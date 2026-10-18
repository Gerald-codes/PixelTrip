"""Tests for the agent layer's 22 domain exceptions and their HTTP mapping.

Covers Requirement 20.7 (no parallel hierarchy — every agent exception subclasses
a spec 02 family base), Requirement 20.9 (each maps onto an existing handler
family with the design's documented code), and Requirement 3.6 / 20.5 / 20.8 (no
message discloses a secret, payload, SQL, or traceback).
"""

from __future__ import annotations

import inspect
import re

import pytest
from app.agents import errors as agent_errors
from app.agents.errors import (
    AGENT_ERROR_CODES,
    DestinationNotSelectedError,
    DuplicateApprovalError,
    ExternalToolUnavailableError,
    FlightNotSelectedError,
    IdempotencyKeyConflictError,
    InvalidIdempotencyKeyError,
    InvalidRunTypeError,
    InvalidTripDurationError,
    IterationCapExceededError,
    ItineraryPersistenceError,
    LLMGenerationError,
    MessageContentTooLargeError,
    NoApprovedItineraryError,
    NoItineraryToRefineError,
    PreferencesNotCollectedError,
    RepeatedVersionContentionError,
    RoomResolutionError,
    RunIdentityMutationError,
    RunStatusTransitionError,
    StagePreconditionNotMetError,
    StateBoundExceededError,
    ToolCallCapExceededError,
    TripNotFoundError,
    UnresolvedMemberError,
    VoteSessionClosedError,
)
from app.core.config import get_settings
from app.exceptions import (
    BackendError,
    ConflictError,
    NotFoundError,
    RepositoryError,
    ValidationError,
)
from app.main import backend_error_handler, resolve_error_mapping
from fastapi import FastAPI
from fastapi.testclient import TestClient

# One constructed instance per exception class, so every class is exercised with
# realistic arguments rather than reflection over signatures.
_INSTANCES: list[BackendError] = [
    StagePreconditionNotMetError("logistics", "no destination is locked"),
    InvalidRunTypeError("bogus"),
    PreferencesNotCollectedError(),
    InvalidTripDurationError(45),
    RunIdentityMutationError("trip_id"),
    IterationCapExceededError(3),
    MessageContentTooLargeError(20_000, 16_384),
    InvalidIdempotencyKeyError("longer than 200 characters"),
    TripNotFoundError("11111111-1111-1111-1111-111111111111"),
    DestinationNotSelectedError(),
    FlightNotSelectedError(),
    NoItineraryToRefineError(),
    NoApprovedItineraryError(),
    RoomResolutionError("22222222-2222-2222-2222-222222222222"),
    ExternalToolUnavailableError("flight_search"),
    LLMGenerationError("destination_candidates"),
    ItineraryPersistenceError(),
    RunStatusTransitionError("pending", "completed"),
    IdempotencyKeyConflictError(),
    StateBoundExceededError("guardrail_findings", 101),
    ToolCallCapExceededError(10),
    RepeatedVersionContentionError(3),
    DuplicateApprovalError(),
    VoteSessionClosedError("55555555-5555-5555-5555-555555555555"),
    UnresolvedMemberError("77777777-7777-7777-7777-777777777777"),
]


def test_all_registered_exceptions_are_accounted_for() -> None:
    """22 from the design's table, plus 2 added for vote resolution (task 12):
    VoteSessionClosedError and UnresolvedMemberError, which the design's
    Requirement 17.13/22.2-22.3 require but the original table predates, plus 1
    for the LLM boundary: LLMGenerationError.
    """
    assert len(AGENT_ERROR_CODES) == 25


def test_every_exception_class_in_module_is_registered() -> None:
    """No agent exception class is defined but left out of the mapping table."""
    defined = {
        obj
        for _name, obj in inspect.getmembers(agent_errors, inspect.isclass)
        if issubclass(obj, BackendError) and obj.__module__ == agent_errors.__name__
    }

    assert defined == set(AGENT_ERROR_CODES)


def test_instances_cover_every_registered_class() -> None:
    """The instance list above exercises every registered class."""
    assert {type(exc) for exc in _INSTANCES} == set(AGENT_ERROR_CODES)


@pytest.mark.parametrize("exc", _INSTANCES, ids=lambda e: type(e).__name__)
def test_every_exception_subclasses_a_spec02_family_base(exc: BackendError) -> None:
    """Requirement 20.7: extends spec 02's hierarchy, no parallel one."""
    assert isinstance(exc, BackendError)
    assert isinstance(exc, ValidationError | NotFoundError | RepositoryError | ConflictError), (
        f"{type(exc).__name__} belongs to no spec 02 family"
    )


@pytest.mark.parametrize("exc", _INSTANCES, ids=lambda e: type(e).__name__)
def test_registered_status_matches_family(exc: BackendError) -> None:
    """The registered status agrees with the family the class inherits from."""
    expected_by_family = {
        ValidationError: 422,
        NotFoundError: 404,
        RepositoryError: 503,
        ConflictError: 409,
    }
    family = next(f for f in expected_by_family if isinstance(exc, f))
    status_code, _code, _msg = resolve_error_mapping(exc)

    assert status_code == expected_by_family[family]


@pytest.mark.parametrize("exc", _INSTANCES, ids=lambda e: type(e).__name__)
def test_resolved_code_matches_design_table(exc: BackendError) -> None:
    """Each class resolves to the exact code documented in design.md."""
    expected_status, expected_code = AGENT_ERROR_CODES[type(exc)]
    status_code, code, _message = resolve_error_mapping(exc)

    assert (status_code, code) == (expected_status, expected_code)


def test_error_codes_are_unique() -> None:
    """No two agent exceptions share an error code."""
    codes = [code for _status, code in AGENT_ERROR_CODES.values()]

    assert len(codes) == len(set(codes))


def test_only_the_four_expected_statuses_are_used() -> None:
    """Requirement 20.9: agent errors map onto exactly the four spec 02 families."""
    statuses = {status for status, _code in AGENT_ERROR_CODES.values()}

    assert statuses == {422, 404, 503, 409}


# --- message safety --------------------------------------------------------


@pytest.mark.parametrize("exc", _INSTANCES, ids=lambda e: type(e).__name__)
def test_message_is_non_empty_and_bounded(exc: BackendError) -> None:
    """Every resolved message is present and within the 500-char envelope limit."""
    _status, _code, message = resolve_error_mapping(exc)

    assert message.strip()
    assert len(message) <= 500


@pytest.mark.parametrize("exc", _INSTANCES, ids=lambda e: type(e).__name__)
def test_message_discloses_no_secret(exc: BackendError) -> None:
    """Requirement 20.5: no configured secret appears in any resolved message."""
    _status, _code, message = resolve_error_mapping(exc)

    for secret in get_settings().secret_values():
        assert secret not in message


#: Statement-shaped SQL patterns and raw-error markers. Deliberately shaped
#: rather than bare keywords: a user-facing sentence may legitimately contain a
#: word like "update", so only SQL-*shaped* text should fail.
_UNSAFE_PATTERNS = (
    r"\bselect\b.+\bfrom\b",
    r"\binsert\s+into\b",
    r"\bupdate\b.+\bset\b",
    r"\bdelete\s+from\b",
    r"\btraceback\b",
    r"\bsqlstate\b",
    r"\b23505\b",
    r'file\s+"[^"]+",\s+line\s+\d+',
)


@pytest.mark.parametrize("exc", _INSTANCES, ids=lambda e: type(e).__name__)
def test_message_has_no_sql_or_traceback_markers(exc: BackendError) -> None:
    """No message carries SQL text, a traceback, or a raw payload marker."""
    _status, _code, message = resolve_error_mapping(exc)
    lowered = message.lower()

    for pattern in _UNSAFE_PATTERNS:
        assert re.search(pattern, lowered) is None, (
            f"{type(exc).__name__} message matched unsafe pattern {pattern!r}: {message!r}"
        )


def test_external_tool_error_does_not_inherit_database_message() -> None:
    """A 503 tool failure must not claim a database operation failed.

    It subclasses RepositoryError for the status family, so without its own opaque
    message it would inherit "Database operation failed." — misleading for a
    flight-API timeout.
    """
    _status, code, message = resolve_error_mapping(ExternalToolUnavailableError("flights"))

    assert code == "EXTERNAL_TOOL_UNAVAILABLE"
    assert "database" not in message.lower()
    assert "travel data source" in message.lower()


def test_itinerary_persistence_error_has_its_own_message() -> None:
    """Same reasoning as the tool error: distinct 503 cause, distinct message."""
    _status, code, message = resolve_error_mapping(ItineraryPersistenceError())

    assert code == "ITINERARY_PERSISTENCE_FAILED"
    assert "database" not in message.lower()
    assert "quest log" in message.lower()


def test_llm_error_has_its_own_code_and_a_safe_message() -> None:
    """The LLM boundary is not a database failure, and must not claim to be one."""
    status, code, message = resolve_error_mapping(LLMGenerationError("itinerary_days"))

    assert (status, code) == (503, "LLM_GENERATION_UNAVAILABLE")
    assert "database" not in message.lower()
    assert "itinerary_days" not in message  # the operation label is internal only


def test_llm_error_keeps_the_operation_for_internal_use() -> None:
    exc = LLMGenerationError("destination_candidates")

    assert exc.operation == "destination_candidates"


def test_external_tool_error_keeps_tool_name_for_internal_use() -> None:
    """The tool name stays available on the exception even though it is not exposed."""
    exc = ExternalToolUnavailableError("flight_search")

    assert exc.tool_name == "flight_search"


# --- over HTTP -------------------------------------------------------------


@pytest.fixture
def agent_error_client() -> TestClient:
    """A probe app that raises agent exceptions through the real handler."""
    probe = FastAPI()
    probe.add_exception_handler(BackendError, backend_error_handler)
    by_name = {type(exc).__name__: exc for exc in _INSTANCES}

    @probe.get("/raise/{name}")
    async def _raise(name: str) -> dict[str, str]:
        raise by_name[name]

    return TestClient(probe, raise_server_exceptions=False)


@pytest.mark.parametrize("exc", _INSTANCES, ids=lambda e: type(e).__name__)
def test_http_response_uses_the_standard_envelope(
    agent_error_client: TestClient, exc: BackendError
) -> None:
    """Requirement 20.3-20.4: one envelope shape for every agent exception."""
    expected_status, expected_code = AGENT_ERROR_CODES[type(exc)]

    response = agent_error_client.get(f"/raise/{type(exc).__name__}")
    body = response.json()

    assert response.status_code == expected_status
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message"}
    assert body["error"]["code"] == expected_code


@pytest.mark.parametrize("exc", _INSTANCES, ids=lambda e: type(e).__name__)
def test_http_response_leaks_no_secret(agent_error_client: TestClient, exc: BackendError) -> None:
    """Correctness property 12: no secret reaches an API_Error_Response body."""
    raw = agent_error_client.get(f"/raise/{type(exc).__name__}").text

    for secret in get_settings().secret_values():
        assert secret not in raw
