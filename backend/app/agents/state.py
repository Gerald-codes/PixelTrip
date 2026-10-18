"""Agent execution state, the repository bundle, and the trip-context loader.

Three things live here, in increasing order of subtlety:

1. :class:`RepositoryBundle` — the dependency carrier. The agent layer never
   builds a repository; the service layer assembles this bundle and threads it
   through, which is what keeps ``app/agents/`` free of Supabase construction
   (Requirement 20.1).

2. :class:`AgentState` — the LangGraph state object, partitioned into a
   **run-identity** group that mirrors the ``agent_runs`` row and an
   **execution-internal** group that is explicitly non-authoritative
   (Requirement 2). Five identity fields are frozen after construction; the other
   two change only through named methods.

3. :func:`load_trip_context` — the re-fetch discipline. Every specialist node
   calls it at entry, so a long-running or resumed run never reasons over state
   it carried in from an earlier step (Requirement 6).

**Why state transitions return new objects.** Nodes return a fresh state rather
than mutating in place: that is LangGraph's own model, and it makes the frozen
identity guard meaningful rather than something a node could sidestep by
assigning to an attribute mid-run.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ConfigDict, PrivateAttr, field_validator

from app.agents.errors import (
    IterationCapExceededError,
    RunIdentityMutationError,
    StagePreconditionNotMetError,
    StateBoundExceededError,
    TripNotFoundError,
)
from app.exceptions import RepositoryError

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.repositories.agent_run_repository import AgentRunRepository
    from app.repositories.feedback_repository import FeedbackRepository
    from app.repositories.itinerary_version_repository import (
        ItineraryVersionRepository,
    )
    from app.repositories.member_repository import MemberRepository
    from app.repositories.message_repository import MessageRepository
    from app.repositories.profile_repository import ProfileRepository
    from app.repositories.room_repository import RoomRepository
    from app.repositories.selection_repository import SelectionRepository
    from app.repositories.trip_repository import TripRepository
    from app.repositories.vote_repository import VoteRepository
    from app.repositories.vote_session_repository import VoteSessionRepository

#: The four ``agent_run_type`` enum values. Nothing outside this set is a run.
RunType = Literal["discovery", "logistics", "itinerary", "refinement", "tiebreak"]

RUN_TYPES: tuple[str, ...] = ("discovery", "logistics", "itinerary", "refinement", "tiebreak")

#: Run-identity fields that may never change once the state is built
#: (Requirement 2.4). ``base_version`` and ``iteration_count`` are deliberately
#: absent: both legitimately change, but only through a named method.
FROZEN_IDENTITY_FIELDS: frozenset[str] = frozenset(
    {"run_id", "trip_id", "run_type", "created_by_member_id", "idempotency_key"}
)

#: The complete run-identity group (Requirement 2.2).
RUN_IDENTITY_FIELDS: frozenset[str] = frozenset(
    {
        "run_id",
        "trip_id",
        "run_type",
        "base_version",
        "created_by_member_id",
        "idempotency_key",
        "iteration_count",
    }
)

#: The complete execution-internal group (Requirement 2.3).
EXECUTION_INTERNAL_FIELDS: frozenset[str] = frozenset(
    {
        "trip_context",
        "group_profile",
        "proposal",
        "guardrail_findings",
        "external_tool_responses",
        "tool_call_count",
        "pending_npc_messages",
        "repair_feedback",
    }
)

#: Accumulator bounds (Requirement 2.6). The tool-response bound is the run's
#: ``Tool_Call_Cap`` and so is carried per-instance rather than here.
MAX_GUARDRAIL_FINDINGS = 100
MAX_PENDING_MESSAGES = 20
MAX_IDEMPOTENCY_KEY_LENGTH = 200

#: Requirement 6.1 / 6.9: the per-attempt budget and retry allowance for loading
#: trip context.
TRIP_CONTEXT_TIMEOUT_SECONDS = 5.0
TRIP_CONTEXT_MAX_RETRIES = 2

#: Planning-stage ordering, used to detect that a trip has already advanced past
#: the stage a run was started for (Requirement 6.8).
STAGE_ORDER: tuple[str, ...] = (
    "setup",
    "discover",
    "logistics",
    "build",
    "refine",
    "wrap",
)

#: The stage each run type operates in. A run whose trip has moved beyond its
#: stage is stale and must not write.
STAGE_BY_RUN_TYPE: dict[str, str] = {
    "discovery": "discover",
    "logistics": "logistics",
    "itinerary": "build",
    "refinement": "refine",
}

#: ``party_rooms.status`` values that close a room to further planning
#: (Requirement 6.7).
CLOSED_ROOM_STATUSES: frozenset[str] = frozenset({"cancelled", "finalised"})


def _is_uuid(value: str) -> bool:
    """Return ``True`` when ``value`` parses as a UUID."""
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return True


# ---------------------------------------------------------------------------
# RepositoryBundle
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RepositoryBundle:
    """Every dependency a node may use, assembled outside the agent layer.

    Frozen so a node cannot swap a repository mid-run. The LLM and tool clients
    are typed loosely (``Any``) on purpose: their concrete classes land in later
    tasks, and pinning them here would couple state to modules that do not exist
    yet.

    Constructed only by the service layer (Requirement 20.1) and passed into the
    graph through LangGraph's ``configurable`` channel.
    """

    trip_repo: TripRepository
    room_repo: RoomRepository
    message_repo: MessageRepository
    vote_session_repo: VoteSessionRepository
    vote_repo: VoteRepository
    selection_repo: SelectionRepository
    itinerary_version_repo: ItineraryVersionRepository
    feedback_repo: FeedbackRepository
    agent_run_repo: AgentRunRepository
    member_repo: MemberRepository
    profile_repo: ProfileRepository
    flight_tool: Any = None
    places_tool: Any = None
    weather_tool: Any = None
    llm: Any = None


# ---------------------------------------------------------------------------
# AgentState
# ---------------------------------------------------------------------------


class AgentState(BaseModel):
    """Typed state for one agent run.

    The two field groups are enumerated in :data:`RUN_IDENTITY_FIELDS` and
    :data:`EXECUTION_INTERNAL_FIELDS`; a test asserts the model's declared fields
    are exactly their union, so adding a field without classifying it fails.
    """

    model_config = ConfigDict(validate_assignment=True, arbitrary_types_allowed=True)

    # --- run-identity group (mirrors the agent_runs row) -------------------
    run_id: str
    trip_id: str
    run_type: RunType
    base_version: int = 0
    created_by_member_id: str | None = None
    idempotency_key: str | None = None
    iteration_count: int = 0

    # --- execution-internal group (non-authoritative) ---------------------
    trip_context: dict[str, Any] | None = None
    group_profile: dict[str, Any] | None = None
    proposal: dict[str, Any] | None = None
    guardrail_findings: list[dict[str, Any]] = []
    external_tool_responses: list[dict[str, Any]] = []
    tool_call_count: int = 0
    pending_npc_messages: list[dict[str, Any]] = []
    repair_feedback: list[dict[str, Any]] = []

    #: The run's ``Tool_Call_Cap``, bounding ``external_tool_responses``. A
    #: private attr rather than a field: it is configuration, not run state, and
    #: must not appear in the serialized model LangGraph passes around.
    _tool_call_cap: int = PrivateAttr(default=10)

    # --- validation --------------------------------------------------------

    @field_validator("run_id", "trip_id")
    @classmethod
    def _require_uuid(cls, value: str) -> str:
        """Reject a non-UUID run or trip id (Requirement 2.11)."""
        if not _is_uuid(value):
            raise ValueError("must be a valid UUID string")
        return value

    @field_validator("created_by_member_id")
    @classmethod
    def _require_uuid_or_none(cls, value: str | None) -> str | None:
        """Allow an absent creator, but reject a malformed one."""
        if value is not None and not _is_uuid(value):
            raise ValueError("must be a valid UUID string or None")
        return value

    @field_validator("base_version")
    @classmethod
    def _require_non_negative_version(cls, value: int) -> int:
        """``0`` means "no itinerary yet"; negative is meaningless."""
        if value < 0:
            raise ValueError("base_version must be >= 0")
        return value

    @field_validator("iteration_count")
    @classmethod
    def _require_non_negative_iterations(cls, value: int) -> int:
        """The repair counter never goes backwards past zero."""
        if value < 0:
            raise ValueError("iteration_count must be >= 0")
        return value

    @field_validator("idempotency_key")
    @classmethod
    def _validate_idempotency_key(cls, value: str | None) -> str | None:
        """Reject a blank or over-long key (Requirement 2.11, 4.8)."""
        if value is None:
            return None
        if not value.strip():
            raise ValueError("idempotency_key must not be blank")
        if len(value) > MAX_IDEMPOTENCY_KEY_LENGTH:
            raise ValueError(
                f"idempotency_key must be at most {MAX_IDEMPOTENCY_KEY_LENGTH} characters"
            )
        return value

    # --- identity guard ----------------------------------------------------

    def __setattr__(self, name: str, value: Any) -> None:
        """Reject in-place mutation of a frozen identity field.

        Only fires once the field is already set, so construction works normally.
        Defense in depth: nodes are expected to use the ``with_*``/``append_*``
        methods, and this makes a stray assignment fail loudly rather than
        silently corrupting a run's identity (Requirement 2.4-2.5).
        """
        if name in FROZEN_IDENTITY_FIELDS and name in self.__dict__:
            raise RunIdentityMutationError(name)
        super().__setattr__(name, value)

    # --- configuration -----------------------------------------------------

    def with_tool_call_cap(self, cap: int) -> AgentState:
        """Return this state with its tool-response bound set to ``cap``."""
        self._tool_call_cap = cap
        return self

    @property
    def tool_call_cap(self) -> int:
        """The run's configured ``Tool_Call_Cap``."""
        return self._tool_call_cap

    # --- sanctioned transitions -------------------------------------------

    def with_base_version(self, base_version: int) -> AgentState:
        """Return a copy recording a re-fetched ``base_version``.

        The only sanctioned path for changing it — used after a lost race
        (Requirement 5.5).
        """
        if base_version < 0:
            raise ValueError("base_version must be >= 0")
        return self._copy_preserving(base_version=base_version)

    def with_incremented_iteration(self, cap: int) -> AgentState:
        """Return a copy with the repair counter advanced by one.

        Raises:
            IterationCapExceededError: If already at ``cap``. Raising here rather
                than clamping is what makes "never exceeds the cap" checkable
                (Requirement 12.8).
        """
        if self.iteration_count >= cap:
            raise IterationCapExceededError(cap)
        return self._copy_preserving(iteration_count=self.iteration_count + 1)

    def with_trip_context(self, trip_context: dict[str, Any]) -> AgentState:
        """Return a copy carrying a freshly loaded trip context."""
        return self._copy_preserving(trip_context=trip_context)

    def with_group_profile(self, group_profile: dict[str, Any]) -> AgentState:
        """Return a copy carrying the derived group profile."""
        return self._copy_preserving(group_profile=group_profile)

    def with_proposal(self, proposal: dict[str, Any] | None) -> AgentState:
        """Return a copy carrying the current proposal."""
        return self._copy_preserving(proposal=proposal)

    def with_repair_feedback(self, findings: list[dict[str, Any]]) -> AgentState:
        """Return a copy whose repair feedback is replaced by ``findings``.

        Replaced rather than appended: the producing node needs the reasons from
        *this* evaluation, not an accumulation across iterations.
        """
        return self._copy_preserving(repair_feedback=list(findings))

    def cleared_for_resume(self) -> AgentState:
        """Return a copy with every execution-internal field reset.

        A resumed run must discard carried working state and reload from Supabase
        (Requirement 6.4). Identity, ``base_version``, and ``iteration_count``
        survive, since those are the run's persisted facts.
        """
        return self._copy_preserving(
            trip_context=None,
            group_profile=None,
            proposal=None,
            guardrail_findings=[],
            external_tool_responses=[],
            tool_call_count=0,
            pending_npc_messages=[],
            repair_feedback=[],
        )

    # --- bounded accumulators ---------------------------------------------

    def append_guardrail_findings(self, findings: list[dict[str, Any]]) -> AgentState:
        """Append guardrail findings, bounded at :data:`MAX_GUARDRAIL_FINDINGS`.

        Raises:
            StateBoundExceededError: If the bound would be exceeded. Existing
                entries are never discarded or truncated (Requirement 2.7).
        """
        combined = self.guardrail_findings + list(findings)
        if len(combined) > MAX_GUARDRAIL_FINDINGS:
            raise StateBoundExceededError("guardrail_findings", len(combined))
        return self._copy_preserving(guardrail_findings=combined)

    def append_tool_response(self, response: dict[str, Any]) -> AgentState:
        """Append a tool response and advance the tool-call count.

        Bounded by the run's ``Tool_Call_Cap``, so the recorded responses can
        never outnumber the calls the run was permitted.

        Raises:
            StateBoundExceededError: If the cap would be exceeded.
        """
        combined = self.external_tool_responses + [response]
        if len(combined) > self._tool_call_cap:
            raise StateBoundExceededError("external_tool_responses", len(combined))
        return self._copy_preserving(
            external_tool_responses=combined,
            tool_call_count=self.tool_call_count + 1,
        )

    def with_failed_tool_attempt(self) -> AgentState:
        """Record an attempt that produced no usable response.

        Requirement 19.2 counts *attempts* against the ``Tool_Call_Cap``,
        including timeouts, transport errors, validation failures, and retries.
        Those produce nothing to append, so the counter has to move independently
        of ``external_tool_responses`` — otherwise a tool that times out
        repeatedly would never consume any budget and the cap would not bound
        anything.

        Unbounded on purpose: the cap is enforced by the caller *before* an
        attempt, and the counter must never be decremented or clamped
        (Requirement 19.2), so coming to rest one above the cap is correct rather
        than an error.
        """
        return self._copy_preserving(tool_call_count=self.tool_call_count + 1)

    def append_pending_message(self, message: dict[str, Any]) -> AgentState:
        """Append a pending NPC message, bounded at :data:`MAX_PENDING_MESSAGES`.

        Raises:
            StateBoundExceededError: If the bound would be exceeded.
        """
        combined = self.pending_npc_messages + [message]
        if len(combined) > MAX_PENDING_MESSAGES:
            raise StateBoundExceededError("pending_npc_messages", len(combined))
        return self._copy_preserving(pending_npc_messages=combined)

    # --- internals ---------------------------------------------------------

    def _copy_preserving(self, **updates: Any) -> AgentState:
        """Copy with ``updates`` applied, carrying the private cap across.

        ``model_copy`` does not copy private attributes, so the tool-call cap
        would silently revert to its default on every transition without this.
        """
        clone = self.model_copy(update=updates)
        clone._tool_call_cap = self._tool_call_cap
        return clone


# ---------------------------------------------------------------------------
# Trip context loading
# ---------------------------------------------------------------------------


async def _gather_trip_context(
    repos: RepositoryBundle,
    trip_id: str,
) -> dict[str, Any]:
    """Read every record making up the trip context.

    The trip row is fetched first because its ``room_id`` keys everything else.
    The remaining reads then run concurrently, and the member-scoped reads
    (characters, preferences) follow once the roster is known.
    """
    trip = await repos.trip_repo.get_by_id(trip_id)
    if trip is None:
        raise TripNotFoundError(trip_id)

    room_id = trip["room_id"]

    room, members, selections, latest_version, open_feedback = await asyncio.gather(
        repos.room_repo.get_by_id(room_id),
        repos.member_repo.list_by_room(room_id),
        repos.selection_repo.list_by_room(room_id),
        repos.itinerary_version_repo.get_latest(trip_id),
        repos.feedback_repo.list_open_by_trip(trip_id),
    )

    member_ids = [m["id"] for m in members]
    characters, preferences = await asyncio.gather(
        repos.profile_repo.list_characters_by_member_ids(member_ids),
        repos.profile_repo.list_preferences_by_member_ids(member_ids),
    )

    return {
        "trip": trip,
        "room": room,
        "room_id": room_id,
        "members": members,
        "characters": characters,
        "preferences": preferences,
        "selections": {s["kind"]: s for s in selections},
        "latest_itinerary_version": latest_version,
        "open_feedback": open_feedback,
    }


def _assert_room_open(room: dict[str, Any] | None) -> None:
    """Abort when the room is closed to further planning (Requirement 6.7)."""
    status = (room or {}).get("status")
    if status in CLOSED_ROOM_STATUSES:
        raise StagePreconditionNotMetError("any", f"the party room is {status}")


def _assert_stage_not_advanced(run_type: str, room: dict[str, Any] | None) -> None:
    """Abort when the trip has moved past this run's stage (Requirement 6.8).

    Silent when either stage is unknown: an unrecognised stage value is not
    evidence the run is stale, and guessing would block valid runs.
    """
    expected_stage = STAGE_BY_RUN_TYPE.get(run_type)
    current_stage = (room or {}).get("planning_stage")
    if expected_stage is None or current_stage is None:
        return
    if current_stage not in STAGE_ORDER or expected_stage not in STAGE_ORDER:
        return
    if STAGE_ORDER.index(current_stage) > STAGE_ORDER.index(expected_stage):
        raise StagePreconditionNotMetError(
            run_type,
            f"the party has already advanced to the {current_stage} stage",
        )


async def load_trip_context(
    repos: RepositoryBundle,
    trip_id: str,
    run_type: str | None = None,
) -> dict[str, Any]:
    """Load fresh trip context, or fail without writing anything.

    Called at the entry of every specialist node and on every repair iteration,
    so no node reasons over state carried in from an earlier step
    (Requirement 6.1-6.3).

    Each attempt is bounded at :data:`TRIP_CONTEXT_TIMEOUT_SECONDS` and retried at
    most :data:`TRIP_CONTEXT_MAX_RETRIES` times (Requirement 6.9). Every failure
    path raises before any write, leaving all records for the trip untouched.

    Args:
        repos: The bundle to read through.
        trip_id: The trip to load.
        run_type: When given, also asserts the trip has not advanced past this
            run type's stage.

    Returns:
        The trip context mapping: ``trip``, ``room``, ``room_id``, ``members``,
        ``characters``, ``preferences``, ``selections`` (keyed by kind),
        ``latest_itinerary_version``, and ``open_feedback``.

    Raises:
        TripNotFoundError: If no trip row exists (Requirement 6.6).
        StagePreconditionNotMetError: If the room is closed or the trip has
            advanced past the run's stage (Requirement 6.7-6.8).
        RepositoryError: If every load attempt fails (Requirement 6.9).
    """
    last_error: Exception | None = None

    for _attempt in range(TRIP_CONTEXT_MAX_RETRIES + 1):
        try:
            context = await asyncio.wait_for(
                _gather_trip_context(repos, trip_id),
                timeout=TRIP_CONTEXT_TIMEOUT_SECONDS,
            )
        except TripNotFoundError:
            # A missing trip is a definitive answer, not a transient fault, so it
            # is never retried.
            raise
        except (TimeoutError, RepositoryError) as exc:
            # Only a timeout or a wrapped database failure is transient. Anything
            # else is a programming error and must surface immediately rather
            # than being retried two more times and masked.
            last_error = exc
            continue

        _assert_room_open(context["room"])
        if run_type is not None:
            _assert_stage_not_advanced(run_type, context["room"])

        return context

    raise (
        last_error if last_error is not None else RepositoryError("Trip context could not be read.")
    )
