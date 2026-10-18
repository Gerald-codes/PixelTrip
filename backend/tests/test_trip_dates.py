"""Trip dates: a trip's own length and days, inside when the party is free."""

from __future__ import annotations

from datetime import date

from app.agents.nodes import discovery
from app.agents.nodes.itinerary import _derive_day_count
from app.agents.party_brief import build_party_brief
from app.core.trip_dates import pick_dates, plan_trip, selected_trip, trip_for

TODAY = date(2026, 10, 10)  # a Saturday
MONTH = [{"start": "2026-10-10", "end": "2026-11-10"}]  # the party is free for a month


def plan(days, **kwargs):
    return plan_trip(MONTH, days, today=TODAY, **kwargs)


def test_a_month_of_availability_is_not_a_month_long_trip():
    trip = plan(4)

    assert trip.days == 4
    # Thu 15 - Sun 18 Oct: the first 4 days from tomorrow that cover a whole weekend.
    assert (trip.start, trip.end) == ("2026-10-15", "2026-10-18")
    assert trip.note is None


def test_dates_cover_the_weekend_when_they_can():
    assert pick_dates(MONTH, 2, TODAY) == (date(2026, 10, 17), date(2026, 10, 18))  # Sat-Sun
    assert pick_dates(MONTH, 3, TODAY) == (date(2026, 10, 16), date(2026, 10, 18))  # Fri-Sun
    # A week covers a weekend whenever it starts, so the earliest start (tomorrow) wins.
    assert pick_dates(MONTH, 7, TODAY) == (date(2026, 10, 11), date(2026, 10, 17))


def test_a_window_without_a_weekend_uses_the_earliest_dates():
    weekdays = [{"start": "2026-10-12", "end": "2026-10-15"}]  # Mon-Thu
    assert pick_dates(weekdays, 3, date(2026, 10, 1)) == (date(2026, 10, 12), date(2026, 10, 14))


def test_a_trip_can_start_tomorrow_but_not_today_unless_nothing_else_fits():
    soon = [{"start": "2026-10-10", "end": "2026-10-13"}]
    assert pick_dates(soon, 3, TODAY) == (date(2026, 10, 11), date(2026, 10, 13))  # tomorrow
    # Only today fits a 4-day trip here, so today is used rather than no trip at all.
    assert pick_dates(soon, 4, TODAY) == (date(2026, 10, 10), date(2026, 10, 13))
    # A window entirely in the past still yields dates rather than nothing.
    past = [{"start": "2026-06-01", "end": "2026-06-05"}]
    assert pick_dates(past, 2, TODAY) is not None


def test_never_longer_than_the_party_is_free():
    trip = plan_trip([{"start": "2026-10-16", "end": "2026-10-18"}], 7, today=TODAY)

    assert trip.days == 3 and (trip.start, trip.end) == ("2026-10-16", "2026-10-18")
    assert "whole party is free" in trip.note


def test_a_hard_budget_shortens_the_trip_to_leave_room_for_flights():
    # 60% of SGD 1,000 is 600 for the stay; at 200 a day that is 3 days.
    trip = plan(7, daily_cost=200, budget_limit=1000)

    assert trip.days == 3
    assert "budget" in trip.note
    # No limit (levels only) never shortens.
    assert plan(7, daily_cost=200).days == 7


def test_length_is_kept_in_a_sensible_range_and_defaults_when_missing():
    assert plan(40).days == 14
    assert plan(1).days == 2
    assert plan(None).days == 5 and plan(0).days == 5
    assert plan_trip([], 4, today=TODAY) is None  # no shared dates, no plan


def test_the_chosen_destination_carries_the_plan_for_later_stages():
    destination = {"tripDays": 4, "tripStart": "2026-10-15", "tripEnd": "2026-10-18"}

    assert selected_trip(destination).days == 4
    assert selected_trip({"title": "Penang"}) is None
    # An older selection without a plan gets a default-length one, not the whole month.
    assert trip_for({"title": "Penang"}, MONTH, TODAY).days == 5
    # The itinerary uses the plan when the flight has no dates.
    assert (
        _derive_day_count({"data": {}}, {"availability_overlap": MONTH}, {"data": destination}) == 4
    )


def test_destination_cards_show_a_checked_length_and_dates():
    members = [{"id": "m1", "display_name": "Gerald"}]
    prefs = [{"member_id": "m1", "budget": 1200, "available_dates": MONTH}]
    party = build_party_brief(members, prefs, [], MONTH)
    card = discovery._DestinationCard(
        name="Penang, Malaysia",
        pick="Best fit",
        description="Food and heritage.",
        why_this_fits="Great food.",
        best_for=[],
        tags=["Food"],
        trade_off="Humid.",
        details="Details.",
        estimated_daily_cost_sgd=32,
        suggested_days=4,
        why_this_long="Four days covers George Town and a hike.",
        preference_match=8,
        budget_fit=10,
        season_fit=7,
        trip_length_fit=9,
    )

    names, cards = discovery._choose_destinations(party, [card], {})
    meta = discovery._build_proposal(names, cards, party)["items"][0]["meta"]

    assert meta["tripDays"] == 4
    assert meta["whyThisLong"] == "Four days covers George Town and a hike."
    # The real room: a 4-day stay costs SGD 128, not a month's SGD 1,024.
    assert party.budget.stay_estimate(32, meta["tripDays"]) == 128
    assert meta["tripStart"] <= meta["tripEnd"]
