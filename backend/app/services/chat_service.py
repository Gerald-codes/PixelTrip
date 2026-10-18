"""Chat: party members send text messages to their room.

Messages are stored in ``messages`` (the same table the AI guide writes to), so every
client sees them over Realtime. Clients cannot insert messages directly; this service is
the only way a member's message is written.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from app.agents.errors import UnresolvedMemberError
from app.exceptions import RepositoryError, RoomNotFoundError
from app.schemas.planning import MessageSchema, SendMessageRequest

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import RepositoryBundle


class ChatService:
    """Writes members' chat messages."""

    def __init__(self, repos: RepositoryBundle) -> None:
        self._repos = repos

    async def send(self, room_code: str, request: SendMessageRequest) -> MessageSchema:
        """Post a member's text message to the room and return it."""
        room = await self._repos.room_repo.get_room_by_code(room_code)
        if room is None:
            raise RoomNotFoundError(f"Room '{room_code}' not found.")
        member_id = str(request.member_id)
        member = await self._repos.member_repo.get_by_id(member_id)
        if member is None or member.get("room_id") != room["id"]:
            raise UnresolvedMemberError(member_id)

        rows = await self._repos.message_repo.insert_turn(
            room["id"],
            [
                {
                    "sender_type": "user",
                    "sender_member_id": member_id,
                    "kind": "text",
                    "content": {"text": request.text},
                }
            ],
        )
        if not rows:
            raise RepositoryError("Database operation 'insert_turn' on 'messages' failed.")
        return to_message(rows[0])


def to_message(row: dict[str, Any]) -> MessageSchema:
    """Map a ``messages`` row to the API envelope (``sender_member_id`` -> ``senderId``)."""
    return MessageSchema(
        id=row["id"],
        room_id=row["room_id"],
        created_at=str(row["created_at"]),
        sender_type=row["sender_type"],
        sender_id=row.get("sender_member_id"),
        kind=row["kind"],
        content=row.get("content") or {},
    )
