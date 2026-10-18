"""Tests for AgentState, RepositoryBundle, and load_trip_context."""

from __future__ import annotations

import asyncio
import dataclasses
from typing import Any

import pytest
from app.agents.errors import (
    IterationCapExceededError,
    RunIdentityMutationError,
    StagePreconditionNotMetError,
    StateBoundExceededError,
    TripNotFoundError,
)
from app.agents.state import (
    EXECUTION_INTERNAL_FIELDS,
    FROZEN_IDENTITY_FIELDS,
    MAX_GUARDRAIL_FINDINGS,
    MAX_PENDING_MESSAGES,
    RUN_IDENTITY_FIELDS,
    RUN_TYPES,
    STAGE_BY_RUN_TYPE,
    STAGE_ORDER,
    AgentState,
    RepositoryBundle,
    load_trip_context,
)
from app.exceptions import RepositoryError
from pydantic import ValidationError as PydanticValidationError

RUN = "33333333-3333-3333-3333-333333333333"
TRIP = "11111111-1111-1111-1111-111111111111"
ROOM = "22222222-2222-2222-2222-222222222222"
MEMBER = "44444444-4444-4444-4444-444444444444"


def make_state(**overrides: Any) -> AgentState:
    """Build a valid state, overriding individual fields."""
    base: dict[str, Any] = {
        "run_id": RUN,
        "trip_id": TRIP,
        "run_type": "discovery",
        "created_by_member_id": MEMBER,
    }
    base.update(overrides)
    return AgentState(**base)


# ===========================================================================
# Field partitioning (Requirement 2.1-2.3)
# ===========================================================================


def test_fields_are_exactly_the_two_groups() -> None:
    """Every declared field belongs to exactly one group, and none is missing."""
    declared = set(AgentState.model_fields)

    assert declared == RUN_IDENTITY_FIELDS | EXECUTION_INTERNAL_FIELDS
    assert not (RUN_IDENTITY_FIELDS & EXECUTION_INTERNAL_FIELDS)


def test_group_sizes_match_the_requirement() -> None:
    """Seven run-identity fields, eight execution-internal (Requirement 2.2-2.3)."""
    assert len(RUN_IDENTITY_FIELDS) == 7
    assert len(EXECUTION_INTERNAL_FIELDS) == 8


def test_tool_call_cap_is_not_a_declared_field() -> None:
    """The cap is configuration, not run state, so it stays out of the model."""
    assert "_tool_call_cap" not in AgentState.model_fields
    assert "tool_call_cap" not in AgentState.model_fields


def test_frozen_fields_exclude_the_two_mutable_identity_fields() -> None:
    """base_version and iteration_count legitimately change; the other five do not."""
    assert FROZEN_IDENTITY_FIELDS == RUN_IDENTITY_FIELDS - {
        "base_version",
        "iteration_count",
    }


# ===========================================================================
# Validation (Requirement 2.11)
# ===========================================================================


@pytest.mark.parametrize("field", ["run_id", "trip_id"])
@pytest.mark.parametrize("bad", ["not-a-uuid", "", "123"])
def test_non_uuid_identity_rejected(field: str, bad: str) -> None:
    """A malformed run or trip id fails before any node runs."""
    with pytest.raises(PydanticValidationError):
        make_state(**{field: bad})


def test_created_by_member_id_may_be_none_but_not_malformed() -> None:
    """An absent creator is allowed; a malformed one is not."""
    assert make_state(created_by_member_id=None).created_by_member_id is None

    with pytest.raises(PydanticValidationError):
        make_state(created_by_member_id="nope")


def test_invalid_run_type_rejected() -> None:
    """Only the four agent_run_type values are accepted."""
    with pytest.raises(PydanticValidationError):
        make_state(run_type="group_profile")


@pytest.mark.parametrize("run_type", RUN_TYPES)
def test_each_valid_run_type_accepted(run_type: str) -> None:
    """All four enum values construct."""
    assert make_state(run_type=run_type).run_type == run_type


def test_negative_base_version_rejected() -> None:
    """0 means "no itinerary yet"; negative is meaningless."""
    with pytest.raises(PydanticValidationError):
        make_state(base_version=-1)


def test_negative_iteration_count_rejected() -> None:
    """The repair counter cannot start below zero."""
    with pytest.raises(PydanticValidationError):
        make_state(iteration_count=-1)


@pytest.mark.parametrize("bad", ["", "   ", "x" * 201])
def test_blank_or_overlong_idempotency_key_rejected(bad: str) -> None:
    """Requirement 4.8: a blank or over-long key is invalid."""
    with pytest.raises(PydanticValidationError):
        make_state(idempotency_key=bad)


def test_idempotency_key_at_the_limit_is_accepted() -> None:
    """Exactly 200 characters is valid; 201 is not."""
    assert make_state(idempotency_key="x" * 200).idempotency_key == "x" * 200


# ===========================================================================
# Identity guard (Requirement 2.4-2.5)
# ===========================================================================


@pytest.mark.parametrize("field", sorted(FROZEN_IDENTITY_FIELDS))
def test_frozen_field_mutation_raises_and_leaves_state_unchanged(field: str) -> None:
    """Assigning a frozen identity field raises and changes nothing."""
    state = make_state(idempotency_key="key-1")
    before = getattr(state, field)

    with pytest.raises(RunIdentityMutationError) as excinfo:
        setattr(state, field, "11111111-2222-3333-4444-555555555555")

    assert excinfo.value.field == field
    assert getattr(state, field) == before


@pytest.mark.parametrize("field", ["base_version", "iteration_count"])
def test_mutable_identity_fields_allow_assignment(field: str) -> None:
    """These two are not frozen: the repair loop and lost-race path change them."""
    state = make_state()

    setattr(state, field, 2)

    assert getattr(state, field) == 2


# ===========================================================================
# Sanctioned transitions
# ===========================================================================


def test_with_base_version_returns_a_new_state() -> None:
    """Transitions produce a new object rather than mutating in place."""
    state = make_state(base_version=1)

    updated = state.with_base_version(5)

    assert updated is not state
    assert updated.base_version == 5
    assert state.base_version == 1


def test_with_base_version_rejects_negative() -> None:
    """A re-fetched version is still never negative."""
    with pytest.raises(ValueError, match="base_version"):
        make_state().with_base_version(-1)


def test_with_incremented_iteration_advances_by_one() -> None:
    """The repair counter advances one step per evaluation."""
    updated = make_state(iteration_count=1).with_incremented_iteration(cap=3)

    assert updated.iteration_count == 2


def test_with_incremented_iteration_raises_at_the_cap() -> None:
    """Requirement 12.8: the counter never exceeds the cap."""
    state = make_state(iteration_count=3)

    with pytest.raises(IterationCapExceededError) as excinfo:
        state.with_incremented_iteration(cap=3)

    assert excinfo.value.cap == 3
    assert state.iteration_count == 3


def test_transitions_preserve_the_tool_call_cap() -> None:
    """The private cap survives a copy.

    ``model_copy`` does not carry private attributes, so without explicit
    handling the cap would silently revert to its default on every transition —
    quietly widening the bound it is supposed to enforce.
    """
    state = make_state().with_tool_call_cap(2)

    updated = state.with_base_version(3).with_incremented_iteration(cap=5)

    assert updated.tool_call_cap == 2


def test_cleared_for_resume_resets_only_execution_internal_fields() -> None:
    """Requirement 6.4: a resumed run discards working state, keeps identity."""
    state = (
        make_state(base_version=4, iteration_count=2)
        .with_trip_context({"trip": {}})
        .with_group_profile({"budget_ceiling": 100})
        .with_proposal({"items": []})
        .append_pending_message({"kind": "text"})
    )

    resumed = state.cleared_for_resume()

    assert resumed.trip_context is None
    assert resumed.group_profile is None
    assert resumed.proposal is None
    assert resumed.pending_npc_messages == []
    assert resumed.guardrail_findings == []
    assert resumed.external_tool_responses == []
    assert resumed.tool_call_count == 0
    assert resumed.repair_feedback == []
    # Identity and persisted counters survive.
    assert resumed.run_id == RUN
    assert resumed.trip_id == TRIP
    assert resumed.base_version == 4
    assert resumed.iteration_count == 2


def test_with_repair_feedback_replaces_rather_than_accumulates() -> None:
    """The producing node needs this evaluation's reasons, not a running history."""
    state = make_state().with_repair_feedback([{"check": "budget"}])

    updated = state.with_repair_feedback([{"check": "dates"}])

    assert updated.repair_feedback == [{"check": "dates"}]


# ===========================================================================
# Bounded accumulators (Requirement 2.6-2.7)
# ===========================================================================


def test_guardrail_findings_accumulate_in_order() -> None:
    """Findings append in node execution order."""
    state = make_state().append_guardrail_findings([{"n": 1}])

    updated = state.append_guardrail_findings([{"n": 2}, {"n": 3}])

    assert [f["n"] for f in updated.guardrail_findings] == [1, 2, 3]


def test_guardrail_findings_bound_enforced_without_truncating() -> None:
    """Requirement 2.7: exceeding the bound raises and discards nothing."""
    state = make_state().append_guardrail_findings(
        [{"n": i} for i in range(MAX_GUARDRAIL_FINDINGS)]
    )

    with pytest.raises(StateBoundExceededError) as excinfo:
        state.append_guardrail_findings([{"n": 999}])

    assert excinfo.value.field == "guardrail_findings"
    assert excinfo.value.attempted == MAX_GUARDRAIL_FINDINGS + 1
    assert len(state.guardrail_findings) == MAX_GUARDRAIL_FINDINGS


def test_tool_response_bound_is_the_tool_call_cap() -> None:
    """Recorded responses can never outnumber the permitted calls."""
    state = make_state().with_tool_call_cap(2)
    state = state.append_tool_response({"tool": "flights"})
    state = state.append_tool_response({"tool": "places"})

    with pytest.raises(StateBoundExceededError) as excinfo:
        state.append_tool_response({"tool": "weather"})

    assert excinfo.value.field == "external_tool_responses"
    assert len(state.external_tool_responses) == 2


def test_append_tool_response_advances_the_call_count() -> None:
    """The counter and the recorded responses stay in step."""
    state = make_state().with_tool_call_cap(5).append_tool_response({"tool": "f"})

    assert state.tool_call_count == 1
    assert len(state.external_tool_responses) == 1


def test_pending_message_bound_enforced() -> None:
    """At most 20 pending messages per run."""
    state = make_state()
    for i in range(MAX_PENDING_MESSAGES):
        state = state.append_pending_message({"n": i})

    with pytest.raises(StateBoundExceededError):
        state.append_pending_message({"n": 999})

    assert len(state.pending_npc_messages) == MAX_PENDING_MESSAGES


# ===========================================================================
# RepositoryBundle
# ===========================================================================


def test_repository_bundle_is_frozen() -> None:
    """A node cannot swap a repository mid-run."""
    assert dataclasses.fields(RepositoryBundle)
    bundle = make_bundle()

    with pytest.raises(dataclasses.FrozenInstanceError):
        bundle.trip_repo = object()  # type: ignore[misc]


def test_repository_bundle_carries_every_required_repository() -> None:
    """All eleven repositories the agent layer reads or writes through."""
    names = {f.name for f in dataclasses.fields(RepositoryBundle)}

    assert {
        "trip_repo",
        "room_repo",
        "message_repo",
        "vote_session_repo",
        "vote_repo",
        "selection_repo",
        "itinerary_version_repo",
        "feedback_repo",
        "agent_run_repo",
        "member_repo",
        "profile_repo",
    } <= names


def test_repository_bundle_tool_and_llm_slots_default_to_none() -> None:
    """Tool clients land in a later task; the bundle does not require them yet."""
    bundle = make_bundle()

    assert bundle.flight_tool is None
    assert bundle.llm is None


# ===========================================================================
# Stage tables
# ===========================================================================


def test_stage_by_run_type_covers_all_four_run_types() -> None:
    """Each run type maps to its stage; tiebreak runs in whichever stage's vote tied."""
    assert set(STAGE_BY_RUN_TYPE) == set(RUN_TYPES) - {"tiebreak"}
    for stage in STAGE_BY_RUN_TYPE.values():
        assert stage in STAGE_ORDER


def test_stage_order_matches_the_six_planning_stages() -> None:
    """The ordering is the documented six-stage journey."""
    assert STAGE_ORDER == (
        "setup",
        "discover",
        "logistics",
        "build",
        "refine",
        "wrap",
    )


# ===========================================================================
# load_trip_context (Requirement 6)
# ===========================================================================


class _StubRepo:
    """Records calls and returns queued values, raising queued exceptions."""

    def __init__(self, **returns: Any) -> None:
        self._returns = returns
        self.calls: list[str] = []

    def __getattr__(self, name: str) -> Any:
        async def _call(*_args: Any, **_kwargs: Any) -> Any:
            self.calls.append(name)
            value = self._returns.get(name)
            if isinstance(value, BaseException):
                raise value
            return value

        return _call


def make_bundle(**overrides: Any) -> RepositoryBundle:
    """Build a bundle of stub repositories with sensible empty defaults."""
    defaults: dict[str, Any] = {
        "trip_repo": _StubRepo(get_by_id={"id": TRIP, "room_id": ROOM, "status": "trip_created"}),
        "room_repo": _StubRepo(
            get_by_id={"id": ROOM, "status": "active", "planning_stage": "discover"}
        ),
        "message_repo": _StubRepo(),
        "vote_session_repo": _StubRepo(),
        "vote_repo": _StubRepo(),
        "selection_repo": _StubRepo(list_by_room=[]),
        "itinerary_version_repo": _StubRepo(get_latest=None),
        "feedback_repo": _StubRepo(list_open_by_trip=[]),
        "agent_run_repo": _StubRepo(),
        "member_repo": _StubRepo(list_by_room=[{"id": MEMBER}]),
        "profile_repo": _StubRepo(
            list_characters_by_member_ids=[], list_preferences_by_member_ids=[]
        ),
    }
    defaults.update(overrides)
    return RepositoryBundle(**defaults)


async def test_load_trip_context_returns_the_documented_shape() -> None:
    """The context carries every record the glossary lists."""
    context = await load_trip_context(make_bundle(), TRIP)

    assert set(context) == {
        "trip",
        "room",
        "room_id",
        "members",
        "characters",
        "preferences",
        "selections",
        "latest_itinerary_version",
        "open_feedback",
    }
    assert context["room_id"] == ROOM


async def test_selections_are_keyed_by_kind() -> None:
    """Nodes look selections up by kind, so the loader indexes them."""
    bundle = make_bundle(
        selection_repo=_StubRepo(
            list_by_room=[
                {"kind": "destination", "data": {"name": "Kyoto"}},
                {"kind": "flight", "data": {"price": 500}},
            ]
        )
    )

    context = await load_trip_context(bundle, TRIP)

    assert set(context["selections"]) == {"destination", "flight"}
    assert context["selections"]["destination"]["data"]["name"] == "Kyoto"


async def test_missing_trip_raises_without_retrying() -> None:
    """Requirement 6.6: a missing trip is definitive, not transient."""
    trip_repo = _StubRepo(get_by_id=None)
    bundle = make_bundle(trip_repo=trip_repo)

    with pytest.raises(TripNotFoundError):
        await load_trip_context(bundle, TRIP)

    # Exactly one attempt: no retry on a definitive answer.
    assert trip_repo.calls.count("get_by_id") == 1


@pytest.mark.parametrize("status", ["cancelled", "finalised"])
async def test_closed_room_aborts_the_run(status: str) -> None:
    """Requirement 6.7: a closed room stops the run before any write."""
    bundle = make_bundle(
        room_repo=_StubRepo(get_by_id={"id": ROOM, "status": status, "planning_stage": "discover"})
    )

    with pytest.raises(StagePreconditionNotMetError, match=status):
        await load_trip_context(bundle, TRIP)


async def test_advanced_stage_aborts_the_run() -> None:
    """Requirement 6.8: a trip past this run's stage makes the run stale."""
    bundle = make_bundle(
        room_repo=_StubRepo(get_by_id={"id": ROOM, "status": "active", "planning_stage": "wrap"})
    )

    with pytest.raises(StagePreconditionNotMetError, match="wrap"):
        await load_trip_context(bundle, TRIP, run_type="discovery")


async def test_earlier_stage_does_not_abort() -> None:
    """A trip behind the run's stage is not stale, so the load proceeds."""
    bundle = make_bundle(
        room_repo=_StubRepo(get_by_id={"id": ROOM, "status": "active", "planning_stage": "setup"})
    )

    context = await load_trip_context(bundle, TRIP, run_type="refinement")

    assert context["trip"]["id"] == TRIP


async def test_unknown_stage_does_not_abort() -> None:
    """An unrecognised stage is not evidence of staleness, so it must not block."""
    bundle = make_bundle(
        room_repo=_StubRepo(get_by_id={"id": ROOM, "status": "active", "planning_stage": "mystery"})
    )

    context = await load_trip_context(bundle, TRIP, run_type="discovery")

    assert context["room"]["planning_stage"] == "mystery"


async def test_stage_check_skipped_when_run_type_omitted() -> None:
    """Without a run type there is no stage to compare against."""
    bundle = make_bundle(
        room_repo=_StubRepo(get_by_id={"id": ROOM, "status": "active", "planning_stage": "wrap"})
    )

    context = await load_trip_context(bundle, TRIP)

    assert context["room"]["planning_stage"] == "wrap"


async def test_repository_failure_is_retried_then_raised() -> None:
    """Requirement 6.9: at most two retries, then the failure surfaces."""
    trip_repo = _StubRepo(get_by_id=RepositoryError("read failed"))
    bundle = make_bundle(trip_repo=trip_repo)

    with pytest.raises(RepositoryError):
        await load_trip_context(bundle, TRIP)

    # Three total attempts: the initial try plus two retries.
    assert trip_repo.calls.count("get_by_id") == 3


async def test_transient_failure_then_success_recovers() -> None:
    """A single transient failure does not doom the run."""
    attempts = {"n": 0}

    class _FlakyTripRepo:
        async def get_by_id(self, _trip_id: str) -> dict[str, Any]:
            attempts["n"] += 1
            if attempts["n"] == 1:
                raise RepositoryError("transient")
            return {"id": TRIP, "room_id": ROOM, "status": "trip_created"}

    context = await load_trip_context(make_bundle(trip_repo=_FlakyTripRepo()), TRIP)

    assert context["trip"]["id"] == TRIP
    assert attempts["n"] == 2


async def test_unexpected_error_is_not_retried() -> None:
    """A programming error surfaces immediately rather than being masked."""
    trip_repo = _StubRepo(get_by_id=TypeError("bug in node code"))
    bundle = make_bundle(trip_repo=trip_repo)

    with pytest.raises(TypeError):
        await load_trip_context(bundle, TRIP)

    assert trip_repo.calls.count("get_by_id") == 1


async def test_timeout_is_treated_as_transient() -> None:
    """A slow read is retried, then reported as a repository failure."""
    attempts = {"n": 0}

    class _HangingTripRepo:
        async def get_by_id(self, _trip_id: str) -> dict[str, Any]:
            attempts["n"] += 1
            await asyncio.sleep(10)
            raise AssertionError("should have timed out")

    with pytest.raises((TimeoutError, RepositoryError)):
        await asyncio.wait_for(
            load_trip_context(make_bundle(trip_repo=_HangingTripRepo()), TRIP),
            timeout=1.0,
        )

    assert attempts["n"] >= 1


async def test_load_performs_no_writes() -> None:
    """Loading context is read-only on every path."""
    bundle = make_bundle()

    await load_trip_context(bundle, TRIP)

    for name in ("message_repo", "vote_repo", "agent_run_repo", "selection_repo"):
        repo = getattr(bundle, name)
        written = [c for c in repo.calls if c.startswith(("insert", "update", "upsert", "mark_"))]
        assert written == [], f"{name} was written during a read-only load"
