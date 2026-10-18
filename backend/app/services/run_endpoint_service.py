"""HTTP-facing agent-run service: start a run now, execute it in the background.

``AgentRunService.trigger_run`` (agent layer) creates a run *and* executes the whole
graph before returning, which can take longer than an HTTP request should (load
balancers cut requests off around 60 seconds). This subclass splits that lifecycle in
two without changing the parent:

* :meth:`start_run` — validate, dedupe, and create the ``pending`` row. Returns at once.
* the returned ``execute`` callable — mark running, run the graph, finalize. The route
  schedules it as a FastAPI background task.

Every rule (idempotency, stale-run reclaim, failure finalization) is the parent's own
logic, reused through its methods; this module adds only the split, a trip-existence
check, and a check that the triggering member belongs to the trip's room.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.agents.errors import TripNotFoundError, UnresolvedMemberError
from app.agents.graph import run_agent_graph
from app.agents.messages import emit_progress_message
from app.agents.state import AgentState
from app.exceptions import RunNotFoundError
from app.schemas.agent_run import AgentRunProgressSchema, AgentRunSchema
from app.services.agent_run_service import RUN_FAILED_ERROR, AgentRunService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class StartedRun:
    """A run as returned to the caller, plus the work still to do (if any).

    ``execute`` is ``None`` when the request matched an existing run (same idempotency
    key, or a run of this type already in progress), so nothing new should start.
    """

    run: AgentRunSchema
    execute: Callable[[], Awaitable[None]] | None


@dataclass(frozen=True)
class RunEndpointService(AgentRunService):
    """``AgentRunService`` with a start-now / execute-later split for HTTP."""

    async def start_run(
        self,
        trip_id: str,
        run_type: str,
        member_id: str,
        idempotency_key: str | None = None,
    ) -> StartedRun:
        """Create (or find) the run and return immediately."""
        self._validate_idempotency_key(idempotency_key)

        trip = await self.trip_repo.get_by_id(trip_id)
        if trip is None:
            raise TripNotFoundError(trip_id)

        member = await self.member_repo.get_by_id(member_id)
        if member is None or member.get("room_id") != trip.get("room_id"):
            raise UnresolvedMemberError(member_id)

        existing = await self._find_existing(trip_id, run_type, idempotency_key)
        if existing is not None:
            return StartedRun(run=AgentRunSchema.from_row(existing), execute=None)

        base_version = await self.itinerary_version_repo.get_latest_version_number(trip_id)
        run = await self.agent_run_repo.create_pending(
            trip_id, run_type, member_id, base_version, idempotency_key
        )
        # A concurrent request with the same key may have won the insert; only the
        # owner of a still-pending run executes it.
        if run.get("status") != "pending":
            return StartedRun(run=AgentRunSchema.from_row(run), execute=None)

        async def execute() -> None:
            await self.execute_run(run)

        return StartedRun(run=AgentRunSchema.from_row(run), execute=execute)

    async def execute_run(self, run: dict[str, Any]) -> None:
        """Run the graph for a ``pending`` run and finalize it. Never raises.

        Mirrors the parent's ``_create_and_execute`` after row creation. Any failure,
        including in the bookkeeping writes, ends with the run marked failed so it never
        stays ``running`` forever.
        """
        run_id = run["id"]
        trip_id = run["trip_id"]
        try:
            await self.agent_run_repo.mark_running(run_id)
            await emit_progress_message(self._bundle(), trip_id, run_id)
            state = AgentState(
                run_id=run_id,
                trip_id=trip_id,
                run_type=run["run_type"],
                base_version=run["base_version"],
                created_by_member_id=run.get("created_by_member_id"),
                idempotency_key=run.get("idempotency_key"),
            )
            try:
                from app.demo.runner import dispatch_run

                final_state = await dispatch_run(state, self._bundle(), run_agent_graph)
            except Exception as exc:
                await self._finalize_failure(run_id, trip_id, exc)
                return
            await self._finalize_success(run_id, trip_id, final_state)
        except Exception as exc:
            logger.error("Background run %s could not finish: %s", run_id, type(exc).__name__)
            try:
                await self.agent_run_repo.mark_failed(run_id, RUN_FAILED_ERROR)
            except Exception as mark_exc:
                logger.error("Could not mark run %s failed: %s", run_id, type(mark_exc).__name__)

    async def get_latest_run(
        self, trip_id: str, run_type: str | None
    ) -> AgentRunProgressSchema | None:
        """The trip's most recent run (optionally of one type) and its step, or ``None``."""
        if await self.trip_repo.get_by_id(trip_id) is None:
            raise TripNotFoundError(trip_id)
        run = await self.agent_run_repo.get_latest_for_trip(trip_id, run_type)
        if run is None:
            return None
        started = _parse_time(run.get("started_at") or run.get("created_at"))
        end = _parse_time(run.get("completed_at")) or datetime.now(UTC)
        elapsed = max(0, round((end - started).total_seconds())) if started else 0
        return AgentRunProgressSchema(
            id=run["id"],
            run_type=run["run_type"],
            status=run["status"],
            phase=run.get("phase"),
            elapsed_seconds=elapsed,
        )

    async def get_run(self, run_id: str) -> AgentRunSchema:
        """Return the run's current state."""
        run = await self.agent_run_repo.get_by_id(run_id)
        if run is None:
            raise RunNotFoundError("Run not found.")
        return AgentRunSchema.from_row(run)


def _parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
