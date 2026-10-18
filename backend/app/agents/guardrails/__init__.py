"""The three-layer guardrail pipeline: structural, business, factual.

Layers run in strict sequence, each only on a proposal that passed the previous
one, and **no repository write happens until all three pass**
(Requirement 11.3). The ordering is not arbitrary: structural validation is
free and catches malformed output, business rules are deterministic and cheap,
and factual verification is last because it is the only layer that reasons about
recorded tool responses.

A failed evaluation increments the repair counter by exactly one regardless of
how many findings it produced (Requirement 11.6, 12.7) — the unit of work is the
*evaluation*, not the individual complaint. That is what makes the iteration cap
mean "three attempts" rather than "three complaints".

:class:`GuardrailOutcome` carries the result, and
:func:`run_guardrail_pipeline` is the single entry point nodes call.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from app.agents.guardrails.business import run_business_guardrail
from app.agents.guardrails.escalation import (
    EscalationOutcome,
    build_escalation_content,
    describe_constraint,
    perform_human_escalation,
)
from app.agents.guardrails.factual import run_factual_guardrail
from app.agents.guardrails.structural import validate_structural

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import AgentState, RepositoryBundle

__all__ = [
    "EscalationOutcome",
    "GuardrailOutcome",
    "LoopOutcome",
    "build_escalation_content",
    "describe_constraint",
    "perform_human_escalation",
    "run_business_guardrail",
    "run_factual_guardrail",
    "run_guardrail_loop",
    "run_guardrail_pipeline",
    "validate_structural",
]

#: A producing node: given the state (carrying this evaluation's findings in
#: ``repair_feedback``) it returns a fresh raw proposal.
ProposalProducer = Callable[["AgentState"], Awaitable[Any]]

#: Which layer rejected a proposal, for the caller's message and logs.
LAYER_STRUCTURAL = "structural"
LAYER_BUSINESS = "business"
LAYER_FACTUAL = "factual"


@dataclass(frozen=True)
class GuardrailOutcome:
    """The result of one full pipeline evaluation.

    Attributes:
        passed: Whether every layer accepted the proposal.
        proposal: The validated model when ``passed``, else ``None``. On success
            this carries tool-corrected factual values.
        findings: Every finding from the layer that rejected. Empty on success.
        failed_layer: Which layer rejected, or ``None`` on success.
        provenance: Tool-entry sources for each validated factual element. Held
            for the run only; never persisted.
    """

    passed: bool
    proposal: Any = None
    findings: list[dict[str, Any]] = field(default_factory=list)
    failed_layer: str | None = None
    provenance: dict[str, dict[str, Any]] = field(default_factory=dict)

    @property
    def rejected(self) -> bool:
        """Whether the proposal was rejected by some layer."""
        return not self.passed

    def finding_checks(self) -> list[str]:
        """Return the check or kind identifier of each finding, in order."""
        return [str(f.get("check") or f.get("kind") or "unknown") for f in self.findings]


def run_guardrail_pipeline(
    raw_proposal: Any,
    kind: str,
    group_profile: dict[str, Any] | None = None,
    tool_responses: list[dict[str, Any]] | None = None,
) -> GuardrailOutcome:
    """Run structural, then business, then factual validation.

    Args:
        raw_proposal: The proposal as produced — a mapping or a model instance.
        kind: The proposal kind, keying
            :data:`~app.agents.proposals.PROPOSAL_MODELS`.
        group_profile: The derived group profile, required by the business layer.
        tool_responses: Recorded external tool responses for this run.

    Returns:
        A :class:`GuardrailOutcome`. When ``rejected``, the caller must perform
        **zero** repository writes for this proposal (Requirement 12.11).
    """
    profile = group_profile or {}
    responses = tool_responses or []

    validated, structural_findings = validate_structural(raw_proposal, kind)
    if structural_findings:
        return GuardrailOutcome(
            passed=False,
            findings=structural_findings,
            failed_layer=LAYER_STRUCTURAL,
        )

    business_findings = run_business_guardrail(validated, profile, responses)
    if business_findings:
        return GuardrailOutcome(
            passed=False,
            findings=business_findings,
            failed_layer=LAYER_BUSINESS,
        )

    corrected, factual_findings, provenance = run_factual_guardrail(validated, responses)
    if factual_findings:
        return GuardrailOutcome(
            passed=False,
            findings=factual_findings,
            failed_layer=LAYER_FACTUAL,
        )

    return GuardrailOutcome(passed=True, proposal=corrected, provenance=provenance)


# ---------------------------------------------------------------------------
# Repair loop
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LoopOutcome:
    """The result of the full repair loop around the pipeline.

    Exactly one of ``proposal`` and ``escalation`` is set. ``proposal`` set means
    the caller should now perform its write; ``escalation`` set means the run is
    already terminal and the caller must write nothing.

    Attributes:
        state: The state after the loop, carrying the final ``iteration_count``
            and the accumulated findings.
        proposal: The validated, factually corrected proposal, or ``None``.
        escalation: The escalation outcome, or ``None``.
        evaluations: How many pipeline evaluations ran. Always
            ``iteration_count + 1`` on the escalation path, since the first
            attempt is not a repair.
        provenance: Tool-entry sources for the accepted proposal's factual
            fields. Run-scoped; never persisted.
    """

    state: AgentState
    proposal: Any = None
    escalation: EscalationOutcome | None = None
    evaluations: int = 0
    provenance: dict[str, dict[str, Any]] = field(default_factory=dict)

    @property
    def escalated(self) -> bool:
        """Whether the loop ended by asking the party instead of succeeding."""
        return self.escalation is not None


async def _repair_or_escalate(
    state: AgentState,
    repos: RepositoryBundle,
    findings: list[dict[str, Any]],
    producer: ProposalProducer,
    cap: int,
) -> tuple[AgentState, Any, EscalationOutcome | None]:
    """Either re-invoke the producing node, or escalate at the cap.

    The counter advances by exactly one per *evaluation*, regardless of how many
    findings that evaluation produced (Requirement 11.6, 12.7) — otherwise a
    proposal that broke three rules at once would burn the whole budget in one
    attempt and the cap would stop meaning "three attempts".

    At the cap the counter is deliberately *not* advanced: Requirement 14.2
    requires it to come to rest exactly at the cap.

    Returns:
        ``(state, new_raw_proposal, None)`` to continue looping, or
        ``(state, None, outcome)`` when escalated.
    """
    if state.iteration_count >= cap:
        outcome = await perform_human_escalation(state, repos, findings)
        return state, None, outcome

    state = state.with_incremented_iteration(cap).with_repair_feedback(findings)
    return state, await producer(state), None


async def run_guardrail_loop(
    state: AgentState,
    repos: RepositoryBundle,
    raw_proposal: Any,
    kind: str,
    producer: ProposalProducer,
    cap: int,
    tool_responses: list[dict[str, Any]] | None = None,
) -> LoopOutcome:
    """Evaluate, repair, and escalate until a proposal passes or the cap is hit.

    This is the only place the repair loop is expressed. It issues **zero**
    repository writes on the accepting path — the caller performs the write once
    it holds :attr:`LoopOutcome.proposal` (Requirement 11.3, 12.11) — and on the
    escalating path the only writes are the escalation's own message and run
    update.

    Args:
        state: The run state at loop entry.
        repos: The repository bundle, used only to escalate.
        raw_proposal: The first proposal to evaluate.
        kind: The proposal kind, keying
            :data:`~app.agents.proposals.PROPOSAL_MODELS`.
        producer: Called to regenerate after a failed evaluation, with the
            findings on ``state.repair_feedback``.
        cap: The run's ``Iteration_Cap``, read from ``Settings`` by the caller.
        tool_responses: Recorded tool responses. Defaults to the state's own.

    Returns:
        A :class:`LoopOutcome`.
    """
    current = raw_proposal
    evaluations = 0

    while True:
        responses = tool_responses if tool_responses is not None else state.external_tool_responses
        outcome = run_guardrail_pipeline(current, kind, state.group_profile, responses)
        evaluations += 1

        if outcome.passed:
            return LoopOutcome(
                state=state,
                proposal=outcome.proposal,
                evaluations=evaluations,
                provenance=outcome.provenance,
            )

        state = state.append_guardrail_findings(outcome.findings)
        state, current, escalation = await _repair_or_escalate(
            state, repos, outcome.findings, producer, cap
        )
        if escalation is not None:
            return LoopOutcome(state=state, escalation=escalation, evaluations=evaluations)
