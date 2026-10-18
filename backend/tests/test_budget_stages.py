"""Each stage applies the shared budget rules (app.core.budget)."""

from __future__ import annotations

from app.agents.nodes import discovery, itinerary, logistics
from app.agents.party_brief import build_party_brief

MEMBERS = [{"id": "m1", "display_name": "Gerald"}, {"id": "m2", "display_name": "Priya"}]
DATES = [{"start": "2026-10-12", "end": "2026-10-16"}]  # 5 days


def context(*budgets, tiers=("low", "low")):
    return {
        "members": MEMBERS,
        "preferences": [
            {"member_id": m["id"], "budget": b, "available_dates": DATES}
            for m, b in zip(MEMBERS, budgets, strict=True)
        ],
        "characters": [
            {"member_id": m["id"], "appearance": {"budgetTier": t}}
            for m, t in zip(MEMBERS, tiers, strict=True)
        ],
    }


PROFILE = {"availability_overlap": DATES}


# --- LOGISTICS: a flight may cost what the budget leaves after the stay ---------------


def test_flight_ceiling_is_the_limit_minus_the_stay():
    ceiling = logistics._flight_ceiling(context(1500, None), 4, {"estimatedDailyCostSgd": 100})
    assert ceiling == 1100  # 1500 - 100 x the trip's 4 days


def test_flight_ceiling_without_a_stay_estimate_is_the_full_limit():
    assert logistics._flight_ceiling(context(1500, 2000), 5, {}) == 1500


def test_a_stay_that_uses_up_the_limit_never_shuts_out_every_flight():
    ceiling = logistics._flight_ceiling(context(400, None), 5, {"estimatedDailyCostSgd": 100})
    assert ceiling == 400


def test_levels_only_means_no_flight_ceiling():
    assert logistics._flight_ceiling(context(None, None), 5, {"estimatedDailyCostSgd": 9}) is None


# --- BUILD: paid activities get what is left after the flight and the stay ------------


def test_activities_ceiling_is_the_limit_minus_flight_and_stay():
    ceiling = itinerary._activities_ceiling(
        context(1500, None), 5, {"estimatedDailyCostSgd": 100}, {"price": 320}
    )
    assert ceiling == 680  # 1500 - 500 - 320


def test_no_activities_check_without_a_limit_or_when_already_over():
    assert itinerary._activities_ceiling(context(None, None), 5, {}, {"price": 320}) is None
    assert (
        itinerary._activities_ceiling(
            context(500, None), 5, {"estimatedDailyCostSgd": 100}, {"price": 320}
        )
        is None
    )


def test_drafted_activity_costs_reach_the_itinerary_items():
    draft = itinerary._DayDraft(
        day=1,
        items=[
            itinerary._ItemDraft(title="Snorkel tour", estimated_cost_sgd=45),
            itinerary._ItemDraft(title="Beach walk", estimated_cost_sgd=0),
            itinerary._ItemDraft(title="Mystery", estimated_cost_sgd=99_999),
            itinerary._ItemDraft(title="Market"),
        ],
    )

    items = itinerary._items_from_draft(1, draft, [])

    assert [i.cost for i in items] == [45, 0, None, None]


# --- DISCOVER: with levels only, an above-level place is labelled, not dropped --------


def test_above_level_destination_is_labelled_not_dropped():
    party = build_party_brief(
        MEMBERS, context(None, None)["preferences"], context(None, None)["characters"], DATES
    )
    card = discovery._DestinationCard(
        name="Zurich, Switzerland",
        pick="Wildcard",
        description="Lakes and banks.",
        why_this_fits="Scenic.",
        best_for=[],
        tags=["Scenery"],
        trade_off="Pricey.",
        details="Details.",
        estimated_daily_cost_sgd=300,
        preference_match=6,
        budget_fit=2,
        season_fit=7,
        trip_length_fit=7,
    )

    names, copy = discovery._choose_destinations(party, [card], {})

    assert "Zurich, Switzerland" in names
    trade_off = copy["zurich, switzerland"]["meta"]["tradeOff"]
    assert trade_off == "Pricey. Above the party's Low budget level (about SGD 50-120 a day)."
