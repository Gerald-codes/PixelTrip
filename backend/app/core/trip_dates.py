"""Trip dates: how long a trip is and which days it falls on.

Members say when they are *free* (availability). That is not the trip length: a party
free for a month does not want a month-long trip. So:

* The AI suggests a length per destination ("people usually spend 4 days in Penang").
* :func:`plan_trip` turns that into a real plan the code can trust:

  - never longer than the party's shared window, and within
    :data:`MIN_TRIP_DAYS`..:data:`MAX_TRIP_DAYS`;
  - with a hard budget, short enough that the stay uses at most
    :data:`STAY_BUDGET_SHARE` of it, leaving room for flights and activities;
  - on dates inside the shared window that cover the most weekend days (people are
    freer at weekends), earliest first on a tie. A trip can start as soon as
    tomorrow; there is no notice period.

Every stage reads the chosen destination's ``tripDays`` / ``tripStart`` / ``tripEnd``
(:func:`selected_trip`), so the prompt, budget, flight search and itinerary agree.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

MIN_TRIP_DAYS = 2
MAX_TRIP_DAYS = 14
#: Used when no length is suggested (e.g. a fallback card).
DEFAULT_TRIP_DAYS = 5
#: The soonest a trip may start, in days from today (1 = tomorrow). Not today:
#: the party still has to vote and book.
EARLIEST_START_DAYS = 1
#: With a hard budget, the most of it the stay (daily cost x days) may use.
STAY_BUDGET_SHARE = 0.6


@dataclass(frozen=True)
class TripPlan:
    days: int
    start: str  # ISO date
    end: str  # ISO date
    #: Set when the suggested length was shortened, saying why.
    note: str | None = None


def windows(overlap: list[dict[str, Any]] | None) -> list[tuple[date, date]]:
    """The party's shared date ranges as ``(start, end)`` pairs, valid ones only."""
    result: list[tuple[date, date]] = []
    for entry in overlap or []:
        try:
            start = date.fromisoformat(str(entry["start"]))
            end = date.fromisoformat(str(entry["end"]))
        except (KeyError, TypeError, ValueError):
            continue
        if end >= start:
            result.append((start, end))
    return result


def longest_window_days(overlap: list[dict[str, Any]] | None) -> int | None:
    lengths = [(end - start).days + 1 for start, end in windows(overlap)]
    return max(lengths) if lengths else None


def _weekend_days(start: date, days: int) -> int:
    return sum(1 for i in range(days) if (start + timedelta(days=i)).weekday() >= 5)


def pick_dates(
    overlap: list[dict[str, Any]] | None, days: int, today: date | None = None
) -> tuple[date, date] | None:
    """The best ``days``-long stretch inside the shared windows, or ``None``.

    Among stretches starting tomorrow or later, prefers the one covering the most
    weekend days, then the earliest start. Today or past dates are only used when
    the window leaves nothing later.
    """
    today = today or date.today()
    candidates: list[date] = []
    for start, end in windows(overlap):
        last_start = end - timedelta(days=days - 1)
        day = start
        while day <= last_start:
            candidates.append(day)
            day += timedelta(days=1)
    if not candidates:
        return None

    from_tomorrow = [d for d in candidates if d >= today + timedelta(days=EARLIEST_START_DAYS)]
    not_past = [d for d in candidates if d >= today]
    pool = from_tomorrow or not_past or candidates
    best = min(pool, key=lambda d: (-_weekend_days(d, days), d))
    return best, best + timedelta(days=days - 1)


def plan_trip(
    overlap: list[dict[str, Any]] | None,
    suggested_days: int | None,
    *,
    daily_cost: float | None = None,
    budget_limit: float | None = None,
    today: date | None = None,
) -> TripPlan | None:
    """A trusted trip plan from a suggested length, or ``None`` with no shared dates."""
    available = longest_window_days(overlap)
    if available is None:
        return None

    wanted = suggested_days if suggested_days and suggested_days > 0 else DEFAULT_TRIP_DAYS
    days = max(MIN_TRIP_DAYS, min(MAX_TRIP_DAYS, int(wanted)))
    note: str | None = None

    if days > available:
        days = available
        note = f"Shortened to the {available} days the whole party is free."

    if budget_limit and daily_cost and daily_cost > 0:
        affordable = int((budget_limit * STAY_BUDGET_SHARE) // daily_cost)
        if affordable < days:
            days = max(min(MIN_TRIP_DAYS, available), affordable)
            note = "Shortened to keep the stay within the party's budget."

    days = max(1, days)
    dates = pick_dates(overlap, days, today)
    if dates is None:
        return None
    return TripPlan(days=days, start=dates[0].isoformat(), end=dates[1].isoformat(), note=note)


def selected_trip(destination: dict[str, Any] | None) -> TripPlan | None:
    """The trip plan stored on the locked destination selection, if it has one."""
    data = destination or {}
    days, start, end = data.get("tripDays"), data.get("tripStart"), data.get("tripEnd")
    if not isinstance(days, int) or days <= 0:
        return None
    try:
        date.fromisoformat(str(start))
        date.fromisoformat(str(end))
    except (TypeError, ValueError):
        return None
    return TripPlan(days=days, start=str(start), end=str(end))


def trip_for(
    destination: dict[str, Any] | None,
    overlap: list[dict[str, Any]] | None,
    today: date | None = None,
) -> TripPlan | None:
    """The chosen destination's plan, or a default-length plan for older selections."""
    return selected_trip(destination) or plan_trip(overlap, None, today=today)
