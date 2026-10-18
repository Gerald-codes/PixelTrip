"""Request and response schemas for the week-1 planning endpoints.

Preferences, voting, agent runs, and itinerary versions. Same conventions as
``app/schemas/room.py``: snake_case in Python, camelCase on the wire, shapes from the
"HTTP API" section of ``api-contracts.md``.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator

from app.schemas.room import (
    CharacterSchema,
    PartyRoomSchema,
    TravelPreferencesSchema,
    TripSchema,
    _Base,
)

_MEMBER_ID_EXAMPLE = "3a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d"

# --- Preferences ----------------------------------------------------------------------


class DateRange(_Base):
    """An inclusive range of dates the member can travel."""

    start: date = Field(examples=["2026-12-20"])
    end: date = Field(examples=["2026-12-27"])

    @model_validator(mode="after")
    def _end_not_before_start(self) -> DateRange:
        if self.end < self.start:
            raise ValueError("'end' must not be before 'start'")
        return self


class CharacterInput(_Base):
    """The member's pixel character. Replaces the saved character when sent."""

    appearance: dict[str, Any] = Field(
        default_factory=dict,
        max_length=50,
        description="Free-form choices from the character creator.",
        examples=[{"outfit": "explorer", "palette": "forest", "accessory": "backpack"}],
    )
    sprite_key: str | None = Field(
        default=None,
        max_length=100,
        description="Which sprite to draw; null means the default sprite.",
        examples=["explorer-01"],
    )

    @field_validator("sprite_key")
    @classmethod
    def _blank_sprite_to_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class SavePreferencesRequest(_Base):
    """A member's full set of travel preferences. Replaces whatever was saved before.

    ``character`` is optional: when sent it replaces the member's character; when
    omitted the character is left unchanged.
    """

    available_dates: list[DateRange] = Field(
        default_factory=list,
        max_length=20,
        description="Date ranges the member can travel; the AI uses the overlap across the party.",
        examples=[[{"start": "2026-12-20", "end": "2026-12-27"}]],
    )
    destinations: list[Any] = Field(default_factory=list, max_length=20, examples=[["Tokyo"]])
    travel_style: str | None = Field(default=None, max_length=50, examples=["relaxed"])
    budget: float | None = Field(default=None, ge=0, le=10_000_000, examples=[1500])
    interests: list[Any] = Field(
        default_factory=list, max_length=30, examples=[["food", "museums"]]
    )
    activities: list[Any] = Field(
        default_factory=list,
        max_length=30,
        examples=[
            [{"name": "hiking", "priority": "must_have"}, {"name": "spa", "priority": "optional"}]
        ],
    )
    hard_constraints: list[Any] = Field(
        default_factory=list, max_length=30, examples=[["no red-eye flights"]]
    )
    origin: str | None = Field(
        default=None,
        max_length=100,
        description="Departure city or IATA code, used for flight search.",
        examples=["SIN"],
    )

    character: CharacterInput | None = Field(
        default=None,
        description="Optional. Saves the member's pixel character in the same call.",
    )

    @field_validator("travel_style", "origin")
    @classmethod
    def _blank_to_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class SavePreferencesResponse(_Base):
    """The saved preferences and character, plus the trip (its status may have advanced)."""

    travel_preferences: TravelPreferencesSchema
    character: CharacterSchema | None = Field(
        default=None, description="The member's character; null only if none exists."
    )
    trip: TripSchema


# --- Voting ---------------------------------------------------------------------------


class CastVoteRequest(_Base):
    member_id: UUID = Field(examples=[_MEMBER_ID_EXAMPLE])
    option_id: str = Field(min_length=1, max_length=200, examples=["opt-tokyo"])


class CastVoteResponse(_Base):
    vote_session_id: str
    member_id: str
    option_id: str
    session_status: Literal["open", "closed"] = Field(
        description="'closed' when this vote was the last one needed and the session resolved."
    )
    tie_pending: bool = Field(
        default=False,
        description="True when this vote completed a tie: the session stays open and the "
        "room owner picks the winner with POST /votes/{id}/break-tie.",
    )


class CloseVoteRequest(_Base):
    member_id: UUID = Field(
        description="Must be the room owner's member id.", examples=[_MEMBER_ID_EXAMPLE]
    )


class TieInfo(_Base):
    tied_option_ids: list[str]
    tied_count: int


class VoteResolutionResponse(_Base):
    vote_session_id: str
    category: Literal["destination", "flight"]
    tie_pending: bool = Field(
        default=False,
        description="True when the vote tied and now waits for the owner's break-tie pick; "
        "winningOption and selectionId are then null.",
    )
    winning_option: dict[str, Any] | None = Field(
        default=None, description="The winning option exactly as it appeared in the vote session."
    )
    tie: TieInfo | None = Field(default=None, description="The tied options, when the vote tied.")
    selection_id: str | None = None


class BreakTieRequest(_Base):
    member_id: UUID = Field(
        description="Must be the room owner's member id.", examples=[_MEMBER_ID_EXAMPLE]
    )
    option_id: str = Field(
        min_length=1, max_length=200, description="One of the tied options.", examples=["tokyo"]
    )


# --- Agent runs -----------------------------------------------------------------------


class StartRunRequest(_Base):
    run_type: Literal["discovery", "logistics", "itinerary", "refinement", "tiebreak"] = Field(
        examples=["discovery"]
    )
    member_id: UUID = Field(examples=[_MEMBER_ID_EXAMPLE])
    idempotency_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=200,
        description="Send the same key on a retry to get the same run back instead of a new one.",
        examples=["discover-1"],
    )


# --- Itinerary versions ---------------------------------------------------------------


class ItineraryVersionSchema(_Base):
    id: str
    trip_id: str
    version: int
    source: Literal["build", "refine"]
    status: Literal["proposed", "approved", "rejected", "superseded"]
    itinerary: dict[str, Any]
    change_summary: str | None = None


# --- Feedback & decisions (REFINE) ----------------------------------------------------


class FeedbackTarget(_Base):
    """What the feedback is about: a whole day, or one activity (``itemId``).

    At least one of ``day`` / ``itemId`` is required, because the refinement AI revises
    the itinerary day by day and activity by activity. ``section`` is optional context.
    """

    day: int | None = Field(default=None, ge=1, le=60, examples=[2])
    item_id: str | None = Field(default=None, min_length=1, max_length=100, examples=["d2-i3"])
    section: str | None = Field(default=None, max_length=100, examples=["dinner"])

    @model_validator(mode="after")
    def _names_a_day_or_activity(self) -> FeedbackTarget:
        if self.day is None and self.item_id is None:
            raise ValueError("target must include a 'day' or an 'itemId'")
        return self


class SubmitFeedbackRequest(_Base):
    member_id: UUID = Field(examples=[_MEMBER_ID_EXAMPLE])
    itinerary_version_id: UUID = Field(
        description="The version being commented on; must be the one under review."
    )
    target: FeedbackTarget
    comment: str = Field(
        min_length=1, max_length=1000, examples=["Swap the museum for a street-food market."]
    )

    @field_validator("comment")
    @classmethod
    def _comment_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("comment must not be blank")
        return value


class FeedbackSchema(_Base):
    id: str
    trip_id: str
    itinerary_version_id: str
    member_id: str
    target: dict[str, Any]
    comment: str
    status: Literal["open", "addressed"]


class SubmitFeedbackResponse(_Base):
    feedback: FeedbackSchema
    trip: TripSchema


class ReviewItineraryRequest(_Base):
    member_id: UUID = Field(description="The reviewing room member.")
    decision: Literal["approve", "refine"] = Field(examples=["approve"])


class ReviewItineraryResponse(_Base):
    version: ItineraryVersionSchema
    trip: TripSchema
    all_ready: bool = Field(
        description="True when every room member has approved this itinerary version."
    )
    needs_refinement: bool = Field(
        default=False,
        description="True when everyone locked in and open feedback requires the refinement agent.",
    )


class VersionDecisionRequest(_Base):
    member_id: UUID = Field(
        description="Must be the room owner's member id.", examples=[_MEMBER_ID_EXAMPLE]
    )
    decision: Literal["approve", "reject"] = Field(examples=["approve"])


class VersionDecisionResponse(_Base):
    version: ItineraryVersionSchema
    trip: TripSchema


# --- Export (WRAP) ----------------------------------------------------------------------


class ExportMember(_Base):
    display_name: str
    role: Literal["owner", "member"]
    sprite_key: str | None = None


class TripExportResponse(_Base):
    """The final, shareable adventure."""

    trip: TripSchema
    room: PartyRoomSchema
    itinerary: ItineraryVersionSchema = Field(description="The approved version.")
    destination: dict[str, Any] | None = Field(
        default=None, description="The locked destination selection's details."
    )
    flight: dict[str, Any] | None = Field(
        default=None, description="The locked flight selection's details."
    )
    party: list[ExportMember]


# --- Chat -----------------------------------------------------------------------------


class SendMessageRequest(_Base):
    member_id: UUID = Field(examples=[_MEMBER_ID_EXAMPLE])
    text: str = Field(min_length=1, max_length=1000, examples=["Ramen first, then the onsen?"])

    @field_validator("text")
    @classmethod
    def _text_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("text must not be blank")
        return value


class MessageSchema(_Base):
    """A chat message (the envelope in "Chat Message Flow" of api-contracts.md)."""

    id: str
    room_id: str
    created_at: str
    sender_type: Literal["user", "ai"]
    sender_id: str | None = Field(description="Member id, or null for the AI guide.")
    kind: Literal["text", "recommendation", "vote", "summary"]
    content: dict[str, Any]


# --- Trip budget (sidebar) -----------------------------------------------------------


class DailyRange(_Base):
    """A budget level's spend per person per day in SGD, excluding flights."""

    low: int
    high: int | None = Field(description="None for the open-ended High level.")
    typical: int


class BudgetMember(_Base):
    member_id: UUID
    display_name: str
    amount: float | None = Field(description="Typed budget (whole trip, incl. flights).")
    level: Literal["low", "medium", "high"] | None


class BudgetEstimates(_Base):
    """What the trip is expected to cost per person so far. ``None`` = not known yet."""

    stay: float | None = Field(
        description="Destination's estimated daily cost x days (an AI estimate)."
    )
    flight: float | None = Field(description="The locked flight's price.")
    activities: float | None = Field(description="Sum of costed itinerary activities.")
    total: float | None = Field(description="Sum of the known parts.")


class TripBudgetResponse(_Base):
    """The party's budget for the sidebar card. All amounts are per person, in SGD."""

    currency: str = "SGD"
    days: int | None = Field(description="Trip length: the flight dates, else shared dates.")
    is_hard_limit: bool = Field(description="True when at least one member typed an amount.")
    limit: float | None = Field(description="The lowest typed amount (whole trip, incl. flights).")
    limit_set_by: str | None
    level: Literal["low", "medium", "high"] | None = Field(
        description="The lowest budget level any member picked."
    )
    level_count: int
    daily_range: DailyRange | None
    level_estimate: float | None = Field(
        description="Typical spend for the trip at the level (excluding flights); a guide."
    )
    estimates: BudgetEstimates
    remaining: float | None = Field(description="limit - estimates.total, when both known.")
    is_over_budget: bool
    members: list[BudgetMember]


# --- Trip dates (sidebar card + change dialog) ---------------------------------------


class TripDatesResponse(_Base):
    """The trip's own length and dates, and what the leader may change them to."""

    destination: str | None = Field(description="The chosen destination, if any.")
    trip_days: int | None
    trip_start: date | None
    trip_end: date | None
    why_this_long: str | None
    windows: list[DateRange] = Field(
        description="When the whole party is free; the trip must fit inside one of these."
    )
    min_days: int
    max_days: int
    daily_cost_sgd: float | None = Field(
        description="The destination's estimated daily cost, for a stay-cost preview."
    )
    budget_limit: float | None = Field(description="The party's hard budget limit, if any.")
    can_change: bool
    locked_reason: str | None = Field(
        description="Why the dates cannot change right now, when can_change is false."
    )


class ChangeTripDatesRequest(_Base):
    member_id: UUID = Field(description="Must be the room owner (the party leader).")
    days: int = Field(ge=1, le=30, examples=[4])
    start: date = Field(examples=["2026-10-16"])
