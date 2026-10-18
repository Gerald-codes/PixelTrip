"""Tests for the repair loop around the guardrail pipeline.

The pipeline itself is a pure function tested in ``test_guardrails.py``. What is
tested here is the loop *policy*: how many times a failing proposal is
regenerated, what the counter reads at the end, and that nothing is persisted
along the way.

The central claim is Requirement 11.6 / 12.7: the counter advances once per
*evaluation*, not once per finding. A proposal that breaks three rules at once
still costs one attempt, which is what makes an ``Iteration_Cap`` of 3 mean
"three tries".
"""

from __future__ import annotations

import dataclasses
from typing import Any

import pytest
from app.agents.guardrails import run_guardrail_loop
from app.agents.state import AgentState

from tests.agents.conftest import FakeSupabaseClient
from tests.agents.test_messages import resolvable, wired_bundle

RUN = "33333333-3333-3333-3333-333333333333"
TRIP = "11111111-1111-1111-1111-111111111111"
ROOM = "22222222-2222-2222-2222-222222222222"

CAP = 3


def make_state(**overrides: Any) -> AgentState:
    """Build a run state for loop tests."""
    base: dict[str, Any] = {
        "run_id": RUN,
        "trip_id": TRIP,
        "run_type": "discovery",
        "group_profile": {"budget_ceiling": None},
    }
    base.update(overrides)
    return AgentState(**base)


def valid_recommendation(count: int = 3) -> dict[str, Any]:
    """A destination recommendation that passes all three layers."""
    return {
        "title": "Three roads",
        "items": [{"id": f"opt-{i}", "title": f"Option {i}"} for i in range(count)],
        "question": "Which road shall we take?",
    }


def broken_recommendation() -> dict[str, Any]:
    """A proposal that fails structurally — too few items and a stray field."""
    return {
        "title": "One road",
        "items": [{"id": "opt-0", "title": "Only one"}],
        "question": "Which road?",
        "nonsense": True,
    }


class _Producer:
    """A stand-in producing node. Records the states it was called with."""

    def __init__(self, *outputs: dict[str, Any]) -> None:
        self._outputs = list(outputs)
        self.states: list[AgentState] = []

    async def __call__(self, state: AgentState) -> dict[str, Any]:
        self.states.append(state)
        if self._outputs:
            return self._outputs.pop(0)
        return broken_recommendation()

    @property
    def call_count(self) -> int:
        """How many times the node was re-invoked."""
        return len(self.states)


def escalation_client() -> FakeSupabaseClient:
    """A client that accepts the escalation message and completes the run."""
    client = resolvable(FakeSupabaseClient())
    client.queue("rpc:insert_message_turn", [{"id": "m1"}])
    client.queue("agent_runs", [{"id": RUN, "status": "running", "started_at": "T0"}])
    client.queue("agent_runs", [{"id": RUN, "status": "completed"}])
    return client


# ===========================================================================
# Accepting path (Requirement 11.3, 12.11)
# ===========================================================================


async def test_a_valid_proposal_passes_without_regeneration() -> None:
    """The first attempt is not a repair, so the producer is never called."""
    client = FakeSupabaseClient()
    producer = _Producer()

    outcome = await run_guardrail_loop(
        make_state(),
        wired_bundle(client),
        valid_recommendation(),
        "destination_recommendation",
        producer,
        CAP,
    )

    assert outcome.proposal is not None
    assert outcome.escalated is False
    assert producer.call_count == 0
    assert outcome.evaluations == 1


async def test_accepting_path_issues_no_repository_writes() -> None:
    """Requirement 11.3: the caller performs the write, not the loop."""
    client = FakeSupabaseClient()

    await run_guardrail_loop(
        make_state(),
        wired_bundle(client),
        valid_recommendation(),
        "destination_recommendation",
        _Producer(),
        CAP,
    )

    assert client.calls == []


async def test_a_repaired_proposal_is_accepted() -> None:
    """One bad attempt, then a good one: the loop returns the good proposal."""
    client = FakeSupabaseClient()
    producer = _Producer(valid_recommendation())

    outcome = await run_guardrail_loop(
        make_state(),
        wired_bundle(client),
        broken_recommendation(),
        "destination_recommendation",
        producer,
        CAP,
    )

    assert outcome.proposal is not None
    assert producer.call_count == 1
    assert outcome.state.iteration_count == 1
    assert outcome.evaluations == 2
    assert client.calls == []


async def test_findings_are_handed_to_the_producer() -> None:
    """A regeneration without the reasons would just reproduce the same error."""
    producer = _Producer(valid_recommendation())

    await run_guardrail_loop(
        make_state(),
        wired_bundle(FakeSupabaseClient()),
        broken_recommendation(),
        "destination_recommendation",
        producer,
        CAP,
    )

    assert producer.states[0].repair_feedback
    assert all("layer" in f for f in producer.states[0].repair_feedback)


async def test_repair_feedback_is_replaced_not_accumulated() -> None:
    """The node needs this evaluation's reasons, not every past complaint."""
    producer = _Producer(broken_recommendation(), valid_recommendation())

    await run_guardrail_loop(
        make_state(),
        wired_bundle(FakeSupabaseClient()),
        broken_recommendation(),
        "destination_recommendation",
        producer,
        CAP,
    )

    first, second = producer.states[0], producer.states[1]
    assert len(second.repair_feedback) == len(first.repair_feedback)


async def test_findings_accumulate_on_the_state() -> None:
    """Unlike repair feedback, the audit trail of findings is kept whole."""
    producer = _Producer(broken_recommendation(), valid_recommendation())

    outcome = await run_guardrail_loop(
        make_state(),
        wired_bundle(FakeSupabaseClient()),
        broken_recommendation(),
        "destination_recommendation",
        producer,
        CAP,
    )

    assert len(outcome.state.guardrail_findings) > len(outcome.state.repair_feedback)


# ===========================================================================
# Counter semantics (Requirement 11.6, 12.7, 12.8)
# ===========================================================================


async def test_counter_advances_once_per_evaluation_not_per_finding() -> None:
    """Requirement 11.6: many findings in one evaluation still cost one attempt."""
    # Two unknown fields and a missing required one: Pydantic reports all three in
    # a single pass, so this is one evaluation carrying three findings.
    multi_fault = {
        "items": [{"id": "opt-0", "title": "Only one"}],
        "nonsense": True,
        "also_nonsense": 1,
    }
    producer = _Producer(valid_recommendation())
    outcome = await run_guardrail_loop(
        make_state(),
        wired_bundle(FakeSupabaseClient()),
        multi_fault,
        "destination_recommendation",
        producer,
        CAP,
    )

    assert len(outcome.state.guardrail_findings) > 1
    assert outcome.state.iteration_count == 1


async def test_counter_comes_to_rest_exactly_at_the_cap() -> None:
    """Requirement 14.2: at the cap, the counter is neither clamped nor exceeded."""
    client = escalation_client()
    producer = _Producer()

    outcome = await run_guardrail_loop(
        make_state(),
        wired_bundle(client),
        broken_recommendation(),
        "destination_recommendation",
        producer,
        CAP,
    )

    assert outcome.state.iteration_count == CAP
    assert outcome.escalated is True


async def test_producer_is_invoked_exactly_cap_times_before_escalating() -> None:
    """Requirement 14.2: no further re-invocation once the cap is reached."""
    producer = _Producer()

    await run_guardrail_loop(
        make_state(),
        wired_bundle(escalation_client()),
        broken_recommendation(),
        "destination_recommendation",
        producer,
        CAP,
    )

    assert producer.call_count == CAP


async def test_evaluations_are_one_more_than_the_cap_on_escalation() -> None:
    """The first attempt plus one per repair: cap + 1 evaluations in total."""
    outcome = await run_guardrail_loop(
        make_state(),
        wired_bundle(escalation_client()),
        broken_recommendation(),
        "destination_recommendation",
        _Producer(),
        CAP,
    )

    assert outcome.evaluations == CAP + 1


@pytest.mark.parametrize("cap", [1, 2, 5])
async def test_cap_is_honoured_for_any_configured_value(cap: int) -> None:
    """Requirement 12.10: the cap is configuration, not a literal in the loop."""
    producer = _Producer()

    outcome = await run_guardrail_loop(
        make_state(),
        wired_bundle(escalation_client()),
        broken_recommendation(),
        "destination_recommendation",
        producer,
        cap,
    )

    assert producer.call_count == cap
    assert outcome.state.iteration_count == cap


async def test_a_run_already_at_the_cap_escalates_immediately() -> None:
    """A resumed run must not get a fresh repair budget."""
    producer = _Producer()

    outcome = await run_guardrail_loop(
        make_state(iteration_count=CAP),
        wired_bundle(escalation_client()),
        broken_recommendation(),
        "destination_recommendation",
        producer,
        CAP,
    )

    assert producer.call_count == 0
    assert outcome.escalated is True
    assert outcome.state.iteration_count == CAP


# ===========================================================================
# Escalating path (Requirement 12.11, 14.7)
# ===========================================================================


async def test_escalation_path_persists_no_proposal() -> None:
    """Requirement 12.11: a rejected proposal reaches no table."""
    client = escalation_client()

    outcome = await run_guardrail_loop(
        make_state(),
        wired_bundle(client),
        broken_recommendation(),
        "destination_recommendation",
        _Producer(),
        CAP,
    )

    assert outcome.proposal is None
    written = {c.table for c in client.write_calls}
    assert written <= {"rpc:insert_message_turn", "agent_runs"}


async def test_escalation_names_a_guardrail_finding() -> None:
    """The party is told which check failed, drawn from the real findings."""
    client = escalation_client()

    outcome = await run_guardrail_loop(
        make_state(),
        wired_bundle(client),
        broken_recommendation(),
        "destination_recommendation",
        _Producer(),
        CAP,
    )

    assert outcome.escalation is not None
    assert outcome.escalation.constraint


async def test_loop_outcome_is_immutable() -> None:
    """The outcome is a record of what happened, not a mutable accumulator."""
    outcome = await run_guardrail_loop(
        make_state(),
        wired_bundle(FakeSupabaseClient()),
        valid_recommendation(),
        "destination_recommendation",
        _Producer(),
        CAP,
    )

    with pytest.raises(dataclasses.FrozenInstanceError):
        outcome.proposal = None  # type: ignore[misc]
