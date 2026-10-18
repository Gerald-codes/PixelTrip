"""Agent-layer domain exceptions.

Every exception here subclasses one of spec 02's family bases in
``app/exceptions.py``, so the agent layer extends the existing hierarchy rather
than defining a parallel one (Requirement 20.7). Each is registered in the
central error-code table at import time via
:func:`~app.main.register_error_code`, which is how spec 03 adds to spec 02's
mapping without editing that table (Requirement 20.9).

Registration is deliberately *lazy*, exposed through :func:`register_agent_errors`
rather than executed at module import. Registering eagerly would make
``app.agents.errors`` import ``app.main``, and ``app.main`` already imports the
route modules — a cycle. ``app.main`` calls this function once, after its own
table is built.

Every message is developer-authored and display-safe: no LLM prompt or completion
text, no raw ``External_Tool`` or Supabase payload, no SQL, no secret value, no
traceback (Requirement 3.6, 20.5, 20.8).
"""

from __future__ import annotations

from app.exceptions import ConflictError, NotFoundError, RepositoryError, ValidationError

# ---------------------------------------------------------------------------
# 422 validation family — precondition and state-consistency failures
# ---------------------------------------------------------------------------


class StagePreconditionNotMetError(ValidationError):
    """The trip's stage prerequisites for this run type are not satisfied."""

    def __init__(self, run_type: str, missing: str) -> None:
        super().__init__(f"Cannot start a '{run_type}' run: {missing}.")
        self.run_type = run_type
        self.missing = missing


class InvalidRunTypeError(ValidationError):
    """The run type is outside the ``agent_run_type`` enum."""

    def __init__(self, run_type: object) -> None:
        super().__init__(
            "Unknown agent run type. Expected one of: discovery, logistics, itinerary, refinement."
        )
        self.run_type = run_type


class PreferencesNotCollectedError(ValidationError):
    """No party member has submitted travel preferences yet."""

    def __init__(self) -> None:
        super().__init__(
            "The party has not submitted travel preferences yet, so there is nothing to plan from."
        )


class InvalidTripDurationError(ValidationError):
    """The derived trip length falls outside the supported 1-30 day range."""

    def __init__(self, day_count: int) -> None:
        super().__init__(
            f"Derived trip duration of {day_count} days is outside the supported "
            "range of 1 to 30 days."
        )
        self.day_count = day_count


class RunIdentityMutationError(ValidationError):
    """A node attempted to change an immutable run-identity field."""

    def __init__(self, field: str) -> None:
        super().__init__(
            f"Run-identity field '{field}' cannot be changed after the agent state is constructed."
        )
        self.field = field


class IterationCapExceededError(ValidationError):
    """The guardrail repair loop hit its configured iteration cap."""

    def __init__(self, cap: int) -> None:
        super().__init__(
            f"The plan could not be brought within the party's constraints after {cap} attempts."
        )
        self.cap = cap


class MessageContentTooLargeError(ValidationError):
    """A message's serialized content exceeds the per-message size limit."""

    def __init__(self, size_bytes: int, limit_bytes: int) -> None:
        super().__init__(
            f"Message content of {size_bytes} bytes exceeds the {limit_bytes}-byte limit."
        )
        self.size_bytes = size_bytes
        self.limit_bytes = limit_bytes


class InvalidIdempotencyKeyError(ValidationError):
    """The supplied idempotency key is empty, blank, or over-long."""

    def __init__(self, reason: str) -> None:
        super().__init__(f"Invalid idempotency key: {reason}.")
        self.reason = reason


class VoteSessionClosedError(ValidationError):
    """A vote was submitted against a session that is no longer open."""

    def __init__(self, vote_session_id: str) -> None:
        super().__init__("Voting on this decision is closed.")
        self.vote_session_id = vote_session_id


class UnresolvedMemberError(ValidationError):
    """A client-supplied member id does not resolve to a room member.

    Raised before any write so a forged or stale ``member_id`` can never be
    persisted as a vote caster (Requirement 22.2-22.3).
    """

    def __init__(self, member_id: str) -> None:
        super().__init__("This party member could not be identified.")
        self.member_id = member_id


# ---------------------------------------------------------------------------
# 404 not-found family — a required record does not exist
# ---------------------------------------------------------------------------


class TripNotFoundError(NotFoundError):
    """No ``trips`` row exists for the supplied trip id."""

    def __init__(self, trip_id: str) -> None:
        super().__init__("Trip not found.")
        self.trip_id = trip_id


class DestinationNotSelectedError(NotFoundError):
    """The room has no locked destination selection yet."""

    def __init__(self) -> None:
        super().__init__(
            "The party has not locked in a destination yet, so travel cannot be arranged."
        )


class FlightNotSelectedError(NotFoundError):
    """The room has no locked flight selection yet."""

    def __init__(self) -> None:
        super().__init__(
            "The party has not locked in travel arrangements yet, so the quest log "
            "cannot be drafted."
        )


class NoItineraryToRefineError(NotFoundError):
    """The trip has no itinerary version, so there is nothing to refine."""

    def __init__(self) -> None:
        super().__init__("There is no quest log yet to refine.")


class NoApprovedItineraryError(NotFoundError):
    """No approved itinerary version exists for the trip."""

    def __init__(self) -> None:
        super().__init__(
            "The party has not approved a quest log yet, so the adventure cannot be wrapped up."
        )


class RoomResolutionError(NotFoundError):
    """Exactly one room could not be resolved for the trip."""

    def __init__(self, trip_id: str) -> None:
        super().__init__("Could not resolve the party room for this trip.")
        self.trip_id = trip_id


# ---------------------------------------------------------------------------
# 503 unavailability family — a dependency could not be reached
# ---------------------------------------------------------------------------


class ExternalToolUnavailableError(RepositoryError):
    """An external data source failed, timed out, or returned invalid data.

    Subclasses :class:`RepositoryError` so it inherits the 503 family, but
    registers its own code and its own opaque client-facing message: the tool
    name is safe to expose, while any underlying payload is not.
    """

    def __init__(self, tool_name: str) -> None:
        super().__init__(f"External tool '{tool_name}' is unavailable.")
        self.tool_name = tool_name


class LLMGenerationError(RepositoryError):
    """The LLM failed to produce a usable response after its retry allowance.

    Subclasses :class:`RepositoryError` so it inherits the 503 family. Never
    constructed with prompt text, completion text, or any provider payload —
    only the operation label (Requirement 20.5, 20.8).
    """

    def __init__(self, operation: str) -> None:
        super().__init__(f"LLM generation for '{operation}' is unavailable.")
        self.operation = operation


class ItineraryPersistenceError(RepositoryError):
    """Persisting an itinerary version failed for a non-contention reason."""

    def __init__(self, detail: str = "itinerary version could not be saved") -> None:
        super().__init__(f"Itinerary persistence failed: {detail}.")


# ---------------------------------------------------------------------------
# 409 conflict family — invalid transition or exceeded internal bound
# ---------------------------------------------------------------------------


class RunStatusTransitionError(ConflictError):
    """An ``agent_runs.status`` transition outside the allowed state machine."""

    def __init__(self, current: str, target: str) -> None:
        super().__init__(f"Invalid agent run status transition from '{current}' to '{target}'.")
        self.current = current
        self.target = target


class IdempotencyKeyConflictError(ConflictError):
    """The idempotency key belongs to a different trip or run type."""

    def __init__(self) -> None:
        super().__init__(
            "That idempotency key is already in use for a different trip or operation."
        )


class StateBoundExceededError(ConflictError):
    """An accumulating agent-state field exceeded its configured bound."""

    def __init__(self, field: str, attempted: int) -> None:
        super().__init__(f"Agent state field '{field}' exceeded its bound at {attempted} entries.")
        self.field = field
        self.attempted = attempted


class ToolCallCapExceededError(ConflictError):
    """The run exhausted its external tool-call budget."""

    def __init__(self, cap: int) -> None:
        super().__init__(f"This run reached its limit of {cap} external lookups.")
        self.cap = cap


class RepeatedVersionContentionError(ConflictError):
    """Too many concurrent itinerary writes collided within one run."""

    def __init__(self, cycles: int) -> None:
        super().__init__(
            f"The quest log changed underneath this update {cycles} times; please try again."
        )
        self.cycles = cycles


class DuplicateApprovalError(ConflictError):
    """Approving would leave more than one approved version for the trip."""

    def __init__(self) -> None:
        super().__init__("This trip already has an approved quest log.")


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

#: ``exception class -> (HTTP status, error code)``, mirroring the design's
#: "Error Code Mapping" table exactly.
AGENT_ERROR_CODES: dict[type[Exception], tuple[int, str]] = {
    # 422 validation family
    StagePreconditionNotMetError: (422, "STAGE_PRECONDITION_NOT_MET"),
    InvalidRunTypeError: (422, "INVALID_RUN_TYPE"),
    PreferencesNotCollectedError: (422, "PREFERENCES_NOT_COLLECTED"),
    InvalidTripDurationError: (422, "INVALID_TRIP_DURATION"),
    RunIdentityMutationError: (422, "RUN_IDENTITY_MUTATION"),
    IterationCapExceededError: (422, "ITERATION_CAP_EXCEEDED"),
    MessageContentTooLargeError: (422, "MESSAGE_CONTENT_TOO_LARGE"),
    InvalidIdempotencyKeyError: (422, "INVALID_IDEMPOTENCY_KEY"),
    VoteSessionClosedError: (422, "VOTE_SESSION_CLOSED"),
    UnresolvedMemberError: (422, "MEMBER_NOT_RESOLVED"),
    # 404 not-found family
    TripNotFoundError: (404, "TRIP_NOT_FOUND"),
    DestinationNotSelectedError: (404, "DESTINATION_NOT_SELECTED"),
    FlightNotSelectedError: (404, "FLIGHT_NOT_SELECTED"),
    NoItineraryToRefineError: (404, "NO_ITINERARY_TO_REFINE"),
    NoApprovedItineraryError: (404, "NO_APPROVED_ITINERARY"),
    RoomResolutionError: (404, "ROOM_RESOLUTION_FAILED"),
    # 503 unavailability family
    ExternalToolUnavailableError: (503, "EXTERNAL_TOOL_UNAVAILABLE"),
    LLMGenerationError: (503, "LLM_GENERATION_UNAVAILABLE"),
    ItineraryPersistenceError: (503, "ITINERARY_PERSISTENCE_FAILED"),
    # 409 conflict family
    RunStatusTransitionError: (409, "RUN_STATUS_TRANSITION_INVALID"),
    IdempotencyKeyConflictError: (409, "IDEMPOTENCY_KEY_CONFLICT"),
    StateBoundExceededError: (409, "STATE_BOUND_EXCEEDED"),
    ToolCallCapExceededError: (409, "TOOL_CALL_CAP_EXCEEDED"),
    RepeatedVersionContentionError: (409, "REPEATED_VERSION_CONTENTION"),
    DuplicateApprovalError: (409, "DUPLICATE_APPROVAL"),
}

#: Exceptions in the 503 family inherit :class:`RepositoryError`, whose registered
#: client message is the fixed ``"Database operation failed."``. These are not
#: database failures, so each supplies its own safe client-facing message rather
#: than inheriting a misleading one.
_AGENT_OPAQUE_MESSAGES: dict[type[Exception], str] = {
    ExternalToolUnavailableError: (
        "A travel data source is unavailable right now. Please try again."
    ),
    LLMGenerationError: "The guide's thoughts are unavailable right now. Please try again.",
    ItineraryPersistenceError: "The quest log could not be saved. Please try again.",
}


def register_agent_errors() -> None:
    """Register every agent exception in the central error-code table.

    Idempotent: re-registering the same class simply overwrites an identical
    entry, so calling this more than once is harmless.
    """
    from app.main import register_error_code

    for exc_type, (status_code, code) in AGENT_ERROR_CODES.items():
        register_error_code(
            exc_type,  # type: ignore[arg-type]
            status_code,
            code,
            opaque_message=_AGENT_OPAQUE_MESSAGES.get(exc_type),
        )
