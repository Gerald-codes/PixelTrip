"""Party room data access.

The agent layer reads two fields from here that live nowhere else:
``party_rooms.status`` (is the room still open to planning?) and
``party_rooms.planning_stage`` (has the party already moved past this run's
stage?). Both gate whether a run may proceed at all — see Requirement 6.7-6.8.
"""

from __future__ import annotations

from typing import Any

from app.exceptions import ValidationError
from app.repositories.base import ROOM_CODE_PATTERN, BaseRepository, require_text, require_uuid

_TABLE = "party_rooms"
RPC_CREATE_ROOM = "create_room_with_owner"
RESULT_KEYS = ("room", "guest", "member", "character", "travel_preferences", "trip")


class RoomRepository(BaseRepository):
    """Reads ``party_rooms`` rows and owns the ``create_room_with_owner`` RPC."""

    async def get_by_id(self, room_id: str) -> dict[str, Any] | None:
        """Return the room row for ``room_id``, or ``None`` if absent."""
        try:
            response = (
                await self._client.table(_TABLE).select("*").eq("id", room_id).limit(1).execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_by_id", table=_TABLE)
        return self._first_row(response)

    async def get_by_code(self, room_code: str) -> dict[str, Any] | None:
        """Return the room row for ``room_code``, or ``None`` if absent."""
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("room_code", room_code)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_by_code", table=_TABLE)
        return self._first_row(response)

    async def create_room_with_owner(
        self,
        name: str,
        room_code: str,
        owner_display_name: str,
        appearance: dict | None = None,
    ) -> dict:
        """Create the room, owner guest, owner membership, character, preferences, and trip.

        Runs as one database transaction via the RPC: all six records or none. Returns a
        dict with keys ``room``, ``guest``, ``member``, ``character``,
        ``travel_preferences``, ``trip``.
        """
        require_text(name, "name", 100)
        require_text(owner_display_name, "owner_display_name", 50)
        if not isinstance(room_code, str) or not ROOM_CODE_PATTERN.fullmatch(room_code):
            raise ValidationError("'room_code' must match ^[A-Z0-9]{4,12}$.")

        params = {
            "p_room_name": name,
            "p_room_code": room_code,
            "p_owner_display_name": owner_display_name,
            "p_appearance": appearance or {},
        }
        try:
            response = await self._client.rpc(RPC_CREATE_ROOM, params).execute()
        except Exception as exc:
            self._handle_error(exc, operation=RPC_CREATE_ROOM, table=_TABLE)

        result = response.data
        if not isinstance(result, dict) or any(key not in result for key in RESULT_KEYS):
            self._handle_error(
                ValueError("Unexpected RPC result"), operation=RPC_CREATE_ROOM, table=_TABLE
            )
        return result

    async def get_room_by_code(self, room_code: str) -> dict | None:
        """Return the room with this code, or ``None``."""
        return await self._select_one(_TABLE, room_code=room_code)

    async def get_room_by_id(self, room_id: str) -> dict | None:
        """Return the room with this id, or ``None`` (rejects malformed ids)."""
        require_uuid(room_id, "room_id")
        return await self._select_one(_TABLE, id=room_id)
