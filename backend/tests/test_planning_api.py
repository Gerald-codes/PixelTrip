"""Endpoint tests for the week-1 planning routes, with the services mocked.

These cover routing, request validation, response shapes (camelCase), status codes,
the error envelope, and that a new AI run's work is handed to a background task.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from app.api.deps import (
    get_itinerary_service,
    get_preference_service,
    get_run_endpoint_service,
    get_voting_endpoint_service,
)
from app.exceptions import RunNotFoundError, VoteSessionNotFoundError
from app.main import app
from app.schemas.agent_run import AgentRunSchema
from app.schemas.planning import (
    CastVoteResponse,
    ItineraryVersionSchema,
    SavePreferencesResponse,
    VoteResolutionResponse,
)
from app.services.itinerary_service import ItineraryService
from app.services.preference_service import PreferenceService
from app.services.run_endpoint_service import RunEndpointService, StartedRun
from app.services.voting_endpoint_service import VotingEndpointService
from fastapi.testclient import TestClient

ROOM_ID = "11111111-1111-4111-8111-111111111111"
TRIP_ID = "22222222-2222-4222-8222-222222222222"
MEMBER_ID = "33333333-3333-4333-8333-333333333333"
SESSION_ID = "55555555-5555-4555-8555-555555555555"
RUN_ID = "66666666-6666-4666-8666-666666666666"

RUN = AgentRunSchema(
    id=RUN_ID, trip_id=TRIP_ID, run_type="discovery", status="pending", base_version=0
)


def _returning(value):
    """A no-argument provider override (a parameter would become a query param)."""
    return lambda: value


@pytest.fixture
def services(mocker):
    mocks = {
        get_preference_service: mocker.AsyncMock(spec=PreferenceService),
        get_voting_endpoint_service: mocker.AsyncMock(spec=VotingEndpointService),
        get_run_endpoint_service: mocker.AsyncMock(spec=RunEndpointService),
        get_itinerary_service: mocker.AsyncMock(spec=ItineraryService),
    }
    for provider, mock in mocks.items():
        app.dependency_overrides[provider] = _returning(mock)
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, mocks
    app.dependency_overrides.clear()


# --- preferences ----------------------------------------------------------------------


def test_save_preferences_200(services):
    client, mocks = services
    service = mocks[get_preference_service]
    service.save.return_value = SavePreferencesResponse.model_validate(
        {
            "travel_preferences": {
                "id": "p1",
                "member_id": MEMBER_ID,
                "available_dates": [{"start": "2026-12-20", "end": "2026-12-27"}],
                "destinations": ["Tokyo"],
                "interests": [],
                "activities": [],
                "hard_constraints": [],
                "budget": 1500,
                "origin": "SIN",
                "submitted_at": "2026-10-04T00:00:00+00:00",
            },
            "character": {
                "id": "c1",
                "member_id": MEMBER_ID,
                "appearance": {"outfit": "explorer"},
                "sprite_key": "explorer-01",
            },
            "trip": {
                "id": TRIP_ID,
                "room_id": ROOM_ID,
                "title": "Trip",
                "status": "preferences_collected",
            },
        }
    )

    response = client.put(
        f"/rooms/ABC123/members/{MEMBER_ID}/preferences",
        json={
            "availableDates": [{"start": "2026-12-20", "end": "2026-12-27"}],
            "budget": 1500,
            "origin": "SIN",
            "character": {"appearance": {"outfit": "explorer"}, "spriteKey": "explorer-01"},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["travelPreferences"]["origin"] == "SIN"
    assert body["travelPreferences"]["submittedAt"]
    assert body["trip"]["status"] == "preferences_collected"
    assert body["character"]["spriteKey"] == "explorer-01"
    room_code, member_id, request = service.save.await_args.args
    assert (room_code, member_id) == ("ABC123", MEMBER_ID)
    assert request.budget == 1500
    assert request.character.sprite_key == "explorer-01"
    assert request.character.appearance == {"outfit": "explorer"}


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/rooms/ABC123/members/not-a-uuid/preferences", {}),
        (f"/rooms/abc123/members/{MEMBER_ID}/preferences", {}),
        (
            f"/rooms/ABC123/members/{MEMBER_ID}/preferences",
            {"availableDates": [{"start": "2026-12-27", "end": "2026-12-20"}]},
        ),
        (f"/rooms/ABC123/members/{MEMBER_ID}/preferences", {"budget": -1}),
        (
            f"/rooms/ABC123/members/{MEMBER_ID}/preferences",
            {"character": {"spriteKey": "x" * 101}},
        ),
    ],
)
def test_save_preferences_validation_errors(services, path, body):
    client, mocks = services

    response = client.put(path, json=body)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    mocks[get_preference_service].save.assert_not_awaited()


# --- votes ----------------------------------------------------------------------------


def test_cast_vote_200(services):
    client, mocks = services
    service = mocks[get_voting_endpoint_service]
    service.cast.return_value = CastVoteResponse(
        vote_session_id=SESSION_ID, member_id=MEMBER_ID, option_id="opt-a", session_status="open"
    )

    response = client.post(
        f"/votes/{SESSION_ID}/cast", json={"memberId": MEMBER_ID, "optionId": "opt-a"}
    )

    assert response.status_code == 200
    assert response.json() == {
        "voteSessionId": SESSION_ID,
        "memberId": MEMBER_ID,
        "optionId": "opt-a",
        "sessionStatus": "open",
        "tiePending": False,
    }
    args = service.cast.await_args
    assert args.args == (SESSION_ID, MEMBER_ID, "opt-a")
    assert callable(args.kwargs["schedule"])  # background tasks hook for a tiebreak run


def test_cast_vote_unknown_session_404(services):
    client, mocks = services
    mocks[get_voting_endpoint_service].cast.side_effect = VoteSessionNotFoundError(
        "Vote session not found."
    )

    response = client.post(
        f"/votes/{SESSION_ID}/cast", json={"memberId": MEMBER_ID, "optionId": "opt-a"}
    )

    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "VOTE_SESSION_NOT_FOUND", "message": "Vote session not found."}
    }


def test_close_vote_200(services):
    client, mocks = services
    mocks[get_voting_endpoint_service].close.return_value = VoteResolutionResponse(
        vote_session_id=SESSION_ID,
        category="destination",
        winning_option={"id": "opt-a", "title": "Kyoto"},
        selection_id="sel-1",
    )

    response = client.post(f"/votes/{SESSION_ID}/close", json={"memberId": MEMBER_ID})

    assert response.status_code == 200
    assert response.json()["winningOption"] == {"id": "opt-a", "title": "Kyoto"}
    assert response.json()["tie"] is None


# --- AI runs --------------------------------------------------------------------------


def test_start_run_202_and_runs_in_background(services):
    client, mocks = services
    execute = AsyncMock()
    mocks[get_run_endpoint_service].start_run.return_value = StartedRun(run=RUN, execute=execute)

    response = client.post(
        f"/trips/{TRIP_ID}/runs",
        json={"runType": "discovery", "memberId": MEMBER_ID, "idempotencyKey": "k1"},
    )

    assert response.status_code == 202
    assert response.json() == {
        "id": RUN_ID,
        "tripId": TRIP_ID,
        "runType": "discovery",
        "status": "pending",
        "baseVersion": 0,
        "resultVersionId": None,
        "error": None,
    }
    mocks[get_run_endpoint_service].start_run.assert_awaited_once_with(
        TRIP_ID, "discovery", MEMBER_ID, "k1"
    )
    execute.assert_awaited_once()  # TestClient runs background tasks before returning


def test_start_run_existing_run_starts_nothing(services):
    client, mocks = services
    mocks[get_run_endpoint_service].start_run.return_value = StartedRun(run=RUN, execute=None)

    response = client.post(
        f"/trips/{TRIP_ID}/runs", json={"runType": "discovery", "memberId": MEMBER_ID}
    )

    assert response.status_code == 202


def test_start_run_rejects_unknown_run_type(services):
    client, mocks = services

    response = client.post(
        f"/trips/{TRIP_ID}/runs", json={"runType": "teleport", "memberId": MEMBER_ID}
    )

    assert response.status_code == 422
    mocks[get_run_endpoint_service].start_run.assert_not_awaited()


def test_get_run_404(services):
    client, mocks = services
    mocks[get_run_endpoint_service].get_run.side_effect = RunNotFoundError("Run not found.")

    response = client.get(f"/runs/{RUN_ID}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "RUN_NOT_FOUND"


# --- itinerary ------------------------------------------------------------------------


def test_list_itinerary_versions_200(services):
    client, mocks = services
    mocks[get_itinerary_service].list_versions.return_value = [
        ItineraryVersionSchema(
            id="v1",
            trip_id=TRIP_ID,
            version=1,
            source="build",
            status="proposed",
            itinerary={"days": []},
        )
    ]

    response = client.get(f"/trips/{TRIP_ID}/itinerary/versions")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": "v1",
            "tripId": TRIP_ID,
            "version": 1,
            "source": "build",
            "status": "proposed",
            "itinerary": {"days": []},
            "changeSummary": None,
        }
    ]


def test_openapi_lists_the_week1_routes(services):
    client, _ = services

    paths = client.get("/openapi.json").json()["paths"]

    for path in (
        "/rooms/{room_code}/members/{member_id}/preferences",
        "/votes/{vote_session_id}/cast",
        "/votes/{vote_session_id}/close",
        "/trips/{trip_id}/runs",
        "/runs/{run_id}",
        "/trips/{trip_id}/itinerary/versions",
    ):
        assert path in paths
