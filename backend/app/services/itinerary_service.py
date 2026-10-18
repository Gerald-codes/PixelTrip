"""Itinerary read service for the itinerary endpoints."""

from __future__ import annotations

from app.agents.errors import TripNotFoundError
from app.repositories.itinerary_version_repository import ItineraryVersionRepository
from app.repositories.trip_repository import TripRepository
from app.schemas.planning import ItineraryVersionSchema


class ItineraryService:
    """Lists a trip's itinerary versions."""

    def __init__(
        self,
        trip_repo: TripRepository,
        itinerary_version_repo: ItineraryVersionRepository,
    ) -> None:
        self._trip_repo = trip_repo
        self._itinerary_version_repo = itinerary_version_repo

    async def list_versions(self, trip_id: str) -> list[ItineraryVersionSchema]:
        """Return every version of the trip's itinerary, oldest first."""
        if await self._trip_repo.get_by_id(trip_id) is None:
            raise TripNotFoundError(trip_id)
        rows = await self._itinerary_version_repo.list_by_trip(trip_id)
        return [ItineraryVersionSchema.model_validate(row) for row in rows]
