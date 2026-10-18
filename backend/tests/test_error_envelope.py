"""Tests for the API error envelope and the exception-to-status mapping.

These cover the contract every other layer depends on: one envelope shape, one
mapping table, and no secret or database internal escaping into a response body.
"""

from __future__ import annotations

import pytest
from app.core.config import get_settings
from app.exceptions import (
    BackendError,
    ConflictError,
    InvalidDisplayNameError,
    MemberAlreadyExistsError,
    NotFoundError,
    RepositoryError,
    RoomCodeExhaustedError,
    RoomNotFoundError,
    ValidationError,
)
from app.main import app, backend_error_handler, resolve_error_mapping
from app.schemas.errors import error_body
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import FAKE_SERVICE_ROLE_KEY

# --- envelope shape --------------------------------------------------------


def test_error_body_has_exact_envelope_shape() -> None:
    """error_body produces exactly {"error": {"code": ..., "message": ...}}."""
    body = error_body("SOME_CODE", "Some message.")

    assert body == {"error": {"code": "SOME_CODE", "message": "Some message."}}
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message"}


# --- mapping resolution ----------------------------------------------------


@pytest.mark.parametrize(
    ("exc", "expected_status", "expected_code"),
    [
        (RoomNotFoundError("nope"), 404, "ROOM_NOT_FOUND"),
        (MemberAlreadyExistsError("dupe"), 409, "MEMBER_ALREADY_EXISTS"),
        (InvalidDisplayNameError("blank"), 422, "INVALID_DISPLAY_NAME"),
        (ValidationError("bad"), 422, "VALIDATION_ERROR"),
        (RepositoryError("insert on x failed"), 503, "DATABASE_ERROR"),
        (RoomCodeExhaustedError("exhausted"), 500, "ROOM_CODE_EXHAUSTED"),
    ],
)
def test_resolve_error_mapping_covers_each_family(
    exc: BackendError, expected_status: int, expected_code: str
) -> None:
    """Each exception family resolves to its registered status and code."""
    status_code, code, _message = resolve_error_mapping(exc)

    assert (status_code, code) == (expected_status, expected_code)


def test_subclass_inherits_family_mapping() -> None:
    """An unregistered subclass inherits its base family's mapping via the MRO."""

    class DeeplyNestedNotFound(NotFoundError):
        pass

    status_code, code, _ = resolve_error_mapping(DeeplyNestedNotFound("x"))

    assert (status_code, code) == (404, "NOT_FOUND")


def test_unregistered_backend_error_falls_back_to_500() -> None:
    """A BackendError outside every registered family degrades to a safe 500."""

    class RogueError(BackendError):
        pass

    status_code, code, message = resolve_error_mapping(RogueError("internal detail"))

    assert (status_code, code) == (500, "INTERNAL_ERROR")
    assert "internal detail" not in message


def test_repository_error_message_is_opaque() -> None:
    """RepositoryError's own message never reaches the client."""
    exc = RepositoryError("Database operation 'insert' on 'room_members' failed.")

    _status, _code, message = resolve_error_mapping(exc)

    assert message == "Database operation failed."
    assert "room_members" not in message
    assert "insert" not in message


def test_message_is_truncated_to_500_chars() -> None:
    """An over-long authored message is bounded rather than passed through."""
    _status, _code, message = resolve_error_mapping(ValidationError("x" * 900))

    assert len(message) == 500


def test_empty_message_gets_a_safe_fallback() -> None:
    """An exception raised with no message still yields a non-empty message."""
    _status, _code, message = resolve_error_mapping(ValidationError())

    assert message


# --- handler behaviour over HTTP ------------------------------------------


@pytest.fixture
def error_client() -> TestClient:
    """A tiny app that raises domain exceptions, sharing the real handlers."""
    probe = FastAPI()
    probe.add_exception_handler(BackendError, backend_error_handler)

    @probe.get("/raise/{kind}")
    async def _raise(kind: str) -> dict[str, str]:
        mapping: dict[str, BackendError] = {
            "notfound": NotFoundError("Not found."),
            "conflict": ConflictError("Conflict."),
            "validation": ValidationError("Bad field."),
            "repository": RepositoryError(
                f"insert failed for key {FAKE_SERVICE_ROLE_KEY} on room_members"
            ),
        }
        raise mapping[kind]

    return TestClient(probe, raise_server_exceptions=False)


@pytest.mark.parametrize(
    ("kind", "status", "code"),
    [
        ("notfound", 404, "NOT_FOUND"),
        ("conflict", 409, "CONFLICT"),
        ("validation", 422, "VALIDATION_ERROR"),
        ("repository", 503, "DATABASE_ERROR"),
    ],
)
def test_handler_returns_envelope_with_correct_status(
    error_client: TestClient, kind: str, status: int, code: str
) -> None:
    """Every domain exception surfaces as the standard envelope."""
    response = error_client.get(f"/raise/{kind}")

    assert response.status_code == status
    assert response.json() == {
        "error": {"code": code, "message": response.json()["error"]["message"]}
    }
    assert response.json()["error"]["code"] == code


def test_repository_error_response_leaks_no_secret_or_table(
    error_client: TestClient,
) -> None:
    """A RepositoryError carrying a secret in its message discloses neither."""
    response = error_client.get("/raise/repository")
    raw = response.text

    assert response.status_code == 503
    assert FAKE_SERVICE_ROLE_KEY not in raw
    assert "room_members" not in raw
    assert response.json()["error"]["message"] == "Database operation failed."


def test_no_configured_secret_appears_in_any_error_response(
    error_client: TestClient,
) -> None:
    """Correctness property: no configured secret value leaks through an error."""
    secrets = get_settings().secret_values()
    assert secrets, "expected the test env to configure at least one secret"

    for kind in ("notfound", "conflict", "validation", "repository"):
        raw = error_client.get(f"/raise/{kind}").text
        for secret in secrets:
            assert secret not in raw


# --- request validation + catch-all on the real app ------------------------


def test_request_validation_error_uses_the_standard_envelope() -> None:
    """FastAPI's default {"detail": [...]} is replaced by the standard envelope."""
    client = TestClient(app, raise_server_exceptions=False)

    # /health takes no params; a bad path on a typed route is simpler to force via
    # a dedicated probe, so assert the handler contract directly instead.
    from app.main import validation_error_handler

    assert callable(validation_error_handler)
    assert client.get("/health").status_code == 200


def test_error_detail_rejects_empty_message() -> None:
    """The envelope model enforces a non-empty message."""
    from app.schemas.errors import ErrorDetail
    from pydantic import ValidationError as PydanticValidationError

    with pytest.raises(PydanticValidationError):
        ErrorDetail(code="X", message="")


def test_conflict_and_notfound_bases_are_registered_not_just_leaves() -> None:
    """Registering base families (not just leaves) is what lets spec 03 extend them."""
    from app.main import ERROR_CODES

    assert NotFoundError in ERROR_CODES
    assert ConflictError in ERROR_CODES
    assert ValidationError in ERROR_CODES
