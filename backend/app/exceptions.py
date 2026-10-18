"""Domain exceptions for the PixelArt Trip Planner backend.

Every exception the backend raises for an expected, describable failure derives
from :class:`BackendError`. Each subclass maps to exactly one HTTP status and one
machine-readable error code; that mapping lives in ``app/main.py`` so routes and
services never construct HTTP responses themselves.

Two rules hold for every exception in this module and its agent-layer extension
(``app/agents/errors.py``):

1. The message is developer-authored and display-safe. It never embeds a
   service-role key, a raw Supabase payload, SQL text, LLM prompt or completion
   text, or a Python traceback.
2. Nothing here subclasses ``HTTPException``. Translation to HTTP is the
   exception handlers' job alone.
"""

from __future__ import annotations


class BackendError(Exception):
    """Base class for every expected backend failure.

    Subclasses are grouped into HTTP status families by the handler registry in
    ``app/main.py``. The agent layer extends this hierarchy rather than defining
    a parallel one (spec 03, Requirement 20.7).
    """


# --- 404 family: a referenced record does not exist -------------------------


class NotFoundError(BackendError):
    """Base for "the thing you named does not exist" failures (HTTP 404)."""


class RoomNotFoundError(NotFoundError):
    """No ``party_rooms`` row matches the supplied room code or id."""


class VoteSessionNotFoundError(NotFoundError):
    """No ``vote_sessions`` row matches the supplied id."""


class RunNotFoundError(NotFoundError):
    """No ``agent_runs`` row matches the supplied id."""


class ItineraryVersionNotFoundError(NotFoundError):
    """No itinerary version with that id belongs to the trip."""


# --- 409 family: a conflicting state or constraint violation ----------------


class ConflictError(BackendError):
    """Base for "this conflicts with existing state" failures (HTTP 409)."""


class MemberAlreadyExistsError(ConflictError):
    """A member with that display name already exists in the room."""


class VersionNotProposedError(ConflictError):
    """The itinerary version is not the one under review (not ``proposed``)."""


# --- 422 family: the request or derived state is invalid --------------------


class ValidationError(BackendError):
    """A value failed a domain guard before any database call (HTTP 422)."""


class VoteTiePendingError(ValidationError):
    """The vote is tied and waiting for the room owner's pick; no more votes."""


class InvalidDisplayNameError(ValidationError):
    """A display name was empty, whitespace-only, or over the length limit."""


class TripDatesLockedError(ConflictError):
    """The trip's dates can no longer change (the flight is already locked)."""


class InvalidTripDatesError(ValidationError):
    """The requested trip length or dates do not fit when the party is free."""


class InvalidBudgetError(ValidationError):
    """A typed trip budget is outside the accepted range (see ``app.core.budget``)."""


# --- 503 family: a dependency is unavailable -------------------------------


class RepositoryError(BackendError):
    """A Supabase operation failed unexpectedly (HTTP 503).

    The message names the operation and table for internal logs only. The HTTP
    handler substitutes a fixed safe message so no database detail escapes.
    """


# --- 500 family: internal invariants ---------------------------------------


class RoomCodeExhaustedError(BackendError):
    """Unique room-code generation exhausted its retry budget (HTTP 500)."""
