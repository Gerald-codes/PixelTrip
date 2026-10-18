"""Tests for NPC message emission and human escalation.

These tests wire the *real* repositories to :class:`FakeSupabaseClient` rather
than stubbing the repository methods. That matters for the escalation
requirements: the strongest statement of "escalation writes nothing to
``itinerary_versions``, ``selections``, or ``trips.status``" (Requirement 14.7)
is an assertion over every write the client saw, and a stubbed repository would
not record those.
"""

from __future__ import annotations

from typing import Any

import pytest
from app.agents.errors import MessageContentTooLargeError, RoomResolutionError
from app.agents.guardrails.escalation import (
    DEFAULT_OPTIONS,
    ESCALATION_WRITE_FAILED_ERROR,
    STAGE_BY_RUN_TYPE,
    build_escalation_content,
    describe_constraint,
    perform_human_escalation,
)
from app.agents.messages import (
    MAX_CONTENT_BYTES,
    MAX_ESCALATION_OPTIONS,
    MIN_TEXT_OPTIONS,
    PROGRESS_TEXT,
    STAGE_IDENTIFIERS,
    RecommendationMessageContent,
    SummaryMessageContent,
    TextMessageContent,
    VoteMessageContent,
    build_message_row,
    emit_npc_message,
    emit_npc_turn,
    emit_progress_message,
    validate_content,
)
from app.agents.state import AgentState, RepositoryBundle
from app.exceptions import RepositoryError
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
from pydantic import ValidationError as PydanticValidationError

from tests.agents.conftest import FakeSupabaseClient

RUN = "33333333-3333-3333-3333-333333333333"
TRIP = "11111111-1111-1111-1111-111111111111"
ROOM = "22222222-2222-2222-2222-222222222222"
MEMBER = "44444444-4444-4444-4444-444444444444"

#: Tables that must never be touched by an escalating or failing run
#: (Requirement 14.7).
FORBIDDEN_TABLES = {
    "itinerary_versions",
    "selections",
    "trips",
    "rpc:set_trip_status_and_stage",
}


def wired_bundle(client: FakeSupabaseClient) -> RepositoryBundle:
    """Build a bundle of real repositories over ``client``."""
    return RepositoryBundle(
        trip_repo=TripRepository(client),
        room_repo=RoomRepository(client),
        message_repo=MessageRepository(client),
        vote_session_repo=VoteSessionRepository(client),
        vote_repo=VoteRepository(client),
        selection_repo=SelectionRepository(client),
        itinerary_version_repo=ItineraryVersionRepository(client),
        feedback_repo=FeedbackRepository(client),
        agent_run_repo=AgentRunRepository(client),
        member_repo=MemberRepository(client),
        profile_repo=ProfileRepository(client),
    )


def resolvable(client: FakeSupabaseClient) -> FakeSupabaseClient:
    """Make ``trips`` resolve ``TRIP`` to ``ROOM`` for every lookup."""
    client.set_default("trips", [{"room_id": ROOM}])
    return client


def make_state(**overrides: Any) -> AgentState:
    """Build a valid state for escalation tests."""
    base: dict[str, Any] = {
        "run_id": RUN,
        "trip_id": TRIP,
        "run_type": "itinerary",
        "created_by_member_id": MEMBER,
    }
    base.update(overrides)
    return AgentState(**base)


def forbidden_writes(client: FakeSupabaseClient) -> list[str]:
    """Return the names of any forbidden table written during the test."""
    return [c.table for c in client.write_calls if c.table in FORBIDDEN_TABLES]


# ===========================================================================
# Content models (Requirement 15.2, 15.4-15.6)
# ===========================================================================


def test_every_message_kind_has_a_content_model() -> None:
    """Requirement 15.2: all four ``message_kind`` values are covered."""
    for kind in ("text", "recommendation", "vote", "summary"):
        assert validate_content(
            kind,
            {
                "text": {"text": "Onward."},
                "recommendation": {
                    "title": "Three roads",
                    "category": "destination",
                    "items": [],
                },
                "vote": {
                    "vote_session_id": "vs-1",
                    "question": "Which road?",
                    "options": [],
                },
                "summary": {"title": "Decided", "text": "Kyoto it is."},
            }[kind],
        )


def test_unknown_kind_is_rejected() -> None:
    """A kind outside the enum is a caller bug, not a shape error."""
    with pytest.raises(ValueError, match="not a valid message kind"):
        validate_content("progress", {"text": "thinking"})


def test_extra_fields_are_rejected() -> None:
    """Content models forbid unknown fields, so contract drift fails loudly."""
    with pytest.raises(PydanticValidationError):
        TextMessageContent(text="Hello.", nonsense=True)


@pytest.mark.parametrize("stage", sorted(STAGE_IDENTIFIERS))
def test_each_stage_identifier_is_accepted(stage: str) -> None:
    """Requirement 15.6: the six in-world stages are the accepted vocabulary."""
    assert TextMessageContent(text="Onward.", stage=stage).stage == stage


def test_unknown_stage_is_rejected() -> None:
    """An unrecognised stage would break the frontend's progress UI."""
    with pytest.raises(PydanticValidationError, match="stage must be one of"):
        TextMessageContent(text="Onward.", stage="MIDGAME")


def test_two_questions_are_rejected() -> None:
    """Requirement 15.4: exactly one question per message."""
    with pytest.raises(PydanticValidationError, match="at most one question"):
        TextMessageContent(text="Where to? And when?")


def test_one_question_is_accepted() -> None:
    """The single-question rule permits exactly one, not zero."""
    assert TextMessageContent(text="Where shall we begin?").text.count("?") == 1


@pytest.mark.parametrize("count", [1, 7])
def test_option_count_outside_bounds_is_rejected(count: int) -> None:
    """Requirement 15.5: quick replies come in bounded sets."""
    options = [{"id": f"o{i}", "label": f"Option {i}"} for i in range(count)]
    with pytest.raises(PydanticValidationError, match="options must carry"):
        TextMessageContent(text="Choose an option.", options=options)


def test_duplicate_option_ids_are_rejected() -> None:
    """A repeated id makes the party's reply ambiguous."""
    with pytest.raises(PydanticValidationError, match="unique"):
        TextMessageContent(
            text="Choose an option.",
            options=[{"id": "a", "label": "A"}, {"id": "a", "label": "Also A"}],
        )


def test_progress_message_may_not_offer_options_or_ask() -> None:
    """Requirement 16.3: progress is status, not a prompt."""
    with pytest.raises(PydanticValidationError, match="must not offer options"):
        TextMessageContent(
            text="Thinking.",
            progress=True,
            options=[{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
        )
    with pytest.raises(PydanticValidationError, match="must not ask a question"):
        TextMessageContent(text="Still thinking?", progress=True)


def test_default_progress_text_is_a_valid_progress_message() -> None:
    """The shipped copy must itself satisfy the progress rules."""
    content = TextMessageContent(text=PROGRESS_TEXT, progress=True, run_id=RUN)

    assert content.options is None
    assert "?" not in content.text


def test_oversized_content_is_rejected_before_any_write() -> None:
    """Requirement 15.3: 16 KiB is the per-message ceiling."""
    with pytest.raises(MessageContentTooLargeError) as excinfo:
        validate_content("summary", {"title": "Big", "text": "x" * (MAX_CONTENT_BYTES + 1)})

    assert excinfo.value.limit_bytes == MAX_CONTENT_BYTES
    assert excinfo.value.size_bytes > MAX_CONTENT_BYTES


def test_content_just_under_the_limit_is_accepted() -> None:
    """The boundary is inclusive, so a payload at the limit still goes through."""
    # The probe already carries one character, so its own byte counts toward the
    # budget; the +1 puts the result exactly on the boundary rather than under it.
    probe = SummaryMessageContent(title="Big", text="x")
    headroom = MAX_CONTENT_BYTES - probe.serialized_size() + 1

    validated = validate_content("summary", {"title": "Big", "text": "x" * headroom})

    assert validated.serialized_size() == MAX_CONTENT_BYTES


# ===========================================================================
# Row construction (Requirement 15.1, 22.5)
# ===========================================================================


def test_row_is_always_ai_authored_with_no_member() -> None:
    """Requirement 22.5: the triggering member never becomes the sender."""
    row = build_message_row("text", TextMessageContent(text="Onward."))

    assert row["sender_type"] == "ai"
    assert row["sender_member_id"] is None


def test_row_omits_unset_optional_fields() -> None:
    """Writing explicit nulls into jsonb would make ``contains`` matches brittle."""
    row = build_message_row("text", TextMessageContent(text="Onward."))

    assert row["content"] == {"text": "Onward."}


def test_row_carries_no_room_id() -> None:
    """``room_id`` is supplied by the RPC from its own argument, not the row."""
    row = build_message_row("text", TextMessageContent(text="Onward."))

    assert "room_id" not in row


# ===========================================================================
# emit_npc_message (Requirement 15.1, 15.9)
# ===========================================================================


async def test_emit_resolves_the_room_from_the_trip() -> None:
    """Requirement 15.9: ``messages`` is room-keyed, runs are trip-keyed."""
    client = resolvable(FakeSupabaseClient())
    client.queue("rpc:insert_message_turn", [{"id": "m1", "room_id": ROOM}])

    row = await emit_npc_message(
        wired_bundle(client), TRIP, "text", TextMessageContent(text="Onward.")
    )

    assert row["id"] == "m1"
    assert client.calls_for("trips")[0].has_filter("id", TRIP)
    assert client.calls_for("rpc:insert_message_turn")[0].payload["p_room_id"] == ROOM


async def test_unresolvable_room_raises_and_writes_nothing() -> None:
    """Requirement 15.9: no room, no message — and no write attempt."""
    client = FakeSupabaseClient()
    client.set_default("trips", [])

    with pytest.raises(RoomResolutionError) as excinfo:
        await emit_npc_message(
            wired_bundle(client), TRIP, "text", TextMessageContent(text="Onward.")
        )

    assert excinfo.value.trip_id == TRIP
    assert client.write_calls == []


async def test_oversized_content_is_rejected_before_the_room_lookup() -> None:
    """Validation precedes every round trip, including the read."""
    client = resolvable(FakeSupabaseClient())

    with pytest.raises(MessageContentTooLargeError):
        await emit_npc_message(
            wired_bundle(client),
            TRIP,
            "summary",
            {"title": "Big", "text": "x" * (MAX_CONTENT_BYTES + 1)},
        )

    assert client.calls == []


async def test_emit_accepts_a_mapping_as_well_as_a_model() -> None:
    """Nodes building content inline should not have to import the model."""
    client = resolvable(FakeSupabaseClient())
    client.queue("rpc:insert_message_turn", [{"id": "m1"}])

    await emit_npc_message(wired_bundle(client), TRIP, "text", {"text": "Onward."})

    payload = client.calls_for("rpc:insert_message_turn")[0].payload
    assert payload["p_messages"][0]["content"] == {"text": "Onward."}


# ===========================================================================
# emit_npc_turn (Requirement 15.10-15.11)
# ===========================================================================


async def test_a_turn_is_written_as_one_rpc_call() -> None:
    """Requirement 15.11: a partial turn must never be visible to realtime."""
    client = resolvable(FakeSupabaseClient())
    client.queue("rpc:insert_message_turn", [{"id": "m1"}, {"id": "m2"}])

    rows = await emit_npc_turn(
        wired_bundle(client),
        TRIP,
        [
            ("summary", SummaryMessageContent(title="Decided", text="Kyoto.")),
            (
                "recommendation",
                RecommendationMessageContent(title="Three roads", category="destination", items=[]),
            ),
        ],
    )

    assert [r["id"] for r in rows] == ["m1", "m2"]
    assert len(client.calls_for("rpc:insert_message_turn")) == 1


async def test_a_turn_preserves_presentation_order() -> None:
    """The RPC orders by insertion, so the array order is the display order."""
    client = resolvable(FakeSupabaseClient())
    client.queue("rpc:insert_message_turn", [{"id": "m1"}, {"id": "m2"}])

    await emit_npc_turn(
        wired_bundle(client),
        TRIP,
        [
            ("summary", {"title": "First", "text": "a"}),
            ("summary", {"title": "Second", "text": "b"}),
        ],
    )

    sent = client.calls_for("rpc:insert_message_turn")[0].payload["p_messages"]
    assert [m["content"]["title"] for m in sent] == ["First", "Second"]


async def test_one_invalid_message_prevents_the_whole_turn() -> None:
    """Every message is validated before the write, so none is committed."""
    client = resolvable(FakeSupabaseClient())

    with pytest.raises(PydanticValidationError):
        await emit_npc_turn(
            wired_bundle(client),
            TRIP,
            [
                ("summary", {"title": "Fine", "text": "a"}),
                ("text", {"text": "Where? When?"}),
            ],
        )

    assert client.write_calls == []


@pytest.mark.parametrize("count", [0, 6])
async def test_turn_size_outside_bounds_costs_no_round_trip(count: int) -> None:
    """Requirement 15.10: 1-5 messages per turn, checked before any call."""
    client = resolvable(FakeSupabaseClient())
    messages = [("summary", {"title": f"T{i}", "text": "a"}) for i in range(count)]

    with pytest.raises(ValueError, match="1 to 5 messages|at least one message"):
        await emit_npc_turn(wired_bundle(client), TRIP, messages)

    assert client.calls == []


# ===========================================================================
# emit_progress_message (Requirement 16.4, 16.9)
# ===========================================================================


async def test_progress_message_is_marked_and_run_tagged() -> None:
    """Progress rides on ``content`` because ``kind`` has no progress value."""
    client = resolvable(FakeSupabaseClient())
    client.set_default("messages", [])
    client.queue("rpc:insert_message_turn", [{"id": "m1"}])

    row = await emit_progress_message(wired_bundle(client), TRIP, RUN, stage="BUILD")

    assert row == {"id": "m1"}
    content = client.calls_for("rpc:insert_message_turn")[0].payload["p_messages"][0]
    assert content["kind"] == "text"
    assert content["content"]["progress"] is True
    assert content["content"]["run_id"] == RUN
    assert content["content"]["stage"] == "BUILD"


async def test_second_progress_message_for_the_same_run_is_a_no_op() -> None:
    """Requirement 16.9: at most one per run, checked against written rows."""
    client = resolvable(FakeSupabaseClient())
    client.set_default("messages", [{"id": "existing"}])

    assert await emit_progress_message(wired_bundle(client), TRIP, RUN) is None
    assert client.calls_for("rpc:insert_message_turn") == []


async def test_progress_lookup_is_scoped_to_room_and_run() -> None:
    """A different run's progress message must not suppress this one."""
    client = resolvable(FakeSupabaseClient())
    client.set_default("messages", [])
    client.queue("rpc:insert_message_turn", [{"id": "m1"}])

    await emit_progress_message(wired_bundle(client), TRIP, RUN)

    lookup = client.calls_for("messages")[0]
    assert lookup.has_filter("room_id", ROOM)
    assert lookup.has_filter("content", {"progress": True, "run_id": RUN})


async def test_progress_write_failure_is_swallowed() -> None:
    """Requirement 16.4: progress is a courtesy and never fails the run."""
    client = resolvable(FakeSupabaseClient())
    client.set_default("messages", [])
    client.queue("rpc:insert_message_turn", RepositoryError("write failed"))

    assert await emit_progress_message(wired_bundle(client), TRIP, RUN) is None


async def test_progress_is_not_retried_after_a_failure() -> None:
    """Retrying would spend the run's budget on a message nobody needs."""
    client = resolvable(FakeSupabaseClient())
    client.set_default("messages", [])
    client.queue("rpc:insert_message_turn", RepositoryError("write failed"))

    await emit_progress_message(wired_bundle(client), TRIP, RUN)

    assert len(client.calls_for("rpc:insert_message_turn")) == 1


async def test_progress_tolerates_an_unresolvable_room() -> None:
    """An unresolved room fails the run elsewhere; progress just gives up."""
    client = FakeSupabaseClient()
    client.set_default("trips", [])

    assert await emit_progress_message(wired_bundle(client), TRIP, RUN) is None
    assert client.write_calls == []


# ===========================================================================
# Escalation content (Requirement 14.3-14.4)
# ===========================================================================


def test_constraint_prefers_a_finding_message() -> None:
    """The party is told which constraint failed, not that "something" failed."""
    named = describe_constraint([{"check": "budget", "message": "The plan is over budget"}])

    assert named == "The plan is over budget"


def test_constraint_falls_back_to_the_check_name() -> None:
    """A finding with no prose still names its check."""
    named = describe_constraint([{"check": "travel_time"}])

    assert "travel time" in named


def test_constraint_falls_back_when_findings_are_empty() -> None:
    """Escalation must still name something, even with nothing to go on."""
    assert describe_constraint([])
    assert describe_constraint(None)


def test_constraint_question_mark_is_stripped() -> None:
    """A finding ending in '?' would make the message ask twice."""
    named = describe_constraint([{"message": "Is the budget too low?"}])

    assert not named.endswith("?")


def test_escalation_content_asks_exactly_one_question() -> None:
    """Requirement 14.3: one question, with the constraint stated first."""
    content = build_escalation_content("itinerary", "The plan is over budget")

    assert content.text.count("?") == 1
    assert content.text.startswith("The plan is over budget")


def test_escalation_content_carries_the_run_stage() -> None:
    """Requirement 14.3: ``content.stage`` is the run's stage."""
    for run_type, stage in STAGE_BY_RUN_TYPE.items():
        content = build_escalation_content(run_type, "Nothing fits")
        assert content.stage == stage


def test_escalation_question_gets_a_question_mark() -> None:
    """A caller passing a bare phrase still produces a question."""
    content = build_escalation_content("itinerary", "Over budget", "What now")

    assert content.text.endswith("What now?")


def test_escalation_defaults_to_three_options() -> None:
    """Requirement 14.4: the default set is within 2-4."""
    content = build_escalation_content("discovery", "No dates overlap")

    assert MIN_TEXT_OPTIONS <= len(content.options or []) <= MAX_ESCALATION_OPTIONS


def test_too_many_options_are_truncated_to_the_cap() -> None:
    """Truncating beats raising: escalation is the recovery path."""
    options = [(f"o{i}", f"Option {i}") for i in range(9)]
    content = build_escalation_content("discovery", "No dates overlap", options=options)

    assert len(content.options or []) == MAX_ESCALATION_OPTIONS


def test_too_few_options_are_topped_up() -> None:
    """A single option is not a choice, so defaults fill the gap."""
    content = build_escalation_content(
        "discovery", "No dates overlap", options=[("widen", "Widen our dates")]
    )

    assert len(content.options or []) >= MIN_TEXT_OPTIONS
    assert (content.options or [])[0].id == "widen"


def test_duplicate_and_blank_options_are_dropped() -> None:
    """Deduplication happens before the bound check, not after."""
    content = build_escalation_content(
        "discovery",
        "No dates overlap",
        options=[("a", "A"), ("a", "A again"), ("", "Blank"), ("b", "B")],
    )

    ids = [o.id for o in content.options or []]
    assert ids == ["a", "b"]


def test_over_long_option_labels_are_truncated() -> None:
    """Requirement 14.4 caps labels at 80 characters."""
    content = build_escalation_content(
        "discovery", "No dates", options=[("a", "x" * 200), ("b", "B")]
    )

    assert len((content.options or [])[0].label) == 80


def test_escalation_options_accept_dicts_and_models() -> None:
    """Callers may pass whichever shape is convenient at the call site."""
    content = build_escalation_content(
        "discovery",
        "No dates",
        options=[{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
    )

    assert [o.id for o in content.options or []] == ["a", "b"]


# ===========================================================================
# perform_human_escalation (Requirement 14.5-14.7)
# ===========================================================================


def _escalation_client() -> FakeSupabaseClient:
    """A client that resolves the room, accepts the message, and completes the run."""
    client = resolvable(FakeSupabaseClient())
    client.queue("rpc:insert_message_turn", [{"id": "m1", "kind": "text"}])
    client.queue("agent_runs", [{"id": RUN, "status": "running", "started_at": "T0"}])
    client.queue(
        "agent_runs",
        [{"id": RUN, "status": "completed", "started_at": "T0", "error": None}],
    )
    return client


async def test_successful_escalation_completes_the_run() -> None:
    """Requirement 14.5: a delivered question is a completed run, not a failure."""
    client = _escalation_client()

    outcome = await perform_human_escalation(
        make_state(), wired_bundle(client), [{"check": "budget", "message": "Over budget"}]
    )

    assert outcome.escalated is True
    assert (outcome.run or {})["status"] == "completed"


async def test_escalation_leaves_error_and_result_version_null() -> None:
    """Requirement 14.5: nothing was produced and nothing broke."""
    client = _escalation_client()

    await perform_human_escalation(make_state(), wired_bundle(client), [])

    update = [c for c in client.calls_for("agent_runs") if c.op == "update"][0]
    assert update.payload["status"] == "completed"
    assert update.payload["error"] is None
    assert update.payload["result_version_id"] is None
    assert "started_at" not in update.payload


async def test_escalation_emits_exactly_one_text_message() -> None:
    """Requirement 14.3-14.4: one text message, no recommendation/vote/summary."""
    client = _escalation_client()

    await perform_human_escalation(make_state(), wired_bundle(client), [])

    turns = client.calls_for("rpc:insert_message_turn")
    assert len(turns) == 1
    sent = turns[0].payload["p_messages"]
    assert len(sent) == 1
    assert sent[0]["kind"] == "text"


async def test_escalation_message_carries_two_to_four_options() -> None:
    """Requirement 14.4: the party always gets actionable choices."""
    client = _escalation_client()

    outcome = await perform_human_escalation(make_state(), wired_bundle(client), [])

    sent_options = client.calls_for("rpc:insert_message_turn")[0].payload["p_messages"][0][
        "content"
    ]["options"]
    assert MIN_TEXT_OPTIONS <= len(sent_options) <= MAX_ESCALATION_OPTIONS
    assert outcome.options == sent_options
    assert len({o["id"] for o in sent_options}) == len(sent_options)


async def test_escalation_creates_no_vote_session() -> None:
    """Requirement 14.4: an escalation asks, it does not start a vote."""
    client = _escalation_client()

    await perform_human_escalation(make_state(), wired_bundle(client), [])

    assert client.calls_for("vote_sessions") == []


async def test_escalation_writes_nothing_to_the_plan_tables() -> None:
    """Requirement 14.7: the recorded plan is byte-identical afterwards."""
    client = _escalation_client()

    await perform_human_escalation(make_state(), wired_bundle(client), [])

    assert forbidden_writes(client) == []


async def test_failed_message_write_fails_the_run() -> None:
    """Requirement 14.6: the party never saw the question, so the run failed."""
    client = resolvable(FakeSupabaseClient())
    client.queue("rpc:insert_message_turn", RepositoryError("write failed"))
    client.queue("agent_runs", [{"id": RUN, "status": "running", "started_at": "T0"}])
    client.queue("agent_runs", [{"id": RUN, "status": "failed", "started_at": "T0"}])

    outcome = await perform_human_escalation(make_state(), wired_bundle(client), [])

    assert outcome.escalated is False
    assert (outcome.run or {})["status"] == "failed"


async def test_failure_path_error_is_display_safe() -> None:
    """Requirement 14.6: no provider text, no stack trace, no credential."""
    client = resolvable(FakeSupabaseClient())
    client.queue(
        "rpc:insert_message_turn",
        RepositoryError("postgrest said: apikey=sk-live-secret\nTraceback..."),
    )
    client.queue("agent_runs", [{"id": RUN, "status": "running", "started_at": "T0"}])
    client.queue("agent_runs", [{"id": RUN, "status": "failed"}])

    await perform_human_escalation(make_state(), wired_bundle(client), [])

    update = [c for c in client.calls_for("agent_runs") if c.op == "update"][0]
    error = update.payload["error"]
    assert error == ESCALATION_WRITE_FAILED_ERROR
    assert "sk-live-secret" not in error
    assert "Traceback" not in error


async def test_failure_path_also_writes_nothing_to_the_plan_tables() -> None:
    """Requirement 14.7 covers failure as well as escalation."""
    client = resolvable(FakeSupabaseClient())
    client.queue("rpc:insert_message_turn", RepositoryError("write failed"))
    client.queue("agent_runs", [{"id": RUN, "status": "running", "started_at": "T0"}])
    client.queue("agent_runs", [{"id": RUN, "status": "failed"}])

    await perform_human_escalation(make_state(), wired_bundle(client), [])

    assert forbidden_writes(client) == []


async def test_escalation_survives_a_failed_run_update() -> None:
    """A dead database must not replace the logged cause with a second error."""
    client = resolvable(FakeSupabaseClient())
    client.queue("rpc:insert_message_turn", RepositoryError("write failed"))
    client.set_default("agent_runs", RepositoryError("also down"))

    outcome = await perform_human_escalation(make_state(), wired_bundle(client), [])

    assert outcome.escalated is False
    assert outcome.run is None


async def test_escalation_names_the_constraint_to_the_party() -> None:
    """Requirement 14.3: the message says what could not be satisfied."""
    client = _escalation_client()

    outcome = await perform_human_escalation(
        make_state(),
        wired_bundle(client),
        [{"check": "budget", "message": "The plan costs 1400 per traveller"}],
    )

    text = client.calls_for("rpc:insert_message_turn")[0].payload["p_messages"][0]["content"][
        "text"
    ]
    assert "1400 per traveller" in text
    assert outcome.constraint == "The plan costs 1400 per traveller"


async def test_escalation_message_is_ai_authored() -> None:
    """Requirement 14.3: ``sender_type='ai'`` with no member attribution."""
    client = _escalation_client()

    await perform_human_escalation(make_state(), wired_bundle(client), [])

    sent = client.calls_for("rpc:insert_message_turn")[0].payload["p_messages"][0]
    assert sent["sender_type"] == "ai"
    assert sent["sender_member_id"] is None


def test_default_options_are_unique_and_within_bounds() -> None:
    """The shipped defaults must themselves satisfy Requirement 14.4."""
    ids = [option_id for option_id, _label in DEFAULT_OPTIONS]

    assert MIN_TEXT_OPTIONS <= len(DEFAULT_OPTIONS) <= MAX_ESCALATION_OPTIONS
    assert len(set(ids)) == len(ids)
    assert all(len(label) <= 80 for _id, label in DEFAULT_OPTIONS)


# ===========================================================================
# Shape sanity for the remaining content models
# ===========================================================================


def test_vote_content_defaults_to_open() -> None:
    """A vote message is emitted when the session opens."""
    content = VoteMessageContent(vote_session_id="vs-1", question="Which road?", options=[])

    assert content.status == "open"


def test_recommendation_category_is_constrained() -> None:
    """Only destination and flight recommendations exist."""
    with pytest.raises(PydanticValidationError):
        RecommendationMessageContent(title="T", category="hotel", items=[])
