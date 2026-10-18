"""Unit tests for the week-1 endpoint services, with mocked repositories (no network)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.agents.errors import TripNotFoundError, UnresolvedMemberError
from app.exceptions import (
    RoomNotFoundError,
    RunNotFoundError,
    ValidationError,
    VoteSessionNotFoundError,
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
from app.schemas.planning import SavePreferencesRequest
from app.services import run_endpoint_service, voting_endpoint_service
from app.services.preference_service import PreferenceService
from app.services.run_endpoint_service import RunEndpointService
from app.services.voting_endpoint_service import VotingEndpointService

pytestmark = pytest.mark.anyio

ROOM_ID = "11111111-1111-4111-8111-111111111111"
OTHER_ROOM_ID = "99999999-9999-4999-8999-999999999999"
TRIP_ID = "22222222-2222-4222-8222-222222222222"
M1 = "33333333-3333-4333-8333-333333333333"
M2 = "44444444-4444-4444-8444-444444444444"
SESSION_ID = "55555555-5555-4555-8555-555555555555"
RUN_ID = "66666666-6666-4666-8666-666666666666"

ROOM = {"id": ROOM_ID, "room_code": "ABC123", "status": "active", "planning_stage": "setup"}
TRIP = {
    "id": TRIP_ID,
    "room_id": ROOM_ID,
    "title": "Trip",
    "summary": None,
    "status": "group_formed",
}


def member(member_id: str, room_id: str = ROOM_ID, role: str = "member") -> dict[str, Any]:
    return {"id": member_id, "room_id": room_id, "role": role}


def prefs_row(member_id: str, submitted: bool) -> dict[str, Any]:
    return {
        "id": f"p-{member_id}",
        "member_id": member_id,
        "available_dates": [{"start": "2026-12-20", "end": "2026-12-27"}],
        "destinations": [],
        "travel_style": None,
        "budget": 1500,
        "interests": [],
        "activities": [],
        "hard_constraints": [],
        "origin": "SIN",
        "submitted_at": "2026-10-04T00:00:00+00:00" if submitted else None,
    }


CHARACTER = {
    "id": "c-1",
    "member_id": M1,
    "appearance": {"outfit": "explorer"},
    "sprite_key": "explorer-01",
}


def bundle() -> SimpleNamespace:
    """Every repository as a spec'd AsyncMock, shaped like RepositoryBundle."""
    return SimpleNamespace(
        agent_run_repo=AsyncMock(spec=AgentRunRepository),
        trip_repo=AsyncMock(spec=TripRepository),
        room_repo=AsyncMock(spec=RoomRepository),
        message_repo=AsyncMock(spec=MessageRepository),
        member_repo=AsyncMock(spec=MemberRepository),
        profile_repo=AsyncMock(spec=ProfileRepository),
        itinerary_version_repo=AsyncMock(spec=ItineraryVersionRepository),
        selection_repo=AsyncMock(spec=SelectionRepository),
        feedback_repo=AsyncMock(spec=FeedbackRepository),
        vote_session_repo=AsyncMock(spec=VoteSessionRepository),
        vote_repo=AsyncMock(spec=VoteRepository),
    )


# --- PreferenceService ------------------------------------------------------------


@pytest.fixture
def repos() -> SimpleNamespace:
    r = bundle()
    r.room_repo.get_room_by_code.return_value = ROOM
    r.member_repo.get_member_by_id.return_value = member(M1)
    r.profile_repo.save_preferences.return_value = prefs_row(M1, submitted=True)
    r.trip_repo.get_by_room_id.return_value = TRIP
    r.member_repo.list_by_room.return_value = [member(M1), member(M2)]
    r.profile_repo.get_character_by_member_id.return_value = CHARACTER
    return r


def preference_service(r: SimpleNamespace) -> PreferenceService:
    return PreferenceService(r.room_repo, r.member_repo, r.profile_repo, r.trip_repo)


async def test_save_preferences_stores_json_ready_fields(repos):
    request = SavePreferencesRequest(
        available_dates=[{"start": "2026-12-20", "end": "2026-12-27"}],
        budget=1500,
        origin="  SIN ",
        travel_style="  ",
    )
    repos.profile_repo.list_preferences_by_member_ids.return_value = [prefs_row(M1, True)]

    await preference_service(repos).save("ABC123", M1, request)

    member_id, fields = repos.profile_repo.save_preferences.await_args.args
    assert member_id == M1
    assert fields["available_dates"] == [{"start": "2026-12-20", "end": "2026-12-27"}]
    assert fields["origin"] == "SIN"
    assert fields["travel_style"] is None


@pytest.mark.parametrize("budget", [2, 99.5, 50_001])
async def test_save_preferences_refuses_a_budget_outside_100_to_50000(repos, budget):
    from app.exceptions import InvalidBudgetError

    request = SavePreferencesRequest(budget=budget)

    with pytest.raises(InvalidBudgetError, match="between SGD 100 and SGD 50,000"):
        await preference_service(repos).save("ABC123", M1, request)

    repos.profile_repo.save_preferences.assert_not_called()


@pytest.mark.parametrize("budget", [None, 100, 50_000])
async def test_save_preferences_accepts_no_budget_or_the_range_edges(repos, budget):
    repos.profile_repo.list_preferences_by_member_ids.return_value = [prefs_row(M1, True)]

    await preference_service(repos).save("ABC123", M1, SavePreferencesRequest(budget=budget))

    repos.profile_repo.save_preferences.assert_awaited_once()


async def test_save_preferences_mirrors_origin_into_hard_constraints(repos):
    repos.profile_repo.list_preferences_by_member_ids.return_value = [prefs_row(M1, True)]
    request = SavePreferencesRequest(
        origin="SIN",
        hard_constraints=["no red-eye", {"type": "departure_origin", "value": "OLD"}],
    )

    await preference_service(repos).save("ABC123", M1, request)

    _, fields = repos.profile_repo.save_preferences.await_args.args
    assert fields["hard_constraints"] == [
        "no red-eye",
        {"type": "departure_origin", "value": "SIN"},
    ]


async def test_clearing_origin_removes_the_mirrored_constraint(repos):
    repos.profile_repo.list_preferences_by_member_ids.return_value = [prefs_row(M1, True)]
    request = SavePreferencesRequest(
        hard_constraints=[{"type": "departure_origin", "value": "SIN"}]
    )

    await preference_service(repos).save("ABC123", M1, request)

    _, fields = repos.profile_repo.save_preferences.await_args.args
    assert fields["hard_constraints"] == []


async def test_last_member_to_submit_collects_preferences(repos):
    repos.profile_repo.list_preferences_by_member_ids.return_value = [
        prefs_row(M1, True),
        prefs_row(M2, True),
    ]
    repos.trip_repo.update_status.return_value = {**TRIP, "status": "preferences_collected"}

    response = await preference_service(repos).save("ABC123", M1, SavePreferencesRequest())

    repos.trip_repo.update_status.assert_awaited_once_with(
        TRIP_ID, "preferences_collected", "discover"
    )
    assert response.trip.status == "preferences_collected"
    assert response.travel_preferences.member_id == M1


async def test_preferences_not_collected_while_someone_is_missing(repos):
    repos.profile_repo.list_preferences_by_member_ids.return_value = [
        prefs_row(M1, True),
        prefs_row(M2, False),
    ]

    response = await preference_service(repos).save("ABC123", M1, SavePreferencesRequest())

    repos.trip_repo.update_status.assert_not_awaited()
    assert response.trip.status == "group_formed"


async def test_preferences_unknown_room(repos):
    repos.room_repo.get_room_by_code.return_value = None

    with pytest.raises(RoomNotFoundError):
        await preference_service(repos).save("ZZZZ99", M1, SavePreferencesRequest())
    repos.profile_repo.save_preferences.assert_not_awaited()


async def test_preferences_member_from_another_room_is_rejected(repos):
    repos.member_repo.get_member_by_id.return_value = member(M1, room_id=OTHER_ROOM_ID)

    with pytest.raises(UnresolvedMemberError):
        await preference_service(repos).save("ABC123", M1, SavePreferencesRequest())
    repos.profile_repo.save_preferences.assert_not_awaited()


async def test_character_is_saved_with_preferences(repos):
    repos.profile_repo.list_preferences_by_member_ids.return_value = [prefs_row(M1, True)]
    repos.profile_repo.save_character.return_value = {
        **CHARACTER,
        "appearance": {"outfit": "knight"},
        "sprite_key": "knight-02",
    }
    request = SavePreferencesRequest(
        budget=1500,
        character={"appearance": {"outfit": "knight"}, "sprite_key": "  knight-02 "},
    )

    response = await preference_service(repos).save("ABC123", M1, request)

    repos.profile_repo.save_character.assert_awaited_once_with(
        M1, {"outfit": "knight"}, "knight-02"
    )
    _, fields = repos.profile_repo.save_preferences.await_args.args
    assert "character" not in fields  # not a travel_preferences column
    assert response.character is not None
    assert response.character.sprite_key == "knight-02"


async def test_omitted_character_is_left_unchanged(repos):
    repos.profile_repo.list_preferences_by_member_ids.return_value = [prefs_row(M1, True)]

    response = await preference_service(repos).save("ABC123", M1, SavePreferencesRequest())

    repos.profile_repo.save_character.assert_not_awaited()
    assert response.character is not None
    assert response.character.sprite_key == "explorer-01"


async def test_rejected_member_saves_no_character(repos):
    repos.member_repo.get_member_by_id.return_value = member(M1, room_id=OTHER_ROOM_ID)

    with pytest.raises(UnresolvedMemberError):
        await preference_service(repos).save(
            "ABC123", M1, SavePreferencesRequest(character={"appearance": {}})
        )
    repos.profile_repo.save_character.assert_not_awaited()


# --- VotingEndpointService --------------------------------------------------------

SESSION = {
    "id": SESSION_ID,
    "room_id": ROOM_ID,
    "status": "open",
    "options": [{"id": "opt-a", "title": "Kyoto"}, {"id": "opt-b", "title": "Seoul"}],
}


async def test_cast_vote_unknown_session_is_404():
    r = bundle()
    r.vote_session_repo.get_by_id.return_value = None

    with pytest.raises(VoteSessionNotFoundError):
        await VotingEndpointService(r).cast(SESSION_ID, M1, "opt-a")


async def test_cast_vote_rejects_option_outside_the_session(monkeypatch):
    r = bundle()
    r.vote_session_repo.get_by_id.return_value = SESSION
    cast = AsyncMock()
    monkeypatch.setattr(voting_endpoint_service, "cast_vote", cast)

    with pytest.raises(ValidationError):
        await VotingEndpointService(r).cast(SESSION_ID, M1, "opt-zzz")
    cast.assert_not_awaited()


async def test_cast_vote_reports_the_session_closing(monkeypatch):
    r = bundle()
    r.vote_session_repo.get_by_id.side_effect = [SESSION, {**SESSION, "status": "closed"}]
    cast = AsyncMock()
    monkeypatch.setattr(voting_endpoint_service, "cast_vote", cast)

    response = await VotingEndpointService(r).cast(SESSION_ID, M1, "opt-b")

    cast.assert_awaited_once_with(r, SESSION_ID, M1, "opt-b")
    assert response.session_status == "closed"
    assert response.option_id == "opt-b"
    # The vote moved the party on; readiness belongs to the new stage, so not set here.
    r.member_repo.set_stage_ready.assert_not_awaited()


async def test_cast_vote_marks_the_voter_ready_while_the_vote_is_open(monkeypatch):
    r = bundle()
    r.vote_session_repo.get_by_id.side_effect = [SESSION, SESSION]
    monkeypatch.setattr(voting_endpoint_service, "cast_vote", AsyncMock())

    response = await VotingEndpointService(r).cast(SESSION_ID, M1, "opt-a")

    assert response.session_status == "open"
    r.member_repo.set_stage_ready.assert_awaited_once_with(M1, True)


async def test_close_vote_maps_the_resolution(monkeypatch):
    r = bundle()
    r.vote_session_repo.get_by_id.return_value = SESSION
    resolution = SimpleNamespace(
        category="destination",
        winning_option={"id": "opt-a", "title": "Kyoto"},
        tie=SimpleNamespace(tied_ids=["opt-a", "opt-b"], tied_count=1, winner_id="opt-a"),
        selection={"id": "sel-1"},
        tie_pending=False,
        closed_session={"id": SESSION_ID, "status": "closed"},
    )
    monkeypatch.setattr(
        voting_endpoint_service, "close_session", AsyncMock(return_value=resolution)
    )

    response = await VotingEndpointService(r).close(SESSION_ID, M1)

    assert response.winning_option == {"id": "opt-a", "title": "Kyoto"}
    assert response.tie is not None and response.tie.tied_option_ids == ["opt-a", "opt-b"]
    assert response.selection_id == "sel-1"


# --- RunEndpointService -----------------------------------------------------------


def pending_run(**overrides: Any) -> dict[str, Any]:
    run = {
        "id": RUN_ID,
        "trip_id": TRIP_ID,
        "run_type": "discovery",
        "status": "pending",
        "base_version": 0,
        "created_by_member_id": M1,
        "idempotency_key": None,
        "result_version_id": None,
        "error": None,
    }
    run.update(overrides)
    return run


@pytest.fixture
def run_repos() -> SimpleNamespace:
    r = bundle()
    r.trip_repo.get_by_id.return_value = TRIP
    r.member_repo.get_by_id.return_value = member(M1)
    r.agent_run_repo.get_active.return_value = None
    r.agent_run_repo.get_by_idempotency_key.return_value = None
    r.itinerary_version_repo.get_latest_version_number.return_value = 0
    r.agent_run_repo.create_pending.return_value = pending_run()
    return r


def run_service(r: SimpleNamespace) -> RunEndpointService:
    return RunEndpointService(**vars(r))


async def test_start_run_returns_pending_and_defers_execution(run_repos):
    started = await run_service(run_repos).start_run(TRIP_ID, "discovery", M1)

    assert started.run.status == "pending"
    assert started.execute is not None
    run_repos.agent_run_repo.create_pending.assert_awaited_once_with(
        TRIP_ID, "discovery", M1, 0, None
    )
    run_repos.agent_run_repo.mark_running.assert_not_awaited()


async def test_start_run_returns_an_existing_run_without_executing(run_repos):
    run_repos.agent_run_repo.get_active.return_value = {
        **pending_run(status="running"),
        "started_at": "2999-01-01T00:00:00+00:00",
    }

    started = await run_service(run_repos).start_run(TRIP_ID, "discovery", M1)

    assert started.run.status == "running"
    assert started.execute is None
    run_repos.agent_run_repo.create_pending.assert_not_awaited()


async def test_start_run_unknown_trip(run_repos):
    run_repos.trip_repo.get_by_id.return_value = None

    with pytest.raises(TripNotFoundError):
        await run_service(run_repos).start_run(TRIP_ID, "discovery", M1)


async def test_start_run_member_from_another_room_is_rejected(run_repos):
    run_repos.member_repo.get_by_id.return_value = member(M1, room_id=OTHER_ROOM_ID)

    with pytest.raises(UnresolvedMemberError):
        await run_service(run_repos).start_run(TRIP_ID, "discovery", M1)
    run_repos.agent_run_repo.create_pending.assert_not_awaited()


async def test_execute_run_success_completes_the_run(run_repos, monkeypatch):
    final_state = SimpleNamespace(
        run_type="discovery", trip_context={"result_version_id": None}, proposal=object()
    )
    monkeypatch.setattr(
        run_endpoint_service, "run_agent_graph", AsyncMock(return_value=final_state)
    )
    monkeypatch.setattr(run_endpoint_service, "emit_progress_message", AsyncMock())

    started = await run_service(run_repos).start_run(TRIP_ID, "discovery", M1)
    await started.execute()

    run_repos.agent_run_repo.mark_running.assert_awaited_once_with(RUN_ID)
    run_repos.agent_run_repo.mark_completed.assert_awaited_once_with(RUN_ID, None)
    run_repos.agent_run_repo.mark_failed.assert_not_awaited()


async def test_execute_run_graph_failure_fails_the_run(run_repos, monkeypatch):
    monkeypatch.setattr(
        run_endpoint_service, "run_agent_graph", AsyncMock(side_effect=RuntimeError("boom"))
    )
    monkeypatch.setattr(run_endpoint_service, "emit_progress_message", AsyncMock())
    run_repos.trip_repo.get_room_id_for_trip.return_value = None

    started = await run_service(run_repos).start_run(TRIP_ID, "discovery", M1)
    await started.execute()

    run_repos.agent_run_repo.mark_failed.assert_awaited_once()
    assert "boom" not in run_repos.agent_run_repo.mark_failed.await_args.args[1]


async def test_execute_run_bookkeeping_failure_still_fails_the_run(run_repos, monkeypatch):
    run_repos.agent_run_repo.mark_running.side_effect = RuntimeError("db down")

    started = await run_service(run_repos).start_run(TRIP_ID, "discovery", M1)
    await started.execute()  # must not raise

    run_repos.agent_run_repo.mark_failed.assert_awaited_once()


async def test_get_run_unknown_is_404(run_repos):
    run_repos.agent_run_repo.get_by_id.return_value = None

    with pytest.raises(RunNotFoundError):
        await run_service(run_repos).get_run(RUN_ID)


async def test_latest_run_reports_its_phase_and_elapsed_time(run_repos):
    run_repos.agent_run_repo.get_latest_for_trip.return_value = {
        **pending_run(),
        "status": "failed",
        "run_type": "logistics",
        "phase": "searching_flights",
        "created_at": "2026-10-10T08:00:00+00:00",
        "started_at": "2026-10-10T08:00:02+00:00",
        "completed_at": "2026-10-10T08:00:14+00:00",
    }

    progress = await run_service(run_repos).get_latest_run(TRIP_ID, "logistics")

    run_repos.agent_run_repo.get_latest_for_trip.assert_awaited_once_with(TRIP_ID, "logistics")
    assert progress.model_dump(by_alias=True) == {
        "id": pending_run()["id"],
        "runType": "logistics",
        "status": "failed",
        "phase": "searching_flights",
        "elapsedSeconds": 12,
    }


async def test_latest_run_is_none_before_any_run(run_repos):
    run_repos.agent_run_repo.get_latest_for_trip.return_value = None

    assert await run_service(run_repos).get_latest_run(TRIP_ID, None) is None


async def test_report_phase_never_raises():
    from app.agents.progress import report_phase

    repos = SimpleNamespace(agent_run_repo=AsyncMock())
    repos.agent_run_repo.set_phase.side_effect = RuntimeError("column missing")
    state = SimpleNamespace(run_id="r1")

    await report_phase(repos, state, "asking_guide")  # swallowed

    repos.agent_run_repo.set_phase.assert_awaited_once_with("r1", "asking_guide")


async def test_ready_is_marked_before_saving_so_a_concurrent_stage_change_clears_it(repos):
    """Two members saving at once must not leave anyone 'ready' in DISCOVER."""
    order: list[str] = []
    repos.member_repo.set_stage_ready.side_effect = lambda *_: order.append("ready")
    repos.profile_repo.save_preferences.side_effect = lambda *_: (
        order.append("save") or {**prefs_row(M1, True)}
    )
    repos.profile_repo.list_preferences_by_member_ids.return_value = [prefs_row(M1, True)]

    await preference_service(repos).save("ABC123", M1, SavePreferencesRequest())

    assert order == ["ready", "save"]


async def test_a_late_joiner_is_not_marked_ready(repos):
    """Past SETUP, ready means 'has voted'; saving a character must not count as a vote."""
    repos.room_repo.get_room_by_code.return_value = {**ROOM, "planning_stage": "discover"}
    repos.profile_repo.list_preferences_by_member_ids.return_value = [prefs_row(M1, True)]

    await preference_service(repos).save("ABC123", M1, SavePreferencesRequest())

    repos.member_repo.set_stage_ready.assert_not_called()
    repos.profile_repo.save_preferences.assert_awaited_once()


async def test_a_failed_save_undoes_the_ready_mark(repos):
    repos.profile_repo.save_preferences.side_effect = RuntimeError("db down")

    with pytest.raises(RuntimeError):
        await preference_service(repos).save("ABC123", M1, SavePreferencesRequest())

    assert [c.args for c in repos.member_repo.set_stage_ready.await_args_list] == [
        (M1, True),
        (M1, False),
    ]
