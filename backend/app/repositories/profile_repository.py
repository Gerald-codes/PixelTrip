"""Guest, character, and travel-preference data access.

These three tables are always read together as a unit by the agent layer: the
Discovery node needs every party member's ``characters`` and
``travel_preferences`` rows to compute the ``Group_Profile`` (Requirement 7.1),
and ``guests`` supplies the display name that ``room_members`` does not carry.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.repositories.base import BaseRepository, require_text, require_uuid

_GUESTS = "guests"
_CHARACTERS = "characters"
_PREFERENCES = "travel_preferences"


class ProfileRepository(BaseRepository):
    """Reads and writes ``guests``, ``characters``, and ``travel_preferences``."""

    # --- guests ------------------------------------------------------------

    async def get_guest_by_id(self, guest_id: str) -> dict[str, Any] | None:
        """Return the guest row for ``guest_id``, or ``None`` if absent."""
        require_uuid(guest_id, "guest_id")
        try:
            response = (
                await self._client.table(_GUESTS).select("*").eq("id", guest_id).limit(1).execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_guest_by_id", table=_GUESTS)
        return self._first_row(response)

    # --- characters --------------------------------------------------------

    async def get_character_by_member_id(self, member_id: str) -> dict[str, Any] | None:
        """Return the character row for ``member_id``, or ``None`` if absent."""
        require_uuid(member_id, "member_id")
        try:
            response = (
                await self._client.table(_CHARACTERS)
                .select("*")
                .eq("member_id", member_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_character_by_member_id", table=_CHARACTERS)
        return self._first_row(response)

    async def list_characters_by_member_ids(self, member_ids: list[str]) -> list[dict[str, Any]]:
        """Return character rows for every id in ``member_ids``.

        Returns an empty list for empty input without issuing a query, so the
        Discovery node's roster load does not fire a pointless ``in ()``.
        """
        if not member_ids:
            return []
        try:
            response = (
                await self._client.table(_CHARACTERS)
                .select("*")
                .in_("member_id", member_ids)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="list_characters_by_member_ids", table=_CHARACTERS)
        return self._rows(response)

    # --- travel_preferences ------------------------------------------------

    async def get_preferences_by_member_id(self, member_id: str) -> dict[str, Any] | None:
        """Return the preferences row for ``member_id``, or ``None`` if absent."""
        require_uuid(member_id, "member_id")
        try:
            response = (
                await self._client.table(_PREFERENCES)
                .select("*")
                .eq("member_id", member_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_preferences_by_member_id", table=_PREFERENCES)
        return self._first_row(response)

    async def list_preferences_by_member_ids(self, member_ids: list[str]) -> list[dict[str, Any]]:
        """Return preference rows for every id in ``member_ids``.

        The Discovery and Logistics nodes derive ``Availability_Overlap`` and
        ``Budget_Ceiling`` from exactly these rows.
        """
        if not member_ids:
            return []
        try:
            response = (
                await self._client.table(_PREFERENCES)
                .select("*")
                .in_("member_id", member_ids)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="list_preferences_by_member_ids", table=_PREFERENCES)
        return self._rows(response)

    # --- creation (room join flow) -----------------------------------------

    async def create_guest(self, display_name: str, avatar_url: str | None = None) -> dict:
        """Insert a guest profile and return it."""
        require_text(display_name, "display_name", 50)
        data: dict = {"display_name": display_name}
        if avatar_url is not None:
            data["avatar_url"] = avatar_url
        return await self._insert_one(_GUESTS, data)

    async def create_character(self, member_id: str, appearance: dict | None = None) -> dict:
        """Insert a character for the member and return it."""
        require_uuid(member_id, "member_id")
        return await self._insert_one(
            _CHARACTERS, {"member_id": member_id, "appearance": appearance or {}}
        )

    async def create_preferences(
        self,
        member_id: str,
        available_dates: list | None = None,
        destinations: list | None = None,
        interests: list | None = None,
        activities: list | None = None,
        hard_constraints: list | None = None,
    ) -> dict:
        """Insert the member's travel preferences (list fields default to ``[]``)."""
        require_uuid(member_id, "member_id")
        data = {
            "member_id": member_id,
            "available_dates": available_dates or [],
            "destinations": destinations or [],
            "interests": interests or [],
            "activities": activities or [],
            "hard_constraints": hard_constraints or [],
        }
        return await self._insert_one(_PREFERENCES, data)

    async def save_preferences(self, member_id: str, fields: dict[str, Any]) -> dict:
        """Replace the member's preferences with ``fields`` and mark them submitted.

        Updates the member's existing row (created on join). If the row is missing,
        it is created instead, so a save never silently does nothing.
        """
        require_uuid(member_id, "member_id")
        data = {**fields, "submitted_at": datetime.now(UTC).isoformat()}
        try:
            response = (
                await self._client.table(_PREFERENCES)
                .update(data)
                .eq("member_id", member_id)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="save_preferences", table=_PREFERENCES)
        row = self._first_row(response)
        if row is not None:
            return row
        return await self._insert_one(_PREFERENCES, {"member_id": member_id, **data})

    async def save_character(
        self, member_id: str, appearance: dict[str, Any], sprite_key: str | None
    ) -> dict:
        """Replace the member's character (created on join); create it if missing."""
        require_uuid(member_id, "member_id")
        data = {"appearance": appearance, "sprite_key": sprite_key}
        try:
            response = (
                await self._client.table(_CHARACTERS)
                .update(data)
                .eq("member_id", member_id)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="save_character", table=_CHARACTERS)
        row = self._first_row(response)
        if row is not None:
            return row
        return await self._insert_one(_CHARACTERS, {"member_id": member_id, **data})
