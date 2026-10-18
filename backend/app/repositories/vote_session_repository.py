"""Vote session data access.

The agent layer needs to find an *open* session of a given category
(``destination`` or ``flight``) so it can close a stale one before opening a new
one (Requirement 7.8, 8.9). Category is not a column on ``vote_sessions``: it
lives in the linked recommendation message's ``content.category``, so
:meth:`VoteSessionRepository.get_open_by_room_and_category` resolves it through
``message_id``.
"""

from __future__ import annotations

from typing import Any

from app.repositories.base import BaseRepository

_TABLE = "vote_sessions"
_MESSAGES = "messages"


class VoteSessionRepository(BaseRepository):
    """Creates, reads, and closes ``vote_sessions`` rows."""

    async def create(
        self,
        room_id: str,
        message_id: str | None,
        question: str,
        options: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Insert an open vote session and return the created row."""
        try:
            response = (
                await self._client.table(_TABLE)
                .insert(
                    {
                        "room_id": room_id,
                        "message_id": message_id,
                        "question": question,
                        "options": options,
                        "status": "open",
                    }
                )
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="create", table=_TABLE)

        row = self._first_row(response)
        if row is None:
            self._handle_error(
                ValueError("insert returned no row"), operation="create", table=_TABLE
            )
        return row

    async def get_by_id(self, vote_session_id: str) -> dict[str, Any] | None:
        """Return the session row for ``vote_session_id``, or ``None``."""
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("id", vote_session_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_by_id", table=_TABLE)
        return self._first_row(response)

    async def list_open_by_room(self, room_id: str) -> list[dict[str, Any]]:
        """Return every open session for ``room_id``, oldest first."""
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("room_id", room_id)
                .eq("status", "open")
                .order("created_at")
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="list_open_by_room", table=_TABLE)
        return self._rows(response)

    async def get_open_by_room_and_category(
        self,
        room_id: str,
        category: str,
    ) -> dict[str, Any] | None:
        """Return the room's open session for ``category``, or ``None``.

        Resolution is two queries rather than a join: fetch the room's open
        sessions, then fetch their linked messages in one batch and match on
        ``content.category``. Deliberately avoids an N+1 and avoids depending on
        PostgREST's nested-JSON filter syntax, which is awkward to mock reliably.

        Args:
            room_id: The room to search.
            category: ``"destination"`` or ``"flight"``.
        """
        open_sessions = await self.list_open_by_room(room_id)
        message_ids = [s["message_id"] for s in open_sessions if s.get("message_id")]
        if not message_ids:
            return None

        try:
            response = (
                await self._client.table(_MESSAGES)
                .select("id, content")
                .in_("id", message_ids)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_open_by_room_and_category", table=_MESSAGES)

        category_by_message: dict[str, Any] = {}
        for message in self._rows(response):
            content = message.get("content") or {}
            if isinstance(content, dict):
                category_by_message[message["id"]] = content.get("category")

        for session in open_sessions:
            if category_by_message.get(session.get("message_id")) == category:
                return session
        return None

    async def close(self, vote_session_id: str) -> dict[str, Any]:
        """Mark the session closed and return the updated row."""
        try:
            response = (
                await self._client.table(_TABLE)
                .update({"status": "closed"})
                .eq("id", vote_session_id)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="close", table=_TABLE)

        row = self._first_row(response)
        if row is None:
            self._handle_error(ValueError("update matched no row"), operation="close", table=_TABLE)
        return row

    async def mark_tie_pending(
        self, vote_session_id: str, tied_option_ids: list[str], category: str
    ) -> dict[str, Any]:
        """Flag the session as tied and waiting for the room owner's pick.

        The session stays ``open`` so it remains visible as undecided; ``tie_pending``
        stops further voting until the owner breaks the tie.
        """
        try:
            response = (
                await self._client.table(_TABLE)
                .update(
                    {
                        "tie_pending": True,
                        "tie_option_ids": tied_option_ids,
                        "category": category,
                    }
                )
                .eq("id", vote_session_id)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="mark_tie_pending", table=_TABLE)

        row = self._first_row(response)
        if row is None:
            self._handle_error(
                ValueError("update matched no row"), operation="mark_tie_pending", table=_TABLE
            )
        return row

    async def get_tie_pending_by_room(self, room_id: str) -> dict[str, Any] | None:
        """Return the room's session that is waiting for a tiebreak, or ``None``."""
        try:
            response = (
                await self._client.table(_TABLE)
                .select("*")
                .eq("room_id", room_id)
                .eq("status", "open")
                .eq("tie_pending", True)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="get_tie_pending_by_room", table=_TABLE)
        return self._first_row(response)

    async def clear_tie_pending(self, vote_session_id: str) -> None:
        """Clear the tie flag (the owner has picked), so the session can close."""
        try:
            await (
                self._client.table(_TABLE)
                .update({"tie_pending": False})
                .eq("id", vote_session_id)
                .execute()
            )
        except Exception as exc:
            self._handle_error(exc, operation="clear_tie_pending", table=_TABLE)
