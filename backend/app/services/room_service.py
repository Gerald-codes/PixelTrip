"""Room service: room code generation and create/join orchestration.

Talks only to repositories, never to Supabase directly.
"""

from __future__ import annotations

import secrets
import string

from app.demo import is_demo, normalized_name
from app.exceptions import (
    InvalidDisplayNameError,
    RepositoryError,
    RoomCodeExhaustedError,
    RoomNotFoundError,
    ValidationError,
)
from app.repositories.member_repository import MemberRepository
from app.repositories.profile_repository import ProfileRepository
from app.repositories.room_repository import RoomRepository
from app.repositories.trip_repository import TripRepository
from app.schemas.room import (
    CharacterSchema,
    CreateRoomRequest,
    CreateRoomResponse,
    GuestSchema,
    JoinRoomRequest,
    JoinRoomResponse,
    PartyRoomSchema,
    RoomMemberSchema,
    TravelPreferencesSchema,
    TripSchema,
)
from app.services.trip_progress import advance_trip, require_room_trip

ROOM_CODE_ALPHABET = string.ascii_uppercase + string.digits
ROOM_CODE_ATTEMPTS = 10

#: A party counts as formed once this many members are in the room (spec 03,
#: Assumptions 14).
GROUP_FORMED_MEMBER_COUNT = 2


def generate_room_code(length: int = 6) -> str:
    """Return a random room code of uppercase letters and digits (``^[A-Z0-9]{4,12}$``)."""
    return "".join(secrets.choice(ROOM_CODE_ALPHABET) for _ in range(length))


class RoomService:
    """Creates rooms and joins/resumes room members."""

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

    async def create_room(self, request: CreateRoomRequest) -> CreateRoomResponse:
        """Create a room with the caller as owner, in one atomic database call."""
        if normalized_name(request.owner_display_name) == "demobob":
            raise ValidationError("DemoAlice creates the demo room; DemoBob joins with its code.")
        room_code = await self._find_unused_room_code()
        result = await self._room_repo.create_room_with_owner(
            name=request.name,
            room_code=room_code,
            owner_display_name=request.owner_display_name,
            appearance={},
        )
        if normalized_name(request.owner_display_name) == "demoalice" and not is_demo(
            result["room"]
        ):
            raise RepositoryError(
                "Apply the prepared-demo database migration before creating demo rooms."
            )
        return CreateRoomResponse(
            room=PartyRoomSchema.model_validate(result["room"]),
            member=RoomMemberSchema.model_validate(result["member"]),
            guest=GuestSchema.model_validate(result["guest"]),
            character=CharacterSchema.model_validate(result["character"]),
            travel_preferences=TravelPreferencesSchema.model_validate(result["travel_preferences"]),
            trip=TripSchema.model_validate(result["trip"]),
        )

    async def join_room(self, room_code: str, request: JoinRoomRequest) -> JoinRoomResponse:
        """Resume the member with this name (any casing) or create a new member."""
        room = await self._room_repo.get_room_by_code(room_code)
        if room is None:
            raise RoomNotFoundError(f"Room '{room_code}' not found.")

        # Passed as received; MemberRepository applies the case-insensitive rule.
        member = await self._member_repo.get_member_by_display_name(
            room_id=room["id"], display_name=request.display_name
        )
        trip = await require_room_trip(self._trip_repo, room["id"])
        if member is not None:
            return await self._resume_member(room, member, trip)

        if is_demo(room) and normalized_name(request.display_name) != "demobob":
            raise ValidationError("Only DemoBob can join this prepared demo room.")

        if not request.display_name.strip():
            raise InvalidDisplayNameError("Display name must not be empty or whitespace-only.")

        # Not transactional (accepted MVP limitation; see design.md).
        guest = await self._profile_repo.create_guest(display_name=request.display_name)
        member = await self._member_repo.create_member(
            room_id=room["id"],
            guest_id=guest["id"],
            display_name=request.display_name,
            role="member",
        )
        character = await self._profile_repo.create_character(member_id=member["id"], appearance={})
        prefs = await self._profile_repo.create_preferences(member_id=member["id"])

        if len(await self._member_repo.list_by_room(room["id"])) >= GROUP_FORMED_MEMBER_COUNT:
            trip = await advance_trip(self._trip_repo, trip, "group_formed")

        return JoinRoomResponse(
            room=PartyRoomSchema.model_validate(room),
            member=RoomMemberSchema.model_validate(member),
            guest=GuestSchema.model_validate(guest),
            character=CharacterSchema.model_validate(character),
            travel_preferences=TravelPreferencesSchema.model_validate(prefs),
            trip=TripSchema.model_validate(trip),
        )

    async def _resume_member(self, room: dict, member: dict, trip: dict) -> JoinRoomResponse:
        """Return the existing member's records without creating anything."""
        guest = await self._profile_repo.get_guest_by_id(member["guest_id"])
        character = await self._profile_repo.get_character_by_member_id(member["id"])
        prefs = await self._profile_repo.get_preferences_by_member_id(member["id"])
        return JoinRoomResponse(
            room=PartyRoomSchema.model_validate(room),
            member=RoomMemberSchema.model_validate(member),
            guest=GuestSchema.model_validate(guest),
            character=CharacterSchema.model_validate(character) if character else None,
            travel_preferences=TravelPreferencesSchema.model_validate(prefs) if prefs else None,
            trip=TripSchema.model_validate(trip),
        )

    async def _find_unused_room_code(self) -> str:
        for _ in range(ROOM_CODE_ATTEMPTS):
            candidate = generate_room_code()
            if await self._room_repo.get_room_by_code(candidate) is None:
                return candidate
        raise RoomCodeExhaustedError("Could not generate a unique room code.")
