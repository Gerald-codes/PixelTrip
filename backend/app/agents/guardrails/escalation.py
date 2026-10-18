"""Human escalation — how a run ends when guardrails cannot be satisfied.

When the repair loop reaches the ``Iteration_Cap`` with a proposal still failing,
the agent does not persist anything and does not keep retrying. It asks the party
a question and stops.

Three design points are easy to get wrong, so they are stated plainly:

* **Escalation completes the run, it does not fail it** (Requirement 14.5,
  Assumption 15). ``agent_run_status`` has no ``escalated`` value, and the
  escalation *is* a successfully delivered NPC request. So ``status='completed'``,
  ``error`` stays NULL, and ``result_version_id`` stays NULL. A run that reads as
  ``failed`` would tell the frontend something broke, which is wrong.

* **Only ``messages`` and ``agent_runs`` are written** (Requirement 14.7). No
  ``itinerary_versions`` row, no ``selections`` row, no ``trips.status`` change —
  the party's recorded plan must look exactly as it did before the run started.
  This module does not hold references to those repositories at all, which is the
  cheapest way to make that guarantee structural rather than conventional.

* **The escalation message is a prompt, not a report.** Exactly one question and
  2-4 concrete options (Requirement 14.3-14.4), because a party that is told
  "no itinerary satisfies your constraints" with no next action is stuck.

A reply to the escalation starts a *new* run; this one is terminal
(Requirement 14.8-14.9), which is why nothing here leaves the run resumable.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from app.agents.messages import (
    MAX_ESCALATION_OPTIONS,
    MAX_OPTION_LABEL_LENGTH,
    MIN_TEXT_OPTIONS,
    QuickReplyOption,
    TextMessageContent,
    emit_npc_message,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import AgentState, RepositoryBundle

logger = logging.getLogger(__name__)

#: ``agent_runs.run_type`` -> the in-world stage carried on ``content.stage``
#: (Requirement 14.3). Uppercase to match the frontend's stage vocabulary.
STAGE_BY_RUN_TYPE: dict[str, str] = {
    "discovery": "DISCOVER",
    "logistics": "LOGISTICS",
    "itinerary": "BUILD",
    "refinement": "REFINE",
}

#: Fallback constraint wording when findings carry nothing more specific. Phrased
#: as a statement, never a question, so the one-question rule still holds once the
#: question is appended.
DEFAULT_CONSTRAINT = "I could not find a plan that satisfies all of the party's constraints"

#: Fallback question. Open enough to apply to any stage.
DEFAULT_QUESTION = "How would you like to proceed?"

#: Fallback options. Always within the 2-4 bound (Requirement 14.4).
DEFAULT_OPTIONS: tuple[tuple[str, str], ...] = (
    ("relax_budget", "Raise our budget"),
    ("widen_dates", "Widen our travel dates"),
    ("relax_constraints", "Drop a must-have"),
)

#: Requirement 14.6: a display-safe summary. Fixed strings only — never an
#: exception's own message, which may carry provider response text or a URL with
#: a credential in it.
ESCALATION_WRITE_FAILED_ERROR = (
    "The guide could not deliver its question to the party. Please try again."
)


@dataclass(frozen=True)
class EscalationOutcome:
    """The result of an escalation attempt.

    Attributes:
        escalated: ``True`` when the NPC message was delivered and the run was
            completed. ``False`` when the message write failed and the run was
            marked failed instead.
        message: The inserted ``messages`` row, or ``None`` on the failure path.
        run: The updated ``agent_runs`` row, or ``None`` if even that write
            failed.
        constraint: The constraint named to the party, for logging and tests.
        options: The ``{id, label}`` entries offered.
    """

    escalated: bool
    message: dict[str, Any] | None = None
    run: dict[str, Any] | None = None
    constraint: str = ""
    options: list[dict[str, str]] = field(default_factory=list)


def describe_constraint(findings: list[dict[str, Any]] | None) -> str:
    """Name the constraint that could not be satisfied (Requirement 14.3).

    Prefers an explicit ``message`` on the first finding, then its ``check``
    identifier, then the generic fallback. Any trailing ``?`` is stripped: the
    constraint is a statement, and the single question comes after it.
    """
    for finding in findings or []:
        text = str(finding.get("message") or "").strip()
        if not text:
            check = str(finding.get("check") or finding.get("kind") or "").strip()
            text = f"the {check.replace('_', ' ')} check could not be satisfied" if check else ""
        if text:
            return text.rstrip("?").rstrip().rstrip(".")
    return DEFAULT_CONSTRAINT


def _normalise_options(
    options: list[tuple[str, str]] | list[dict[str, str]] | None,
) -> list[QuickReplyOption]:
    """Coerce caller-supplied options into 2-4 valid quick replies.

    Rather than rejecting a caller that offered too many, the list is truncated to
    the cap and topped up from :data:`DEFAULT_OPTIONS` if too short. An escalation
    that raised on its own option list would turn a recoverable "ask the party"
    into a hard run failure, which is the one outcome this whole path exists to
    avoid.
    """
    raw = list(options) if options else list(DEFAULT_OPTIONS)

    normalised: list[QuickReplyOption] = []
    seen: set[str] = set()
    for entry in raw:
        if isinstance(entry, QuickReplyOption):
            option_id, label = entry.id, entry.label
        elif isinstance(entry, dict):
            option_id, label = str(entry.get("id", "")), str(entry.get("label", ""))
        else:
            option_id, label = str(entry[0]), str(entry[1])

        option_id, label = option_id.strip(), label.strip()
        if not option_id or not label or option_id in seen:
            continue
        seen.add(option_id)
        normalised.append(QuickReplyOption(id=option_id, label=label[:MAX_OPTION_LABEL_LENGTH]))
        if len(normalised) == MAX_ESCALATION_OPTIONS:
            break

    for option_id, label in DEFAULT_OPTIONS:
        if len(normalised) >= MIN_TEXT_OPTIONS:
            break
        if option_id not in seen:
            seen.add(option_id)
            normalised.append(QuickReplyOption(id=option_id, label=label))

    return normalised


def build_escalation_content(
    run_type: str,
    constraint: str,
    question: str = DEFAULT_QUESTION,
    options: list[tuple[str, str]] | list[dict[str, str]] | None = None,
) -> TextMessageContent:
    """Build the single ``kind='text'`` escalation content.

    The constraint is stated, then exactly one question is asked
    (Requirement 14.3). ``TextMessageContent`` enforces the one-question rule, so
    a constraint string that smuggled in a ``?`` would be caught there rather
    than reaching the party as two questions.
    """
    statement = constraint.rstrip("?").rstrip().rstrip(".")
    asked = question.strip()
    if not asked.endswith("?"):
        asked = f"{asked}?"

    return TextMessageContent(
        text=f"{statement}. {asked}",
        stage=STAGE_BY_RUN_TYPE.get(run_type),
        options=_normalise_options(options),
    )


async def perform_human_escalation(
    state: AgentState,
    repos: RepositoryBundle,
    findings: list[dict[str, Any]] | None = None,
    *,
    constraint: str | None = None,
    question: str = DEFAULT_QUESTION,
    options: list[tuple[str, str]] | list[dict[str, str]] | None = None,
) -> EscalationOutcome:
    """Escalate to the party and terminate the run.

    Emits exactly one ``kind='text'`` message, then completes the run. On a
    message-write failure the run is marked ``failed`` with a display-safe
    summary (Requirement 14.6) — the party never saw the question, so reporting
    the run as completed would be a lie.

    Neither path writes ``itinerary_versions``, ``selections``, or
    ``trips.status`` (Requirement 14.7).

    Args:
        state: The run's state. Supplies ``run_id``, ``trip_id``, ``run_type``.
        repos: The repository bundle.
        findings: Guardrail findings used to name the constraint when
            ``constraint`` is not given explicitly.
        constraint: Overrides the constraint derived from ``findings``.
        question: The single question put to the party.
        options: 2-4 ``{id, label}`` ways to relax the constraint. Defaults are
            substituted when absent.

    Returns:
        An :class:`EscalationOutcome`. Never raises for an expected failure: the
        outcome's ``escalated`` flag carries which path was taken.
    """
    named = constraint if constraint is not None else describe_constraint(findings)
    content = build_escalation_content(state.run_type, named, question, options)
    option_rows = [{"id": o.id, "label": o.label} for o in (content.options or [])]

    try:
        message = await emit_npc_message(repos, state.trip_id, "text", content)
    except Exception as exc:
        logger.warning("Escalation message failed for run %s: %s", state.run_id, type(exc).__name__)
        run = await _try_mark_failed(repos, state.run_id)
        return EscalationOutcome(escalated=False, run=run, constraint=named, options=option_rows)

    run = await repos.agent_run_repo.mark_completed(state.run_id, result_version_id=None)
    return EscalationOutcome(
        escalated=True,
        message=message,
        run=run,
        constraint=named,
        options=option_rows,
    )


async def _try_mark_failed(repos: RepositoryBundle, run_id: str) -> dict[str, Any] | None:
    """Mark the run failed, tolerating a second failure.

    If the database is unreachable, the message write and this write fail for the
    same reason. Raising here would replace the already-logged cause with a less
    informative one, so the outcome simply reports no run row.
    """
    try:
        return await repos.agent_run_repo.mark_failed(run_id, ESCALATION_WRITE_FAILED_ERROR)
    except Exception as exc:
        logger.warning(
            "Could not mark run %s failed after escalation: %s",
            run_id,
            type(exc).__name__,
        )
        return None
