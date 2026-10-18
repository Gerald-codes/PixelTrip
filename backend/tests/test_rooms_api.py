"""Endpoint tests for the room routes (Requirement 20).

``get_room_service`` is overridden with an ``AsyncMock(spec=RoomService)``, so these tests
exercise routing, validation, serialization, and error handling without Supabase.
"""

import pytest
from app.api.deps import get_room_service
from app.exceptions import MemberAlreadyExistsError, RepositoryError, RoomNotFoundError
from app.main import app
from app.schemas.room import CreateRoomResponse, JoinRoomResponse
from app.services.room_service import RoomService
from fastapi.testclient import TestClient

ROOM_ID = "11111111-1111-4111-8111-111111111111"
GUEST_ID = "22222222-2222-4222-8222-222222222222"
OWNER_ID = "33333333-3333-4333-8333-333333333333"
MEMBER_ID = "66666666-6666-4666-8666-666666666666"
SERVICE_ROLE_KEY = "test-service-role-key"


def payload(member_id: str, display_name: str, role: str) -> dict:
    return {
        "room": {
            "id": ROOM_ID,
            "room_code": "ABC123",
            "name": "Adventure Club",
            "status": "active",
            "planning_stage": "setup",
        },
        "member": {
            "id": member_id,
            "room_id": ROOM_ID,
            "guest_id": GUEST_ID,
            "display_name": display_name,
            "role": role,
        },
        "guest": {"id": GUEST_ID, "display_name": display_name},
        "character": {
            "id": "44444444-4444-4444-8444-444444444444",
            "member_id": member_id,
            "appearance": {},
        },
        "travel_preferences": {
            "id": "55555555-5555-4555-8555-555555555555",
            "member_id": member_id,
            "available_dates": [],
            "destinations": [],
            "interests": [],
            "activities": [],
            "hard_constraints": [],
        },
        "trip": {
            "id": "77777777-7777-4777-8777-777777777777",
            "room_id": ROOM_ID,
            "title": "Adventure Club",
            "status": "trip_created",
        },
    }


@pytest.fixture
def test_client(mocker):
    mock_service = mocker.AsyncMock(spec=RoomService)
    app.dependency_overrides[get_room_service] = lambda: mock_service
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, mock_service
    app.dependency_overrides.clear()


# --- POST /rooms ------------------------------------------------------------------------


def test_post_rooms_200(test_client):
    client, service = test_client
    service.create_room.return_value = CreateRoomResponse.model_validate(
        payload(OWNER_ID, "Gerald", "owner")
    )

    response = client.post("/rooms", json={"name": "Adventure Club", "ownerDisplayName": "Gerald"})

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"room", "member", "guest", "character", "travelPreferences", "trip"}
    assert body["room"]["roomCode"] == "ABC123"
    assert body["member"]["role"] == "owner"
    service.create_room.assert_awaited_once()


def test_post_rooms_422_empty_name(test_client):
    client, service = test_client

    response = client.post("/rooms", json={"name": "   ", "ownerDisplayName": "Gerald"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    service.create_room.assert_not_awaited()


# --- POST /rooms/{room_code}/join -------------------------------------------------------


def test_post_rooms_join_new_member_200(test_client):
    client, service = test_client
    service.join_room.return_value = JoinRoomResponse.model_validate(
        payload(MEMBER_ID, "Priya", "member")
    )

    response = client.post("/rooms/ABC123/join", json={"displayName": "Priya"})

    assert response.status_code == 200
    member = response.json()["member"]
    assert set(member) == {"id", "roomId", "guestId", "displayName", "role", "stageReady"}
    assert member["role"] == "member"


def test_post_rooms_join_resume_200(test_client):
    client, service = test_client
    service.join_room.return_value = JoinRoomResponse.model_validate(
        payload(OWNER_ID, "Gerald", "owner")
    )

    first = client.post("/rooms/ABC123/join", json={"displayName": "Gerald"})
    second = client.post("/rooms/ABC123/join", json={"displayName": "gerald"})

    assert first.status_code == second.status_code == 200
    assert first.json()["member"]["id"] == second.json()["member"]["id"]
    # The route passes the name through unchanged; the repository normalizes it.
    assert service.join_room.await_args_list[1].args[1].display_name == "gerald"


def test_post_rooms_join_404(test_client):
    client, service = test_client
    service.join_room.side_effect = RoomNotFoundError("Room 'ZZZZ99' not found.")

    response = client.post("/rooms/ZZZZ99/join", json={"displayName": "Gerald"})

    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "ROOM_NOT_FOUND", "message": "Room 'ZZZZ99' not found."}
    }


@pytest.mark.parametrize("bad_code", ["abc123", "AB", "ABCDEFGHIJKLM", "AB-123"])
def test_post_rooms_join_422_bad_code(test_client, bad_code):
    client, service = test_client

    response = client.post(f"/rooms/{bad_code}/join", json={"displayName": "Gerald"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    service.join_room.assert_not_awaited()


def test_post_rooms_join_409_conflict(test_client):
    client, service = test_client
    service.join_room.side_effect = MemberAlreadyExistsError(
        "A member with that name already exists in this room."
    )

    response = client.post("/rooms/ABC123/join", json={"displayName": "Gerald"})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "MEMBER_ALREADY_EXISTS"
    assert "room_members_room_id_normalized_name_key" not in response.text


def test_post_rooms_503_on_repo_error(test_client):
    client, service = test_client
    service.join_room.side_effect = RepositoryError(
        f"duplicate key ... constraint room_members_pkey ... {SERVICE_ROLE_KEY}"
    )

    response = client.post("/rooms/ABC123/join", json={"displayName": "Gerald"})

    assert response.status_code == 503
    assert response.json() == {
        "error": {"code": "DATABASE_ERROR", "message": "Database operation failed."}
    }
    assert SERVICE_ROLE_KEY not in response.text
    assert "room_members_pkey" not in response.text


def test_post_rooms_500_on_unexpected_error(test_client):
    client, service = test_client
    service.create_room.side_effect = RuntimeError(f"boom {SERVICE_ROLE_KEY}")

    response = client.post("/rooms", json={"name": "Adventure Club", "ownerDisplayName": "Gerald"})

    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "INTERNAL_ERROR", "message": "An internal error occurred."}
    }
    assert SERVICE_ROLE_KEY not in response.text


# --- OpenAPI and CORS -------------------------------------------------------------------


def test_openapi_documents_room_routes(test_client):
    client, _ = test_client

    spec = client.get("/openapi.json").json()

    create = spec["paths"]["/rooms"]["post"]
    join = spec["paths"]["/rooms/{room_code}/join"]["post"]
    assert create["summary"] and create["description"]
    assert join["summary"] and join["description"]
    assert {"200", "422"} <= set(create["responses"])
    assert {"200", "404", "409", "422"} <= set(join["responses"])
    assert "ErrorResponse" in spec["components"]["schemas"]


def test_cors_preflight_allows_frontend(test_client):
    client, _ = test_client

    response = client.options(
        "/rooms",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
