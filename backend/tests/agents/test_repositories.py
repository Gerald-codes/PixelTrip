"""Unit tests for the eight agent-layer repositories.

Each test drives a real query-builder chain against
:class:`~tests.agents.conftest.FakeSupabaseClient`, so a wrong table, missing
filter, or wrong conflict target fails rather than passing against a loose mock.
"""

from __future__ import annotations

import pytest
from app.agents.errors import (
    DuplicateApprovalError,
    IdempotencyKeyConflictError,
    RunStatusTransitionError,
)
from app.exceptions import RepositoryError
from app.repositories.agent_run_repository import (
    ALLOWED_TRANSITIONS,
    AgentRunRepository,
)
from app.repositories.feedback_repository import FeedbackRepository
from app.repositories.itinerary_version_repository import (
    ItineraryVersionRepository,
    UniqueVersionViolation,
)
from app.repositories.message_repository import (
    MAX_MESSAGES_PER_TURN,
    MessageRepository,
)
from app.repositories.selection_repository import SelectionRepository
from app.repositories.trip_repository import TripRepository
from app.repositories.vote_repository import VoteRepository
from app.repositories.vote_session_repository import VoteSessionRepository

from tests.agents.conftest import (
    FakePostgresError,
    FakeSupabaseClient,
    unique_violation,
)

TRIP = "11111111-1111-1111-1111-111111111111"
ROOM = "22222222-2222-2222-2222-222222222222"
RUN = "33333333-3333-3333-3333-333333333333"
MEMBER = "44444444-4444-4444-4444-444444444444"
SESSION = "55555555-5555-5555-5555-555555555555"
VERSION_ID = "66666666-6666-6666-6666-666666666666"


# ===========================================================================
# TripRepository
# ===========================================================================


async def test_get_room_id_for_trip_returns_room_id(fake_client: FakeSupabaseClient) -> None:
    """The trip -> room bridge returns the room id."""
    fake_client.queue("trips", [{"room_id": ROOM}])
    repo = TripRepository(fake_client)

    assert await repo.get_room_id_for_trip(TRIP) == ROOM
    call = fake_client.calls_for("trips")[0]
    assert call.has_filter("id", TRIP)


async def test_get_room_id_for_trip_returns_none_when_absent(
    fake_client: FakeSupabaseClient,
) -> None:
    """A missing trip yields None rather than raising."""
    fake_client.queue("trips", [])
    repo = TripRepository(fake_client)

    assert await repo.get_room_id_for_trip(TRIP) is None


async def test_update_status_calls_rpc_once_with_both_values(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 18.10: status and stage move through one atomic RPC."""
    fake_client.queue("rpc:set_trip_status_and_stage", [{"id": TRIP, "status": "flight_selected"}])
    repo = TripRepository(fake_client)

    await repo.update_status(TRIP, "flight_selected", "build")

    rpc_calls = fake_client.calls_for("rpc:set_trip_status_and_stage")
    assert len(rpc_calls) == 1
    assert rpc_calls[0].payload == {
        "p_trip_id": TRIP,
        "p_status": "flight_selected",
        "p_planning_stage": "build",
    }
    # No direct table writes: the pair must not be updated separately.
    assert fake_client.calls_for("trips") == []
    assert fake_client.calls_for("party_rooms") == []


async def test_update_status_wraps_failure(fake_client: FakeSupabaseClient) -> None:
    """An RPC failure surfaces as RepositoryError, not a raw driver error."""
    fake_client.queue("rpc:set_trip_status_and_stage", FakePostgresError("boom"))
    repo = TripRepository(fake_client)

    with pytest.raises(RepositoryError):
        await repo.update_status(TRIP, "trip_approved", "wrap")


# ===========================================================================
# MessageRepository
# ===========================================================================


async def test_insert_turn_sends_all_messages_in_one_rpc(
    fake_client: FakeSupabaseClient,
) -> None:
    """A multi-message turn is one atomic RPC, not N inserts."""
    messages = [
        {"sender_type": "ai", "sender_member_id": None, "kind": "text", "content": {}},
        {"sender_type": "ai", "sender_member_id": None, "kind": "summary", "content": {}},
    ]
    fake_client.queue("rpc:insert_message_turn", [{"id": "m1"}, {"id": "m2"}])
    repo = MessageRepository(fake_client)

    rows = await repo.insert_turn(ROOM, messages)

    assert len(rows) == 2
    rpc_calls = fake_client.calls_for("rpc:insert_message_turn")
    assert len(rpc_calls) == 1
    assert rpc_calls[0].payload["p_room_id"] == ROOM
    assert rpc_calls[0].payload["p_messages"] == messages


@pytest.mark.parametrize("count", [0, MAX_MESSAGES_PER_TURN + 1, 10])
async def test_insert_turn_rejects_out_of_range_counts(
    fake_client: FakeSupabaseClient, count: int
) -> None:
    """Requirement 15.10: 1..5 messages per turn, checked before any round trip."""
    repo = MessageRepository(fake_client)
    messages = [{"sender_type": "ai", "kind": "text", "content": {}}] * count

    with pytest.raises(ValueError, match="1 to 5 messages"):
        await repo.insert_turn(ROOM, messages)

    assert fake_client.calls == []


async def test_insert_turn_failure_yields_no_partial_turn(
    fake_client: FakeSupabaseClient,
) -> None:
    """A mid-turn failure surfaces as RepositoryError with nothing written."""
    fake_client.queue("rpc:insert_message_turn", FakePostgresError("constraint"))
    repo = MessageRepository(fake_client)

    with pytest.raises(RepositoryError):
        await repo.insert_turn(ROOM, [{"sender_type": "ai", "kind": "text", "content": {}}])

    # Exactly one attempt; no fallback to per-row inserts.
    assert len(fake_client.calls) == 1
    assert fake_client.calls_for("messages") == []


async def test_count_progress_messages_filters_on_content(
    fake_client: FakeSupabaseClient,
) -> None:
    """Progress is tracked inside content, since message_kind has no progress value."""
    fake_client.queue("messages", [{"id": "m1"}])
    repo = MessageRepository(fake_client)

    assert await repo.count_progress_messages(ROOM, RUN) == 1
    call = fake_client.calls_for("messages")[0]
    assert call.has_filter("room_id", ROOM)
    assert ("content", "contains", {"progress": True, "run_id": RUN}) in call.filters


# ===========================================================================
# VoteSessionRepository
# ===========================================================================


async def test_create_vote_session_opens_it(fake_client: FakeSupabaseClient) -> None:
    """A newly created session is open."""
    fake_client.queue("vote_sessions", [{"id": SESSION, "status": "open"}])
    repo = VoteSessionRepository(fake_client)

    await repo.create(ROOM, "msg-1", "Where to?", [{"id": "a", "label": "A"}])

    call = fake_client.calls_for("vote_sessions")[0]
    assert call.op == "insert"
    assert call.payload["status"] == "open"
    assert call.payload["room_id"] == ROOM


async def test_get_open_by_category_matches_linked_message_category(
    fake_client: FakeSupabaseClient,
) -> None:
    """Category comes from the linked message's content, not a session column."""
    fake_client.queue(
        "vote_sessions",
        [
            {"id": "s-flight", "message_id": "m-flight"},
            {"id": "s-dest", "message_id": "m-dest"},
        ],
    )
    fake_client.queue(
        "messages",
        [
            {"id": "m-flight", "content": {"category": "flight"}},
            {"id": "m-dest", "content": {"category": "destination"}},
        ],
    )
    repo = VoteSessionRepository(fake_client)

    found = await repo.get_open_by_room_and_category(ROOM, "destination")

    assert found is not None
    assert found["id"] == "s-dest"


async def test_get_open_by_category_returns_none_when_no_match(
    fake_client: FakeSupabaseClient,
) -> None:
    """A room with only a flight session has no open destination session."""
    fake_client.queue("vote_sessions", [{"id": "s1", "message_id": "m1"}])
    fake_client.queue("messages", [{"id": "m1", "content": {"category": "flight"}}])
    repo = VoteSessionRepository(fake_client)

    assert await repo.get_open_by_room_and_category(ROOM, "destination") is None


async def test_get_open_by_category_short_circuits_without_message_ids(
    fake_client: FakeSupabaseClient,
) -> None:
    """No linked messages means no second query is issued."""
    fake_client.queue("vote_sessions", [{"id": "s1", "message_id": None}])
    repo = VoteSessionRepository(fake_client)

    assert await repo.get_open_by_room_and_category(ROOM, "destination") is None
    assert fake_client.calls_for("messages") == []


async def test_list_open_by_room_filters_to_open(fake_client: FakeSupabaseClient) -> None:
    """Only open sessions are returned."""
    fake_client.queue("vote_sessions", [])
    repo = VoteSessionRepository(fake_client)

    await repo.list_open_by_room(ROOM)

    call = fake_client.calls_for("vote_sessions")[0]
    assert call.has_filter("status", "open")


async def test_close_sets_status_closed(fake_client: FakeSupabaseClient) -> None:
    """Closing a session writes status = closed."""
    fake_client.queue("vote_sessions", [{"id": SESSION, "status": "closed"}])
    repo = VoteSessionRepository(fake_client)

    await repo.close(SESSION)

    call = fake_client.calls_for("vote_sessions")[0]
    assert call.op == "update"
    assert call.payload == {"status": "closed"}


# ===========================================================================
# VoteRepository
# ===========================================================================


async def test_upsert_vote_targets_the_unique_constraint(
    fake_client: FakeSupabaseClient,
) -> None:
    """Re-voting replaces rather than duplicates, via the unique constraint."""
    fake_client.queue("votes", [{"id": "v1"}])
    repo = VoteRepository(fake_client)

    await repo.upsert(SESSION, MEMBER, "option-a")

    call = fake_client.calls_for("votes")[0]
    assert call.op == "upsert"
    assert call.on_conflict == "vote_session_id,member_id"


async def test_count_by_option_tallies(fake_client: FakeSupabaseClient) -> None:
    """Votes are grouped by option id."""
    fake_client.queue(
        "votes",
        [
            {"member_id": "m1", "option_id": "a"},
            {"member_id": "m2", "option_id": "a"},
            {"member_id": "m3", "option_id": "b"},
        ],
    )
    repo = VoteRepository(fake_client)

    assert await repo.count_by_option(SESSION) == {"a": 2, "b": 1}


async def test_count_by_option_excludes_departed_members(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 17.6: a departed member's vote cannot decide an outcome."""
    fake_client.queue(
        "votes",
        [
            {"member_id": "m1", "option_id": "a"},
            {"member_id": "gone", "option_id": "b"},
        ],
    )
    repo = VoteRepository(fake_client)

    tally = await repo.count_by_option(SESSION, eligible_member_ids=["m1"])

    assert tally == {"a": 1}


async def test_count_distinct_voters_is_unique_by_member(
    fake_client: FakeSupabaseClient,
) -> None:
    """Distinct voters counts members, not vote rows."""
    fake_client.queue(
        "votes",
        [
            {"member_id": "m1", "option_id": "a"},
            {"member_id": "m2", "option_id": "b"},
        ],
    )
    repo = VoteRepository(fake_client)

    assert await repo.count_distinct_voters(SESSION) == 2


# ===========================================================================
# SelectionRepository
# ===========================================================================


async def test_selection_upsert_targets_room_kind_constraint(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 17.3: one selection per (room, kind), updated not duplicated."""
    fake_client.queue("selections", [{"id": "sel1"}])
    repo = SelectionRepository(fake_client)

    await repo.upsert(ROOM, "destination", {"name": "Kyoto"}, SESSION)

    call = fake_client.calls_for("selections")[0]
    assert call.op == "upsert"
    assert call.on_conflict == "room_id,kind"
    assert call.payload["vote_session_id"] == SESSION


async def test_get_by_room_and_kind_filters_both(fake_client: FakeSupabaseClient) -> None:
    """Lookup is scoped by both room and kind."""
    fake_client.queue("selections", [{"id": "sel1", "kind": "flight"}])
    repo = SelectionRepository(fake_client)

    await repo.get_by_room_and_kind(ROOM, "flight")

    call = fake_client.calls_for("selections")[0]
    assert call.has_filter("room_id", ROOM)
    assert call.has_filter("kind", "flight")


# ===========================================================================
# ItineraryVersionRepository
# ===========================================================================


async def test_insert_version_writes_proposed_status(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 5.8: inserts are always proposed, never approved/rejected."""
    fake_client.queue("itinerary_versions", [{"id": VERSION_ID, "version": 1}])
    repo = ItineraryVersionRepository(fake_client)

    await repo.insert_version(TRIP, 1, "build", {"days": []})

    call = fake_client.calls_for("itinerary_versions")[0]
    assert call.op == "insert"
    assert call.payload["status"] == "proposed"
    assert call.payload["version"] == 1
    assert call.payload["source"] == "build"


async def test_version_collision_raises_unique_version_violation(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 5.3: a (trip_id, version) collision is a lost race, not a fault."""
    fake_client.queue(
        "itinerary_versions", unique_violation("itinerary_versions_trip_id_version_key")
    )
    repo = ItineraryVersionRepository(fake_client)

    with pytest.raises(UniqueVersionViolation) as excinfo:
        await repo.insert_version(TRIP, 3, "refine", {"days": []})

    assert excinfo.value.version == 3
    assert excinfo.value.trip_id == TRIP


async def test_non_collision_failure_is_repository_error_not_lost_race(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 5.13: any other failure must not be mistaken for contention."""
    fake_client.queue("itinerary_versions", FakePostgresError("deadlock", code="40P01"))
    repo = ItineraryVersionRepository(fake_client)

    with pytest.raises(RepositoryError):
        await repo.insert_version(TRIP, 2, "refine", {"days": []})


async def test_approved_index_violation_is_not_a_version_lost_race(
    fake_client: FakeSupabaseClient,
) -> None:
    """A 23505 from the approved index must not be read as version contention."""
    fake_client.queue("itinerary_versions", unique_violation("uq_itinerary_versions_one_approved"))
    repo = ItineraryVersionRepository(fake_client)

    with pytest.raises(RepositoryError):
        await repo.insert_version(TRIP, 2, "refine", {"days": []})


async def test_supersede_never_touches_settled_versions(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 5.9: only lower-version proposed rows are superseded."""
    fake_client.queue("itinerary_versions", [])
    repo = ItineraryVersionRepository(fake_client)

    await repo.supersede_lower_versions(TRIP, below_version=4)

    call = fake_client.calls_for("itinerary_versions")[0]
    assert call.payload == {"status": "superseded"}
    assert call.has_filter("status", "proposed")
    assert ("version", "lt", 4) in call.filters


async def test_get_latest_version_number_is_zero_when_empty(
    fake_client: FakeSupabaseClient,
) -> None:
    """A trip with no itinerary starts from base_version 0 (Requirement 3.1)."""
    fake_client.queue("itinerary_versions", [])
    repo = ItineraryVersionRepository(fake_client)

    assert await repo.get_latest_version_number(TRIP) == 0


async def test_get_latest_orders_by_version_desc(fake_client: FakeSupabaseClient) -> None:
    """Latest means highest version, not newest timestamp."""
    fake_client.queue("itinerary_versions", [{"id": VERSION_ID, "version": 7}])
    repo = ItineraryVersionRepository(fake_client)

    assert await repo.get_latest_version_number(TRIP) == 7
    call = fake_client.calls_for("itinerary_versions")[0]
    assert ("version", True) in call.order


async def test_mark_approved_rejects_a_second_approval(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 5.10: at most one approved version per trip."""
    fake_client.queue(
        "itinerary_versions",
        [{"id": VERSION_ID, "trip_id": TRIP}],  # get_by_id
        [{"id": "other-version", "trip_id": TRIP}],  # get_approved -> already approved
    )
    repo = ItineraryVersionRepository(fake_client)

    with pytest.raises(DuplicateApprovalError):
        await repo.mark_approved(VERSION_ID)

    assert fake_client.write_calls == []


async def test_mark_approved_succeeds_when_none_approved(
    fake_client: FakeSupabaseClient,
) -> None:
    """Approving the first version proceeds and writes status = approved."""
    fake_client.queue(
        "itinerary_versions",
        [{"id": VERSION_ID, "trip_id": TRIP}],  # get_by_id
        [],  # get_approved -> none
        [{"id": VERSION_ID, "status": "approved"}],  # update
    )
    repo = ItineraryVersionRepository(fake_client)

    row = await repo.mark_approved(VERSION_ID)

    assert row["status"] == "approved"
    updates = [c for c in fake_client.calls_for("itinerary_versions") if c.op == "update"]
    assert updates[0].payload == {"status": "approved"}


async def test_mark_approved_maps_index_violation_to_duplicate_approval(
    fake_client: FakeSupabaseClient,
) -> None:
    """A race that trips the partial index still yields DuplicateApprovalError."""
    fake_client.queue(
        "itinerary_versions",
        [{"id": VERSION_ID, "trip_id": TRIP}],
        [],
        unique_violation("uq_itinerary_versions_one_approved"),
    )
    repo = ItineraryVersionRepository(fake_client)

    with pytest.raises(DuplicateApprovalError):
        await repo.mark_approved(VERSION_ID)


async def test_repository_never_updates_itinerary_column(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 5.2: history is append-only; no update touches `itinerary`."""
    fake_client.set_default("itinerary_versions", [{"id": VERSION_ID, "trip_id": TRIP}])
    repo = ItineraryVersionRepository(fake_client)

    await repo.insert_version(TRIP, 1, "build", {"days": []})
    await repo.supersede_lower_versions(TRIP, 2)
    await repo.mark_rejected(VERSION_ID)

    for call in fake_client.calls_for("itinerary_versions"):
        if call.op == "update":
            assert "itinerary" not in (call.payload or {})


# ===========================================================================
# FeedbackRepository
# ===========================================================================


async def test_list_open_by_trip_filters_and_bounds(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 10.1: open only, oldest first, capped at 50."""
    fake_client.queue("feedback", [])
    repo = FeedbackRepository(fake_client)

    await repo.list_open_by_trip(TRIP)

    call = fake_client.calls_for("feedback")[0]
    assert call.has_filter("trip_id", TRIP)
    assert call.has_filter("status", "open")
    assert call.limit == 50
    assert ("created_at", False) in call.order


async def test_mark_addressed_is_noop_for_empty_input(
    fake_client: FakeSupabaseClient,
) -> None:
    """A run that resolved nothing issues no update."""
    repo = FeedbackRepository(fake_client)

    await repo.mark_addressed([])

    assert fake_client.calls == []


async def test_mark_addressed_updates_only_given_ids(
    fake_client: FakeSupabaseClient,
) -> None:
    """Only the addressed rows are settled."""
    fake_client.queue("feedback", [])
    repo = FeedbackRepository(fake_client)

    await repo.mark_addressed(["f1", "f2"])

    call = fake_client.calls_for("feedback")[0]
    assert call.payload == {"status": "addressed"}
    assert ("id", "in", ["f1", "f2"]) in call.filters


# ===========================================================================
# AgentRunRepository
# ===========================================================================


async def test_create_pending_sets_all_lifecycle_columns(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 3.1: a new run starts pending with every stamp cleared."""
    fake_client.queue("agent_runs", [{"id": RUN, "status": "pending"}])
    repo = AgentRunRepository(fake_client)

    await repo.create_pending(TRIP, "discovery", MEMBER, base_version=0)

    payload = fake_client.calls_for("agent_runs")[0].payload
    assert payload["status"] == "pending"
    assert payload["iteration_count"] == 0
    assert payload["base_version"] == 0
    assert payload["created_by_member_id"] == MEMBER
    for cleared in ("result_version_id", "started_at", "completed_at", "error"):
        assert payload[cleared] is None


async def test_idempotency_collision_returns_the_winning_row(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 4.5: the loser re-reads once and returns the winner's run."""
    winner = {"id": "winner-run", "status": "running", "idempotency_key": "key-1"}
    fake_client.queue(
        "agent_runs",
        unique_violation("agent_runs_idempotency_key_key"),  # insert loses
        [winner],  # single re-read
    )
    repo = AgentRunRepository(fake_client)

    row = await repo.create_pending(
        TRIP, "discovery", MEMBER, base_version=0, idempotency_key="key-1"
    )

    assert row["id"] == "winner-run"
    # Exactly two calls: the failed insert and one re-read. No retry loop.
    assert len(fake_client.calls_for("agent_runs")) == 2


async def test_idempotency_collision_with_vanished_row_raises_conflict(
    fake_client: FakeSupabaseClient,
) -> None:
    """If the colliding row cannot be re-read, the trigger is unresolvable."""
    fake_client.queue(
        "agent_runs",
        unique_violation("agent_runs_idempotency_key_key"),
        [],  # re-read finds nothing
    )
    repo = AgentRunRepository(fake_client)

    with pytest.raises(IdempotencyKeyConflictError):
        await repo.create_pending(
            TRIP, "discovery", MEMBER, base_version=0, idempotency_key="key-1"
        )


async def test_get_active_filters_to_in_flight_statuses(
    fake_client: FakeSupabaseClient,
) -> None:
    """An Active_Run is pending or running only."""
    fake_client.queue("agent_runs", [])
    repo = AgentRunRepository(fake_client)

    await repo.get_active(TRIP, "itinerary")

    call = fake_client.calls_for("agent_runs")[0]
    assert ("status", "in", ["pending", "running"]) in call.filters


async def test_mark_running_stamps_started_at(fake_client: FakeSupabaseClient) -> None:
    """pending -> running stamps started_at."""
    fake_client.queue(
        "agent_runs",
        [{"id": RUN, "status": "pending", "started_at": None}],
        [{"id": RUN, "status": "running"}],
    )
    repo = AgentRunRepository(fake_client)

    await repo.mark_running(RUN)

    update = [c for c in fake_client.calls_for("agent_runs") if c.op == "update"][0]
    assert update.payload["status"] == "running"
    assert update.payload["started_at"] is not None


async def test_mark_running_preserves_existing_started_at(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 3.2: a non-NULL started_at is never overwritten."""
    fake_client.queue(
        "agent_runs",
        [{"id": RUN, "status": "pending", "started_at": "2026-01-01T00:00:00Z"}],
        [{"id": RUN, "status": "running"}],
    )
    repo = AgentRunRepository(fake_client)

    await repo.mark_running(RUN)

    update = [c for c in fake_client.calls_for("agent_runs") if c.op == "update"][0]
    assert "started_at" not in update.payload


async def test_mark_completed_sets_result_version_in_same_update(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 3.10: result_version_id lands with the completed status."""
    fake_client.queue(
        "agent_runs",
        [{"id": RUN, "status": "running"}],
        [{"id": RUN, "status": "completed"}],
    )
    repo = AgentRunRepository(fake_client)

    await repo.mark_completed(RUN, result_version_id=VERSION_ID)

    update = [c for c in fake_client.calls_for("agent_runs") if c.op == "update"][0]
    assert update.payload["status"] == "completed"
    assert update.payload["result_version_id"] == VERSION_ID
    assert update.payload["error"] is None
    assert update.payload["completed_at"] is not None


async def test_mark_failed_truncates_and_keeps_started_at(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 3.5-3.6: error is bounded; started_at untouched."""
    fake_client.queue(
        "agent_runs",
        [{"id": RUN, "status": "running"}],
        [{"id": RUN, "status": "failed"}],
    )
    repo = AgentRunRepository(fake_client)

    await repo.mark_failed(RUN, "x" * 900)

    update = [c for c in fake_client.calls_for("agent_runs") if c.op == "update"][0]
    assert len(update.payload["error"]) == 500
    assert "started_at" not in update.payload


@pytest.mark.parametrize(
    ("current", "target"),
    [
        ("pending", "completed"),  # must pass through running first
        ("completed", "running"),  # terminal, cannot reopen
        ("failed", "running"),  # terminal, cannot reopen
        ("failed", "completed"),  # terminal, cannot succeed after failing
        ("completed", "failed"),  # terminal, cannot fail after completing
        ("running", "running"),  # same-status no-op is rejected
    ],
)
async def test_invalid_transitions_rejected_without_touching_the_row(
    fake_client: FakeSupabaseClient, current: str, target: str
) -> None:
    """Requirement 3.7, 3.11: illegal transitions raise and write nothing.

    There is deliberately no ``mark_pending``: ``pending`` is only ever set at
    creation, so a transition *into* it is unreachable rather than merely invalid.
    """
    fake_client.queue("agent_runs", [{"id": RUN, "status": current}])
    repo = AgentRunRepository(fake_client)
    method = {
        "running": repo.mark_running,
        "completed": repo.mark_completed,
        "failed": lambda rid: repo.mark_failed(rid, "e"),
    }[target]

    with pytest.raises(RunStatusTransitionError):
        await method(RUN)

    assert fake_client.write_calls == []


def test_allowed_transitions_match_the_documented_state_machine() -> None:
    """The transition table is exactly the four documented moves."""
    assert ALLOWED_TRANSITIONS["pending"] == frozenset({"running", "failed"})
    assert ALLOWED_TRANSITIONS["running"] == frozenset({"completed", "failed"})
    assert ALLOWED_TRANSITIONS["completed"] == frozenset()
    assert ALLOWED_TRANSITIONS["failed"] == frozenset()


async def test_update_base_version_is_not_a_status_transition(
    fake_client: FakeSupabaseClient,
) -> None:
    """Requirement 5.5: recording a re-fetched base_version bypasses the machine."""
    fake_client.queue("agent_runs", [{"id": RUN, "base_version": 4}])
    repo = AgentRunRepository(fake_client)

    await repo.update_base_version(RUN, 4)

    update = fake_client.calls_for("agent_runs")[0]
    assert update.payload == {"base_version": 4}
