"""The trip budget for the sidebar: limit, level, what is spent so far, what is left.

All rules come from :mod:`app.core.budget`. This service only gathers the inputs:
members, preferences and characters (who can spend what), the locked destination
and flight (their cost estimates), and the itinerary (costed activities).
"""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING, Any

from app.agents.errors import TripNotFoundError
from app.core.budget import party_budget
from app.core.trip_dates import selected_trip
from app.schemas.planning import (
    BudgetEstimates,
    BudgetMember,
    DailyRange,
    TripBudgetResponse,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import RepositoryBundle


class BudgetService:
    def __init__(self, repos: RepositoryBundle) -> None:
        self._repos = repos

    async def get(self, trip_id: str) -> TripBudgetResponse:
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
        flight = selections.get("flight") or {}
        destination = selections.get("destination") or {}

        # The trip's own length: the locked flight's dates, else the chosen
        # destination's plan. Unknown until a destination is chosen (the shared dates
        # only say when the party is free, not how long the trip is).
        trip = selected_trip(destination)
        days = _flight_days(flight) or (trip.days if trip else None)
        budget = party_budget(members, preferences, characters, days)

        stay = budget.stay_estimate(_number(destination.get("estimatedDailyCostSgd")))
        flight_price = _number(flight.get("price"))
        activities = await self._activities_cost(trip_id)
        known = [part for part in (stay, flight_price, activities) if part is not None]
        total = round(sum(known), 2) if known else None
        remaining = round(budget.limit - (total or 0.0), 2) if budget.limit is not None else None
        band = budget.daily_band

        return TripBudgetResponse(
            days=days,
            is_hard_limit=budget.is_hard,
            limit=budget.limit,
            limit_set_by=budget.limit_member,
            level=budget.tier,  # type: ignore[arg-type]
            level_count=budget.tier_count,
            daily_range=DailyRange(low=band[0], high=band[1], typical=band[2]) if band else None,
            level_estimate=float(band[2] * days) if band and days else None,
            estimates=BudgetEstimates(
                stay=stay, flight=flight_price, activities=activities, total=total
            ),
            remaining=remaining,
            is_over_budget=budget.over_limit(total),
            members=[
                BudgetMember(
                    member_id=b.member_id,
                    display_name=b.name,
                    amount=b.amount,
                    level=b.tier,  # type: ignore[arg-type]
                )
                for b in budget.members
            ],
        )

    async def _activities_cost(self, trip_id: str) -> float | None:
        """Costed activities in the approved itinerary, else the latest one."""
        repos = self._repos
        version = await repos.itinerary_version_repo.get_approved(trip_id)
        if version is None:
            version = await repos.itinerary_version_repo.get_latest(trip_id)
        if version is None:
            return None
        costs = [
            _number(item.get("cost"))
            for day in (version.get("itinerary") or {}).get("days") or []
            for item in day.get("items") or []
            if isinstance(item, dict)
        ]
        known = [c for c in costs if c is not None]
        return round(sum(known), 2) if known else None


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) and value >= 0 else None


def _flight_days(flight: dict[str, Any]) -> int | None:
    try:
        start = date.fromisoformat(str(flight["depart_at"])[:10])
        end = date.fromisoformat(str(flight["return_at"])[:10])
    except (KeyError, TypeError, ValueError):
        return None
    days = (end - start).days + 1
    return days if days > 0 else None
