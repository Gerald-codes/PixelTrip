"""Trip and planning-stage data access.

Two responsibilities the agent layer leans on:

* **Room resolution.** Agent runs are keyed by ``trip_id``, but ``messages`` rows
  are keyed by ``room_id``. :meth:`TripRepository.get_room_id_for_trip` is the
  single bridge between the two (Requirement 15.1).
* **Atomic status/stage advance.** ``trips.status`` and
  ``party_rooms.planning_stage`` must move together, so
  :meth:`TripRepository.update_status` delegates to the
  ``set_trip_status_and_stage`` RPC rather than issuing two updates
  (Requirement 18.10).
"""

from __future__ import annotations

from typing import Any

from app.repositories.base import BaseRepository

_TABLE = "trips"
_SET_STATUS_RPC = "set_trip_status_and_stage"


class TripRepository(BaseRepository):
    """Reads ``trips`` and advances the trip status / planning stage pair."""

    async def get_by_id(self, trip_id: str) -> dict[str, Any] | None:
        """Return the trip row for ``trip_id``, or ``None`` if absent."""
        try:
            response = (
                await self._client.table(_TABLE).select("*").eq("id", trip_id).limit(1).execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_by_id", table=_TABLE)
        return self._first_row(response)

    async def get_by_room_id(self, room_id: str) -> dict[str, Any] | None:
        """Return the room's single active trip, or ``None`` if absent."""
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("room_id", room_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_by_room_id", table=_TABLE)
        return self._first_row(response)

    async def get_room_id_for_trip(self, trip_id: str) -> str | None:
        """Return the ``room_id`` owning ``trip_id``, or ``None`` if unresolved.

        Returns ``None`` rather than raising: the caller
        (:func:`~app.agents.messages.emit_npc_message`) turns that into a
        :class:`~app.agents.errors.RoomResolutionError`, keeping the decision about
        how to fail in the agent layer rather than the repository.
        """
        try:
            response = (
                await self._client.table(_TABLE)
                .select("room_id")
                .eq("id", trip_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_room_id_for_trip", table=_TABLE)
        row = self._first_row(response)
        return None if row is None else row.get("room_id")

    async def update_status(
        self,
        trip_id: str,
        status: str,
        planning_stage: str,
    ) -> dict[str, Any]:
        """Set ``trips.status`` and ``party_rooms.planning_stage`` atomically.

        Both writes happen inside the ``set_trip_status_and_stage`` RPC, so no
        reader observes one updated without the other (Requirement 18.10).

        Raises:
            RepositoryError: If the RPC fails, including when the trip does not
                exist — the function raises rather than silently matching zero rows.
        """
        try:
            response = await self._client.rpc(
                _SET_STATUS_RPC,
                {
                    "p_trip_id": trip_id,
                    "p_status": status,
                    "p_planning_stage": planning_stage,
                },
            ).execute()
        except Exception as exc:
            self._handle_error(exc, operation="update_status", table=_TABLE)

        row = self._first_row(response)
        if row is None:
            self._handle_error(
                ValueError("RPC returned no row"),
                operation="update_status",
                table=_TABLE,
            )
        return row
