"""Agent run data access — the run lifecycle boundary.

This repository is the sole enforcer of the ``agent_runs.status`` state machine
(Requirement 3.7, 3.11)::

    pending ──> running ──> completed
       │            └─────> failed
       └─────────────────-> failed

Any other transition raises :class:`~app.agents.errors.RunStatusTransitionError`
and leaves every column untouched. Centralizing that here means no service or node
can corrupt a run's lifecycle, even by mistake.

It also owns idempotency-key resolution: a ``23505`` on ``idempotency_key`` means a
concurrent request won the race, so the loser re-reads and returns the winner's row
rather than surfacing a database error (Requirement 4.5).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.agents.errors import IdempotencyKeyConflictError, RunStatusTransitionError
from app.repositories.base import BaseRepository, is_unique_violation

_TABLE = "agent_runs"

#: Statuses a run can hold while still in flight (Requirement 4.4's Active_Run).
ACTIVE_STATUSES = ("pending", "running")

#: The permitted status transitions. Any pair absent from this map is rejected.
ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "pending": frozenset({"running", "failed"}),
    "running": frozenset({"completed", "failed"}),
    "completed": frozenset(),
    "failed": frozenset(),
}

#: Requirement 3.6 bounds the stored error summary.
MAX_ERROR_LENGTH = 500


def _now() -> str:
    """Return the current UTC timestamp as an ISO 8601 string."""
    return datetime.now(UTC).isoformat()


class AgentRunRepository(BaseRepository):
    """Creates agent runs and advances them through their lifecycle."""

    # --- reads -------------------------------------------------------------

    async def get_by_id(self, run_id: str) -> dict[str, Any] | None:
        """Return the run row for ``run_id``, or ``None`` if absent."""
        try:
            response = (
                await self._client.table(_TABLE).select("*").eq("id", run_id).limit(1).execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_by_id", table=_TABLE)
        return self._first_row(response)

    async def get_by_idempotency_key(self, idempotency_key: str) -> dict[str, Any] | None:
        """Return the run holding ``idempotency_key``, or ``None`` if unused."""
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("idempotency_key", idempotency_key)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_by_idempotency_key", table=_TABLE)
        return self._first_row(response)

    async def get_active(self, trip_id: str, run_type: str) -> dict[str, Any] | None:
        """Return the newest in-flight run for this trip and run type, or ``None``."""
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("trip_id", trip_id)
                .eq("run_type", run_type)
                .in_("status", list(ACTIVE_STATUSES))
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_active", table=_TABLE)
        return self._first_row(response)

    # --- creation ----------------------------------------------------------

    async def create_pending(
        self,
        trip_id: str,
        run_type: str,
        created_by_member_id: str | None,
        base_version: int,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Insert a ``pending`` run row with all lifecycle columns reset.

        ``result_version_id``, ``started_at``, ``completed_at``, and ``error`` are
        explicitly NULL and ``iteration_count`` is 0, per Requirement 3.1.

        On a ``23505`` against ``idempotency_key`` a concurrent request already
        created this run: exactly one re-read resolves it and the winner's row is
        returned (Requirement 4.5).

        Raises:
            IdempotencyKeyConflictError: If the key collided but the re-read found
                nothing — the row vanished, so the trigger cannot be resolved.
            RepositoryError: For any other failure.
        """
        payload = {
            "trip_id": trip_id,
            "run_type": run_type,
            "created_by_member_id": created_by_member_id,
            "base_version": base_version,
            "status": "pending",
            "iteration_count": 0,
            "idempotency_key": idempotency_key,
            "result_version_id": None,
            "started_at": None,
            "completed_at": None,
            "error": None,
        }
        try:
            response = await self._client.table(_TABLE).insert(payload).execute()
        except Exception as exc:
            if is_unique_violation(exc) and idempotency_key is not None:
                existing = await self.get_by_idempotency_key(idempotency_key)
                if existing is not None:
                    return existing
                raise IdempotencyKeyConflictError() from exc
            self._handle_error(exc, operation="create_pending", table=_TABLE)

        row = self._first_row(response)
        if row is None:
            self._handle_error(
                ValueError("insert returned no row"),
                operation="create_pending",
                table=_TABLE,
            )
        return row

    # --- lifecycle transitions --------------------------------------------

    async def mark_running(self, run_id: str) -> dict[str, Any]:
        """Transition ``pending -> running`` and stamp ``started_at``.

        An already non-NULL ``started_at`` is preserved rather than overwritten
        (Requirement 3.2).
        """
        current = await self._require_run(run_id)
        self._assert_transition(current, "running")

        updates: dict[str, Any] = {"status": "running"}
        if not current.get("started_at"):
            updates["started_at"] = _now()
        return await self._apply(run_id, updates, operation="mark_running")

    async def mark_completed(
        self,
        run_id: str,
        result_version_id: str | None = None,
    ) -> dict[str, Any]:
        """Transition ``running -> completed``, stamping ``completed_at``.

        ``result_version_id`` is set in the same update that completes the run
        (Requirement 3.10), and ``error`` stays NULL (Requirement 3.3).
        """
        current = await self._require_run(run_id)
        self._assert_transition(current, "completed")

        return await self._apply(
            run_id,
            {
                "status": "completed",
                "completed_at": _now(),
                "result_version_id": result_version_id,
                "error": None,
            },
            operation="mark_completed",
        )

    async def mark_failed(self, run_id: str, error: str) -> dict[str, Any]:
        """Transition to ``failed``, stamping ``completed_at`` and the summary.

        ``started_at`` is left untouched (Requirement 3.5) and the summary is
        truncated to :data:`MAX_ERROR_LENGTH` (Requirement 3.6). The caller is
        responsible for passing an already display-safe string.
        """
        current = await self._require_run(run_id)
        self._assert_transition(current, "failed")

        summary = (error or "The run failed.").strip()[:MAX_ERROR_LENGTH]
        return await self._apply(
            run_id,
            {"status": "failed", "completed_at": _now(), "error": summary},
            operation="mark_failed",
        )

    async def set_phase(self, run_id: str, phase: str) -> dict[str, Any]:
        """Record the step the run is on (see ``app.agents.progress``)."""
        return await self._apply(run_id, {"phase": phase}, operation="set_phase")

    async def get_latest_for_trip(
        self, trip_id: str, run_type: str | None = None
    ) -> dict[str, Any] | None:
        """The trip's most recent run, optionally of one type."""
        try:
            query = self._client.table(_TABLE).select("*").eq("trip_id", trip_id)
            if run_type is not None:
                query = query.eq("run_type", run_type)
            response = await query.order("created_at", desc=True).limit(1).execute()
        except Exception as exc:
            self._handle_error(exc, operation="get_latest_for_trip", table=_TABLE)
        return self._first_row(response)

    async def update_base_version(self, run_id: str, base_version: int) -> dict[str, Any]:
        """Record the version a run actually worked from after a lost race.

        Not a status transition, so the state machine does not apply
        (Requirement 5.5).
        """
        return await self._apply(
            run_id,
            {"base_version": base_version},
            operation="update_base_version",
        )

    async def set_iteration_count(self, run_id: str, iteration_count: int) -> dict[str, Any]:
        """Persist the repair-loop counter (Requirement 12.7)."""
        return await self._apply(
            run_id,
            {"iteration_count": iteration_count},
            operation="set_iteration_count",
        )

    # --- internals ---------------------------------------------------------

    async def _require_run(self, run_id: str) -> dict[str, Any]:
        """Load a run or fail; transitions need the current status to validate."""
        current = await self.get_by_id(run_id)
        if current is None:
            self._handle_error(
                ValueError(f"no agent_runs row for id {run_id}"),
                operation="load_for_transition",
                table=_TABLE,
            )
        return current

    @staticmethod
    def _assert_transition(current: dict[str, Any], target: str) -> None:
        """Reject any transition outside :data:`ALLOWED_TRANSITIONS`.

        Also rejects a no-op transition to the same status (Requirement 3.7).

        Raises:
            RunStatusTransitionError: If the move is not permitted.
        """
        current_status = str(current.get("status", ""))
        if target not in ALLOWED_TRANSITIONS.get(current_status, frozenset()):
            raise RunStatusTransitionError(current_status, target)

    async def _apply(
        self,
        run_id: str,
        updates: dict[str, Any],
        *,
        operation: str,
    ) -> dict[str, Any]:
        """Apply a column update and return the updated row."""
        try:
            response = await self._client.table(_TABLE).update(updates).eq("id", run_id).execute()
        except Exception as exc:
            self._handle_error(exc, operation=operation, table=_TABLE)

        row = self._first_row(response)
        if row is None:
            self._handle_error(
                ValueError("update matched no row"), operation=operation, table=_TABLE
            )
        return row
