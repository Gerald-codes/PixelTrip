"""Room routes: create a party room and join/resume a member.

Routes only parse HTTP and delegate to ``RoomService``. Errors are raised as domain
exceptions and converted to the ``API_Error_Response`` envelope by the handlers in
``app/main.py``.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path

from app.api.deps import get_room_service
from app.schemas.errors import ErrorResponse
from app.schemas.room import (
    CreateRoomRequest,
    CreateRoomResponse,
    JoinRoomRequest,
    JoinRoomResponse,
)
from app.services.room_service import RoomService

router = APIRouter(prefix="/rooms", tags=["rooms"])

RoomCode = Annotated[str, Path(pattern=r"^[A-Z0-9]{4,12}$", examples=["ABC123"])]
RoomServiceDep = Annotated[RoomService, Depends(get_room_service)]


@router.post(
    "",
    response_model=CreateRoomResponse,
    summary="Create a new party room",
    description=(
        "Creates a new planning room with a unique room code, plus the owner's guest "
        "profile, membership, character, and travel preferences, in a single atomic "
        "transaction."
    ),
    responses={
        200: {"description": "Room created"},
        422: {"model": ErrorResponse, "description": "Validation error"},
        500: {"model": ErrorResponse, "description": "Internal error"},
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def create_room(
    body: CreateRoomRequest,
    service: RoomServiceDep,
) -> CreateRoomResponse:
    """Create a new party room with the caller as the room owner."""
    return await service.create_room(body)


@router.post(
    "/{room_code}/join",
    response_model=JoinRoomResponse,
    summary="Join or resume a party room",
    description=(
        "Joins an existing room. If the display name already exists in the room "
        "(ignoring case and surrounding spaces), the existing member is resumed. "
        "Otherwise a new member is created."
    ),
    responses={
        200: {"description": "Member joined or resumed"},
        404: {"model": ErrorResponse, "description": "Room not found"},
        409: {"model": ErrorResponse, "description": "Concurrent join conflict"},
        422: {"model": ErrorResponse, "description": "Validation error"},
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def join_room(
    room_code: RoomCode,
    body: JoinRoomRequest,
    service: RoomServiceDep,
) -> JoinRoomResponse:
    """Join a room by room code and display name, or resume an existing member."""
    return await service.join_room(room_code, body)
