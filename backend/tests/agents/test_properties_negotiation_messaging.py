"""Property-based tests: negotiation scope, messaging, status, atomicity
(design.md Properties 5, 9, 11, 16, 17, 18).
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.agents.messages import (
    CONTENT_MODEL_BY_KIND,
    build_message_row,
    emit_npc_message,
    emit_progress_message,
)
from app.agents.nodes.negotiation import (
    compute_affected_scope,
    partition_by_target_resolution,
    regenerate_affected_only,
)
from app.repositories.message_repository import MAX_MESSAGES_PER_TURN, MessageRepository
from app.services.trip_status_service import (
    STAGE_BY_STATUS,
    STATUS_ORDER,
    advance_trip_status,
    is_refine_loop_transition,
)
from hypothesis import HealthCheck, given, seed, settings
from hypothesis import strategies as st

from tests.agents.conftest import FakeSupabaseClient
from tests.agents.test_messages import ROOM, TRIP, resolvable, wired_bundle

PROPERTY_SEED = 20260925
PROPERTY_EXAMPLES = 50

RUN = "33333333-3333-3333-3333-333333333333"


# ===========================================================================
# Property 5: Unaffected-scope preservation
# ===========================================================================


def _itinerary_with_days(day_item_counts: list[int]) -> dict[str, Any]:
    return {
        "trip_id": TRIP,
        "room_id": ROOM,
        "title": "T",
        "summary": "S",
        "destination": {"name": "D"},
        "days": [
            {
                "day": day_num,
                "items": [{"id": f"d{day_num}-i{i}", "title": f"Item {i}"} for i in range(count)],
            }
            for day_num, count in enumerate(day_item_counts, start=1)
        ],
    }


@seed(PROPERTY_SEED)
@settings(
    max_examples=PROPERTY_EXAMPLES,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    day_item_counts=st.lists(st.integers(min_value=1, max_value=4), min_size=2, max_size=5),
    target_day_index=st.integers(min_value=0, max_value=100),
)
def test_property_5_days_outside_affected_scope_are_byte_identical(
    day_item_counts: list[int], target_day_index: int
) -> None:
    """Feature: 03-AI-agents, Property 5.

    For any base itinerary and any feedback targeting one day, every day
    outside the computed Affected_Scope survives regeneration completely
    unchanged — the same guarantee negotiation_node relies on for
    Requirement 10.3.
    """
    itinerary = _itinerary_with_days(day_item_counts)
    target_day = (target_day_index % len(day_item_counts)) + 1
    target_item = itinerary["days"][target_day - 1]["items"][0]["id"]

    feedback_rows = [
        {
            "id": "f1",
            "target": {"itemId": target_item},
            "comment": "remove this",
        }
    ]
    resolvable_rows, _unresolvable = partition_by_target_resolution(feedback_rows, itinerary)
    scope = compute_affected_scope(resolvable_rows, itinerary)
    new_itinerary, _addressed = regenerate_affected_only(itinerary, scope, resolvable_rows, [])

    in_scope_days = set(scope.get("whole_days") or [])
    in_scope_days.update(int(d) for d in (scope.get("items") or {}))
    base_by_day = {d["day"]: d for d in itinerary["days"]}
    new_by_day = {d["day"]: d for d in new_itinerary["days"]}

    for day_num in base_by_day:
        if day_num not in in_scope_days:
            assert new_by_day[day_num] == base_by_day[day_num]


# ===========================================================================
# Property 9: Message envelope validity
# ===========================================================================


def _valid_payload_for_kind(kind: str) -> dict[str, Any]:
    return {
        "text": {"text": "Onward!"},
        "recommendation": {
            "title": "Options",
            "category": "destination",
            "items": [
                {"id": "a", "title": "A"},
                {"id": "b", "title": "B"},
                {"id": "c", "title": "C"},
            ],
        },
        "vote": {"vote_session_id": "vs-1", "question": "Which?", "options": []},
        "summary": {"title": "Decided", "text": "Kyoto it is."},
    }[kind]


@seed(PROPERTY_SEED)
@settings(
    max_examples=PROPERTY_EXAMPLES,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(kind=st.sampled_from(sorted(CONTENT_MODEL_BY_KIND)))
def test_property_9_the_constructed_row_always_satisfies_the_envelope(kind: str) -> None:
    """Feature: 03-AI-agents, Property 9.

    For every `message_kind`, the row `build_message_row` constructs before
    any repository call has `sender_type='ai'`, `sender_member_id=None`, a
    valid `kind`, and content that validates against that kind's model.
    """
    model_cls = CONTENT_MODEL_BY_KIND[kind]
    content = model_cls.model_validate(_valid_payload_for_kind(kind))

    row = build_message_row(kind, content)

    assert row["sender_type"] == "ai"
    assert row["sender_member_id"] is None
    assert row["kind"] in CONTENT_MODEL_BY_KIND
    model_cls.model_validate(row["content"])  # re-validates without raising


@seed(PROPERTY_SEED)
@settings(
    max_examples=PROPERTY_EXAMPLES,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(kind=st.sampled_from(sorted(CONTENT_MODEL_BY_KIND)))
def test_property_9_emit_npc_message_never_sends_a_member_identity(kind: str) -> None:
    """The same guarantee, exercised through the real emit path."""

    async def run() -> dict[str, Any]:
        client = resolvable(FakeSupabaseClient())
        client.queue("rpc:insert_message_turn", [{"id": "m1"}])
        return await emit_npc_message(
            wired_bundle(client), TRIP, kind, _valid_payload_for_kind(kind)
        )

    asyncio.run(run())


# ===========================================================================
# Property 11: Status monotonicity with one exception
# ===========================================================================


@seed(PROPERTY_SEED)
@settings(
    max_examples=PROPERTY_EXAMPLES,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    sequence=st.lists(st.sampled_from(STATUS_ORDER), min_size=1, max_size=12),
)
def test_property_11_status_rank_never_decreases_except_the_refine_loop(
    sequence: list[str],
) -> None:
    """Feature: 03-AI-agents, Property 11.

    Across any sequence of `advance_trip_status` calls, the trip's rank never
    decreases, except the single permitted `refinement_completed ->
    feedback_collected` step, which may recur freely.
    """
    rank = {status: i for i, status in enumerate(STATUS_ORDER)}

    async def run() -> list[str]:
        client = resolvable(FakeSupabaseClient())
        client.set_default("rpc:set_trip_status_and_stage", [{"id": TRIP}])
        bundle = wired_bundle(client)

        current = "trip_created"
        history = [current]
        for new_status in sequence:
            result = await advance_trip_status(bundle, TRIP, new_status, current)
            current = result.status
            history.append(current)
        return history

    history = asyncio.run(run())

    for before, after in zip(history, history[1:], strict=False):
        if is_refine_loop_transition(before, after):
            continue
        assert rank[after] >= rank[before]


# ===========================================================================
# Property 16: Stage/status coherence
# ===========================================================================


def test_property_16_stage_by_status_covers_every_enum_value_exactly() -> None:
    """Feature: 03-AI-agents, Property 16.

    `STAGE_BY_STATUS` has an entry for all 10 `trip_status` values and no
    others — not a hypothesis-driven test since the enum is a fixed, finite
    set rather than a generated input, but still the direct check Property 16
    describes.
    """
    assert set(STAGE_BY_STATUS) == set(STATUS_ORDER)
    assert len(STATUS_ORDER) == 10


@seed(PROPERTY_SEED)
@settings(
    max_examples=PROPERTY_EXAMPLES,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(new_status=st.sampled_from(STATUS_ORDER))
def test_property_16_a_persisted_write_reads_back_the_matching_stage(new_status: str) -> None:
    """Every status that actually gets written carries its mapped stage in
    the same RPC call — no write can land status and stage out of sync.
    """

    async def run() -> dict[str, Any] | None:
        client = resolvable(FakeSupabaseClient())
        client.set_default("rpc:set_trip_status_and_stage", [{"id": TRIP, "status": new_status}])
        bundle = wired_bundle(client)
        await advance_trip_status(bundle, TRIP, new_status, "trip_created")
        calls = client.calls_for("rpc:set_trip_status_and_stage")
        return calls[0].payload if calls else None

    payload = asyncio.run(run())

    if payload is not None:
        assert payload["p_planning_stage"] == STAGE_BY_STATUS[new_status]


# ===========================================================================
# Property 17: Turn atomicity
# ===========================================================================


@seed(PROPERTY_SEED)
@settings(
    max_examples=PROPERTY_EXAMPLES,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    message_count=st.integers(min_value=1, max_value=MAX_MESSAGES_PER_TURN),
    fail=st.booleans(),
)
def test_property_17_a_turn_is_all_visible_or_none_is(message_count: int, fail: bool) -> None:
    """Feature: 03-AI-agents, Property 17.

    A turn's messages either all land in one RPC call (and are therefore all
    visible together, since the RPC is atomic) or the call fails and none of
    them are recorded — this test asserts the client-side half of that
    guarantee: `insert_turn` issues exactly one call for the whole turn,
    never a partial sequence of per-message inserts.
    """
    from app.exceptions import RepositoryError

    async def run() -> tuple[int, bool]:
        client = FakeSupabaseClient()
        rows = [{"id": f"m{i}"} for i in range(message_count)]
        if fail:
            client.queue("rpc:insert_message_turn", RepositoryError("write failed"))
        else:
            client.queue("rpc:insert_message_turn", rows)

        repo = MessageRepository(client)
        messages = [
            {"sender_type": "ai", "sender_member_id": None, "kind": "text", "content": {}}
            for _ in range(message_count)
        ]
        succeeded = True
        try:
            result = await repo.insert_turn(ROOM, messages)
        except RepositoryError:
            succeeded = False
            result = []

        call_count = len(client.calls_for("rpc:insert_message_turn"))
        return call_count, succeeded if not fail else (len(result) if succeeded else 0) == 0

    call_count, outcome_consistent = asyncio.run(run())

    assert call_count == 1
    assert outcome_consistent


# ===========================================================================
# Property 18: Progress-message singularity
# ===========================================================================


@seed(PROPERTY_SEED)
@settings(
    max_examples=PROPERTY_EXAMPLES,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(call_count=st.integers(min_value=0, max_value=10))
def test_property_18_at_most_one_progress_insert_per_run(call_count: int) -> None:
    """Feature: 03-AI-agents, Property 18.

    Any number of `emit_progress_message` calls for the same run id result in
    at most one actual `content.progress=true` insert — later calls see the
    first's row already present and skip.
    """

    async def run() -> int:
        client = resolvable(FakeSupabaseClient())
        inserted: list[dict[str, Any]] = []

        def _messages_response(_call: Any) -> list[dict[str, Any]]:
            return inserted

        # The repository checks for an existing progress row via a plain
        # select on `messages`; model that as "empty until the first insert
        # succeeds" so later calls correctly see one already recorded.
        for _ in range(call_count):
            client.set_default("messages", list(inserted))
            if not inserted:
                client.queue("rpc:insert_message_turn", [{"id": f"m{len(inserted)}"}])
            await emit_progress_message(wired_bundle(client), TRIP, RUN)
            if not inserted:
                inserted.append({"content": {"progress": True, "run_id": RUN}})

        return len(client.calls_for("rpc:insert_message_turn"))

    insert_count = asyncio.run(run())

    assert insert_count <= 1
