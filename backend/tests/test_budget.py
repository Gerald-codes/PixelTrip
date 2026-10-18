"""The shared budget rules (app.core.budget)."""

from __future__ import annotations

from app.core.budget import band_text, is_valid_amount, party_budget

MEMBERS = [
    {"id": "m1", "display_name": "Gerald"},
    {"id": "m2", "display_name": "Priya"},
    {"id": "m3", "display_name": "Ken"},
]


def prefs(*budgets):
    return [{"member_id": f"m{i}", "budget": b} for i, b in enumerate(budgets, start=1)]


def chars(*tiers):
    return [
        {"member_id": f"m{i}", "appearance": {"budgetTier": t}}
        for i, t in enumerate(tiers, start=1)
        if t
    ]


def test_valid_amounts_and_bands():
    assert is_valid_amount(100) and is_valid_amount(50_000)
    assert not is_valid_amount(99) and not is_valid_amount(50_001) and not is_valid_amount("1500")
    assert band_text("low") == "SGD 50-120"
    assert band_text("high") == "SGD 250+"


def test_hard_limit_is_the_lowest_typed_amount_and_names_who_set_it():
    budget = party_budget(MEMBERS, prefs(2000, 1200, None), chars("high", "medium", "low"), 5)

    assert budget.is_hard
    assert budget.limit == 1200 and budget.limit_member == "Priya"
    assert budget.tier == "low" and budget.tier_count == 1
    assert budget.stay_estimate(80) == 400
    assert budget.over_limit(1300) and not budget.over_limit(1200)
    assert budget.money_for_flight(400) == 800


def test_levels_only_is_a_soft_guide_that_never_excludes():
    budget = party_budget(MEMBERS, prefs(None, None, None), chars("medium", "medium", None), 4)

    assert not budget.is_hard and budget.limit is None
    assert budget.tier == "medium" and budget.tier_count == 2
    assert not budget.over_limit(99_999)  # no limit, nothing is ever over it
    assert budget.money_for_flight(500) is None
    assert budget.above_level(300) and not budget.above_level(200)
    assert budget.members[0].estimate(4) == 720  # Medium typical 180 x 4 days


def test_out_of_range_amounts_saved_earlier_are_not_limits():
    budget = party_budget(MEMBERS, prefs(2, None, None), chars("low", None, None), 5)

    assert budget.limit is None
    assert budget.members[0].amount is None


def test_missing_estimates_never_exclude():
    budget = party_budget(MEMBERS, prefs(1000, None, None), [], None)

    assert budget.stay_estimate(150) is None  # no trip length yet
    assert not budget.over_limit(None)
    assert not budget.above_level(500)  # no level known
