"""Preference routes: a member saves their travel preferences.

Routes only parse HTTP and delegate to ``PreferenceService``; errors become the
standard envelope via the handlers in ``app/main.py``.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path

from app.api.deps import get_preference_service
from app.schemas.errors import ErrorResponse
from app.schemas.planning import SavePreferencesRequest, SavePreferencesResponse
from app.services.preference_service import PreferenceService

router = APIRouter(prefix="/rooms", tags=["preferences"])

RoomCode = Annotated[str, Path(pattern=r"^[A-Z0-9]{4,12}$", examples=["ABC123"])]
PreferenceServiceDep = Annotated[PreferenceService, Depends(get_preference_service)]


@router.put(
    "/{room_code}/members/{member_id}/preferences",
    response_model=SavePreferencesResponse,
    summary="Save a member's travel preferences",
    description=(
        "Replaces the member's preferences (dates, budget, interests, activities, "
        "constraints, departure origin). When every member of the room has saved "
        "preferences, the trip advances to `preferences_collected` (stage `discover`)."
    ),
    responses={
        200: {"description": "Preferences saved"},
        404: {"model": ErrorResponse, "description": "Room not found"},
        422: {
            "model": ErrorResponse,
            "description": "Validation error, or the member is not in this room",
        },
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def save_preferences(
    room_code: RoomCode,
    member_id: UUID,
    body: SavePreferencesRequest,
    service: PreferenceServiceDep,
) -> SavePreferencesResponse:
    """Save the member's travel preferences."""
    return await service.save(room_code, str(member_id), body)
