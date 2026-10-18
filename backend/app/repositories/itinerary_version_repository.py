"""Itinerary version data access — the optimistic-lock boundary.

This repository carries the single most important distinction in the agent layer:
separating *"another run beat me to this version number"* from *"the database is
broken"*. Both surface from Supabase as an exception, but they demand opposite
responses — re-fetch and re-evaluate versus fail the run.

:class:`UniqueVersionViolation` marks the first case. It is raised only for a
Postgres ``23505`` whose text names the ``(trip_id, version)`` constraint; every
other failure becomes a plain :class:`~app.exceptions.RepositoryError`
(Requirement 5.3, 5.13).

Two invariants are enforced here rather than left to callers:

* **Insert-only.** Nothing in this class updates an existing row's ``itinerary``
  column (Requirement 5.2). History is append-only.
* **Supersede never touches a settled version.** Marking older proposals
  superseded skips any row already ``approved`` or ``rejected``
  (Requirement 5.9).
"""

from __future__ import annotations

from typing import Any

from app.agents.errors import DuplicateApprovalError
from app.exceptions import BackendError
from app.repositories.base import (
    BaseRepository,
    constraint_mentioned,
    is_unique_violation,
)

_TABLE = "itinerary_versions"

#: Fragments that identify the two unique constraints this repository cares about.
#: ``itinerary_versions UNIQUE(trip_id, version)`` is auto-named by Postgres, so
#: matching is tolerant: an explicit constraint name, or the column pair.
_VERSION_CONSTRAINT_HINTS = (
    "itinerary_versions_trip_id_version_key",
    "trip_id, version",
    "trip_id,version",
)
_APPROVED_INDEX_HINT = "uq_itinerary_versions_one_approved"


class UniqueVersionViolation(BackendError):
    """Raised when ``(trip_id, version)`` is already taken — a lost race.

    Deliberately *not* one of the 22 registered agent exceptions: it is an
    internal control-flow signal that ``persist_itinerary_version`` catches and
    resolves. It never reaches an HTTP handler, so it needs no status mapping.
    """

    def __init__(self, trip_id: str, version: int) -> None:
        super().__init__(f"Itinerary version {version} already exists for trip {trip_id}.")
        self.trip_id = trip_id
        self.version = version


class ItineraryVersionRepository(BaseRepository):
    """Appends itinerary versions and manages their status transitions."""

    async def get_latest(self, trip_id: str) -> dict[str, Any] | None:
        """Return the trip's highest-``version`` row, or ``None`` if none exist."""
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("trip_id", trip_id)
                .order("version", desc=True)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_latest", table=_TABLE)
        return self._first_row(response)

    async def get_latest_version_number(self, trip_id: str) -> int:
        """Return the trip's highest version number, or ``0`` when none exist.

        ``0`` is the documented ``base_version`` for a trip with no itinerary yet
        (Requirement 3.1), so this is the value a new run starts from.
        """
        latest = await self.get_latest(trip_id)
        return 0 if latest is None else int(latest["version"])

    async def list_by_trip(self, trip_id: str) -> list[dict[str, Any]]:
        """Return every version for the trip, oldest first."""
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("trip_id", trip_id)
                .order("version")
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="list_by_trip", table=_TABLE)
        return self._rows(response)

    async def get_approved(self, trip_id: str) -> dict[str, Any] | None:
        """Return the trip's approved version, or ``None`` if not yet approved."""
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("trip_id", trip_id)
                .eq("status", "approved")
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_approved", table=_TABLE)
        return self._first_row(response)

    async def insert_version(
        self,
        trip_id: str,
        version: int,
        source: str,
        itinerary: dict[str, Any],
        change_summary: str | None = None,
    ) -> dict[str, Any]:
        """Append a new ``proposed`` itinerary version.

        Always an INSERT; never an UPDATE of an existing row's ``itinerary``
        (Requirement 5.2). ``status`` is always ``proposed`` on insert
        (Requirement 5.8).

        Raises:
            UniqueVersionViolation: If ``(trip_id, version)`` is already taken.
                The caller re-fetches and re-evaluates rather than retrying the
                same number (Requirement 5.3).
            RepositoryError: For any other failure — explicitly *not* treated as
                contention, so it is never retried (Requirement 5.13).
        """
        payload = {
            "trip_id": trip_id,
            "version": version,
            "source": source,
            "status": "proposed",
            "itinerary": itinerary,
            "change_summary": change_summary,
        }
        try:
            response = await self._client.table(_TABLE).insert(payload).execute()
        except Exception as exc:
            if is_unique_violation(exc) and self._names_version_constraint(exc):
                raise UniqueVersionViolation(trip_id, version) from exc
            self._handle_error(exc, operation="insert_version", table=_TABLE)

        row = self._first_row(response)
        if row is None:
            self._handle_error(
                ValueError("insert returned no row"),
                operation="insert_version",
                table=_TABLE,
            )
        return row

    @staticmethod
    def _names_version_constraint(exc: BaseException) -> bool:
        """Return ``True`` when a ``23505`` came from ``(trip_id, version)``.

        A ``23505`` on this table could also come from the partial unique index on
        ``approved``; those must not be mistaken for version contention. If the
        error text names neither, it is treated as version contention, since that
        is the only unique constraint an ``insert_version`` call can realistically
        hit (the approved index is only reachable via a status update).
        """
        if constraint_mentioned(exc, _APPROVED_INDEX_HINT):
            return False
        if any(constraint_mentioned(exc, hint) for hint in _VERSION_CONSTRAINT_HINTS):
            return True
        return True

    async def supersede_lower_versions(self, trip_id: str, below_version: int) -> None:
        """Mark older ``proposed`` versions ``superseded``.

        Scoped to ``status = 'proposed'`` and ``version < below_version``, so a row
        already ``approved`` or ``rejected`` is never touched (Requirement 5.9).
        """
        try:
            await (
                self._client.table(_TABLE)
                .update({"status": "superseded"})
                .eq("trip_id", trip_id)
                .eq("status", "proposed")
                .lt("version", below_version)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="supersede_lower_versions", table=_TABLE)

    async def mark_approved(self, itinerary_version_id: str) -> dict[str, Any]:
        """Approve a version, enforcing at most one approved version per trip.

        Raises:
            DuplicateApprovalError: If the trip already has an approved version,
                detected either by a pre-check or by the
                ``uq_itinerary_versions_one_approved`` partial index
                (Requirement 5.10).
            RepositoryError: For any other failure.
        """
        existing = await self.get_by_id(itinerary_version_id)
        if existing is not None:
            already = await self.get_approved(existing["trip_id"])
            if already is not None and already["id"] != itinerary_version_id:
                raise DuplicateApprovalError()

        try:
            response = (
                await self._client.table(_TABLE)
                .update({"status": "approved"})
                .eq("id", itinerary_version_id)
                .execute()
            )
        except Exception as exc:
            if is_unique_violation(exc):
                raise DuplicateApprovalError() from exc
            self._handle_error(exc, operation="mark_approved", table=_TABLE)

        row = self._first_row(response)
        if row is None:
            self._handle_error(
                ValueError("update matched no row"),
                operation="mark_approved",
                table=_TABLE,
            )
        return row

    async def mark_rejected(self, itinerary_version_id: str) -> dict[str, Any]:
        """Mark a version ``rejected`` and return the updated row."""
        try:
            response = (
                await self._client.table(_TABLE)
                .update({"status": "rejected"})
                .eq("id", itinerary_version_id)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="mark_rejected", table=_TABLE)

        row = self._first_row(response)
        if row is None:
            self._handle_error(
                ValueError("update matched no row"),
                operation="mark_rejected",
                table=_TABLE,
            )
        return row

    async def get_by_id(self, itinerary_version_id: str) -> dict[str, Any] | None:
        """Return the version row for ``itinerary_version_id``, or ``None``."""
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("id", itinerary_version_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_by_id", table=_TABLE)
        return self._first_row(response)
