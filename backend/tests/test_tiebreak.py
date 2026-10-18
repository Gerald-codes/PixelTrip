"""Tests for the AI-assisted, leader-decided tiebreak (destination and flight votes)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.agents.errors import LLMGenerationError, UnresolvedMemberError, VoteSessionClosedError
from app.agents.nodes import tiebreak as tiebreak_module
from app.agents.nodes.tiebreak import tiebreak_node
from app.api.deps import get_voting_endpoint_service
from app.exceptions import ValidationError, VoteTiePendingError
from app.main import app
from app.repositories.member_repository import MemberRepository
from app.repositories.message_repository import MessageRepository
from app.repositories.selection_repository import SelectionRepository
from app.repositories.trip_repository import TripRepository
from app.repositories.vote_repository import VoteRepository
from app.repositories.vote_session_repository import VoteSessionRepository
from app.services.run_endpoint_service import RunEndpointService, StartedRun
from app.services.vote_service import break_tie, cast_vote, close_session
from app.services.voting_endpoint_service import VotingEndpointService
from fastapi.testclient import TestClient

ROOM_ID = "11111111-1111-4111-8111-111111111111"
TRIP_ID = "22222222-2222-4222-8222-222222222222"
OWNER = "33333333-3333-4333-8333-333333333333"
MEMBER = "44444444-4444-4444-8444-444444444444"
SESSION_ID = "55555555-5555-4555-8555-555555555555"
MESSAGE_ID = "66666666-6666-4666-8666-666666666666"

OPTIONS = [{"id": "tokyo", "label": "Tokyo"}, {"id": "seoul", "label": "Seoul"}]


def session(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": SESSION_ID,
        "room_id": ROOM_ID,
        "message_id": MESSAGE_ID,
        "status": "open",
        "options": OPTIONS,
        "tie_pending": True,
        "tie_option_ids": ["tokyo", "seoul"],
        "category": "destination",
    }
    row.update(overrides)
    return row


def bundle() -> SimpleNamespace:
    r = SimpleNamespace(
        trip_repo=AsyncMock(spec=TripRepository),
        member_repo=AsyncMock(spec=MemberRepository),
        message_repo=AsyncMock(spec=MessageRepository),
        selection_repo=AsyncMock(spec=SelectionRepository),
        vote_repo=AsyncMock(spec=VoteRepository),
        vote_session_repo=AsyncMock(spec=VoteSessionRepository),
        llm=None,
    )
    r.vote_session_repo.get_by_id.return_value = session()
    r.member_repo.get_owner.return_value = {"id": OWNER, "room_id": ROOM_ID}
    r.member_repo.list_by_room.return_value = [
        {"id": OWNER, "display_name": "Gerald"},
        {"id": MEMBER, "display_name": "Priya"},
    ]
    r.vote_repo.count_by_option.return_value = {"tokyo": 1, "seoul": 1}
    r.message_repo.get_by_id.return_value = {
        "id": MESSAGE_ID,
        "content": {"category": "destination", "items": [{"id": "tokyo", "title": "Tokyo"}]},
    }
    r.message_repo.insert_turn.return_value = [{}]
    r.selection_repo.upsert.return_value = {"id": "sel-1"}
    r.vote_session_repo.close.return_value = session(status="closed", tie_pending=False)
    r.trip_repo.get_by_room_id.return_value = {
        "id": TRIP_ID,
        "room_id": ROOM_ID,
        "status": "preferences_collected",
    }
    r.trip_repo.update_status.return_value = {"id": TRIP_ID, "status": "destination_selected"}
    r.trip_repo.get_room_id_for_trip.return_value = ROOM_ID
    return r


anyio = pytest.mark.anyio


# --- break_tie (vote service) ---------------------------------------------------------


@anyio
async def test_owner_breaks_the_tie_and_it_locks_like_a_winner():
    r = bundle()

    resolution = await break_tie(r, SESSION_ID, OWNER, "seoul")

    r.vote_session_repo.clear_tie_pending.assert_awaited_once_with(SESSION_ID)
    upsert = r.selection_repo.upsert.await_args.kwargs
    assert upsert["kind"] == "destination"
    assert upsert["data"]["id"] == "seoul"
    r.vote_session_repo.close.assert_awaited_once_with(SESSION_ID)
    r.trip_repo.update_status.assert_awaited_once_with(TRIP_ID, "destination_selected", "logistics")
    assert resolution.winning_option["id"] == "seoul"
    assert resolution.tie is not None and resolution.tie.winner_id == "seoul"
    posted = r.message_repo.insert_turn.await_args.args[1][0]
    assert posted["content"]["details"]["winner"] == "seoul"


@anyio
async def test_flight_tie_advances_to_flight_selected():
    r = bundle()
    r.vote_session_repo.get_by_id.return_value = session(category="flight")
    r.trip_repo.get_by_room_id.return_value = {"id": TRIP_ID, "status": "destination_selected"}

    await break_tie(r, SESSION_ID, OWNER, "tokyo")

    assert r.selection_repo.upsert.await_args.kwargs["kind"] == "flight"
    r.trip_repo.update_status.assert_awaited_once_with(TRIP_ID, "flight_selected", "build")


@anyio
@pytest.mark.parametrize(
    ("row", "member", "option", "error"),
    [
        (session(status="closed", tie_pending=False), OWNER, "tokyo", VoteSessionClosedError),
        (session(tie_pending=False), OWNER, "tokyo", ValidationError),
        (session(), MEMBER, "tokyo", UnresolvedMemberError),
        (session(), OWNER, "lisbon", ValidationError),
    ],
)
async def test_break_tie_rejections(row, member, option, error):
    r = bundle()
    r.vote_session_repo.get_by_id.return_value = row

    with pytest.raises(error):
        await break_tie(r, SESSION_ID, member, option)
    r.selection_repo.upsert.assert_not_awaited()


@anyio
async def test_no_more_votes_while_a_tie_is_pending():
    r = bundle()

    with pytest.raises(VoteTiePendingError):
        await cast_vote(r, SESSION_ID, MEMBER, "tokyo")
    r.vote_repo.upsert.assert_not_awaited()


@anyio
async def test_owner_cannot_close_a_tied_vote_early():
    r = bundle()

    with pytest.raises(VoteTiePendingError):
        await close_session(r, SESSION_ID, OWNER)


# --- endpoint service starts the advice run ----------------------------------------------


@anyio
async def test_a_tying_vote_starts_one_tiebreak_run_in_the_background(monkeypatch):
    r = bundle()
    r.vote_session_repo.get_by_id.side_effect = [session(tie_pending=False), session()]
    monkeypatch.setattr("app.services.voting_endpoint_service.cast_vote", AsyncMock())
    run_service = AsyncMock(spec=RunEndpointService)
    execute = AsyncMock()
    run_service.start_run.return_value = StartedRun(run=None, execute=execute)  # type: ignore[arg-type]
    scheduled: list[Any] = []

    response = await VotingEndpointService(r, run_service).cast(
        SESSION_ID, MEMBER, "seoul", schedule=scheduled.append
    )

    assert response.tie_pending is True
    assert response.session_status == "open"
    run_service.start_run.assert_awaited_once_with(
        TRIP_ID, "tiebreak", MEMBER, idempotency_key=f"tiebreak-{SESSION_ID}"
    )
    assert scheduled == [execute]
    r.member_repo.set_stage_ready.assert_awaited_once_with(MEMBER, True)


@anyio
async def test_a_normal_vote_starts_no_tiebreak(monkeypatch):
    r = bundle()
    r.vote_session_repo.get_by_id.side_effect = [
        session(tie_pending=False),
        session(tie_pending=False),
    ]
    monkeypatch.setattr("app.services.voting_endpoint_service.cast_vote", AsyncMock())
    run_service = AsyncMock(spec=RunEndpointService)

    response = await VotingEndpointService(r, run_service).cast(SESSION_ID, MEMBER, "seoul")

    assert response.tie_pending is False
    run_service.start_run.assert_not_awaited()


# --- tiebreak agent node --------------------------------------------------------------


def node_state() -> SimpleNamespace:
    return SimpleNamespace(
        run_id="run-1",
        trip_id=TRIP_ID,
        trip_context={
            "room_id": ROOM_ID,
            "members": [
                {"id": OWNER, "display_name": "Gerald"},
                {"id": MEMBER, "display_name": "Priya"},
            ],
            "preferences": [{"member_id": OWNER, "budget": 1500, "interests": ["food"]}],
            "characters": [],
        },
    )


def flight_bundle() -> SimpleNamespace:
    r = bundle()
    r.vote_session_repo.get_tie_pending_by_room.return_value = session(
        category="flight",
        options=[{"id": "f1", "label": "Scoot TR804"}, {"id": "f2", "label": "ANA NH804"}],
        tie_option_ids=["f1", "f2"],
    )
    r.message_repo.get_by_id.return_value = {
        "id": MESSAGE_ID,
        "content": {
            "category": "flight",
            "items": [
                {
                    "id": "f1",
                    "title": "Scoot TR804",
                    "meta": {
                        "price": 1136.5,
                        "stops": 0,
                        "tags": ["SGD 1,136", "Scoot", "Direct"],
                        "tradeOff": "Nothing stands out against the other options.",
                        "details": "Scoot TR804, SIN to NRT. SGD 1,136 per person, round trip.",
                    },
                },
                {"id": "f2", "title": "ANA NH804", "meta": {"price": 1778.3, "stops": 0}},
            ],
        },
    }
    r.vote_repo.list_by_session.return_value = [
        {"member_id": OWNER, "option_id": "f1"},
        {"member_id": MEMBER, "option_id": "f2"},
    ]
    return r


def posted_content(r: SimpleNamespace) -> dict[str, Any]:
    return r.message_repo.insert_turn.await_args.args[1][0]["content"]


def scored_advice(**overrides: Any) -> Any:
    data: dict[str, Any] = {
        "analyses": [
            {
                "option_id": "f1",
                "score": 84,
                "why_this_fits": "Cheapest and direct.",
                "tags": ["Budget", "Direct", "Evening arrival", "Low fare", "Extra tag"],
                "trade_off": "No checked bag included.",
                "member_fit": [
                    {"member_id": OWNER, "score": 92, "reason": "Fits Gerald's budget."},
                    {"member_id": MEMBER, "score": 70, "reason": "Fine, but Priya wanted ANA."},
                ],
            },
            {
                "option_id": "f2",
                "score": 61,
                "why_this_fits": "Pricier full-service flight.",
                "tags": ["Full service", "Arrives early"],
                "trade_off": "Over Gerald's budget.",
                "member_fit": [
                    {"member_id": OWNER, "score": 40, "reason": "Over Gerald's budget."},
                    {"member_id": MEMBER, "score": 88, "reason": "Priya's pick."},
                    {"member_id": "not-a-member", "score": 99, "reason": "ignored"},
                ],
            },
        ],
        "recommended_option_id": "f2",
        "advice": "Scoot suits the party's budget; ANA is more comfortable.",
    }
    data.update(overrides)
    return tiebreak_module._TiebreakAdvice(**data)


@anyio
async def test_node_posts_scored_llm_advice_for_the_leader():
    r = flight_bundle()
    r.llm = AsyncMock()
    r.llm.generate_structured.return_value = scored_advice()

    await tiebreak_node(node_state(), {"configurable": {"repos": r}})

    content = posted_content(r)
    assert content["category"] == "flight_tiebreak"
    assert content["vote_session_id"] == SESSION_ID
    assert [o["id"] for o in content["options"]] == ["f1", "f2"]
    first, second = content["items"]
    # Same card keys as recommendation items (CR-1).
    assert first["score"] == 84 and second["score"] == 61
    assert first["title"] == "Scoot TR804"
    assert first["whyThisFits"] == "Cheapest and direct."
    assert first["tags"] == ["Budget", "Direct", "Evening arrival", "Low fare"]  # capped at 4
    assert second["tradeOff"] == "Over Gerald's budget."
    assert first["memberFit"][0] == {
        "memberId": OWNER,
        "displayName": "Gerald",
        "score": 92,
        "reason": "Fits Gerald's budget.",
    }
    assert [f["memberId"] for f in second["memberFit"]] == [OWNER, MEMBER]  # unknown dropped
    assert first["votes"] == ["Gerald"]
    # details is the card's string; the raw numbers ride along in facts.
    assert first["details"] == "Scoot TR804, SIN to NRT. SGD 1,136 per person, round trip."
    assert first["facts"]["price"] == 1136.5
    assert second["details"] == "price: 1778.3. stops: 0"
    # The suggestion follows the highest party score, not the model's stated pick.
    assert content["recommended_option_id"] == "f1"
    assert content["stage"] == "LOGISTICS"


@anyio
async def test_scores_are_clamped_to_0_100():
    r = flight_bundle()
    r.llm = AsyncMock()
    advice = scored_advice()
    advice.analyses[0].score = 140
    advice.analyses[1].member_fit[0].score = -5
    r.llm.generate_structured.return_value = advice

    await tiebreak_node(node_state(), {"configurable": {"repos": r}})

    first, second = posted_content(r)["items"]
    assert first["score"] == 100
    assert second["memberFit"][0]["score"] == 0


@anyio
async def test_level_scores_fall_back_to_the_models_pick():
    r = flight_bundle()
    r.llm = AsyncMock()
    advice = scored_advice()
    advice.analyses[1].score = 84
    r.llm.generate_structured.return_value = advice

    await tiebreak_node(node_state(), {"configurable": {"repos": r}})

    assert posted_content(r)["recommended_option_id"] == "f2"


@anyio
async def test_an_answer_missing_an_option_uses_the_fallback():
    r = flight_bundle()
    r.llm = AsyncMock()
    advice = scored_advice()
    advice.analyses.pop()
    r.llm.generate_structured.return_value = advice

    await tiebreak_node(node_state(), {"configurable": {"repos": r}})

    assert "choice is yours" in posted_content(r)["advice"]


@anyio
async def test_fallback_scores_members_on_votes_and_budget():
    r = flight_bundle()
    r.llm = AsyncMock()
    r.llm.generate_structured.side_effect = LLMGenerationError("flight_tiebreak")

    await tiebreak_node(node_state(), {"configurable": {"repos": r}})

    content = posted_content(r)
    first, second = content["items"]
    # Gerald (budget 1500) voted f1: 50 + 25 vote + 25 within budget.
    assert first["memberFit"][0]["score"] == 100
    # f2 (S$1778.3) is over Gerald's budget: 50 - 25.
    assert second["memberFit"][0]["score"] == 25
    assert first["score"] > second["score"]
    assert content["recommended_option_id"] == "f1"
    assert "S$1136.5" in first["whyThisFits"]
    # Tags and the trade-off carry over from the recommendation card.
    assert first["tags"] == ["SGD 1,136", "Scoot", "Direct"]
    assert first["tradeOff"] == "Nothing stands out against the other options."
    assert second["tags"] == [] and second["tradeOff"] == ""
    assert "choice is yours" in content["advice"]


@anyio
async def test_fallback_destination_score_uses_wish_lists():
    r = bundle()
    r.vote_session_repo.get_tie_pending_by_room.return_value = session()
    r.vote_repo.list_by_session.return_value = [
        {"member_id": OWNER, "option_id": "tokyo"},
        {"member_id": MEMBER, "option_id": "seoul"},
    ]
    state = node_state()
    state.trip_context["preferences"] = [
        {"member_id": OWNER, "destinations": ["Japan", "Tokyo"]},
        {"member_id": MEMBER, "destinations": ["Tokyo"]},
    ]

    await tiebreak_node(state, {"configurable": {"repos": r}})

    tokyo, seoul = posted_content(r)["items"]
    assert tokyo["memberFit"][1]["reason"] == "On their wish list"
    assert tokyo["score"] > seoul["score"]


@anyio
async def test_node_does_nothing_without_a_tied_vote():
    r = bundle()
    r.vote_session_repo.get_tie_pending_by_room.return_value = None

    await tiebreak_node(node_state(), {"configurable": {"repos": r}})

    r.message_repo.insert_turn.assert_not_awaited()


# --- route ----------------------------------------------------------------------------


@pytest.fixture
def client(mocker):
    service = mocker.AsyncMock(spec=VotingEndpointService)
    app.dependency_overrides[get_voting_endpoint_service] = lambda: service
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client, service
    app.dependency_overrides.clear()


def test_break_tie_route(client):
    test_client, service = client
    service.break_tie.return_value = {
        "vote_session_id": SESSION_ID,
        "category": "destination",
        "winning_option": {"id": "seoul", "label": "Seoul"},
        "tie": {"tied_option_ids": ["tokyo", "seoul"], "tied_count": 1},
        "selection_id": "sel-1",
    }

    response = test_client.post(
        f"/votes/{SESSION_ID}/break-tie", json={"memberId": OWNER, "optionId": "seoul"}
    )

    assert response.status_code == 200
    assert response.json()["winningOption"]["id"] == "seoul"
    assert response.json()["tiePending"] is False
    service.break_tie.assert_awaited_once_with(SESSION_ID, OWNER, "seoul")


def test_cast_during_a_tie_maps_to_422(client):
    test_client, service = client
    service.cast.side_effect = VoteTiePendingError("tied")

    response = test_client.post(
        f"/votes/{SESSION_ID}/cast", json={"memberId": MEMBER, "optionId": "tokyo"}
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VOTE_TIE_PENDING"


@anyio
async def test_the_prompt_describes_the_party_the_same_way_discovery_does():
    r = flight_bundle()
    r.llm = AsyncMock()
    r.llm.generate_structured.return_value = scored_advice()
    state = node_state()
    state.trip_context["members"][0]["role"] = "owner"
    state.trip_context["preferences"] = [
        {
            "member_id": OWNER,
            "budget": 1500,
            "interests": ["food"],
            "destinations": ["asia"],
            "travel_style": "planner",
            "hard_constraints": [{"type": "departure_origin", "value": "SIN"}],
            "available_dates": [{"start": "2026-11-12", "end": "2026-11-16"}],
        }
    ]
    state.trip_context["characters"] = [{"member_id": OWNER, "appearance": {"budgetTier": "low"}}]

    await tiebreak_node(state, {"configurable": {"repos": r}})

    prompt = r.llm.generate_structured.await_args.kwargs["user_prompt"]
    assert f"member_id={OWNER} | Gerald (party leader)" in prompt
    assert "budget: Low, SGD 1,500 total" in prompt
    assert "Budget level: low (1 of 1 chose Low Budget), about SGD 50-120" in prompt
    assert "a hard limit, set by Gerald" in prompt
    assert "Trip types / regions: Asia (1/1)" in prompt
    assert "role: Planner" in prompt
    # No raw origin codes or constraint bookkeeping reach the model.
    assert "departure_origin" not in prompt and "hard constraints" not in prompt
