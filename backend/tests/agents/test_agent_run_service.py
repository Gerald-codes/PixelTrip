"""Tests for AgentRunService: identity resolution, idempotency, and finalization."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from app.agents.errors import (
    IdempotencyKeyConflictError,
    InvalidIdempotencyKeyError,
    InvalidRunTypeError,
    UnresolvedMemberError,
)
from app.repositories.agent_run_repository import AgentRunRepository
from app.repositories.feedback_repository import FeedbackRepository
from app.repositories.itinerary_version_repository import ItineraryVersionRepository
from app.repositories.member_repository import MemberRepository
from app.repositories.message_repository import MessageRepository
from app.repositories.profile_repository import ProfileRepository
from app.repositories.room_repository import RoomRepository
from app.repositories.selection_repository import SelectionRepository
from app.repositories.trip_repository import TripRepository
from app.repositories.vote_repository import VoteRepository
from app.repositories.vote_session_repository import VoteSessionRepository
from app.services.agent_run_service import STALE_RUN_ERROR, AgentRunService

from tests.agents.conftest import FakeSupabaseClient
from tests.agents.test_messages import ROOM, TRIP

MEMBER = "44444444-4444-4444-4444-444444444444"
RUN = "33333333-3333-3333-3333-333333333333"
NEW_RUN = "99999999-9999-9999-9999-999999999999"
KEY = "a-stable-client-key"


def wired_service(client: FakeSupabaseClient) -> AgentRunService:
    """Build an AgentRunService over real repositories and a fake client."""
    return AgentRunService(
        agent_run_repo=AgentRunRepository(client),
        trip_repo=TripRepository(client),
        room_repo=RoomRepository(client),
        message_repo=MessageRepository(client),
        member_repo=MemberRepository(client),
        profile_repo=ProfileRepository(client),
        itinerary_version_repo=ItineraryVersionRepository(client),
        selection_repo=SelectionRepository(client),
        feedback_repo=FeedbackRepository(client),
        vote_session_repo=VoteSessionRepository(client),
        vote_repo=VoteRepository(client),
    )


def member_row(**overrides: Any) -> dict[str, Any]:
    base = {"id": MEMBER, "room_id": ROOM}
    base.update(overrides)
    return base


def pending_run_row(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": RUN,
        "trip_id": TRIP,
        "run_type": "discovery",
        "status": "pending",
        "base_version": 0,
        "result_version_id": None,
        "error": None,
        "started_at": None,
        "created_at": datetime.now(UTC).isoformat(),
    }
    base.update(overrides)
    return base


def wire_quiet_graph_failure(client: FakeSupabaseClient) -> None:
    """Make the graph fail immediately (missing trip) so no node runs.

    Used by tests that only care about pre-graph behaviour (identity,
    idempotency) and want the run to end deterministically rather than hang on
    a placeholder specialist node's ``NotImplementedError`` leaking oddly.
    """
    client.set_default("trips", [])


# ===========================================================================
# Run-type and idempotency-key validation (Requirement 1.5, 4.8)
# ===========================================================================


async def test_an_invalid_run_type_is_rejected_before_any_read() -> None:
    """Requirement 1.5: rejected before member resolution or any run lookup."""
    client = FakeSupabaseClient()

    with pytest.raises(InvalidRunTypeError):
        await wired_service(client).trigger_run(TRIP, "bogus", MEMBER)

    assert client.calls == []


@pytest.mark.parametrize("key", ["", "   ", "x" * 201])
async def test_an_invalid_idempotency_key_is_rejected_before_any_read(key: str) -> None:
    """Requirement 4.8: blank or over-long keys fail fast, before any lookup."""
    client = FakeSupabaseClient()

    with pytest.raises(InvalidIdempotencyKeyError):
        await wired_service(client).trigger_run(TRIP, "discovery", MEMBER, key)

    assert client.calls == []


# ===========================================================================
# Identity resolution (Requirement 22.2-22.3)
# ===========================================================================


async def test_an_unresolved_member_is_rejected_before_any_write() -> None:
    """A client-supplied member id that resolves to nothing is never trusted."""
    client = FakeSupabaseClient()
    client.queue("room_members", [])

    with pytest.raises(UnresolvedMemberError):
        await wired_service(client).trigger_run(TRIP, "discovery", MEMBER)

    assert client.write_calls == []


# ===========================================================================
# Idempotency key matching (Requirement 4.1-4.2, 4.7, 4.9)
# ===========================================================================


async def test_two_calls_with_the_same_key_return_the_same_run() -> None:
    """Requirement 4.2: the second call returns the first's row, no new insert."""
    client = FakeSupabaseClient()
    client.set_default("room_members", [member_row()])
    client.set_default("itinerary_versions", [])
    wire_quiet_graph_failure(client)
    client.queue("agent_runs", [])  # first call: get_by_idempotency_key -> None
    client.queue("agent_runs", [])  # first call: get_active -> None
    client.queue("agent_runs", [pending_run_row(idempotency_key=KEY)])  # create_pending
    client.set_default("agent_runs", [pending_run_row(idempotency_key=KEY)])

    first = await wired_service(client).trigger_run(TRIP, "discovery", MEMBER, KEY)

    client2 = FakeSupabaseClient()
    client2.set_default("room_members", [member_row()])
    client2.queue("agent_runs", [pending_run_row(idempotency_key=KEY)])  # get_by_idempotency_key

    second = await wired_service(client2).trigger_run(TRIP, "discovery", MEMBER, KEY)

    assert second.id == first.id
    assert client2.calls_for("agent_runs")[0].op == "select"
    assert len([c for c in client2.write_calls if c.table == "agent_runs"]) == 0


async def test_a_mismatched_trip_or_run_type_on_the_same_key_conflicts() -> None:
    """Requirement 4.7: a key reused for a different trip/run_type is rejected."""
    client = FakeSupabaseClient()
    client.queue(
        "agent_runs",
        [pending_run_row(trip_id="other-trip", idempotency_key=KEY)],
    )
    client.set_default("room_members", [member_row()])

    with pytest.raises(IdempotencyKeyConflictError):
        await wired_service(client).trigger_run(TRIP, "discovery", MEMBER, KEY)

    assert client.write_calls == []


async def test_no_key_supplied_leaves_idempotency_key_null_on_the_created_row() -> None:
    """Requirement 4.9: no key means the created row's key stays NULL."""
    client = FakeSupabaseClient()
    client.set_default("room_members", [member_row()])
    client.set_default("itinerary_versions", [])
    wire_quiet_graph_failure(client)
    created = pending_run_row()
    client.queue("agent_runs", [])  # get_active -> None
    client.queue("agent_runs", [created])  # create_pending
    client.queue("agent_runs", [created])  # mark_running's get_by_id
    client.set_default("agent_runs", [{**created, "status": "running"}])

    await wired_service(client).trigger_run(TRIP, "discovery", MEMBER)

    insert_call = next(c for c in client.calls_for("agent_runs") if c.op == "insert")
    assert insert_call.payload["idempotency_key"] is None


# ===========================================================================
# Active_Run reuse and stale reclaim (Requirement 3.8, 4.4)
# ===========================================================================


async def test_a_fresh_active_run_is_returned_without_creating_a_new_one() -> None:
    """Requirement 4.4: an existing running attempt is returned, not duplicated."""
    client = FakeSupabaseClient()
    client.set_default("room_members", [member_row()])
    fresh = pending_run_row(status="running", started_at=datetime.now(UTC).isoformat())
    client.queue("agent_runs", [fresh])  # get_active

    result = await wired_service(client).trigger_run(TRIP, "discovery", MEMBER)

    assert result.id == RUN
    assert client.write_calls == []


async def test_a_stale_active_run_is_marked_failed_before_a_new_one_is_created() -> None:
    """Requirement 3.8: an attempt untouched for 300s+ is reclaimed first."""
    client = FakeSupabaseClient()
    client.set_default("room_members", [member_row()])
    client.set_default("itinerary_versions", [])
    wire_quiet_graph_failure(client)
    stale_started = (datetime.now(UTC) - timedelta(seconds=400)).isoformat()
    stale = pending_run_row(status="running", started_at=stale_started)
    new_run = pending_run_row(id=NEW_RUN)
    client.queue("agent_runs", [stale])  # get_active
    client.queue("agent_runs", [stale])  # mark_failed's own get_by_id
    client.queue("agent_runs", [{**stale, "status": "failed"}])  # mark_failed's update
    client.queue("agent_runs", [new_run])  # create_pending
    client.queue("agent_runs", [new_run])  # mark_running's get_by_id
    client.set_default("agent_runs", [{**new_run, "status": "running"}])

    await wired_service(client).trigger_run(TRIP, "discovery", MEMBER)

    fail_call = next(
        c
        for c in client.calls_for("agent_runs")
        if c.op == "update" and c.payload.get("status") == "failed"
    )
    assert fail_call.payload["error"] == STALE_RUN_ERROR
    create_call = next(c for c in client.calls_for("agent_runs") if c.op == "insert")
    assert create_call is not None


async def test_a_pending_run_older_than_the_threshold_uses_created_at() -> None:
    """A run that never left 'pending' has no started_at; created_at is used."""
    client = FakeSupabaseClient()
    client.set_default("room_members", [member_row()])
    client.set_default("itinerary_versions", [])
    wire_quiet_graph_failure(client)
    stale_created = (datetime.now(UTC) - timedelta(seconds=301)).isoformat()
    stale = pending_run_row(status="pending", started_at=None, created_at=stale_created)
    new_run = pending_run_row(id=NEW_RUN)
    client.queue("agent_runs", [stale])  # get_active
    client.queue("agent_runs", [stale])  # mark_failed's own get_by_id
    client.queue("agent_runs", [{**stale, "status": "failed"}])  # mark_failed's update
    client.queue("agent_runs", [new_run])  # create_pending
    client.queue("agent_runs", [new_run])  # mark_running's get_by_id
    client.set_default("agent_runs", [{**new_run, "status": "running"}])

    await wired_service(client).trigger_run(TRIP, "discovery", MEMBER)

    assert any(
        c.op == "update" and c.payload.get("status") == "failed"
        for c in client.calls_for("agent_runs")
    )


async def test_a_recent_active_run_is_not_reclaimed() -> None:
    """A run only seconds old must not be treated as interrupted."""
    client = FakeSupabaseClient()
    client.set_default("room_members", [member_row()])
    recent = pending_run_row(
        status="running", started_at=(datetime.now(UTC) - timedelta(seconds=5)).isoformat()
    )
    client.queue("agent_runs", [recent])  # get_active

    result = await wired_service(client).trigger_run(TRIP, "discovery", MEMBER)

    assert result.id == RUN
    assert client.write_calls == []


# ===========================================================================
# Wire shape (Requirement 4.6)
# ===========================================================================


async def test_the_returned_schema_exposes_exactly_the_seven_documented_fields() -> None:
    """Requirement 4.6: no internal lifecycle column reaches the caller."""
    client = FakeSupabaseClient()
    client.set_default("room_members", [member_row()])
    fresh = pending_run_row(status="running", started_at=datetime.now(UTC).isoformat())
    client.queue("agent_runs", [fresh])  # get_active

    result = await wired_service(client).trigger_run(TRIP, "discovery", MEMBER)

    dumped = result.model_dump(by_alias=True)
    assert set(dumped) == {
        "id",
        "tripId",
        "runType",
        "status",
        "baseVersion",
        "resultVersionId",
        "error",
    }


async def test_the_schema_object_itself_has_no_internal_attributes() -> None:
    """The model simply has no field to leak — not just an unset one."""
    client = FakeSupabaseClient()
    client.set_default("room_members", [member_row()])
    fresh = pending_run_row(status="running", started_at=datetime.now(UTC).isoformat())
    client.queue("agent_runs", [fresh])  # get_active

    result = await wired_service(client).trigger_run(TRIP, "discovery", MEMBER)

    for internal_field in (
        "idempotency_key",
        "created_by_member_id",
        "iteration_count",
        "started_at",
        "completed_at",
    ):
        assert not hasattr(result, internal_field)


# ===========================================================================
# LLM wiring
# ===========================================================================


def test_the_bundle_carries_no_llm_unless_one_was_injected() -> None:
    """Without a client every node stays on its deterministic path."""
    service = wired_service(FakeSupabaseClient())

    assert service.llm_client is None
    assert service._bundle().llm is None


def test_the_bundle_carries_the_injected_llm_client() -> None:
    from dataclasses import replace

    from app.agents.llm import LLMClient

    llm = LLMClient()
    service = replace(wired_service(FakeSupabaseClient()), llm_client=llm)

    assert service._bundle().llm is llm
