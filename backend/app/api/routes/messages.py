"""Chat routes: a party member sends a message to their room.

Everyone in the room receives it over Realtime (the ``messages`` table). The AI guide
writes to the same table, so chat and NPC messages share one transcript.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, status

from app.api.deps import get_chat_service
from app.schemas.errors import ErrorResponse
from app.schemas.planning import MessageSchema, SendMessageRequest
from app.services.chat_service import ChatService

router = APIRouter(prefix="/rooms", tags=["chat"])

RoomCode = Annotated[str, Path(pattern=r"^[A-Z0-9]{4,12}$", examples=["ABC123"])]
ChatServiceDep = Annotated[ChatService, Depends(get_chat_service)]


@router.post(
    "/{room_code}/messages",
    response_model=MessageSchema,
    status_code=status.HTTP_201_CREATED,
    summary="Send a chat message",
    description="Posts a member's text message to the room's chat. Everyone in the room "
    "receives it live over Realtime.",
    responses={
        201: {"description": "Message sent"},
        404: {"model": ErrorResponse, "description": "Room not found"},
        422: {
            "model": ErrorResponse,
            "description": "Validation error, or the member is not in this room",
        },
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def send_message(
    room_code: RoomCode, body: SendMessageRequest, service: ChatServiceDep
) -> MessageSchema:
    """Send a chat message to the room."""
    return await service.send(room_code, body)
