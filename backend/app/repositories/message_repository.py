"""Room message data access.

An agent *turn* may emit several messages (a summary plus a recommendation, say).
Those must land atomically and in a deterministic order, so
:meth:`MessageRepository.insert_turn` delegates to the ``insert_message_turn``
RPC rather than looping inserts client-side: a partial turn would otherwise be
visible to a realtime subscriber (Requirement 15.10-15.11).
"""

from __future__ import annotations

from typing import Any

from app.repositories.base import BaseRepository

_TABLE = "messages"
_INSERT_TURN_RPC = "insert_message_turn"

#: Requirement 15.10. Enforced here as well as in the RPC so a caller mistake
#: fails fast, before a round trip.
MAX_MESSAGES_PER_TURN = 5


class MessageRepository(BaseRepository):
    """Writes agent turns and reads room message history."""

    async def insert_turn(
        self,
        room_id: str,
        messages: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Insert 1-``MAX_MESSAGES_PER_TURN`` messages as one atomic turn.

        Args:
            room_id: The room the messages belong to.
            messages: Each entry carries ``sender_type``, ``sender_member_id``
                (``None`` for AI), ``kind``, and ``content``.

        Returns:
            The inserted rows in presentation order (``created_at`` ascending).

        Raises:
            ValueError: If the message count is outside 1..5. Raised before any
                database call, so an obvious caller bug does not cost a round trip.
            RepositoryError: If the RPC fails. The turn commits entirely or not at
                all; no partial turn is ever left behind.
        """
        if not 1 <= len(messages) <= MAX_MESSAGES_PER_TURN:
            raise ValueError(
                f"An agent turn must carry 1 to {MAX_MESSAGES_PER_TURN} messages, "
                f"got {len(messages)}."
            )

        try:
            response = await self._client.rpc(
                _INSERT_TURN_RPC,
                {"p_room_id": room_id, "p_messages": messages},
            ).execute()
        except Exception as exc:
            self._handle_error(exc, operation="insert_turn", table=_TABLE)
        return self._rows(response)

    async def list_by_room(self, room_id: str, limit: int = 100) -> list[dict[str, Any]]:
        """Return the room's messages oldest-first, capped at ``limit``."""
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("room_id", room_id)
                .order("created_at")
                .limit(limit)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="list_by_room", table=_TABLE)
        return self._rows(response)

    async def get_by_id(self, message_id: str) -> dict[str, Any] | None:
        """Return the message row for ``message_id``, or ``None`` if absent."""
        try:
            response = (
                await self._client.table(_TABLE).select("*").eq("id", message_id).limit(1).execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_by_id", table=_TABLE)
        return self._first_row(response)

    async def count_progress_messages(self, room_id: str, run_id: str) -> int:
        """Count progress messages already emitted for ``run_id`` in this room.

        Progress is marked inside ``content`` (``content.progress = true``,
        ``content.run_id``) because the ``message_kind`` enum has no ``progress``
        value — see Backend Change Request Entry 2. Filtering therefore uses a
        JSON containment match rather than a column predicate.

        Used to enforce "at most one progress message per run"
        (Requirement 16.9).
        """
        try:
            response = (
                await self._client.table(_TABLE)
                .select("id")
                .eq("room_id", room_id)
                .contains("content", {"progress": True, "run_id": run_id})
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="count_progress_messages", table=_TABLE)
        return len(self._rows(response))
