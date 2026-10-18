"""WRAP stage: package the approved adventure into one shareable payload."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from app.agents.errors import NoApprovedItineraryError, TripNotFoundError
from app.schemas.planning import ExportMember, ItineraryVersionSchema, TripExportResponse
from app.schemas.room import PartyRoomSchema, TripSchema
from app.services.trip_progress import advance_trip

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import RepositoryBundle


class ExportService:
    """Builds the final trip export and marks the trip exported."""

    def __init__(self, repos: RepositoryBundle) -> None:
        self._repos = repos

    async def export(self, trip_id: str) -> TripExportResponse:
        """Return the approved trip; the first call moves the trip to ``trip_exported``.

        Safe to call repeatedly: later calls return the same payload and leave the
        status as it is.
        """
        repos = self._repos
        trip = await repos.trip_repo.get_by_id(trip_id)
        if trip is None:
            raise TripNotFoundError(trip_id)
        approved = await repos.itinerary_version_repo.get_approved(trip_id)
        if approved is None:
            raise NoApprovedItineraryError()

        room_id = trip["room_id"]
        room = await repos.room_repo.get_by_id(room_id)
        if room is None:
            raise TripNotFoundError(trip_id)
        members = await repos.member_repo.list_by_room(room_id)
        characters = await repos.profile_repo.list_characters_by_member_ids(
            [m["id"] for m in members]
        )
        sprite_by_member = {c["member_id"]: c.get("sprite_key") for c in characters}
        selections = {
            s["kind"]: s.get("data") for s in await repos.selection_repo.list_by_room(room_id)
        }

        trip = await advance_trip(repos.trip_repo, trip, "trip_exported")

        return TripExportResponse(
            trip=TripSchema.model_validate(trip),
            room=PartyRoomSchema.model_validate(room),
            itinerary=ItineraryVersionSchema.model_validate(approved),
            destination=_as_dict(selections.get("destination")),
            flight=_as_dict(selections.get("flight")),
            party=[
                ExportMember(
                    display_name=m["display_name"],
                    role=m["role"],
                    sprite_key=sprite_by_member.get(m["id"]),
                )
                for m in members
            ],
        )


def _as_dict(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None
