"""Room-member data access.

Spec 03's agent layer uses this repository read-only: the Discovery node loads the
party roster, ``AgentRunService`` resolves a triggering member's identity against
it before trusting a client-supplied id (Requirement 22.2), and vote tallying
restricts counts to members still present in the room (Requirement 17.6).
"""

from __future__ import annotations

from typing import Any, Literal

from app.exceptions import MemberAlreadyExistsError, ValidationError
from app.repositories.base import (
    BaseRepository,
    is_unique_violation,
    require_text,
    require_uuid,
)

_TABLE = "room_members"
ROLES = ("owner", "member")


def normalize_display_name(name: str) -> str:
    """Trim, collapse internal whitespace to one space, and lower-case.

    Identity rule: ``room_id + normalized display name`` -> room member, so "Gerald",
    "gerald", "GERald", and "  Gerald  " are the same member. Must match the database
    column: ``lower(btrim(regexp_replace(display_name, '\\s+', ' ', 'g')))``.
    """
    return " ".join(name.split()).lower()


class MemberRepository(BaseRepository):
    """Reads and writes ``room_members`` rows, including case-insensitive identity."""

    async def get_by_id(self, member_id: str) -> dict[str, Any] | None:
        """Return the member row for ``member_id``, or ``None`` if absent.

        This is the resolution step Requirement 22.2 requires before any
        client-supplied identity is persisted as authoritative.
        """
        try:
            response = (
                await self._client.table(_TABLE).select("*").eq("id", member_id).limit(1).execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_by_id", table=_TABLE)
        return self._first_row(response)

    async def list_by_room(self, room_id: str) -> list[dict[str, Any]]:
        """Return every member row for ``room_id``, oldest first."""
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("room_id", room_id)
                .order("created_at")
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="list_by_room", table=_TABLE)
        return self._rows(response)

    async def count_by_room(self, room_id: str) -> int:
        """Return the number of members in ``room_id``."""
        return len(await self.list_by_room(room_id))

    async def get_owner(self, room_id: str) -> dict[str, Any] | None:
        """Return the room's ``role = 'owner'`` member row, or ``None``.

        Used to authorize owner-triggered vote-session closure
        (Requirement 17.12).
        """
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("room_id", room_id)
                .eq("role", "owner")
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_owner", table=_TABLE)
        return self._first_row(response)

    async def create_member(
        self,
        room_id: str,
        guest_id: str,
        display_name: str,
        role: Literal["owner", "member"],
    ) -> dict:
        """Insert a membership row and return it.

        Raises ``MemberAlreadyExistsError`` if a member with the same normalized name
        already exists in the room (e.g. two concurrent joins).
        """
        require_uuid(room_id, "room_id")
        require_uuid(guest_id, "guest_id")
        require_text(display_name, "display_name", 50)
        if role not in ROLES:
            raise ValidationError("'role' must be 'owner' or 'member'.")

        data = {
            "room_id": room_id,
            "guest_id": guest_id,
            "display_name": display_name,
            "role": role,
        }
        try:
            response = await self._client.table(_TABLE).insert(data).execute()
        except Exception as exc:
            if is_unique_violation(exc):
                raise MemberAlreadyExistsError(
                    "A member with that name already exists in this room."
                ) from exc
            self._handle_error(exc, operation="create_member", table=_TABLE)
        if not response.data:
            self._handle_error(
                ValueError("No data returned"), operation="create_member", table=_TABLE
            )
        return response.data[0]

    async def get_member_by_display_name(self, room_id: str, display_name: str) -> dict | None:
        """Case-insensitive match on ``normalized_name`` within the given room."""
        require_uuid(room_id, "room_id")
        require_text(display_name, "display_name", 50)
        return await self._select_one(
            _TABLE, room_id=room_id, normalized_name=normalize_display_name(display_name)
        )

    async def get_member_by_id(self, member_id: str) -> dict | None:
        """Return the member with this id, or ``None`` (rejects malformed ids)."""
        require_uuid(member_id, "member_id")
        return await self._select_one(_TABLE, id=member_id)

    async def list_members_by_room(self, room_id: str) -> list[dict]:
        """Return all members of the room (possibly empty; rejects malformed ids)."""
        require_uuid(room_id, "room_id")
        try:
            response = await self._client.table(_TABLE).select("*").eq("room_id", room_id).execute()
        except Exception as exc:
            self._handle_error(exc, operation="list_members_by_room", table=_TABLE)
        return response.data or []

    async def set_stage_ready(self, member_id: str, ready: bool) -> None:
        """Set a member's ``stage_ready`` flag (service-role write).

        Mirrors the member's completion of the party's current stage onto the
        anon-readable ``room_members`` row so every client sees readiness live over
        Realtime, without exposing ``travel_preferences``.
        """
        require_uuid(member_id, "member_id")
        try:
            await (
                self._client.table(_TABLE)
                .update({"stage_ready": ready})
                .eq("id", member_id)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="set_stage_ready", table=_TABLE)
