"""Logistics_Node — LOGISTICS stage flight recommendation.

Mirrors discovery_node's shape (load context, compute profile, escalate on an
unworkable precondition, otherwise filter/rank candidates, validate through the
guardrail loop, emit + vote), with one real addition: this node calls an
``External_Tool`` for its factual data instead of relying only on preferences.

1. **Load context, require a locked destination.** Flights are arranged
   *for* a destination, so a missing ``kind='destination'`` selection fails
   the run outright, before any tool call (Requirement 8.1-8.2).
2. **Escalate before touching the flight tool, not after.** Both pre-tool
   escalation paths — an empty availability overlap and an unresolved
   departure origin — are checked first (Requirement 8.10-8.11); the whole
   point of checking first is that ``FlightSearchTool`` is never invoked for
   a request that cannot be formed, which also means it never spends the
   run's ``Tool_Call_Cap`` on a call that was going to be escalated anyway.
3. **Call the tool once, then filter and rank.** Exclusions are over budget
   or outside the overlap, never both inputs required at once — an
   unconstrained budget excludes nothing (Requirement 8.6). An empty result
   escalates, naming whichever bound did the eliminating (Requirement 8.7).
   Survivors are sorted ``(price, duration, stops)`` ascending before ever
   reaching the guardrail (Requirement 8.8), since ranking is this node's job,
   not the model's.
4. **Validate through the guardrail loop**, exactly like discovery.
5. **On success, emit the recommendation and open its vote**, closing any
   prior open *flight*-category session first (Requirement 8.4-8.5, 8.9).

**On the departure origin (Backend Change Request Entry 1).** No typed column
holds a party's departure origin yet. Per the filed change request, this node
reads a conventioned ``travel_preferences.hard_constraints`` entry shaped
``{"type": "departure_origin", "value": "<IATA or city>"}``. Absence is an
escalation, never a guess from model output or from the destination
(Requirement 8.11) — guessing an origin would mean searching flights from a
place no one in the party may be starting from.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from langchain_core.runnables import RunnableConfig

from app.agents.errors import DestinationNotSelectedError
from app.agents.group_profile import compute_group_profile
from app.agents.guardrails import perform_human_escalation, run_guardrail_loop
from app.agents.messages import RecommendationMessageContent, emit_npc_message
from app.agents.progress import report_phase
from app.agents.proposals import FlightRecommendationProposal
from app.agents.tools.base import FlightOption
from app.agents.tools.flights import FlightSearchTool
from app.core.budget import party_budget
from app.core.config import get_settings
from app.core.trip_dates import trip_for

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import AgentState, RepositoryBundle

logger = logging.getLogger(__name__)

#: Requirement 8.4: a recommendation carries 3-5 items.
MIN_RECOMMENDATION_ITEMS = 3
MAX_RECOMMENDATION_ITEMS = 5

#: Requirement 8.5: the vote question's length bound.
MAX_QUESTION_LENGTH = 200

STAGE = "LOGISTICS"

#: Backend Change Request Entry 1: the conventioned ``hard_constraints`` entry
#: naming a departure origin, pending a typed ``travel_preferences.origin``
#: column.
_DEPARTURE_ORIGIN_TYPE = "departure_origin"


def _resolve_departure_origin(preferences: list[dict[str, Any]]) -> str | None:
    """Read the party's departure origin from a conventioned hard constraint.

    Reads the *raw* ``travel_preferences`` rows rather than
    ``Group_Profile.hard_constraints``: ``compute_group_profile`` flattens that
    column to display strings via ``_string_entries`` (it only recognises
    ``name``/``label``/``title``/``activity`` keys), which silently drops a
    ``{"type": "departure_origin", "value": ...}`` entry. Reading the raw rows
    here avoids depending on a lossy derivation for data this convention needs
    intact.

    Returns ``None`` when absent — the caller escalates rather than guessing
    (Requirement 8.11). Never inferred from model output or from the
    destination.
    """
    for preference in preferences:
        constraints = preference.get("hard_constraints")
        if not isinstance(constraints, list):
            continue
        for constraint in constraints:
            if isinstance(constraint, dict) and constraint.get("type") == _DEPARTURE_ORIGIN_TYPE:
                value = constraint.get("value")
                if isinstance(value, str) and value.strip():
                    return value.strip()
    return None


def _flight_ceiling(
    context: dict[str, Any], trip_days: int | None, destination: dict[str, Any] | None
) -> float | None:
    """The most a flight may cost per person (``None`` = no hard limit).

    The party's hard limit (the lowest typed budget, whole trip including flights)
    minus the locked destination's estimated stay (daily estimate x the trip's days).
    Without a stay estimate, or if the stay alone would use up the limit, the full
    limit applies: an estimate must never shut out every flight on its own.
    """
    budget = party_budget(
        context["members"], context["preferences"], context["characters"], trip_days
    )
    if budget.limit is None:
        return None
    daily = (destination or {}).get("estimatedDailyCostSgd")
    left = budget.money_for_flight(
        budget.stay_estimate(daily if isinstance(daily, int | float) else None)
    )
    return left if left is not None and left > 0 else budget.limit


def _option_cost(option: FlightOption) -> float:
    """The per-member price this node ranks and filters on."""
    return option.price


def _within_overlap(option: FlightOption, overlap: list[dict[str, str]]) -> bool:
    """Return ``True`` when the option's departure falls within the overlap.

    An empty ``overlap`` means no shared dates exist at all, which the caller
    has already escalated on before this function is ever reached — so this
    only decides membership for a non-empty overlap.
    """
    depart_date = option.depart_at.split("T", 1)[0]
    return any(entry["start"] <= depart_date <= entry["end"] for entry in overlap)


def _filter_and_rank(
    options: list[FlightOption], group_profile: dict[str, Any]
) -> tuple[list[FlightOption], str | None]:
    """Apply Requirement 8.6's exclusions, then Requirement 8.8's ordering.

    Returns:
        ``(survivors_sorted, eliminating_reason)``. ``eliminating_reason`` is
        set only when filtering emptied the set (Requirement 8.7).
    """
    ceiling = group_profile.get("budget_ceiling")
    overlap = group_profile.get("availability_overlap") or []

    survivors: list[FlightOption] = []
    excluded_by_budget = False
    excluded_by_dates = False
    for option in options:
        if ceiling is not None and _option_cost(option) > float(ceiling):
            excluded_by_budget = True
            continue
        if not _within_overlap(option, overlap):
            excluded_by_dates = True
            continue
        survivors.append(option)

    if survivors:
        ranked = sorted(survivors, key=lambda o: (o.price, o.duration_minutes, o.stops))
        return ranked, None

    if excluded_by_budget:
        return [], f"the party's budget ceiling of {ceiling}"
    if excluded_by_dates:
        return [], "the party's available travel dates"
    return [], "the party's current constraints"


def _format_duration(minutes: int) -> str:
    hours, mins = divmod(minutes, 60)
    return f"{hours}h {mins:02d}m" if hours else f"{mins}m"


def _format_stops(stops: int) -> str:
    return "Direct" if stops == 0 else f"{stops} stop" + ("s" if stops > 1 else "")


def _spread(value: float, low: float, high: float) -> float:
    """Where ``value`` sits between ``low`` (0.0) and ``high`` (1.0)."""
    return 0.0 if high <= low else (value - low) / (high - low)


def _flight_card(option: FlightOption, shown: list[FlightOption], currency: str) -> dict[str, Any]:
    """CR-1 card copy for one flight, judged against the other options shown.

    ``score`` is value for money: it starts at 95 and loses up to 30 for being
    the priciest option, up to 15 for being the slowest, and 8 per stop.
    Everything else is built from the tool's facts, never invented.
    """
    prices = [o.price for o in shown]
    durations = [o.duration_minutes for o in shown]
    fewest_stops = min(o.stops for o in shown)
    price_spread = _spread(option.price, min(prices), max(prices))
    duration_spread = _spread(option.duration_minutes, min(durations), max(durations))
    score = round(95 - 30 * price_spread - 15 * duration_spread - 8 * option.stops)

    price_text = f"{currency} {option.price:,.0f}"
    duration_text = _format_duration(option.duration_minutes)
    stops_text = _format_stops(option.stops)
    round_trip = option.return_depart_at is not None

    strengths = []
    if len(shown) > 1 and option.price == min(prices):
        strengths.append("the cheapest option")
    if len(shown) > 1 and option.duration_minutes == min(durations):
        strengths.append("the quickest journey")
    if option.stops == 0:
        strengths.append("a direct flight")
    why = (
        f"{' and '.join(strengths).capitalize()} for the party."
        if strengths
        else "A balance of price and travel time for the party."
    )

    if len(shown) > 1 and option.price > min(prices):
        trade_off = f"{currency} {option.price - min(prices):,.0f} more than the cheapest option."
    elif option.stops > fewest_stops:
        trade_off = f"{stops_text} where other options fly with fewer."
    elif len(shown) > 1 and option.duration_minutes > min(durations):
        trade_off = (
            f"{_format_duration(option.duration_minutes - min(durations))} longer than the "
            "quickest option."
        )
    else:
        trade_off = "Nothing stands out against the other options."

    route = f"{option.origin} to {option.destination}"
    details = (
        f"{option.carrier} {option.flight_number}, {route}. Departs {option.depart_at}, "
        f"arrives {option.arrive_at}. {duration_text}, {stops_text.lower()}."
    )
    if round_trip and len(str(option.return_depart_at)) <= 10:
        # A date with no time: the provider prices the round trip without return times.
        details += (
            f" Returns on {option.return_depart_at}; the return flight time is shown at "
            f"booking. {price_text} per person, round trip."
        )
    elif round_trip:
        details += f" Returns {option.return_depart_at}. {price_text} per person, round trip."
    else:
        details += f" {price_text} per person, one way."

    return {
        "description": f"{route}, {stops_text.lower()}, {duration_text}, {price_text}.",
        "meta": {
            "score": max(0, min(100, score)),
            "whyThisFits": why,
            "tags": [price_text, option.carrier, duration_text, stops_text],
            "tradeOff": trade_off,
            "details": details,
        },
    }


def overlap_of(profile: dict[str, Any]) -> list[dict[str, str]]:
    return profile.get("availability_overlap") or []


def _build_proposal(
    options: list[FlightOption],
    currency: str | None = None,
    budget_left: float | None = None,
) -> dict[str, Any]:
    """Build a raw flight recommendation payload from ranked options.

    ``meta`` keeps the tool's factual fields (the factual guardrail, the
    itinerary and the tiebreak read them) and adds the CR-1 card keys.
    """
    currency = currency or get_settings().flight_currency
    shown = options[:MAX_RECOMMENDATION_ITEMS]
    items = []
    for option in shown:
        card = _flight_card(option, shown, currency)
        if budget_left is not None and option.price > budget_left:
            # Shown because nothing fits the budget; say by how much it is over.
            over = option.price - budget_left
            card["meta"]["tradeOff"] = (
                f"{currency} {over:,.0f} over what the party's budget leaves for flights."
            )
            card["meta"]["tags"] = ["Over budget", *card["meta"]["tags"]][:5]
        items.append(
            {
                "id": option.id,
                "title": f"{option.carrier} {option.flight_number}",
                "description": card["description"],
                "meta": {
                    "flight_id": option.id,
                    "carrier": option.carrier,
                    "flight_number": option.flight_number,
                    "origin": option.origin,
                    "destination": option.destination,
                    "depart_at": option.depart_at,
                    "arrive_at": option.arrive_at,
                    "price": option.price,
                    "duration_minutes": option.duration_minutes,
                    "stops": option.stops,
                    # The itinerary sizes the trip from depart_at / return_at.
                    "return_at": option.return_depart_at,
                    "return_arrive_at": option.return_arrive_at,
                    **card["meta"],
                },
            }
        )
    return {
        "title": "How shall the party travel?",
        "items": items,
        "question": "Which flight suits the party best?"[:MAX_QUESTION_LENGTH],
    }


async def logistics_node(state: AgentState, config: RunnableConfig) -> AgentState:
    """Produce a flight recommendation for the LOGISTICS stage.

    Raises:
        DestinationNotSelectedError: If no destination is locked in yet
            (Requirement 8.2). No flight-tool call, no write.
        TripNotFoundError: If the trip does not exist.
        StagePreconditionNotMetError: If the room is closed or past this stage.
    """
    repos: RepositoryBundle = config["configurable"]["repos"]

    context = await _load_context(state, repos)
    state = state.with_trip_context(context)

    destination_selection = context["selections"].get("destination")
    if destination_selection is None:
        raise DestinationNotSelectedError()

    profile = compute_group_profile(
        context["members"], context["preferences"], context["characters"]
    )
    # For a flight run the ceiling is what the budget leaves once the stay is paid
    # for; the filter below and the business guardrail both read it from the profile.
    # The trip's own length and dates come from the chosen destination card (the AI
    # suggests a length per place; see app.core.trip_dates), not the whole stretch the
    # party is free.
    trip = trip_for(destination_selection.get("data"), profile["availability_overlap"])
    profile = {
        **profile,
        "budget_ceiling": _flight_ceiling(
            context, trip.days if trip else None, destination_selection.get("data")
        ),
    }
    state = state.with_group_profile(profile)

    if not profile["availability_overlap"]:
        await perform_human_escalation(
            state,
            repos,
            constraint="no shared travel dates exist across the party",
            question="Would the party like to widen their available dates?",
            options=[("widen_dates", "Widen our available dates")],
        )
        return state

    origin = _resolve_departure_origin(context["preferences"])
    if origin is None:
        await perform_human_escalation(
            state,
            repos,
            constraint="no departure origin has been given for the party",
            question="Where shall the party's journey begin?",
            options=[("set_origin", "Tell the guide where we're departing from")],
        )
        return state

    destination_data = destination_selection.get("data") or {}
    # Vote options (and so the locked selection) carry "label"; accept "title" too.
    destination_name = destination_data.get("title") or destination_data.get("label") or ""
    search_params = {
        "origin": origin,
        "destination": destination_name,
        "depart_after": trip.start if trip else profile["availability_overlap"][0]["start"],
        "depart_before": trip.end if trip else profile["availability_overlap"][-1]["end"],
    }

    tool = FlightSearchTool()
    await report_phase(repos, state, "searching_flights")
    response, state = await tool.invoke(state, **search_params)

    await report_phase(repos, state, "checking_budget")
    survivors, eliminating_reason = _filter_and_rank(response.options, profile)
    no_flights_found = not response.options
    budget_left: float | None = None
    if not survivors and (eliminating_reason or "").startswith("the party's budget"):
        # Never a dead end: show the cheapest flights anyway, marked over budget, and
        # let the party decide. The budget check is lifted for this proposal only.
        budget_left = profile["budget_ceiling"]
        in_dates = [o for o in response.options if _within_overlap(o, overlap_of(profile))]
        survivors = sorted(in_dates, key=lambda o: (o.price, o.duration_minutes, o.stops))
        if survivors:
            profile = {**profile, "budget_ceiling": None}
            state = state.with_group_profile(profile)
    if not survivors:
        await perform_human_escalation(
            state,
            repos,
            # Nothing came back at all: say so, rather than blaming a "constraint".
            constraint=(
                f"no flights were found from {origin} to {destination_name} for "
                f"{search_params['depart_after']} to {search_params['depart_before']}"
                if no_flights_found
                else f"every flight option was eliminated by {eliminating_reason}"
            ),
            question=(
                "Would the party like to try different dates?"
                if no_flights_found
                else "Would the party like to relax that constraint?"
            ),
            options=[
                ("relax_budget", "Raise our budget"),
                ("widen_dates", "Widen our available dates"),
            ],
        )
        return state

    cap = get_settings().iteration_cap

    async def _producer(repair_state: AgentState) -> dict[str, Any]:
        """Re-load context and re-rank from the already-recorded tool response.

        The flight tool is not called again on a repair iteration: its
        response was already recorded in state by the initial call above, and
        Requirement 19.9 treats an identical call as a cache hit anyway — this
        just skips the round trip entirely by reusing the already-filtered
        ``survivors`` rather than re-deriving them from a fresh profile that,
        for flights already in hand, would not change their price or dates.
        """
        await _load_context(repair_state, repos)
        return _build_proposal(survivors, budget_left=budget_left)

    await report_phase(repos, state, "checking_answer")
    loop_outcome = await run_guardrail_loop(
        state,
        repos,
        _build_proposal(survivors, budget_left=budget_left),
        "flight_recommendation",
        _producer,
        cap,
    )
    state = loop_outcome.state

    if loop_outcome.escalated:
        return state

    proposal: FlightRecommendationProposal = loop_outcome.proposal
    state = state.with_proposal(proposal.model_dump(mode="json"))

    await report_phase(repos, state, "posting")
    await _close_prior_vote_session(repos, context["room_id"])
    message = await emit_npc_message(
        repos,
        state.trip_id,
        "recommendation",
        RecommendationMessageContent(
            title=proposal.title,
            category="flight",
            items=[item.model_dump(mode="json") for item in proposal.items],
            prompt=proposal.prompt,
            stage=STAGE,
        ),
    )
    await repos.vote_session_repo.create(
        room_id=context["room_id"],
        message_id=message["id"],
        question=proposal.question,
        options=[{"id": item.id, "label": item.title} for item in proposal.items],
    )

    return state


async def _load_context(state: AgentState, repos: RepositoryBundle) -> dict[str, Any]:
    """Re-fetch the trip context fresh (Requirement 6.1-6.3)."""
    from app.agents.state import load_trip_context

    return await load_trip_context(repos, state.trip_id, state.run_type)


async def _close_prior_vote_session(repos: RepositoryBundle, room_id: str) -> None:
    """Close any open flight vote session before opening a new one.

    Requirement 8.9: at most one open flight session per room.
    """
    existing = await repos.vote_session_repo.get_open_by_room_and_category(room_id, "flight")
    if existing is not None:
        await repos.vote_session_repo.close(existing["id"])
