"""In-memory fake repositories used only by the property-based tests.

These are deliberately simpler than :class:`~tests.agents.conftest.FakeSupabaseClient`:
each one models exactly the one database invariant its property needs to
check (a unique constraint, an idempotency key), rather than a general query
builder. That keeps each property test's fake small enough to read in one
sitting and obviously correct on its own.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4


class FakeUniqueViolation(Exception):
    """Raised by a fake repository standing in for a Postgres 23505."""


@dataclass
class FakeItineraryVersionRepository:
    """Enforces ``UNIQUE(trip_id, version)`` and the one-approved-per-trip index.

    Mirrors the real ``ItineraryVersionRepository`` just enough for the
    version-lifecycle properties: insert, supersede, approve, get_latest.
    """

    rows: dict[str, dict[str, Any]] = field(default_factory=dict)
    insert_calls: list[tuple[str, int, str]] = field(default_factory=list)

    def _by_trip(self, trip_id: str) -> list[dict[str, Any]]:
        return [r for r in self.rows.values() if r["trip_id"] == trip_id]

    async def insert_version(
        self,
        trip_id: str,
        version: int,
        source: str,
        itinerary: dict[str, Any],
        change_summary: str | None = None,
    ) -> dict[str, Any]:
        from app.repositories.itinerary_version_repository import UniqueVersionViolation

        self.insert_calls.append((trip_id, version, source))
        if any(r["trip_id"] == trip_id and r["version"] == version for r in self.rows.values()):
            raise UniqueVersionViolation(trip_id, version)

        row = {
            "id": str(uuid4()),
            "trip_id": trip_id,
            "version": version,
            "source": source,
            "status": "proposed",
            "itinerary": itinerary,
            "change_summary": change_summary,
        }
        self.rows[row["id"]] = row
        return dict(row)

    async def get_latest(self, trip_id: str) -> dict[str, Any] | None:
        rows = self._by_trip(trip_id)
        if not rows:
            return None
        return dict(max(rows, key=lambda r: r["version"]))

    async def supersede_lower_versions(self, trip_id: str, below_version: int) -> None:
        for row in self._by_trip(trip_id):
            if row["status"] == "proposed" and row["version"] < below_version:
                row["status"] = "superseded"

    async def mark_approved(self, itinerary_version_id: str) -> dict[str, Any]:
        from app.agents.errors import DuplicateApprovalError

        row = self.rows[itinerary_version_id]
        already_approved = [
            r
            for r in self._by_trip(row["trip_id"])
            if r["status"] == "approved" and r["id"] != itinerary_version_id
        ]
        if already_approved:
            raise DuplicateApprovalError()
        row["status"] = "approved"
        return dict(row)

    async def get_by_id(self, itinerary_version_id: str) -> dict[str, Any] | None:
        row = self.rows.get(itinerary_version_id)
        return dict(row) if row else None


@dataclass
class FakeAgentRunRepository:
    """Enforces ``UNIQUE(idempotency_key)`` for the idempotency-replay property."""

    rows_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    rows_by_key: dict[str, str] = field(default_factory=dict)

    async def create_pending(
        self,
        trip_id: str,
        run_type: str,
        created_by_member_id: str | None,
        base_version: int,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        if idempotency_key is not None and idempotency_key in self.rows_by_key:
            # Requirement 4.5: the loser re-reads and returns the winner's row.
            return dict(self.rows_by_id[self.rows_by_key[idempotency_key]])

        row = {
            "id": str(uuid4()),
            "trip_id": trip_id,
            "run_type": run_type,
            "created_by_member_id": created_by_member_id,
            "base_version": base_version,
            "status": "pending",
            "idempotency_key": idempotency_key,
            "result_version_id": None,
            "started_at": None,
            "completed_at": None,
            "error": None,
            "iteration_count": 0,
        }
        self.rows_by_id[row["id"]] = row
        if idempotency_key is not None:
            self.rows_by_key[idempotency_key] = row["id"]
        return dict(row)

    async def get_by_idempotency_key(self, idempotency_key: str) -> dict[str, Any] | None:
        run_id = self.rows_by_key.get(idempotency_key)
        return dict(self.rows_by_id[run_id]) if run_id else None
