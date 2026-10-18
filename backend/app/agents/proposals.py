"""Pydantic models for the four Proposal kinds.

These models are the single definition of proposal shape, shared by the producing
node and the write path (Requirement 11.10). Every model forbids unknown fields,
so a generation that invents a field fails validation rather than silently
carrying it into the database (Requirement 11.1).

Shapes mirror the ``api-contracts.md`` sections they implement: "Recommendation
Response Structure", "Itinerary Format", and "Feedback & Refinement".

**On the frontend gap.** ``ItineraryVersionModel`` requires ``id`` and ``status``,
and ``ItineraryItemModel`` requires ``id``, even though the current frontend
TypeScript types omit all three. That is deliberate (Requirement 9.16, 10.16):
the agent's output contract is set by the database schema and
``api-contracts.md``, not narrowed by an out-of-sync consumer. The mismatch is
tracked as Frontend Reconciliation entries 1 and 2.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class _StrictModel(BaseModel):
    """Base for every proposal model: unknown fields are an error.

    ``extra="forbid"`` is inherited by every nested model below, which is what
    makes Requirement 11.1 hold recursively rather than only at the top level.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# ---------------------------------------------------------------------------
# Recommendations (DISCOVER and LOGISTICS)
# ---------------------------------------------------------------------------


class RecommendationItem(_StrictModel):
    """One comparable option inside a recommendation set."""

    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    description: str = Field(default="")
    image_url: str | None = None
    sprite_key: str | None = None
    #: Comparison details rendered side by side. For flights this carries the
    #: factual fields (price, carrier, duration, stops, times); for destinations,
    #: things like region and budget band.
    meta: dict[str, Any] = Field(default_factory=dict)


class RecommendationProposalBase(_StrictModel):
    """Shared shape for a recommendation set plus its vote question.

    Public rather than underscore-prefixed because the business guardrail needs it
    for an ``isinstance`` check across module boundaries.
    """

    title: str = Field(min_length=1)
    items: list[RecommendationItem]
    prompt: str | None = None
    #: The question used for the paired vote session.
    question: str = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def _validate_items(self) -> RecommendationProposalBase:
        """Enforce the 3-5 option count and unique item ids.

        The bound comes from Requirement 7.6 / 8.4: fewer than three is not a
        comparison, and more than five does not fit the comparison UI. Unique ids
        matter because the vote session's options are matched to these ids
        one-to-one.
        """
        if not 3 <= len(self.items) <= 5:
            raise ValueError(f"a recommendation must carry 3 to 5 items, got {len(self.items)}")
        ids = [item.id for item in self.items]
        if len(set(ids)) != len(ids):
            raise ValueError("recommendation item ids must be unique")
        return self

    def option_ids(self) -> list[str]:
        """Return the item ids, in presentation order."""
        return [item.id for item in self.items]


class DestinationRecommendationProposal(RecommendationProposalBase):
    """A destination option set for the DISCOVER stage."""

    category: Literal["destination"] = "destination"


class FlightRecommendationProposal(RecommendationProposalBase):
    """A flight option set for the LOGISTICS stage.

    Ranking is the node's job, not the model's: items arrive already ordered by
    ``(price, duration, stops)`` ascending per Requirement 8.8.
    """

    category: Literal["flight"] = "flight"


# ---------------------------------------------------------------------------
# Itinerary (BUILD and REFINE)
# ---------------------------------------------------------------------------


class ItineraryItemModel(_StrictModel):
    """One ordered activity within a day.

    ``id`` is required and stable across versions so ``feedback.target.itemId``
    resolves to exactly one item (Requirement 9.9).
    """

    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    time: str | None = None
    description: str | None = None
    location: str | None = None
    #: Identifier of the places-tool entry this location came from, when the item
    #: references a real place. The factual guardrail matches on this.
    location_id: str | None = None
    tags: list[str] = Field(default_factory=list)
    #: Costed value used by the budget check. ``None`` contributes 0.
    cost: float | None = Field(default=None, ge=0)


class ItineraryDayModel(_StrictModel):
    """A day plan of ordered activities."""

    day: int = Field(ge=1)
    date: str | None = None
    items: list[ItineraryItemModel]

    @field_validator("items")
    @classmethod
    def _validate_item_count(cls, items: list[ItineraryItemModel]) -> list[ItineraryItemModel]:
        """Requirement 9.3 bounds a day at 1-10 items."""
        if not 1 <= len(items) <= 10:
            raise ValueError(f"a day must carry 1 to 10 items, got {len(items)}")
        return items


class MapPointModel(_StrictModel):
    """A point rendered on the travel map."""

    label: str = Field(min_length=1)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class DestinationRef(_StrictModel):
    """The trip's destination, as carried on the itinerary object."""

    name: str = Field(min_length=1)
    country: str | None = None


class DateRange(_StrictModel):
    """An inclusive start/end date pair."""

    start: str
    end: str


class ItineraryModel(_StrictModel):
    """The full trip plan.

    The journal, quest log, timeline, and map are all derived from this one
    object, per ``api-contracts.md``.
    """

    trip_id: str
    room_id: str
    title: str = Field(min_length=1)
    summary: str = Field(default="")
    destination: DestinationRef
    dates: DateRange | None = None
    days: list[ItineraryDayModel]
    map: list[MapPointModel] = Field(default_factory=list)

    @field_validator("days")
    @classmethod
    def _validate_days(cls, days: list[ItineraryDayModel]) -> list[ItineraryDayModel]:
        """Require a non-empty, gapless day sequence starting at 1.

        Requirement 9.2: ``day`` numbers increment by one with no gaps, so the
        quest log renders as a continuous journey rather than a sparse list.
        """
        if not days:
            raise ValueError("an itinerary must carry at least one day")
        expected = list(range(1, len(days) + 1))
        actual = [d.day for d in days]
        if actual != expected:
            raise ValueError(
                f"day numbers must start at 1 and increment with no gaps, got {actual}"
            )
        return days

    @model_validator(mode="after")
    def _validate_unique_item_ids(self) -> ItineraryModel:
        """Require item ids unique across every day (Requirement 9.9)."""
        ids = [item.id for day in self.days for item in day.items]
        if len(set(ids)) != len(ids):
            duplicates = sorted({i for i in ids if ids.count(i) > 1})
            raise ValueError(f"itinerary item ids must be unique; duplicated: {duplicates}")
        return self

    def all_item_ids(self) -> list[str]:
        """Return every item id across all days, in order."""
        return [item.id for day in self.days for item in day.items]

    def day_numbers(self) -> list[int]:
        """Return every day number, in order."""
        return [day.day for day in self.days]

    def total_cost(self) -> float:
        """Return the summed costed value; an item without a cost contributes 0.

        This is the value the budget check compares against the ceiling
        (Requirement 12.2).
        """
        return sum(item.cost or 0.0 for day in self.days for item in day.items)


class ItineraryProposal(_StrictModel):
    """A BUILD-stage itinerary plus the scope it would change.

    ``affected_scope`` is agent-internal bookkeeping used by the lost-race
    re-evaluation; it is stripped by :meth:`to_persistable` before the itinerary
    reaches the database.
    """

    itinerary: ItineraryModel
    #: Day numbers and item ids this proposal changes relative to its base
    #: version. Empty for a first build, which changes nothing.
    affected_scope: dict[str, Any] = Field(default_factory=dict)

    def to_persistable(self) -> dict[str, Any]:
        """Return the itinerary payload to store, without agent-internal fields."""
        return self.itinerary.model_dump(mode="json")


class RefinementProposal(_StrictModel):
    """A REFINE-stage itinerary revision.

    Carries the change summary and the bookkeeping the negotiation node needs:
    which feedback rows this revision addresses, and which conflicts it resolved.
    """

    itinerary: ItineraryModel
    change_summary: str = Field(min_length=1, max_length=500)
    #: Feedback row ids this revision addresses. Rows left out stay ``open``
    #: (Requirement 10.7).
    addressed_feedback_ids: list[str] = Field(default_factory=list)
    #: Feedback rows that could not be resolved, with the reason.
    unresolved_feedback_ids: list[str] = Field(default_factory=list)
    #: Day numbers and item ids this revision changes.
    affected_scope: dict[str, Any] = Field(default_factory=dict)
    #: Conflicts detected between incompatible feedback rows
    #: (Requirement 10.8).
    conflicts: list[dict[str, Any]] = Field(default_factory=list)

    def to_persistable(self) -> dict[str, Any]:
        """Return the itinerary payload to store, without agent-internal fields."""
        return self.itinerary.model_dump(mode="json")


# ---------------------------------------------------------------------------
# Itinerary version envelope
# ---------------------------------------------------------------------------


class ItineraryVersionModel(_StrictModel):
    """A persisted itinerary version, as emitted to clients.

    ``id`` and ``status`` are required. The current frontend type omits both and
    substitutes ``isCurrent``; the agent layer still emits the schema-correct
    shape (Requirement 9.16, 10.16).
    """

    id: str = Field(min_length=1)
    version: int = Field(ge=1)
    source: Literal["build", "refine"]
    status: Literal["proposed", "approved", "rejected", "superseded"]
    itinerary: ItineraryModel
    change_summary: str | None = None

    @model_validator(mode="after")
    def _validate_build_source_invariant(self) -> ItineraryVersionModel:
        """Mirror the DB ``CHECK ((version = 1) = (source = 'build'))``.

        Enforced in the model too, so an invalid pairing fails before the write
        rather than as a constraint violation (Requirement 5.7).
        """
        if (self.version == 1) != (self.source == "build"):
            raise ValueError(
                "version 1 must have source 'build', and any later version "
                f"must have source 'refine'; got version={self.version} "
                f"source={self.source!r}"
            )
        return self


# ---------------------------------------------------------------------------
# Kind registry
# ---------------------------------------------------------------------------

#: The four proposal kinds, keyed by the name the guardrail pipeline uses.
PROPOSAL_MODELS: dict[str, type[_StrictModel]] = {
    "destination_recommendation": DestinationRecommendationProposal,
    "flight_recommendation": FlightRecommendationProposal,
    "itinerary": ItineraryProposal,
    "refinement": RefinementProposal,
}

#: Which proposal kind each run type produces.
PROPOSAL_KIND_BY_RUN_TYPE: dict[str, str] = {
    "discovery": "destination_recommendation",
    "logistics": "flight_recommendation",
    "itinerary": "itinerary",
    "refinement": "refinement",
}
