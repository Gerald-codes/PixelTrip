"""Itinerary persistence and the Itinerary_Node (BUILD stage).

Two things live here:

1. :func:`persist_itinerary_version` — the optimistic-lock insert loop shared by
   this node and, later, Negotiation_Node. Appending a version can race another
   run inserting the same ``(trip_id, version)`` pair; this function is the one
   place that race is handled, so a specialist node never has to re-derive the
   retry/escalate policy.

2. :func:`itinerary_node` — the BUILD-stage specialist. It loads both locked
   selections and the party's preferences, derives a day count, generates a
   simple day-by-day itinerary, and persists it as the trip's first version.

**Why "evaluate applicability" is trivial here but not forever.** A lost race
during a *build* (``version == 1``) always means another run already built the
trip's first version — there is no ``Affected_Scope`` to re-check, because a
first build changes nothing relative to a prior version; there is no prior
version. So :func:`persist_itinerary_version`'s ``is_still_applicable`` callback
is one line here (``return False``: the attempt is never still applicable once
beaten). Negotiation_Node, which generates version 2+ from a real
``Affected_Scope``, is where that callback does real work — this function takes
the callback as a parameter precisely so that case can plug in without a second
copy of the retry loop.

**On LLM-drafted days.** The model drafts each day's activities; everything
around that is deterministic. Day count, dates, ids, ordering and the
1-10-items-per-day bound come from code, never from the model, and every draft
goes back through :class:`~app.agents.proposals.ItineraryProposal`'s strict
validation before anything is persisted. Items that break a party hard
constraint are dropped. The LLM is an enhancement, not a dependency: with no
client, no API key, or a failed call, the affected days fall back to a single
well-formed placeholder activity each, so BUILD still completes and the
itinerary stays structurally valid and immediately refinable.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import TYPE_CHECKING, Any

from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel, ConfigDict, Field

from app.agents.errors import (
    DestinationNotSelectedError,
    FlightNotSelectedError,
    InvalidTripDurationError,
    ItineraryPersistenceError,
    LLMGenerationError,
    PreferencesNotCollectedError,
    RepeatedVersionContentionError,
)
from app.agents.group_profile import compute_group_profile, format_party_for_prompt
from app.agents.llm import UNTRUSTED_INPUT_GUARD, clip_for_prompt, clip_text
from app.agents.messages import SummaryMessageContent, emit_npc_message
from app.agents.nodes.discovery import _violates_hard_constraints
from app.agents.progress import report_phase
from app.agents.proposals import (
    DateRange,
    DestinationRef,
    ItineraryDayModel,
    ItineraryItemModel,
    ItineraryModel,
    ItineraryProposal,
)
from app.core.budget import party_budget
from app.core.trip_dates import selected_trip
from app.exceptions import RepositoryError
from app.repositories.itinerary_version_repository import UniqueVersionViolation
from app.services.trip_status_service import advance_trip_status

if TYPE_CHECKING:  # pragma: no cover - typing only
    from collections.abc import Awaitable, Callable

    from app.agents.state import AgentState, RepositoryBundle

logger = logging.getLogger(__name__)

#: Requirement 5.11-5.12: at most 2 lost-race retries, failing on a 3rd collision.
MAX_LOST_RACE_CYCLES = 2

#: Requirement 9.3: 1-10 items per day.
MIN_ITEMS_PER_DAY = 1
MAX_ITEMS_PER_DAY = 10

#: Requirement 9.5: a derived trip duration outside this range fails the run.
MIN_TRIP_DAYS = 1
MAX_TRIP_DAYS = 30

#: Days drafted per model call. Bounds one response's size (a 30-day trip is
#: three calls, not one oversized one) and keeps the call count low enough for
#: free-tier rate limits.
LLM_DAYS_PER_CALL = 10

#: Per-field ceilings applied to model text before it reaches the proposal.
MAX_TITLE_CHARS = 120
MAX_DESCRIPTION_CHARS = 500
MAX_TIME_CHARS = 40
MAX_LOCATION_CHARS = 120

STAGE = "BUILD"


async def persist_itinerary_version(
    state: AgentState,
    repos: RepositoryBundle,
    itinerary_dict: dict[str, Any],
    source: str,
    change_summary: str | None,
    is_still_applicable: Callable[[dict[str, Any]], Awaitable[bool]],
) -> tuple[dict[str, Any] | None, AgentState]:
    """Insert one itinerary version, retrying through at most 2 lost races.

    Args:
        state: The run's state. ``state.base_version`` is read for the
            candidate version number and updated on each lost race
            (Requirement 5.5).
        repos: The repository bundle.
        itinerary_dict: The itinerary payload to persist (already stripped of
            any agent-internal bookkeeping — see
            :meth:`~app.agents.proposals.ItineraryProposal.to_persistable`).
        source: The caller's intended source for its *first* attempt —
            ``"build"`` for a first version, ``"refine"`` for every later one.
            A retry after a lost race always re-derives the actual source from
            the new candidate version instead of reusing this value: a build
            whose first attempt collided is, by definition, no longer trying
            to write version 1, so continuing to call it ``"build"`` would
            violate ``CHECK ((version = 1) = (source = 'build'))`` on retry
            (Requirement 5.7). This parameter exists so a mismatched intent is
            still caught on the very first attempt, before any lost race could
            paper over a caller bug.
        change_summary: 1-500 characters for a refine version, or ``None`` for
            a build (Requirement 9.7's "no changeSummary"). A caller retrying
            a build after a lost race has no change summary to offer either,
            since nothing in a first build's content is scoped to an
            ``Affected_Scope`` — this is fine because a build's own
            ``is_still_applicable`` always returns ``False`` (see module
            docstring), so a build is never actually retried with a derived
            ``"refine"`` source in practice; only Negotiation_Node's own calls,
            which already pass a real summary, retry past version 1.
        is_still_applicable: Called with the re-fetched highest-version row
            after a lost race. ``True`` retries the insert at the new
            ``base_version + 1``; ``False`` ends the attempt with nothing
            written (Requirement 5.6).

    Returns:
        ``(row, state)`` on a successful insert, or ``(None, state)`` when a
        lost race made the proposal no longer applicable
        (Requirement 5.6) — the caller must emit exactly one
        ``kind='text'`` message for that outcome and persist nothing further.

    Raises:
        ValueError: If ``source`` does not match the first attempt's candidate
            version — a caller bug, not a race.
        RepeatedVersionContentionError: After a 3rd lost race
            (Requirement 5.12).
        ItineraryPersistenceError: If the insert fails for any reason other
            than ``UNIQUE(trip_id, version)`` (Requirement 5.13). Never
            retried.
    """
    lost_race_count = 0

    while lost_race_count <= MAX_LOST_RACE_CYCLES:
        candidate_version = state.base_version + 1
        candidate_source = "build" if candidate_version == 1 else "refine"
        if lost_race_count == 0 and source != candidate_source:
            # A caller bug, not a race: Requirement 5.7's CHECK constraint pairs
            # version 1 with 'build' and every later version with 'refine'.
            raise ValueError(
                f"source {source!r} is invalid for version {candidate_version}; "
                f"expected {candidate_source!r}"
            )

        try:
            row = await repos.itinerary_version_repo.insert_version(
                trip_id=state.trip_id,
                version=candidate_version,
                source=candidate_source,
                itinerary=itinerary_dict,
                change_summary=change_summary,
            )
        except UniqueVersionViolation:
            lost_race_count += 1
            latest = await repos.itinerary_version_repo.get_latest(state.trip_id)
            if latest is None:  # pragma: no cover - defensive: a 23505 implies a row exists
                raise
            state = state.with_base_version(int(latest["version"]))

            if lost_race_count > MAX_LOST_RACE_CYCLES:
                break
            if not await is_still_applicable(latest):
                # Requirement 5.6: completed, nothing written, one message.
                return None, state
            continue
        except RepositoryError as exc:
            # Requirement 5.13: anything other than the version UNIQUE
            # violation is a fatal, non-retried failure.
            raise ItineraryPersistenceError("the version could not be inserted") from exc

        # Success: supersede older proposed rows, never touch approved/rejected
        # (Requirement 5.9).
        await repos.itinerary_version_repo.supersede_lower_versions(
            state.trip_id, below_version=row["version"]
        )
        return row, state

    # Requirement 5.12: a 3rd lost race within the same run.
    raise RepeatedVersionContentionError(lost_race_count)


# ---------------------------------------------------------------------------
# Day-count derivation (Requirement 9.3-9.4)
# ---------------------------------------------------------------------------


def _parse_date(value: Any) -> date | None:
    """Parse an ISO date (or date-time) string, returning ``None`` if unusable."""
    if isinstance(value, date):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().split("T", 1)[0]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _derive_day_count(
    flight_selection: dict[str, Any],
    group_profile: dict[str, Any],
    destination_selection: dict[str, Any] | None = None,
) -> int:
    """Derive the itinerary's day count (Requirement 9.3-9.5).

    Prefers the locked flight's outbound/return dates; then the chosen
    destination's trip plan (its own length and dates); and only then the
    availability overlap's first range. Raises before any write when the result
    falls outside 1-30 days.
    """
    flight_data = flight_selection.get("data") or {}
    outbound = _parse_date(flight_data.get("depart_at") or flight_data.get("departAt"))
    returning = _parse_date(flight_data.get("return_at") or flight_data.get("returnAt"))

    if outbound is None or returning is None:
        trip = selected_trip((destination_selection or {}).get("data"))
        if trip is not None:
            outbound, returning = _parse_date(trip.start), _parse_date(trip.end)

    if outbound is None or returning is None:
        overlap = group_profile.get("availability_overlap") or []
        if overlap:
            outbound = _parse_date(overlap[0]["start"])
            returning = _parse_date(overlap[0]["end"])

    if outbound is None or returning is None:
        raise InvalidTripDurationError(0)

    day_count = (returning - outbound).days + 1
    if not MIN_TRIP_DAYS <= day_count <= MAX_TRIP_DAYS:
        raise InvalidTripDurationError(day_count)
    return day_count


# ---------------------------------------------------------------------------
# Itinerary generation
# ---------------------------------------------------------------------------


def _generate_items(day_index: int) -> list[ItineraryItemModel]:
    """Return the deterministic placeholder for one day.

    Used for any day the LLM did not (or could not) draft. A single well-formed
    activity keeps the itinerary structurally complete; ordering
    (Requirement 9.6) and unique ids (Requirement 9.9) hold regardless of what
    fills each slot.
    """
    return [
        ItineraryItemModel(
            id=f"d{day_index}-i1",
            title="Free time to explore",
            description="The guide has not yet filled in this day's plan.",
        )
    ]


class _ItemDraft(BaseModel):
    """One activity as drafted by the model. Lenient on length; trimmed in code."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, description="Short name of the activity.")
    time: str | None = Field(default=None, description="Start time, 24-hour HH:MM.")
    description: str = Field(default="", description="One or two sentences.")
    location: str | None = Field(default=None, description="Neighbourhood or venue name.")
    estimated_cost_sgd: float | None = Field(
        default=None,
        description="Rough cost per person in SGD for this activity (tickets, tours, "
        "entry, a special meal); 0 if free.",
    )


class _DayDraft(BaseModel):
    """One day's drafted activities, in chronological order."""

    model_config = ConfigDict(extra="forbid")

    day: int = Field(ge=1)
    items: list[_ItemDraft] = Field(min_length=1)


class _ItineraryDraft(BaseModel):
    """The model's answer for one chunk of days."""

    model_config = ConfigDict(extra="forbid")

    days: list[_DayDraft] = Field(min_length=1)


def _items_from_draft(
    day_number: int, draft: _DayDraft, hard_constraints: list[str]
) -> list[ItineraryItemModel]:
    """Turn one drafted day into validated items, or ``[]`` if nothing usable survives.

    Ids are assigned here (``d{day}-i{n}``), never taken from the model, so they
    are unique and stable by construction (Requirement 9.9). An item that names
    something a party hard constraint forbids is dropped.
    """
    items: list[ItineraryItemModel] = []
    for entry in draft.items:
        title = clip_text(entry.title, MAX_TITLE_CHARS)
        if title is None:
            continue
        description = clip_text(entry.description, MAX_DESCRIPTION_CHARS)
        location = clip_text(entry.location, MAX_LOCATION_CHARS)
        searchable = " ".join(filter(None, (title, description, location)))
        if _violates_hard_constraints(searchable, hard_constraints) is not None:
            continue
        items.append(
            ItineraryItemModel(
                id=f"d{day_number}-i{len(items) + 1}",
                title=title,
                time=clip_text(entry.time, MAX_TIME_CHARS),
                description=description,
                location=location,
                cost=_activity_cost(entry.estimated_cost_sgd),
            )
        )
        if len(items) >= MAX_ITEMS_PER_DAY:
            break
    return items


#: An activity estimate above this (SGD per person) is treated as junk, not a cost.
MAX_ACTIVITY_COST = 5_000


def _activity_cost(value: float | None) -> float | None:
    if value is None or not 0 <= value <= MAX_ACTIVITY_COST:
        return None
    return round(float(value), 2)


def _activities_ceiling(
    context: dict[str, Any],
    day_count: int,
    destination: dict[str, Any] | None,
    flight: dict[str, Any] | None,
) -> float | None:
    """What the hard limit leaves per person for paid activities (``None`` = no check).

    The lowest typed budget minus the flight price and the destination's estimated
    stay. No limit, or nothing left (the party is already over), means no check: the
    itinerary cannot fix an overspend that the flight and stay already made.
    """
    budget = party_budget(
        context["members"], context["preferences"], context["characters"], day_count
    )
    if budget.limit is None:
        return None
    daily = (destination or {}).get("estimatedDailyCostSgd")
    stay = budget.stay_estimate(daily if isinstance(daily, int | float) else None) or 0.0
    price = (flight or {}).get("price")
    left = budget.limit - stay - (float(price) if isinstance(price, int | float) else 0.0)
    return round(left, 2) if left > 0 else None


def _day_label(day_number: int, day_count: int, day_date: date) -> str:
    """Describe one requested day for the prompt."""
    role = ""
    if day_count > 1 and day_number == 1:
        role = " (arrival day: keep it light)"
    elif day_count > 1 and day_number == day_count:
        role = " (departure day: keep it short)"
    return f"Day {day_number}: {day_date.isoformat()}{role}"


async def _draft_days_with_llm(
    llm: Any,
    *,
    destination: str,
    outbound: date,
    day_count: int,
    flight_data: dict[str, Any] | None = None,
    group_profile: dict[str, Any],
) -> dict[int, list[ItineraryItemModel]]:
    """Ask the LLM to draft the days, a chunk at a time.

    Returns whatever it managed to draft, keyed by day number. Never raises: a
    failed chunk simply leaves its days out, and the caller fills them with the
    placeholder.
    """
    if llm is None:
        return {}

    hard_constraints = [str(c) for c in (group_profile.get("hard_constraints") or [])]
    ceiling = group_profile.get("budget_ceiling")
    flight_data = flight_data or {}
    depart_at = flight_data.get("depart_at") or flight_data.get("departAt") or "unknown"
    arrive_at = flight_data.get("arrive_at") or flight_data.get("arriveAt") or "unknown"
    return_depart_at = (
        flight_data.get("return_depart_at")
        or flight_data.get("returnDepartAt")
        or flight_data.get("return_at")
        or flight_data.get("returnAt")
        or "unknown"
    )
    return_arrive_at = (
        flight_data.get("return_arrive_at") or flight_data.get("returnArriveAt") or "unknown"
    )
    system_prompt = (
        f"{UNTRUSTED_INPUT_GUARD}\n\n"
        "You are an in-world NPC travel guide drafting a day-by-day itinerary for a group "
        "trip-planning game. For each requested day, list 3 to 5 activities in chronological "
        "order, with a 24-hour HH:MM start time, a one or two sentence description, and the "
        "neighbourhood or venue. Prefer well-known real places and typical local activities "
        "for the destination. Give each activity a rough cost per person in SGD in "
        "estimated_cost_sgd (0 if free) and keep the total within the money left for "
        "activities when one is given; never write prices, opening hours, flight details or "
        "booking information in the text. Treat the flight schedule as fixed: keep arrival "
        "day light, schedule the first activity after arrival, keep departure day short, "
        "and finish activities before the return departure. Never schedule activities during "
        "a flight or before outbound arrival. Never include anything that violates a stated "
        "hard constraint, and "
        "include every required activity somewhere in the trip. Read each member's own "
        "profile and spread the days so every member gets some of what they asked for, "
        "not only the loudest interest; name who an activity is for in its description "
        "when it serves one member in particular. Return exactly the days requested, "
        "numbered as given."
    )
    context = (
        f"Destination: {' '.join(destination.split())[:MAX_TITLE_CHARS]}\n"
        f"Outbound flight departure: {depart_at}\n"
        f"Outbound flight arrival: {arrive_at}\n"
        f"Return flight departure: {return_depart_at}\n"
        f"Return flight arrival: {return_arrive_at}\n"
        f"Party size: {group_profile.get('member_count') or 'unknown'}\n"
        f"Money left per person for paid activities: "
        f"{f'SGD {ceiling:,.0f}' if ceiling is not None else 'no limit given'}\n"
        f"Interests: {clip_for_prompt(group_profile.get('interests'))}\n"
        f"Activities: {clip_for_prompt(group_profile.get('activities'))}\n"
        f"Required activities: {clip_for_prompt(group_profile.get('required_activities'))}\n"
        f"Travel styles: {clip_for_prompt(group_profile.get('travel_styles'))}\n"
        f"Hard constraints: {clip_for_prompt(hard_constraints)}\n"
        f"{format_party_for_prompt(group_profile)}"
    )

    drafted: dict[int, list[ItineraryItemModel]] = {}
    for first in range(1, day_count + 1, LLM_DAYS_PER_CALL):
        chunk = list(range(first, min(first + LLM_DAYS_PER_CALL, day_count + 1)))
        requested = "\n".join(
            _day_label(n, day_count, outbound + timedelta(days=n - 1)) for n in chunk
        )
        try:
            draft = await llm.generate_structured(
                operation="itinerary_days",
                system_prompt=system_prompt,
                user_prompt=f"{context}\nDraft these days:\n{requested}",
                response_model=_ItineraryDraft,
            )
            drafted_days = draft.days
        except LLMGenerationError:
            logger.info("LLM itinerary drafting unavailable; using placeholder days")
            continue
        except Exception:  # a malformed double or SDK surprise must not break BUILD
            logger.info("LLM itinerary drafting returned an unusable result; using placeholders")
            continue

        for day_draft in drafted_days:
            if day_draft.day in chunk and day_draft.day not in drafted:
                items = _items_from_draft(day_draft.day, day_draft, hard_constraints)
                if items:
                    drafted[day_draft.day] = items
    return drafted


def _destination_title(destination_selection: dict[str, Any]) -> str:
    """Name the locked destination.

    Vote options (and so the locked selection) carry ``label``; ``title`` is
    accepted too. Used for both the itinerary itself and the model prompt, so the
    two can never disagree about where the party is going.
    """
    data = destination_selection.get("data") or {}
    return str(data.get("title") or data.get("label") or "the destination")


def _build_itinerary(
    trip_id: str,
    room_id: str,
    destination_selection: dict[str, Any],
    outbound: date,
    day_count: int,
    drafted_items: dict[int, list[ItineraryItemModel]] | None = None,
) -> ItineraryModel:
    """Build the itinerary object for a fresh BUILD-stage version.

    ``drafted_items`` holds the LLM's validated items by day number; any day
    absent from it gets the deterministic placeholder.
    """
    destination_title = _destination_title(destination_selection)
    drafted_items = drafted_items or {}

    days = [
        ItineraryDayModel(
            day=day_number,
            date=(outbound + timedelta(days=day_number - 1)).isoformat(),
            items=drafted_items.get(day_number) or _generate_items(day_number),
        )
        for day_number in range(1, day_count + 1)
    ]

    return ItineraryModel(
        trip_id=trip_id,
        room_id=room_id,
        title=f"The {destination_title} Quest",
        summary=f"A {day_count}-day adventure to {destination_title}.",
        destination=DestinationRef(name=destination_title),
        dates=DateRange(
            start=outbound.isoformat(),
            end=(outbound + timedelta(days=day_count - 1)).isoformat(),
        ),
        days=days,
    )


async def _never_still_applicable(_latest: dict[str, Any]) -> bool:
    """A build's lost-race callback: there is no scope to re-check (see module docstring)."""
    return False


async def itinerary_node(state: AgentState, config: RunnableConfig) -> AgentState:
    """Draft the trip's first itinerary version for the BUILD stage.

    Raises:
        DestinationNotSelectedError: If no destination is locked
            (Requirement 9.11).
        FlightNotSelectedError: If no flight is locked (Requirement 9.11).
        PreferencesNotCollectedError: If no party member has submitted
            preferences (Requirement 9.12).
        InvalidTripDurationError: If the derived day count falls outside 1-30
            (Requirement 9.5).
        RepeatedVersionContentionError: After a 3rd lost-race collision
            (Requirement 5.12).
        ItineraryPersistenceError: If the insert fails for a non-contention
            reason (Requirement 5.13).
        TripNotFoundError: If the trip does not exist.
        StagePreconditionNotMetError: If the room is closed or past this stage.
    """
    repos: RepositoryBundle = config["configurable"]["repos"]

    context = await _load_context(state, repos)
    state = state.with_trip_context(context)

    destination_selection = context["selections"].get("destination")
    if destination_selection is None:
        raise DestinationNotSelectedError()
    flight_selection = context["selections"].get("flight")
    if flight_selection is None:
        raise FlightNotSelectedError()
    if not context["preferences"]:
        raise PreferencesNotCollectedError()

    profile = compute_group_profile(
        context["members"], context["preferences"], context["characters"]
    )
    state = state.with_group_profile(profile)

    day_count = _derive_day_count(flight_selection, profile, destination_selection)
    # For an itinerary run the ceiling is what the budget leaves for paid activities
    # once the flight and the stay are paid for; the business guardrail checks the
    # itinerary's costed activities against it.
    state = state.with_group_profile(
        {
            **profile,
            "budget_ceiling": _activities_ceiling(
                context, day_count, destination_selection.get("data"), flight_selection.get("data")
            ),
        }
    )

    flight_data = flight_selection.get("data") or {}
    outbound = _parse_date(flight_data.get("depart_at") or flight_data.get("departAt"))
    if outbound is None:
        overlap = profile.get("availability_overlap") or []
        outbound = _parse_date(overlap[0]["start"]) if overlap else date.today()

    destination_title = _destination_title(destination_selection)
    await report_phase(repos, state, "drafting_days")
    drafted_items = await _draft_days_with_llm(
        repos.llm,
        destination=destination_title,
        outbound=outbound,
        day_count=day_count,
        flight_data=flight_data,
        group_profile=profile,
    )
    itinerary = _build_itinerary(
        state.trip_id,
        context["room_id"],
        destination_selection,
        outbound,
        day_count,
        drafted_items,
    )
    proposal = ItineraryProposal(itinerary=itinerary, affected_scope={})
    state = state.with_proposal(proposal.model_dump(mode="json"))

    await report_phase(repos, state, "posting")
    row, state = await persist_itinerary_version(
        state,
        repos,
        proposal.to_persistable(),
        source="build",
        change_summary=None,
        is_still_applicable=_never_still_applicable,
    )

    if row is None:
        # Requirement 5.6: another run already built this trip's first
        # version. The party's plan already moved on; say so and stop.
        await emit_npc_message(repos, state.trip_id, "text", _already_moved_on_text())
        return state

    await emit_npc_message(
        repos,
        state.trip_id,
        "summary",
        SummaryMessageContent(
            title=itinerary.title,
            text=itinerary.summary,
            stage=STAGE,
            itinerary_version_id=row["id"],
        ),
    )
    await advance_trip_status(
        repos, state.trip_id, "itinerary_generated", context["trip"]["status"]
    )

    return state


def _already_moved_on_text() -> Any:
    """Build the Requirement 5.6 ``kind='text'`` content for a lost first build."""
    from app.agents.messages import TextMessageContent

    return TextMessageContent(
        text="The party's plan already moved on, so this attempt made no changes.",
        stage=STAGE,
    )


async def _load_context(state: AgentState, repos: RepositoryBundle) -> dict[str, Any]:
    """Re-fetch the trip context fresh (Requirement 6.1-6.3)."""
    from app.agents.state import load_trip_context

    return await load_trip_context(repos, state.trip_id, state.run_type)
