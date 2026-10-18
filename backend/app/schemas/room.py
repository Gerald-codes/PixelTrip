"""Request and response schemas for the room endpoints.

Python fields are snake_case; JSON uses camelCase (``alias_generator=to_camel``) to match
``api-contracts.md``. ``from_attributes`` + ``populate_by_name`` let the service build
responses straight from the snake_case dicts returned by the repositories.
"""

from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

_ROOM_ID = "6f1c2b8e-1a2b-4c3d-8e9f-0a1b2c3d4e5f"
_GUEST_ID = "0c4d2e1f-9a8b-4c7d-8e6f-5a4b3c2d1e0f"
_MEMBER_ID = "3a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d"


class _Base(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


def _no_whitespace_only(value: str) -> str:
    if not value.strip():
        raise ValueError("Field must not be empty or whitespace-only")
    return value


_non_empty_str = Annotated[str, AfterValidator(_no_whitespace_only)]


# --- Response building blocks ---------------------------------------------------------


class GuestSchema(_Base):
    id: str = Field(examples=[_GUEST_ID])
    display_name: str = Field(min_length=1, max_length=50, examples=["Gerald"])
    avatar_url: str | None = Field(default=None, examples=[None])


class PartyRoomSchema(_Base):
    id: str = Field(examples=[_ROOM_ID])
    room_code: str = Field(examples=["ABC123"])
    name: str = Field(max_length=100, examples=["Adventure Club Trip 2025"])
    status: Literal["active", "finalised", "cancelled"] = Field(examples=["active"])
    planning_stage: Literal["setup", "discover", "logistics", "build", "refine", "wrap"] = Field(
        examples=["setup"]
    )
    demo_scenario: Literal["vietnam-five-days"] | None = None
    demo_start: str | None = None


class RoomMemberSchema(_Base):
    id: str = Field(examples=[_MEMBER_ID])
    room_id: str = Field(examples=[_ROOM_ID])
    guest_id: str = Field(examples=[_GUEST_ID])
    display_name: str = Field(min_length=1, max_length=50, examples=["Gerald"])
    role: Literal["owner", "member"] = Field(examples=["owner"])
    stage_ready: bool = Field(
        default=False,
        description="True once the member has done their part in the current stage.",
        examples=[False],
    )


class CharacterSchema(_Base):
    id: str = Field(examples=["9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a"])
    member_id: str = Field(examples=[_MEMBER_ID])
    appearance: dict = Field(examples=[{}])
    sprite_key: str | None = Field(default=None, examples=[None])


class TravelPreferencesSchema(_Base):
    id: str = Field(examples=["2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e"])
    member_id: str = Field(examples=[_MEMBER_ID])
    available_dates: list = Field(examples=[[{"start": "2026-12-20", "end": "2026-12-27"}]])
    destinations: list = Field(examples=[["Tokyo"]])
    travel_style: str | None = Field(default=None, examples=["relaxed"])
    budget: float | None = Field(default=None, ge=0, examples=[1500.0])
    interests: list = Field(examples=[["food", "museums"]])
    activities: list = Field(examples=[["hiking"]])
    hard_constraints: list = Field(examples=[["no red-eye flights"]])
    origin: str | None = Field(default=None, examples=["SIN"])
    submitted_at: str | None = Field(
        default=None,
        description="When the member last saved preferences; null until they first do.",
        examples=["2026-10-04T09:30:00+00:00"],
    )


class TripSchema(_Base):
    id: str = Field(examples=["8e7d6c5b-4a39-4281-9f0e-1d2c3b4a5f6e"])
    room_id: str = Field(examples=[_ROOM_ID])
    title: str = Field(examples=["Adventure Club Trip 2025"])
    summary: str | None = Field(default=None, examples=[None])
    status: Literal[
        "trip_created",
        "group_formed",
        "preferences_collected",
        "destination_selected",
        "flight_selected",
        "itinerary_generated",
        "feedback_collected",
        "refinement_completed",
        "trip_approved",
        "trip_exported",
    ] = Field(examples=["trip_created"])


# --- Requests -------------------------------------------------------------------------


class CreateRoomRequest(_Base):
    name: _non_empty_str = Field(
        min_length=1, max_length=100, examples=["Adventure Club Trip 2025"]
    )
    owner_display_name: _non_empty_str = Field(min_length=1, max_length=50, examples=["Gerald"])


class JoinRoomRequest(_Base):
    display_name: _non_empty_str = Field(min_length=1, max_length=50, examples=["Priya"])


# --- Responses ------------------------------------------------------------------------


class _RoomPayload(_Base):
    room: PartyRoomSchema
    member: RoomMemberSchema
    guest: GuestSchema
    character: CharacterSchema
    travel_preferences: TravelPreferencesSchema
    trip: TripSchema


class CreateRoomResponse(_RoomPayload):
    """Everything the frontend needs after creating a room as its owner."""


class JoinRoomResponse(_RoomPayload):
    """The joined or resumed member and their records.

    On the resume path a member's character or preferences may be missing; they are
    returned as ``null`` rather than recreated (Requirement 11.6).
    """

    character: CharacterSchema | None = None
    travel_preferences: TravelPreferencesSchema | None = None
