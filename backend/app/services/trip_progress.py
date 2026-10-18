"""Small helpers the API services share for reading a room's trip and advancing it.

Status changes always go through ``trip_status_service.advance_trip_status`` (the sole
writer of ``trips.status``), which only ever uses ``repos.trip_repo``. These helpers let
services that hold just a ``TripRepository`` call it without assembling the full agent
``RepositoryBundle``.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import TYPE_CHECKING, Any

from app.exceptions import RoomNotFoundError
from app.services.trip_status_service import advance_trip_status

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.repositories.trip_repository import TripRepository


async def require_room_trip(trip_repo: TripRepository, room_id: str) -> dict[str, Any]:
    """Return the room's trip row.

    Every room has exactly one trip (created with the room). A missing trip means the
    week-1 migration has not been applied, so it surfaces as the room being unusable.
    """
    trip = await trip_repo.get_by_room_id(room_id)
    if trip is None:
        raise RoomNotFoundError("This room has no trip; it cannot be planned yet.")
    return trip


async def advance_trip(
    trip_repo: TripRepository, trip: dict[str, Any], new_status: str
) -> dict[str, Any]:
    """Advance ``trip`` to ``new_status`` if that moves it forward; return the trip row.

    A same-or-lower status is a no-op (the trip row is returned unchanged).
    """
    result = await advance_trip_status(
        SimpleNamespace(trip_repo=trip_repo),  # type: ignore[arg-type]
        trip["id"],
        new_status,
        trip.get("status", "trip_created"),
    )
    return result.row if result.advanced and result.row else trip
