"""Regression coverage for removal wording in day-level refinement feedback."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from app.agents.nodes.negotiation import (
    _ActivityAddition,
    _AdditionBatch,
    _classify_outcome,
    _FeedbackIntent,
    _FeedbackIntentBatch,
    _ItemRevision,
    _RevisionBatch,
    compute_affected_scope,
    detect_conflicts,
    draft_activity_additions,
    draft_item_revisions,
    interpret_feedback,
    partition_by_target_resolution,
    regenerate_affected_only,
)
from app.agents.proposals import ItineraryModel
from app.agents.state import AgentState


def itinerary():
    return ItineraryModel(
        trip_id="trip",
        room_id="room",
        title="Trip",
        summary="Plan",
        destination={"name": "Krabi"},
        days=[
            {"day": 1, "items": [{"id": "d1-i1", "title": "Dinner"}]},
            {
                "day": 2,
                "items": [
                    {"id": "d2-i1", "title": "Museum"},
                    {"id": "d2-i2", "title": "Lunch"},
                ],
            },
        ],
    ).model_dump(mode="json")


def prepare(base, rows):
    resolved, _ = partition_by_target_resolution(rows, base)
    return compute_affected_scope(resolved, base), resolved, detect_conflicts(resolved)


@pytest.mark.parametrize(
    "comment,outcome",
    [
        ("remove the lunch activity and change it to a bar lunch activity", "edit"),
        ("remove malay lunch, I want eat chinese", "remove"),
        ("remove lunch and replace it with a cafe", "edit"),
        ("don't remove lunch", "retain"),
        ("do not remove lunch", "retain"),
        ("visit the shortcut trail", "edit"),
        ("extra activity after dinner, suggest 1 popular club location nearby for me", "add"),
        ("another activity before dinner", "add"),
        ("an additional activity after lunch", "add"),
        ("Plan 1 club to visit near the dinner spot or best spots for clubbing", "add"),
    ],
)
def test_removal_and_replacement_classification(comment, outcome):
    assert _classify_outcome(comment) == outcome


@pytest.mark.anyio
async def test_day_lunch_replacement_is_drafted_and_keeps_other_activities():
    base = itinerary()
    rows = [
        {
            "id": "feedback",
            "target": {"day": 2},
            "comment": "remove the lunch activity and change it to a bar lunch activity",
        }
    ]
    scope, resolved, conflicts = prepare(base, rows)
    llm = AsyncMock()
    llm.generate_structured.return_value = _RevisionBatch(
        revisions=[
            _ItemRevision(item_id="d2-i1", title="Museum"),
            _ItemRevision(item_id="d2-i2", title="Bar lunch"),
        ]
    )
    revisions = await draft_item_revisions(llm, base, scope, resolved, conflicts, [])
    result, addressed = regenerate_affected_only(base, scope, resolved, conflicts, revisions)
    ItineraryModel(**result)
    llm.generate_structured.assert_awaited_once()
    assert result["days"][0] == base["days"][0]
    assert [item["title"] for item in result["days"][1]["items"]] == ["Museum", "Bar lunch"]
    assert addressed == ["feedback"]


@pytest.mark.parametrize(
    "rows,expected_ids",
    [
        ([{"id": "f1", "target": {"day": 2}, "comment": "remove lunch"}], []),
        ([{"id": "f1", "target": {"itemId": "d1-i1"}, "comment": "remove dinner"}], []),
        (
            [
                {"id": "f1", "target": {"itemId": "d2-i1"}, "comment": "remove museum"},
                {"id": "f2", "target": {"itemId": "d2-i2"}, "comment": "remove lunch"},
            ],
            [],
        ),
        ([{"id": "f1", "target": {"itemId": "d2-i2"}, "comment": "remove lunch"}], ["f1"]),
    ],
)
def test_removal_never_empties_a_day_and_only_settles_applied_feedback(rows, expected_ids):
    base = itinerary()
    result, addressed = regenerate_affected_only(base, *prepare(base, rows))
    ItineraryModel(**result)
    assert addressed == expected_ids
    if not expected_ids:
        assert result == base
    else:
        assert [item["id"] for item in result["days"][1]["items"]] == ["d2-i1"]


@pytest.mark.anyio
@pytest.mark.parametrize(
    "target,comment,anchor,placement,time,position",
    [
        (
            {"day": 1},
            "add 1 more activity after dinner: club hopping",
            "d1-i1",
            "after",
            "21:00",
            1,
        ),
        ({"day": 2}, "add dinner before the museum activity", "d2-i1", "before", "10:00", 0),
        ({"itemId": "d1-i1"}, "add club hopping after dinner", "d1-i1", "after", "21:00", 1),
    ],
)
async def test_additions_create_separate_rows_and_preserve_existing_activities(
    target,
    comment,
    anchor,
    placement,
    time,
    position,
):
    base = itinerary()
    base["days"][0]["items"][0]["time"] = "19:00"
    base["days"][1]["items"][0]["time"] = "11:00"
    rows = [{"id": "f1", "target": target, "comment": comment}]
    scope, resolved, conflicts = prepare(base, rows)
    llm = AsyncMock()
    llm.generate_structured.return_value = _AdditionBatch(
        additions=[
            _ActivityAddition(
                feedback_id="f1",
                anchor_item_id=anchor,
                placement=placement,
                title="Clubbing" if placement == "after" else "Dinner",
                time=time,
                description="Visit a nearby venue for a separate activity.",
                location="City centre",
            )
        ]
    )
    # An addition must never be sent through the existing-item rewrite path.
    assert await draft_item_revisions(llm, base, scope, resolved, conflicts, []) == {}
    llm.generate_structured.assert_not_awaited()
    additions = await draft_activity_additions(llm, base, resolved, conflicts, [])
    result, addressed = regenerate_affected_only(
        base, scope, resolved, conflicts, additions=additions
    )
    ItineraryModel(**result)
    day_index = resolved[0][1].day - 1
    new_items = result["days"][day_index]["items"]
    assert len(new_items) == len(base["days"][day_index]["items"]) + 1
    assert new_items[position]["description"] == "Visit a nearby venue for a separate activity."
    assert new_items[position]["time"] == time
    assert new_items[position]["id"] not in {i["id"] for d in base["days"] for i in d["items"]}
    assert [i for i in new_items if i["id"] != new_items[position]["id"]] == base["days"][
        day_index
    ]["items"]
    assert result["days"][1 - day_index] == base["days"][1 - day_index]
    assert addressed == ["f1"]


@pytest.mark.anyio
@pytest.mark.parametrize(
    "overrides,constraints",
    [
        ({"anchor_item_id": "d2-i1"}, []),  # wrong day
        ({"anchor_item_id": "unknown"}, []),
        ({"feedback_id": "unrequested"}, []),
        ({"placement": "before"}, []),  # request explicitly says after
        ({"time": "18:00"}, []),  # before the dinner's time
        ({"title": "Seafood restaurant"}, ["no seafood"]),
    ],
)
async def test_invalid_additions_leave_feedback_open_and_do_not_rewrite_dinner(
    overrides, constraints
):
    base = itinerary()
    base["days"][0]["items"][0]["time"] = "19:00"
    rows = [{"id": "f1", "target": {"day": 1}, "comment": "add 1 activity after dinner"}]
    scope, resolved, conflicts = prepare(base, rows)
    entry = {
        "feedback_id": "f1",
        "anchor_item_id": "d1-i1",
        "placement": "after",
        "title": "Clubbing",
        "time": "21:00",
        "description": "Visit a local club.",
        **overrides,
    }
    llm = AsyncMock()
    llm.generate_structured.return_value = _AdditionBatch(additions=[_ActivityAddition(**entry)])
    additions = await draft_activity_additions(llm, base, resolved, conflicts, constraints)
    result, addressed = regenerate_affected_only(
        base, scope, resolved, conflicts, additions=additions
    )
    assert result == base
    assert addressed == []


@pytest.mark.anyio
async def test_addition_provider_failure_leaves_feedback_open():
    base = itinerary()
    rows = [{"id": "f1", "target": {"day": 1}, "comment": "add clubbing after dinner"}]
    scope, resolved, conflicts = prepare(base, rows)
    llm = AsyncMock()
    llm.generate_structured.side_effect = RuntimeError("unavailable")
    additions = await draft_activity_additions(llm, base, resolved, conflicts, [])
    result, addressed = regenerate_affected_only(
        base, scope, resolved, conflicts, additions=additions
    )
    assert result == base
    assert addressed == []


@pytest.mark.anyio
async def test_full_day_does_not_request_or_apply_an_eleventh_activity():
    base = itinerary()
    base["days"][0]["items"] = [{"id": f"d1-i{i}", "title": f"Activity {i}"} for i in range(10)]
    rows = [{"id": "f1", "target": {"day": 1}, "comment": "add clubbing after dinner"}]
    scope, resolved, conflicts = prepare(base, rows)
    llm = AsyncMock()
    additions = await draft_activity_additions(llm, base, resolved, conflicts, [])
    result, addressed = regenerate_affected_only(
        base, scope, resolved, conflicts, additions=additions
    )
    assert result == base
    assert addressed == []
    llm.generate_structured.assert_not_awaited()


@pytest.mark.anyio
@pytest.mark.parametrize("available", [True, False])
async def test_refinement_node_persists_additions_and_settles_only_successful_feedback(
    monkeypatch,
    available,
):
    from app.agents.nodes import negotiation

    base = itinerary()
    row = {
        "id": "f1",
        "target": {"day": 1},
        "comment": "something fun after we eat",
    }
    context = {
        "latest_itinerary_version": {"version": 1, "itinerary": base},
        "open_feedback": [row],
        "trip": {"status": "feedback_collected"},
    }
    monkeypatch.setattr(negotiation, "_load_context", AsyncMock(return_value=context))
    monkeypatch.setattr(negotiation, "emit_npc_message", AsyncMock())
    monkeypatch.setattr(negotiation, "advance_trip_status", AsyncMock())
    persisted = []

    async def persist(state, repos, content, **kwargs):
        persisted.append(content)
        return {"id": "version2", "version": 2}, state

    monkeypatch.setattr(negotiation, "persist_itinerary_version", persist)
    llm = AsyncMock()
    if available:
        addition_batch = _AdditionBatch(
            additions=[
                _ActivityAddition(
                    feedback_id="f1",
                    anchor_item_id="d1-i1",
                    placement="after",
                    title="Clubbing",
                    time="21:00",
                    description="Visit a club after dinner.",
                )
            ]
        )
        llm.generate_structured.side_effect = [
            _FeedbackIntentBatch(intents=[_FeedbackIntent(feedback_id="f1", outcome="add")]),
            addition_batch,
        ]
    else:
        llm.generate_structured.side_effect = RuntimeError("unavailable")
    repos = SimpleNamespace(llm=llm, feedback_repo=AsyncMock(), agent_run_repo=AsyncMock())
    state = AgentState(
        run_id="33333333-3333-3333-3333-333333333333",
        trip_id="44444444-4444-4444-4444-444444444444",
        run_type="refinement",
    )
    result = await negotiation.negotiation_node(state, {"configurable": {"repos": repos}})
    assert len(persisted[0]["days"][0]["items"]) == (2 if available else 1)
    assert persisted[0]["days"][0]["items"][0] == base["days"][0]["items"][0]
    if available:
        assert [call.kwargs["operation"] for call in llm.generate_structured.await_args_list] == [
            "refinement_intent",
            "itinerary_addition",
        ]
        repos.feedback_repo.mark_addressed.assert_awaited_once_with(["f1"])
        assert result.proposal["unresolved_feedback_ids"] == []
    else:
        repos.feedback_repo.mark_addressed.assert_not_awaited()
        assert result.proposal["unresolved_feedback_ids"] == ["f1"]


@pytest.mark.anyio
async def test_semantic_intent_overrides_keywords_without_mutating_saved_feedback():
    base = itinerary()
    row = {"id": "f1", "target": {"day": 1}, "comment": "something fun after we eat"}
    resolved, _ = partition_by_target_resolution([row], base)
    llm = AsyncMock()
    llm.generate_structured.return_value = _FeedbackIntentBatch(
        intents=[_FeedbackIntent(feedback_id="f1", outcome="add", addition_count=2)]
    )
    interpreted = await interpret_feedback(llm, base, resolved)
    assert interpreted[0][0]["_interpreted_outcome"] == "add"
    assert interpreted[0][0]["_addition_count"] == 2
    assert "_interpreted_outcome" not in row
    scope = compute_affected_scope(interpreted, base)
    assert await draft_item_revisions(llm, base, scope, interpreted, [], []) == {}
    assert llm.generate_structured.await_count == 1


@pytest.mark.anyio
@pytest.mark.parametrize(
    "intents",
    [
        [],
        [_FeedbackIntent(feedback_id="unknown", outcome="remove")],
        [
            _FeedbackIntent(feedback_id="f1", outcome="add"),
            _FeedbackIntent(feedback_id="f1", outcome="remove"),
        ],
    ],
)
async def test_invalid_intent_responses_fall_back_to_existing_classification(intents):
    base = itinerary()
    row = {"id": "f1", "target": {"day": 1}, "comment": "extra activity after dinner"}
    resolved, _ = partition_by_target_resolution([row], base)
    llm = AsyncMock()
    llm.generate_structured.return_value = _FeedbackIntentBatch(intents=intents)
    interpreted = await interpret_feedback(llm, base, resolved)
    assert interpreted[0][0]["_interpreted_outcome"] == "add"
    assert "_interpreted_outcome" not in row
