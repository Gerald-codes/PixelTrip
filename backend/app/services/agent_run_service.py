"""`AgentRunService` — the only caller of `run_agent_graph`.

:meth:`AgentRunService.trigger_run` is the full lifecycle in one place: resolve
the triggering identity, deduplicate against an existing run, create the
``pending`` row, invoke the graph, and finalize. Every rule from
Requirement 3 (lifecycle) and Requirement 4 (idempotency) that is already
enforced inside :class:`~app.repositories.agent_run_repository.AgentRunRepository`
is *used*, not re-implemented, here — this service orchestrates calls into that
repository rather than duplicating its state machine or its idempotency-key
race handling.

**Why identity resolution happens first, before anything else.** A
client-supplied ``member_id`` is resolved against ``room_members`` before it is
trusted for ``created_by_member_id`` (Requirement 22.2-22.3). Nothing is written
if that fails — not even an attempt to read an existing run — because an
unresolved caller should get the exact same rejection whether or not a run
already exists for this trip.

**Why the stale-run reclaim and the idempotency lookup happen before any new
row is created.** Both are read-and-maybe-short-circuit steps:
:meth:`AgentRunRepository.get_active` plus the 300-second staleness check
(Requirement 3.8), then a by-key lookup matched against *this* request's
``trip_id``/``run_type`` (Requirement 4.2, 4.7). Reaching ``create_pending`` at
all means neither short-circuit applied.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from app.agents.errors import (
    IdempotencyKeyConflictError,
    InvalidIdempotencyKeyError,
    InvalidRunTypeError,
    UnresolvedMemberError,
)
from app.agents.graph import run_agent_graph
from app.agents.llm import LLMClient
from app.agents.messages import TextMessageContent, emit_progress_message
from app.agents.state import RUN_TYPES, AgentState, RepositoryBundle
from app.exceptions import RepositoryError
from app.schemas.agent_run import AgentRunSchema

if TYPE_CHECKING:  # pragma: no cover - typing only
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

logger = logging.getLogger(__name__)

#: Requirement 3.8: an active run older than this is treated as interrupted.
STALE_RUN_THRESHOLD_SECONDS = 300

#: Requirement 4.1/4.8: the idempotency key's length bound.
MAX_IDEMPOTENCY_KEY_LENGTH = 200

#: Requirement 3.5-3.6: a display-safe summary for a stale reclaim.
STALE_RUN_ERROR = "This attempt was interrupted and did not complete."

#: Display-safe summaries for the two outcome paths that are not "a proposal
#: was produced" (Requirement 16.6-16.7). Named constants rather than inline
#: literals so the wording used in a test assertion and the wording actually
#: shipped cannot silently drift apart.
OUTCOME_NO_PROPOSAL_CONCURRENT = (
    "Another member's action already settled this, so the plan stayed as it was."
)
OUTCOME_NO_PROPOSAL_NOTHING_TO_CHANGE = (
    "There was nothing left to change, so the plan stayed as it was."
)
OUTCOME_FAILED_TEXT = "That attempt didn't come together. The party may try again."
RUN_FAILED_ERROR = "The attempt did not complete successfully."


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _parse_timestamp(value: str) -> datetime:
    """Parse a Postgres-style timestamp, tolerating a trailing ``Z``."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _is_stale(run: dict[str, Any]) -> bool:
    """Return ``True`` when an active run has been running too long to trust.

    Requirement 3.8 reads ``started_at``, falling back to ``created_at`` when
    the run never left ``pending``.
    """
    reference = run.get("started_at") or run.get("created_at")
    if not reference:
        return False
    age = datetime.now(UTC) - _parse_timestamp(reference)
    return age > timedelta(seconds=STALE_RUN_THRESHOLD_SECONDS)


@dataclass(frozen=True)
class AgentRunService:
    """Creates, runs, and finalizes one agent run per `trigger_run` call."""

    agent_run_repo: AgentRunRepository
    trip_repo: TripRepository
    room_repo: RoomRepository
    message_repo: MessageRepository
    member_repo: MemberRepository
    profile_repo: ProfileRepository
    itinerary_version_repo: ItineraryVersionRepository
    selection_repo: SelectionRepository
    feedback_repo: FeedbackRepository
    vote_session_repo: VoteSessionRepository
    vote_repo: VoteRepository
    #: The shared LLM client. Optional: with none, every node uses its
    #: deterministic behaviour, so a run never depends on a model being reachable.
    llm_client: LLMClient | None = None

    def _bundle(self) -> RepositoryBundle:
        """Assemble the bundle every node reads and writes through."""
        return RepositoryBundle(
            trip_repo=self.trip_repo,
            room_repo=self.room_repo,
            message_repo=self.message_repo,
            vote_session_repo=self.vote_session_repo,
            vote_repo=self.vote_repo,
            selection_repo=self.selection_repo,
            itinerary_version_repo=self.itinerary_version_repo,
            feedback_repo=self.feedback_repo,
            agent_run_repo=self.agent_run_repo,
            member_repo=self.member_repo,
            profile_repo=self.profile_repo,
            llm=self.llm_client,
        )

    async def trigger_run(
        self,
        trip_id: str,
        run_type: str,
        member_id: str,
        idempotency_key: str | None = None,
    ) -> AgentRunSchema:
        """Trigger (or return the existing) agent run for this trip and type.

        Args:
            trip_id: The trip to run against.
            run_type: One of the four ``agent_run_type`` values.
            member_id: The triggering member's claimed id, resolved against
                ``room_members`` before being trusted.
            idempotency_key: An optional 1-200 character deduplication key.

        Returns:
            The run's wire-shaped representation.

        Raises:
            InvalidRunTypeError: If ``run_type`` is not recognised
                (Requirement 1.5).
            InvalidIdempotencyKeyError: If a supplied key is blank or over-long
                (Requirement 4.8).
            UnresolvedMemberError: If ``member_id`` does not resolve to a real
                room member (Requirement 22.2-22.3).
            IdempotencyKeyConflictError: If the key belongs to a different
                trip/run_type (Requirement 4.7).
        """
        if run_type not in RUN_TYPES:
            raise InvalidRunTypeError(run_type)
        self._validate_idempotency_key(idempotency_key)

        member = await self.member_repo.get_by_id(member_id)
        if member is None:
            raise UnresolvedMemberError(member_id)

        existing = await self._find_existing(trip_id, run_type, idempotency_key)
        if existing is not None:
            return AgentRunSchema.from_row(existing)

        run = await self._create_and_execute(trip_id, run_type, member_id, idempotency_key)
        return AgentRunSchema.from_row(run)

    async def _find_existing(
        self,
        trip_id: str,
        run_type: str,
        idempotency_key: str | None,
    ) -> dict[str, Any] | None:
        """Resolve the two short-circuit paths before any row is created.

        Returns the run to return as-is, or ``None`` when a new run must be
        created.
        """
        if idempotency_key is not None:
            matched = await self.agent_run_repo.get_by_idempotency_key(idempotency_key)
            if matched is not None:
                if matched["trip_id"] != trip_id or matched["run_type"] != run_type:
                    raise IdempotencyKeyConflictError()
                # Requirement 4.2: return as-is, whatever its status.
                return matched

        active = await self.agent_run_repo.get_active(trip_id, run_type)
        if active is None:
            return None
        if _is_stale(active):
            await self.agent_run_repo.mark_failed(active["id"], STALE_RUN_ERROR)
            return None
        # Requirement 4.4: a fresh Active_Run short-circuits a new creation.
        return active

    @staticmethod
    def _validate_idempotency_key(idempotency_key: str | None) -> None:
        """Reject a blank or over-long key before any read (Requirement 4.8)."""
        if idempotency_key is None:
            return
        if not idempotency_key.strip():
            raise InvalidIdempotencyKeyError("must not be blank")
        if len(idempotency_key) > MAX_IDEMPOTENCY_KEY_LENGTH:
            raise InvalidIdempotencyKeyError(
                f"must be at most {MAX_IDEMPOTENCY_KEY_LENGTH} characters"
            )

    async def _create_and_execute(
        self,
        trip_id: str,
        run_type: str,
        member_id: str,
        idempotency_key: str | None,
    ) -> dict[str, Any]:
        """Create the pending row, run the graph, and finalize the outcome."""
        base_version = await self.itinerary_version_repo.get_latest_version_number(trip_id)
        run = await self.agent_run_repo.create_pending(
            trip_id, run_type, member_id, base_version, idempotency_key
        )
        # Requirement 4.2/4.5: a 23505-raced loser gets the winner's row back,
        # possibly already past 'pending'. Only drive the graph for a run this
        # call actually owns from 'pending'.
        if run.get("status") != "pending":
            return run

        await self.agent_run_repo.mark_running(run["id"])
        await emit_progress_message(self._bundle(), trip_id, run["id"])

        state = AgentState(
            run_id=run["id"],
            trip_id=trip_id,
            run_type=run_type,
            base_version=base_version,
            created_by_member_id=member_id,
            idempotency_key=idempotency_key,
        )

        try:
            from app.demo.runner import dispatch_run

            final_state = await dispatch_run(state, self._bundle(), run_agent_graph)
        except Exception as exc:
            return await self._finalize_failure(run["id"], trip_id, exc)

        return await self._finalize_success(run["id"], trip_id, final_state)

    async def _finalize_success(
        self,
        run_id: str,
        trip_id: str,
        final_state: AgentState,
    ) -> dict[str, Any]:
        """Mark the run completed and emit its outcome message.

        A persisted proposal means a result version id may exist on the state
        (Requirement 3.10); its absence — including a lost race or a
        refinement run with nothing to address — still completes the run
        (Requirement 16.6).
        """
        result_version_id = (final_state.trip_context or {}).get("result_version_id")
        run = await self.agent_run_repo.mark_completed(run_id, result_version_id)

        if final_state.run_type == "tiebreak":
            # The tiebreak node posts its own advice message; it never produces a
            # proposal, so the "plan stayed as it was" outcome would be misleading.
            return run

        if final_state.proposal is not None:
            await self._emit_proposal_outcome(trip_id, final_state)
        else:
            await self._emit_no_proposal_outcome(trip_id, final_state)

        return run

    async def _finalize_failure(
        self,
        run_id: str,
        trip_id: str,
        exc: Exception,
    ) -> dict[str, Any]:
        """Mark the run failed with a display-safe summary and notify the party.

        The summary is always one of the fixed, developer-authored constants in
        this module — never ``str(exc)`` — so a provider payload, SQL text, or a
        traceback can never reach ``agent_runs.error`` (Requirement 3.6).
        """
        logger.warning("Agent run %s failed: %s", run_id, type(exc).__name__)
        run = await self.agent_run_repo.mark_failed(run_id, RUN_FAILED_ERROR)
        await self._emit_failure_outcome(trip_id)
        return run

    async def _emit_proposal_outcome(self, trip_id: str, final_state: AgentState) -> None:
        """Emit the run's outcome when a proposal was produced (Requirement 16.5).

        The specialist node is expected to have already emitted its own
        recommendation/vote/summary message as part of producing the proposal
        (Requirement 15.2); this is a best-effort safety net only, swallowed on
        failure like every other progress-adjacent write.
        """
        # The specialist nodes (tasks 16-20) emit their own outcome message as
        # part of producing the proposal, so there is nothing additional to send
        # here. This branch exists so the two outcome paths stay structurally
        # distinct in the service even before every node emits its own message.
        return

    async def _emit_no_proposal_outcome(self, trip_id: str, final_state: AgentState) -> None:
        """Tell the party the plan is unchanged (Requirement 16.6), best-effort."""
        reason = (
            OUTCOME_NO_PROPOSAL_CONCURRENT
            if final_state.repair_feedback
            else OUTCOME_NO_PROPOSAL_NOTHING_TO_CHANGE
        )
        await self._emit_text_best_effort(trip_id, reason)

    async def _emit_failure_outcome(self, trip_id: str) -> None:
        """Tell the party the attempt failed (Requirement 16.7), best-effort."""
        await self._emit_text_best_effort(trip_id, OUTCOME_FAILED_TEXT)

    async def _emit_text_best_effort(self, trip_id: str, text: str) -> None:
        """Emit one ``kind='text'`` message, swallowing any failure.

        A run's finalized status is the authoritative record; a message that
        narrates it is a courtesy that must never flip a completed run into a
        failed one just because the narration itself could not be written.
        """
        try:
            room_id = await self.trip_repo.get_room_id_for_trip(trip_id)
            if room_id is None:
                return
            await self.message_repo.insert_turn(
                room_id,
                [
                    {
                        "sender_type": "ai",
                        "sender_member_id": None,
                        "kind": "text",
                        "content": TextMessageContent(text=text).model_dump(
                            mode="json", exclude_none=True
                        ),
                    }
                ],
            )
        except RepositoryError as exc:
            logger.info("Outcome message skipped for trip %s: %s", trip_id, type(exc).__name__)
