"""FastAPI application entrypoint for the PixelArt Trip Planner backend.

Responsibilities kept deliberately narrow: build the app, install CORS, register
the centralized exception handlers, and include the route modules.

**All** error translation happens here. Services, repositories, and the agent
layer raise :class:`~app.exceptions.BackendError` subclasses and never construct
HTTP responses, so there is exactly one place where a domain failure becomes a
status code and one envelope shape on the wire.

Run locally with::

    uvicorn app.main:app --reload
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import dev, health, messages, preferences, rooms, trips, votes
from app.core.config import get_settings
from app.exceptions import (
    BackendError,
    ConflictError,
    InvalidBudgetError,
    InvalidDisplayNameError,
    InvalidTripDatesError,
    ItineraryVersionNotFoundError,
    MemberAlreadyExistsError,
    NotFoundError,
    RepositoryError,
    RoomCodeExhaustedError,
    RoomNotFoundError,
    RunNotFoundError,
    TripDatesLockedError,
    ValidationError,
    VersionNotProposedError,
    VoteSessionNotFoundError,
    VoteTiePendingError,
)
from app.schemas.errors import error_body

logger = logging.getLogger(__name__)

settings = get_settings()

# The interactive API docs are a development aid; production does not publish them.
_docs = settings.environment.lower() != "production"
app = FastAPI(
    title=settings.app_name,
    docs_url="/docs" if _docs else None,
    redoc_url="/redoc" if _docs else None,
    openapi_url="/openapi.json" if _docs else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(rooms.router)
app.include_router(preferences.router)
app.include_router(votes.router)
app.include_router(trips.router)
app.include_router(messages.router)
if settings.enable_dev_endpoints:
    # Testing-only routes (lock a test flight, add feedback); absent unless explicitly enabled.
    app.include_router(dev.router)


# ---------------------------------------------------------------------------
# Error-code mapping
#
# Each entry maps an exception class to its (HTTP status, error code). Handlers
# below consult this table so adding an exception is a one-line change and the
# mapping stays inspectable in one place.
#
# Ordering matters: the registry is walked most-specific-first via the exception's
# MRO, so a subclass may override its base's mapping.
# ---------------------------------------------------------------------------

ERROR_CODES: dict[type[BackendError], tuple[int, str]] = {
    NotFoundError: (404, "NOT_FOUND"),
    ConflictError: (409, "CONFLICT"),
    ValidationError: (422, "VALIDATION_ERROR"),
    RepositoryError: (503, "DATABASE_ERROR"),
    RoomCodeExhaustedError: (500, "ROOM_CODE_EXHAUSTED"),
    # Leaf overrides: the MRO walk finds these before the family default, so the
    # room API keeps its specific codes.
    RoomNotFoundError: (404, "ROOM_NOT_FOUND"),
    VoteSessionNotFoundError: (404, "VOTE_SESSION_NOT_FOUND"),
    VoteTiePendingError: (422, "VOTE_TIE_PENDING"),
    RunNotFoundError: (404, "RUN_NOT_FOUND"),
    ItineraryVersionNotFoundError: (404, "ITINERARY_VERSION_NOT_FOUND"),
    VersionNotProposedError: (409, "VERSION_NOT_PROPOSED"),
    MemberAlreadyExistsError: (409, "MEMBER_ALREADY_EXISTS"),
    InvalidDisplayNameError: (422, "INVALID_DISPLAY_NAME"),
    InvalidBudgetError: (422, "INVALID_BUDGET"),
    InvalidTripDatesError: (422, "INVALID_TRIP_DATES"),
    TripDatesLockedError: (409, "TRIP_DATES_LOCKED"),
}

#: Exceptions whose own message must never reach the client. For these the
#: handler substitutes a fixed safe string, because the message is written for
#: internal logs and may name tables, operations, or constraints.
_OPAQUE_MESSAGE: dict[type[BackendError], str] = {
    RepositoryError: "Database operation failed.",
}

#: Constraint-violation SQLSTATE surfaced by the repository layer; declared here
#: only so the mapping table above stays the single source of HTTP translation.
_UNREGISTERED_FALLBACK = (500, "INTERNAL_ERROR")


def register_error_code(
    exc_type: type[BackendError],
    status_code: int,
    code: str,
    *,
    opaque_message: str | None = None,
) -> None:
    """Register an exception class in the error-code registry.

    The agent layer calls this at import time for each of its exception classes,
    which is how spec 03 extends this mapping without editing the table above.

    Args:
        exc_type: The :class:`BackendError` subclass to register.
        status_code: HTTP status to return for it.
        code: Machine-readable uppercase error code.
        opaque_message: When given, the client always receives this string
            instead of the exception's own message.
    """
    ERROR_CODES[exc_type] = (status_code, code)
    if opaque_message is not None:
        _OPAQUE_MESSAGE[exc_type] = opaque_message


def resolve_error_mapping(exc: BackendError) -> tuple[int, str, str]:
    """Resolve ``exc`` to its ``(status, code, message)`` triple.

    Walks the exception's MRO so a subclass inherits its base family's mapping
    unless it registered its own. Unregistered ``BackendError`` subclasses fall
    back to a 500 rather than leaking an unhandled traceback.
    """
    for klass in type(exc).__mro__:
        if klass in ERROR_CODES:
            status_code, code = ERROR_CODES[klass]
            break
    else:  # pragma: no cover - defensive; every family is registered
        status_code, code = _UNREGISTERED_FALLBACK
        return status_code, code, "An internal error occurred."

    for klass in type(exc).__mro__:
        if klass in _OPAQUE_MESSAGE:
            return status_code, code, _OPAQUE_MESSAGE[klass]

    message = str(exc) or "Request could not be completed."
    return status_code, code, message[:500]


# Register the agent layer's 22 exceptions into the table above.
#
# Imported here, after ERROR_CODES exists, rather than at the top of the module:
# `app.agents.errors` needs `register_error_code` from this module, so an eager
# top-level import in either direction would be circular.
from app.agents.errors import register_agent_errors  # noqa: E402

register_agent_errors()


@app.exception_handler(BackendError)
async def backend_error_handler(_request: Request, exc: BackendError) -> JSONResponse:
    """Translate every domain exception into the standard error envelope."""
    status_code, code, message = resolve_error_mapping(exc)
    # Full detail stays in internal logs; only the authored message goes out.
    if status_code >= 500:
        logger.error("Backend error (%s)", code, exc_info=exc)
    else:
        logger.info("Backend error (%s): %s", code, message)
    return JSONResponse(status_code=status_code, content=error_body(code, message))


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """Replace FastAPI's default ``{"detail": [...]}`` with the standard envelope."""
    fields = ", ".join(".".join(str(part) for part in err["loc"]) for err in exc.errors())
    message = f"Validation failed for: {fields}" if fields else "Validation failed."
    return JSONResponse(
        status_code=422,
        content=error_body("VALIDATION_ERROR", message[:500]),
    )


@app.exception_handler(Exception)
async def catch_all_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Return a fixed safe 500 for anything unexpected.

    Never serializes the exception: raw text, tracebacks, LLM prompt content, and
    external payloads all stay in internal logs only (Requirement 20.8).
    """
    logger.error("Unhandled exception", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content=error_body("INTERNAL_ERROR", "An internal error occurred."),
    )
