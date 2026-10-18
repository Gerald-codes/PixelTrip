"""Tests for VoteService: casting, the Tiebreak_Flow, and both resolution triggers."""

from __future__ import annotations

from typing import Any

import pytest
from app.agents.errors import UnresolvedMemberError, VoteSessionClosedError
from app.services.vote_service import (
    cast_vote,
    close_session,
    pick_winner,
    resolve_vote_session,
)

from tests.agents.conftest import FakeSupabaseClient
from tests.agents.test_messages import ROOM, TRIP, wired_bundle

SESSION = "55555555-5555-5555-5555-555555555555"
MESSAGE = "66666666-6666-6666-6666-666666666666"
M1, M2, M3 = "member-1", "member-2", "member-3"

OPTIONS = [
    {"id": "opt-a", "title": "Kyoto"},
    {"id": "opt-b", "title": "Seoul"},
    {"id": "opt-c", "title": "Lisbon"},
]


def open_session(**overrides: Any) -> dict[str, Any]:
    """A session row with a destination category, open by default."""
    base: dict[str, Any] = {
        "id": SESSION,
        "room_id": ROOM,
        "message_id": MESSAGE,
        "status": "open",
        "options": OPTIONS,
        "category": "destination",  # fallback path; most tests use the message
    }
    base.update(overrides)
    return base


def members(count: int = 3) -> list[dict[str, Any]]:
    return [{"id": f"member-{i + 1}", "room_id": ROOM} for i in range(count)]


def votes(*choices: tuple[str, str]) -> list[dict[str, Any]]:
    """Build vote rows from ``(member_id, option_id)`` pairs."""
    return [{"member_id": m, "option_id": o} for m, o in choices]


def wire_resolution(
    client: FakeSupabaseClient,
    *,
    member_rows: list[dict[str, Any]] | None = None,
    vote_rows: list[dict[str, Any]] | None = None,
    category: str = "destination",
) -> None:
    """Queue the reads/writes a full ``resolve_vote_session`` call makes."""
    client.set_default("messages", [{"id": MESSAGE, "content": {"category": category}}])
    client.set_default("room_members", member_rows if member_rows is not None else members())
    client.set_default("votes", vote_rows if vote_rows is not None else [])
    client.queue("selections", [{"room_id": ROOM, "kind": category, "data": OPTIONS[0]}])
    client.queue("vote_sessions", [{"id": SESSION, "status": "closed"}])
    client.set_default("trips", [{"id": TRIP, "room_id": ROOM, "status": "preferences_collected"}])
    client.set_default("rpc:set_trip_status_and_stage", [{"id": TRIP}])


# ===========================================================================
# pick_winner / Option_Index_Rule (Requirement 17.6-17.8)
# ===========================================================================


def test_the_strict_majority_wins_outright() -> None:
    """Requirement 17.6: one option with the strictly highest count wins."""
    winner, tie = pick_winner({"opt-a": 3, "opt-b": 1}, OPTIONS)

    assert winner["id"] == "opt-a"
    assert tie is None


def test_a_tie_is_broken_by_the_lowest_index() -> None:
    """Requirement 17.7: the earliest option in the array wins a tie."""
    winner, tie = pick_winner({"opt-b": 2, "opt-c": 2}, OPTIONS)

    assert winner["id"] == "opt-b"
    assert tie is not None
    assert set(tie.tied_ids) == {"opt-b", "opt-c"}
    assert tie.tied_count == 2
    assert tie.winner_id == "opt-b"


def test_a_three_way_tie_still_resolves_to_the_lowest_index() -> None:
    """The rule generalises past two tied options."""
    winner, tie = pick_winner({"opt-a": 1, "opt-b": 1, "opt-c": 1}, OPTIONS)

    assert winner["id"] == "opt-a"
    assert tie is not None
    assert len(tie.tied_ids) == 3


def test_overlap_without_an_exact_tie_does_not_trigger_the_tiebreak() -> None:
    """Requirement 17.8: only exact equality of the top count triggers it."""
    _winner, tie = pick_winner({"opt-a": 3, "opt-b": 2}, OPTIONS)

    assert tie is None


def test_resolution_is_deterministic_across_repeated_calls() -> None:
    """Requirement 17.7: the same inputs always yield the same winner."""
    counts = {"opt-b": 2, "opt-c": 2}

    results = {pick_winner(counts, OPTIONS)[0]["id"] for _ in range(20)}

    assert results == {"opt-b"}


def test_an_empty_tally_has_no_winner_to_pick() -> None:
    """A session with zero eligible votes cannot resolve to anything."""
    with pytest.raises(ValueError, match="empty tally"):
        pick_winner({}, OPTIONS)


# ===========================================================================
# resolve_vote_session (Requirement 17.1, 17.3, 17.9, 17.10)
# ===========================================================================


async def test_resolution_writes_the_selection_and_closes_the_session() -> None:
    """Requirement 17.1, 17.3: the winner is locked in and voting ends."""
    client = FakeSupabaseClient()
    wire_resolution(client, vote_rows=votes((M1, "opt-a"), (M2, "opt-a"), (M3, "opt-b")))

    result = await resolve_vote_session(wired_bundle(client), open_session())

    assert result.winning_option["id"] == "opt-a"
    assert result.category == "destination"
    selection_write = client.calls_for("selections")[0]
    assert selection_write.payload["kind"] == "destination"
    assert selection_write.payload["vote_session_id"] == SESSION
    assert client.calls_for("vote_sessions")[0].op == "update"


async def test_a_tie_is_held_for_the_leader_with_one_summary_message() -> None:
    """A tie no longer auto-picks: one summary names the tie and that the leader decides."""
    client = FakeSupabaseClient()
    wire_resolution(client, vote_rows=votes((M1, "opt-b"), (M2, "opt-c")))

    result = await resolve_vote_session(wired_bundle(client), open_session())

    assert result.tie is not None
    assert result.tie_pending is True
    assert result.winning_option is None
    assert result.selection is None
    turns = client.calls_for("rpc:insert_message_turn")
    assert len(turns) == 1
    sent = turns[0].payload["p_messages"][0]
    assert sent["kind"] == "summary"
    details = sent["content"]["details"]
    assert details["tie_pending"] is True
    assert set(details["tied_ids"]) == {"opt-b", "opt-c"}
    assert details["tied_count"] == 1


async def test_an_outright_winner_emits_no_summary_message() -> None:
    """Only a tie is worth narrating; a clean win needs no message."""
    client = FakeSupabaseClient()
    wire_resolution(client, vote_rows=votes((M1, "opt-a"), (M2, "opt-a"), (M3, "opt-b")))

    await resolve_vote_session(wired_bundle(client), open_session())

    assert client.calls_for("rpc:insert_message_turn") == []


async def test_a_tie_marks_the_session_pending_and_locks_nothing() -> None:
    """On a tie the session stays open, flagged tie_pending with the tied ids."""
    client = FakeSupabaseClient()
    wire_resolution(client, vote_rows=votes((M1, "opt-b"), (M2, "opt-c")))

    await resolve_vote_session(wired_bundle(client), open_session())

    update = client.calls_for("vote_sessions")[0]
    assert update.payload["tie_pending"] is True
    assert set(update.payload["tie_option_ids"]) == {"opt-b", "opt-c"}
    assert update.payload["category"] == "destination"
    assert "status" not in update.payload  # still open
    assert client.calls_for("selections") == []
    assert client.calls_for("rpc:set_trip_status_and_stage") == []


async def test_a_departed_member_vote_does_not_decide_the_outcome() -> None:
    """Requirement 17.6: only members still in room_members are counted."""
    client = FakeSupabaseClient()
    # Only M1 and M2 remain; M3's vote (for opt-b) must not count.
    wire_resolution(
        client,
        member_rows=members(2),
        vote_rows=votes((M1, "opt-a"), (M2, "opt-a"), (M3, "opt-b")),
    )

    result = await resolve_vote_session(wired_bundle(client), open_session())

    assert result.winning_option["id"] == "opt-a"


async def test_resolution_advances_destination_status() -> None:
    """Requirement 17.4: a destination selection sets destination_selected."""
    client = FakeSupabaseClient()
    wire_resolution(client, vote_rows=votes((M1, "opt-a"), (M2, "opt-a")), category="destination")

    await resolve_vote_session(wired_bundle(client), open_session())

    rpc_call = client.calls_for("rpc:set_trip_status_and_stage")[0]
    assert rpc_call.payload["p_status"] == "destination_selected"


async def test_resolution_advances_flight_status() -> None:
    """Requirement 17.5: a flight selection sets flight_selected."""
    client = FakeSupabaseClient()
    wire_resolution(client, vote_rows=votes((M1, "opt-a"), (M2, "opt-a")), category="flight")

    await resolve_vote_session(wired_bundle(client), open_session(category="flight"))

    rpc_call = client.calls_for("rpc:set_trip_status_and_stage")[0]
    assert rpc_call.payload["p_status"] == "flight_selected"


# ===========================================================================
# cast_vote (Requirement 17.11, 17.13, 22.2-22.3)
# ===========================================================================


async def test_a_vote_on_a_closed_session_is_rejected_with_no_writes() -> None:
    """Requirement 17.13: votes, selections, and status all stay untouched."""
    client = FakeSupabaseClient()
    client.queue("vote_sessions", [{"id": SESSION, "status": "closed", "room_id": ROOM}])

    with pytest.raises(VoteSessionClosedError):
        await cast_vote(wired_bundle(client), SESSION, M1, "opt-a")

    assert client.write_calls == []


async def test_an_unresolved_member_id_is_rejected_before_any_write() -> None:
    """Requirement 22.2-22.3: a forged member id never reaches ``votes``."""
    client = FakeSupabaseClient()
    client.queue("vote_sessions", [open_session()])
    client.queue("room_members", [])  # get_by_id finds nothing

    with pytest.raises(UnresolvedMemberError):
        await cast_vote(wired_bundle(client), SESSION, "forged-id", "opt-a")

    assert client.write_calls == []


async def test_a_member_from_a_different_room_is_rejected() -> None:
    """A member id that resolves, but to the wrong room, is still untrusted."""
    client = FakeSupabaseClient()
    client.queue("vote_sessions", [open_session()])
    client.queue("room_members", [{"id": M1, "room_id": "other-room"}])

    with pytest.raises(UnresolvedMemberError):
        await cast_vote(wired_bundle(client), SESSION, M1, "opt-a")

    assert client.write_calls == []


async def test_full_participation_triggers_resolution() -> None:
    """Requirement 17.11: the last of N members voting resolves the session."""
    client = FakeSupabaseClient()
    client.queue("vote_sessions", [open_session()])
    client.queue("room_members", [{"id": M3, "room_id": ROOM}])  # get_by_id
    client.queue("votes", [{"member_id": M3, "vote_session_id": SESSION, "option_id": "opt-a"}])
    # count_distinct_voters' list_by_session, then member_repo.list_by_room for the
    # participation check, then resolve_vote_session's own reads.
    client.set_default(
        "votes",
        [
            {"member_id": M1, "option_id": "opt-a"},
            {"member_id": M2, "option_id": "opt-a"},
            {"member_id": M3, "option_id": "opt-a"},
        ],
    )
    client.set_default("room_members", members(3))
    client.set_default("messages", [{"id": MESSAGE, "content": {"category": "destination"}}])
    client.queue("selections", [{"room_id": ROOM, "kind": "destination"}])
    client.queue("vote_sessions", [{"id": SESSION, "status": "closed"}])
    client.set_default("trips", [{"id": TRIP, "room_id": ROOM, "status": "preferences_collected"}])
    client.set_default("rpc:set_trip_status_and_stage", [{"id": TRIP}])

    await cast_vote(wired_bundle(client), SESSION, M3, "opt-a")

    assert client.calls_for("selections") != []
    assert any(c.payload == {"status": "closed"} for c in client.calls_for("vote_sessions"))


async def test_partial_participation_does_not_resolve() -> None:
    """Only full participation auto-resolves; two of three voting must not."""
    client = FakeSupabaseClient()
    client.queue("vote_sessions", [open_session()])
    client.queue("room_members", [{"id": M2, "room_id": ROOM}])  # get_by_id
    client.queue("votes", [{"member_id": M2, "option_id": "opt-a"}])  # upsert result
    client.set_default(
        "votes", [{"member_id": M1, "option_id": "opt-a"}, {"member_id": M2, "option_id": "opt-a"}]
    )
    client.set_default("room_members", members(3))

    await cast_vote(wired_bundle(client), SESSION, M2, "opt-a")

    assert client.calls_for("selections") == []
    assert client.calls_for("vote_sessions") == [
        c for c in client.calls_for("vote_sessions") if c.op != "update"
    ]


# ===========================================================================
# close_session (Requirement 17.12)
# ===========================================================================


async def test_owner_can_close_a_session_with_partial_votes() -> None:
    """Requirement 17.12: resolution uses only what is persisted at that moment."""
    client = FakeSupabaseClient()
    client.queue("vote_sessions", [open_session()])
    client.queue("room_members", [{"id": M1, "room_id": ROOM, "role": "owner"}])  # get_owner
    wire_resolution(client, vote_rows=votes((M1, "opt-a")))

    result = await close_session(wired_bundle(client), SESSION, M1)

    assert result.winning_option["id"] == "opt-a"
    assert client.calls_for("selections") != []


async def test_a_non_owner_cannot_close_the_session() -> None:
    """Only the room's owner may trigger an early close."""
    client = FakeSupabaseClient()
    client.queue("vote_sessions", [open_session()])
    client.queue("room_members", [{"id": M1, "room_id": ROOM, "role": "owner"}])  # get_owner

    with pytest.raises(UnresolvedMemberError):
        await close_session(wired_bundle(client), SESSION, M2)

    assert client.write_calls == []


async def test_closing_an_already_closed_session_is_rejected() -> None:
    """A second close attempt must not re-resolve or re-write anything."""
    client = FakeSupabaseClient()
    client.queue("vote_sessions", [open_session(status="closed")])

    with pytest.raises(VoteSessionClosedError):
        await close_session(wired_bundle(client), SESSION, M1)

    assert client.write_calls == []
