"""Error-envelope conformance tests (Requirement 22).

Every error response must be exactly ``{"error": {"code": ..., "message": <non-empty>}}``
with no FastAPI-style top-level ``"detail"`` key.
"""

import pytest
from app.api.deps import get_room_service
from app.exceptions import (
    InvalidDisplayNameError,
    MemberAlreadyExistsError,
    RepositoryError,
    RoomCodeExhaustedError,
    RoomNotFoundError,
    ValidationError,
)
from app.main import app
from app.services.room_service import RoomService
from fastapi.testclient import TestClient


@pytest.fixture
def test_client(mocker):
    mock_service = mocker.AsyncMock(spec=RoomService)
    app.dependency_overrides[get_room_service] = lambda: mock_service
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, mock_service
    app.dependency_overrides.clear()


def assert_envelope(response, status: int, code: str) -> None:
    assert response.status_code == status
    body = response.json()
    assert "detail" not in body
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message"}
    assert body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]


@pytest.mark.parametrize(
    ("exc", "status", "code"),
    [
        (RoomNotFoundError("Room 'ABC123' not found."), 404, "ROOM_NOT_FOUND"),
        (MemberAlreadyExistsError("Name taken."), 409, "MEMBER_ALREADY_EXISTS"),
        (InvalidDisplayNameError("Name is blank."), 422, "INVALID_DISPLAY_NAME"),
        (ValidationError("'room_id' must be a valid UUID."), 422, "VALIDATION_ERROR"),
        (RepositoryError("raw details"), 503, "DATABASE_ERROR"),
        (RoomCodeExhaustedError("No code."), 500, "ROOM_CODE_EXHAUSTED"),
        (RuntimeError("unexpected"), 500, "INTERNAL_ERROR"),
    ],
)
def test_domain_errors_use_envelope(test_client, exc, status, code):
    client, service = test_client
    service.join_room.side_effect = exc

    response = client.post("/rooms/ABC123/join", json={"displayName": "Gerald"})

    assert_envelope(response, status, code)


def test_request_validation_uses_envelope(test_client):
    client, _ = test_client

    response = client.post("/rooms/ABC123/join", json={"displayName": "   "})

    assert_envelope(response, 422, "VALIDATION_ERROR")
    assert "displayName" in response.json()["error"]["message"]


def test_malformed_json_uses_envelope(test_client):
    client, _ = test_client

    response = client.post(
        "/rooms", content=b"not json", headers={"content-type": "application/json"}
    )

    assert_envelope(response, 422, "VALIDATION_ERROR")
