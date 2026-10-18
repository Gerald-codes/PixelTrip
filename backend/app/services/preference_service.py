"""Preference service: save a member's travel preferences (and optionally their
character) and detect "everyone's in".

When the last member of a room saves preferences, the trip advances to
``preferences_collected`` (planning stage ``discover``), which is what lets the party
start destination discovery.
"""

from __future__ import annotations

from typing import Any

from app.agents.errors import UnresolvedMemberError
from app.core.budget import CURRENCY, MAX_BUDGET, MIN_BUDGET, is_valid_amount
from app.demo import is_demo, require_demo_pair
from app.exceptions import InvalidBudgetError, RoomNotFoundError
from app.repositories.member_repository import MemberRepository
from app.repositories.profile_repository import ProfileRepository
from app.repositories.room_repository import RoomRepository
from app.repositories.trip_repository import TripRepository
from app.schemas.planning import SavePreferencesRequest, SavePreferencesResponse
from app.schemas.room import CharacterSchema, TravelPreferencesSchema, TripSchema
from app.services.trip_progress import advance_trip, require_room_trip

#: Interim: the agent layer's flight search reads the departure origin from this
#: ``hard_constraints`` entry (spec 03, Backend Change Request Entry 1) until it reads the
#: ``travel_preferences.origin`` column. Mirroring keeps both in sync.
_ORIGIN_CONSTRAINT_TYPE = "departure_origin"


def _to_columns(request: SavePreferencesRequest) -> dict[str, Any]:
    """Map the request to ``travel_preferences`` columns, mirroring ``origin``."""
    fields = request.model_dump(mode="json", exclude={"character"})
    constraints = [
        item
        for item in fields["hard_constraints"]
        if not (isinstance(item, dict) and item.get("type") == _ORIGIN_CONSTRAINT_TYPE)
    ]
    if fields["origin"]:
        constraints.append({"type": _ORIGIN_CONSTRAINT_TYPE, "value": fields["origin"]})
    fields["hard_constraints"] = constraints
    return fields


class PreferenceService:
    """Saves preferences and advances the trip once every member has submitted.

    Saving also marks the member "ready" on ``room_members`` (anon-readable, so every
    client sees it live; ``travel_preferences`` stays backend-only), see
    20261005000000_stage_readiness.sql.
    """

    def __init__(
        self,
        room_repo: RoomRepository,
        member_repo: MemberRepository,
        profile_repo: ProfileRepository,
        trip_repo: TripRepository,
    ) -> None:
        self._room_repo = room_repo
        self._member_repo = member_repo
        self._profile_repo = profile_repo
        self._trip_repo = trip_repo

    async def save(
        self, room_code: str, member_id: str, request: SavePreferencesRequest
    ) -> SavePreferencesResponse:
        """Replace the member's preferences and return them with the (maybe advanced) trip."""
        if request.budget is not None and not is_valid_amount(request.budget):
            raise InvalidBudgetError(
                f"Adventure funds must be between {CURRENCY} {MIN_BUDGET:,} and "
                f"{CURRENCY} {MAX_BUDGET:,} per person for the whole trip "
                f"(you entered {request.budget:,.0f}). Leave it empty if you are not sure."
            )
        room = await self._room_repo.get_room_by_code(room_code)
        if room is None:
            raise RoomNotFoundError(f"Room '{room_code}' not found.")

        member = await self._member_repo.get_member_by_id(member_id)
        if member is None or member.get("room_id") != room["id"]:
            raise UnresolvedMemberError(member_id)

        # Mark the member ready BEFORE saving, and only while the room is in SETUP.
        # Order matters when two members save at the same time: the stage change to
        # DISCOVER (which clears everyone's ready flag) can only happen after this
        # member's preferences exist, so it always lands after this mark and never
        # leaves anyone "ready" in DISCOVER. A late joiner (room already past SETUP) is
        # not marked: there, ready means "has voted".
        in_setup = room.get("planning_stage", "setup") == "setup"
        if in_setup:
            await self._member_repo.set_stage_ready(member_id, True)
        try:
            saved = await self._profile_repo.save_preferences(member_id, _to_columns(request))
        except Exception:
            if in_setup:
                await self._member_repo.set_stage_ready(member_id, False)
            raise
        if request.character is not None:
            character = await self._profile_repo.save_character(
                member_id, request.character.appearance, request.character.sprite_key
            )
        else:
            character = await self._profile_repo.get_character_by_member_id(member_id)

        trip = await require_room_trip(self._trip_repo, room["id"])
        members = await self._member_repo.list_by_room(room["id"]) if is_demo(room) else None
        demo_ready = not is_demo(room) or (members is not None and len(members) == 2)
        if is_demo(room) and demo_ready:
            require_demo_pair(members)
        if demo_ready and await self._everyone_submitted(room["id"]):
            # Moving to DISCOVER clears everyone's stage_ready (a database trigger on
            # planning_stage; see 20261008000000_stage_ready_reset.sql).
            trip = await advance_trip(self._trip_repo, trip, "preferences_collected")

        return SavePreferencesResponse(
            travel_preferences=TravelPreferencesSchema.model_validate(saved),
            character=CharacterSchema.model_validate(character) if character else None,
            trip=TripSchema.model_validate(trip),
        )

    async def _everyone_submitted(self, room_id: str) -> bool:
        members = await self._member_repo.list_by_room(room_id)
        if not members:
            return False
        member_ids = [m["id"] for m in members]
        prefs = await self._profile_repo.list_preferences_by_member_ids(member_ids)
        submitted = {p["member_id"] for p in prefs if p.get("submitted_at")}
        return submitted.issuperset(member_ids)
