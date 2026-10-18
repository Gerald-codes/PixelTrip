"""Trip dates: read the trip's plan, and let the party leader change it.

The AI suggests a length and dates per destination; the chosen destination's plan
lives on its selection (``tripDays`` / ``tripStart`` / ``tripEnd``). The leader may
change it until a flight is locked, but not while a flight search is running. A change
must fit inside when the whole party is free; it then closes any open flight vote (those
flights were for the old dates), so the party searches again for the new ones.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import TYPE_CHECKING

from app.agents.errors import DestinationNotSelectedError, TripNotFoundError, UnresolvedMemberError
from app.agents.group_profile import compute_availability_overlap
from app.agents.messages import TextMessageContent, emit_npc_message
from app.core.budget import party_budget
from app.core.trip_dates import MAX_TRIP_DAYS, MIN_TRIP_DAYS, selected_trip, windows
from app.demo import is_demo
from app.exceptions import InvalidTripDatesError, TripDatesLockedError
from app.schemas.planning import ChangeTripDatesRequest, DateRange, TripDatesResponse

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import RepositoryBundle

logger = logging.getLogger(__name__)

LOCKED_BY_FLIGHT = "The flight is locked, so the dates can no longer change."
NO_DESTINATION = "Choose a destination first."
SEARCH_RUNNING = "The guide is searching flights right now. Try again when it finishes."
SET_BY_LEADER = "Set by the party leader."


class TripDatesService:
    def __init__(self, repos: RepositoryBundle) -> None:
        self._repos = repos

    async def get(self, trip_id: str) -> TripDatesResponse:
        repos = self._repos
        trip = await repos.trip_repo.get_by_id(trip_id)
        if trip is None:
            raise TripNotFoundError(trip_id)
        room_id = trip["room_id"]
        members = await repos.member_repo.list_by_room(room_id)
        member_ids = [m["id"] for m in members]
        preferences = await repos.profile_repo.list_preferences_by_member_ids(member_ids)
        characters = await repos.profile_repo.list_characters_by_member_ids(member_ids)
        selections = {
            s["kind"]: s.get("data") or {} for s in await repos.selection_repo.list_by_room(room_id)
        }
        destination = selections.get("destination")
        flight_locked = "flight" in selections

        free = windows(compute_availability_overlap(preferences))
        longest = max(((end - start).days + 1 for start, end in free), default=0)
        plan = selected_trip(destination)
        daily = (destination or {}).get("estimatedDailyCostSgd")
        budget = party_budget(members, preferences, characters, plan.days if plan else None)

        if destination is None:
            locked_reason: str | None = NO_DESTINATION
        elif flight_locked:
            locked_reason = LOCKED_BY_FLIGHT
        else:
            locked_reason = None
        room = await repos.room_repo.get_by_id(room_id)
        if room and is_demo(room):
            locked_reason = "The prepared demo uses a fixed five-day itinerary."

        return TripDatesResponse(
            destination=(destination or {}).get("title") or (destination or {}).get("label"),
            trip_days=plan.days if plan else None,
            trip_start=date.fromisoformat(plan.start) if plan else None,
            trip_end=date.fromisoformat(plan.end) if plan else None,
            why_this_long=(destination or {}).get("whyThisLong"),
            windows=[DateRange(start=start, end=end) for start, end in free],
            min_days=max(1, min(MIN_TRIP_DAYS, longest)),
            max_days=max(1, min(MAX_TRIP_DAYS, longest)),
            daily_cost_sgd=float(daily) if isinstance(daily, int | float) else None,
            budget_limit=budget.limit,
            can_change=locked_reason is None,
            locked_reason=locked_reason,
        )

    async def change(self, trip_id: str, request: ChangeTripDatesRequest) -> TripDatesResponse:
        """Set the trip's length and start date (leader only), then reopen flights."""
        repos = self._repos
        trip = await repos.trip_repo.get_by_id(trip_id)
        if trip is None:
            raise TripNotFoundError(trip_id)
        room_id = trip["room_id"]
        room = await repos.room_repo.get_by_id(room_id)
        if room and is_demo(room):
            raise TripDatesLockedError("The prepared demo uses a fixed five-day itinerary.")
        member_id = str(request.member_id)
        owner = await repos.member_repo.get_owner(room_id)
        if owner is None or owner.get("id") != member_id:
            raise UnresolvedMemberError(member_id)

        selection = await repos.selection_repo.get_by_room_and_kind(room_id, "destination")
        if selection is None:
            raise DestinationNotSelectedError()
        if await repos.selection_repo.get_by_room_and_kind(room_id, "flight") is not None:
            raise TripDatesLockedError(LOCKED_BY_FLIGHT)
        # A search in progress would post flights for the old dates after the change.
        if await repos.agent_run_repo.get_active(trip_id, "logistics") is not None:
            raise TripDatesLockedError(SEARCH_RUNNING)

        current = await self.get(trip_id)
        start, end = request.start, request.start + timedelta(days=request.days - 1)
        if not current.min_days <= request.days <= current.max_days:
            raise InvalidTripDatesError(
                f"The trip must be {current.min_days} to {current.max_days} days long."
            )
        if start < date.today():
            raise InvalidTripDatesError("The trip cannot start in the past.")
        if not any(w.start <= start and end <= w.end for w in current.windows):
            free = "; ".join(f"{w.start:%d %b} to {w.end:%d %b}" for w in current.windows)
            raise InvalidTripDatesError(
                "Those dates fall outside when the whole party is free "
                f"({free or 'no shared dates'})."
            )

        data = {
            **(selection.get("data") or {}),
            "tripDays": request.days,
            "tripStart": start.isoformat(),
            "tripEnd": end.isoformat(),
            "whyThisLong": SET_BY_LEADER,
        }
        await repos.selection_repo.upsert(
            room_id, "destination", data, vote_session_id=selection.get("vote_session_id")
        )

        # Any open flight vote was for the old dates: close it so the party searches again.
        stale = await repos.vote_session_repo.get_open_by_room_and_category(room_id, "flight")
        if stale is not None:
            if stale.get("tie_pending"):
                await repos.vote_session_repo.clear_tie_pending(stale["id"])
            await repos.vote_session_repo.close(stale["id"])
            for member in await repos.member_repo.list_by_room(room_id):
                await repos.member_repo.set_stage_ready(member["id"], False)

        try:
            await emit_npc_message(
                repos,
                trip_id,
                "text",
                TextMessageContent(
                    text=(
                        f"The party leader set the trip to {request.days} days, "
                        f"{start:%a %d %b} to {end:%a %d %b}. Flights will be searched for "
                        "the new dates."
                    ),
                    stage="LOGISTICS",
                ),
            )
        except Exception:  # the change is saved; a missing note must not undo it
            logger.info("Could not post the trip-dates note for trip %s", trip_id)

        return await self.get(trip_id)
