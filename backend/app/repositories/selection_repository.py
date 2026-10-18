"""Locked decision (selection) data access.

``selections`` carries ``UNIQUE(room_id, kind)`` — one locked destination and one
locked flight per room. :meth:`SelectionRepository.upsert` relies on that
constraint so a re-resolved vote replaces the prior decision rather than adding a
second row (Requirement 17.3).
"""

from __future__ import annotations

from typing import Any

from app.repositories.base import BaseRepository

_TABLE = "selections"


class SelectionRepository(BaseRepository):
    """Reads and writes the party's locked destination / flight choices."""

    async def get_by_room_and_kind(
        self,
        room_id: str,
        kind: str,
    ) -> dict[str, Any] | None:
        """Return the locked selection of ``kind`` for the room, or ``None``.

        Args:
            room_id: The room to look up.
            kind: ``"destination"`` or ``"flight"``.
        """
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("room_id", room_id)
                .eq("kind", kind)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_by_room_and_kind", table=_TABLE)
        return self._first_row(response)

    async def list_by_room(self, room_id: str) -> list[dict[str, Any]]:
        """Return every locked selection for the room."""
        try:
            response = await self._client.table(_TABLE).select("*").eq("room_id", room_id).execute()
        except Exception as exc:
            self._handle_error(exc, operation="list_by_room", table=_TABLE)
        return self._rows(response)

    async def upsert(
        self,
        room_id: str,
        kind: str,
        data: dict[str, Any],
        vote_session_id: str | None = None,
    ) -> dict[str, Any]:
        """Lock in a decision, replacing any existing one of the same kind.

        Uses ``UNIQUE(room_id, kind)`` as the conflict target so the room keeps at
        most one destination and one flight selection.
        """
        try:
            response = (
                await self._client.table(_TABLE)
                .upsert(
                    {
                        "room_id": room_id,
                        "kind": kind,
                        "data": data,
                        "vote_session_id": vote_session_id,
                    },
                    on_conflict="room_id,kind",
                )
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="upsert", table=_TABLE)

        row = self._first_row(response)
        if row is None:
            self._handle_error(
                ValueError("upsert returned no row"), operation="upsert", table=_TABLE
            )
        return row
