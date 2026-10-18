"""The party brief turns saved preferences into prompt text."""

from __future__ import annotations

from app.agents.party_brief import (
    budget_text,
    build_party_brief,
    members_text,
    named_places_text,
    trip_text,
    wants_text,
)

MEMBERS = [
    {"id": "m1", "display_name": "Gerald", "role": "owner"},
    {"id": "m2", "display_name": "Priya"},
    {"id": "m3", "display_name": "No prefs yet"},
]
PREFS = [
    {
        "member_id": "m1",
        "destinations": ["asia", "Tokyo, Japan", "beach-escape"],
        "interests": ["food", "nightlife"],
        "activities": ["hiking", {"name": "tea ceremony", "priority": "must_have"}],
        "travel_style": "planner",
        "budget": 2,
    },
    {
        "member_id": "m2",
        "destinations": ["Asia", "tokyo, japan"],
        "interests": ["food"],
        "activities": ["hiking"],
        "travel_style": "chill",
        "budget": 1200,
    },
]
CHARACTERS = [
    {"member_id": "m1", "appearance": {"budgetTier": "medium"}},
    {"member_id": "m2", "appearance": {"budgetTier": "low"}},
]
OVERLAP = [
    {"start": "2026-10-12", "end": "2026-10-13"},
    {"start": "2026-10-20", "end": "2026-10-24"},
]


def test_brief_counts_labels_and_separates_trip_types_from_places():
    brief = build_party_brief(MEMBERS, PREFS, CHARACTERS, OVERLAP)

    assert brief.party_size == 2  # members without preferences are left out
    assert brief.trip_types == [("Asia", 2), ("Beach Escape", 1)]
    assert brief.named_places == ["Tokyo, Japan"]  # de-duplicated, case-insensitive
    assert brief.priorities == [("Food", 2), ("Nightlife", 1)]
    assert brief.activities == [("Hiking", 2), ("Tea Ceremony", 1)]
    assert brief.roles == ["Planner", "Chill"]


def test_budget_uses_the_lowest_level_and_names_typo_amounts():
    brief = build_party_brief(MEMBERS, PREFS, CHARACTERS, OVERLAP)

    assert brief.budget_level == "Low"
    assert brief.budget_amount == 1200  # the "2" is never a limit
    assert budget_text(brief) == (
        "Budget level: low (1 of 2 chose Low Budget), about SGD 50-120 per person per day, "
        "excluding flights\n"
        "Budget per person for the whole trip, including flights: SGD 1,200 (a hard limit, "
        "set by Priya, the lowest in the party)\n"
        "Ignored as likely typos (outside SGD 100-50,000): Gerald entered SGD 2"
    )
    assert "budget: Low, SGD 1,200 total" in members_text(brief)


def test_dates_are_described_as_availability_not_trip_length():
    brief = build_party_brief(MEMBERS, PREFS, CHARACTERS, OVERLAP)

    assert brief.days == 5  # the longest stretch everyone is free
    assert brief.overlap == OVERLAP
    assert trip_text(brief) == (
        "the whole party is free from 20 Oct 2026 to 24 Oct 2026 (5 days available; this "
        "is when they can travel, not how long the trip is), departing from Singapore"
    )


def test_rendered_sections():
    brief = build_party_brief(MEMBERS, PREFS, CHARACTERS, OVERLAP)

    assert "- Trip types / regions: Asia (2/2), Beach Escape (1/2)" in wants_text(brief)
    assert members_text(brief).splitlines()[0] == (
        "- Gerald (party leader): trip types: Asia, Beach Escape | priorities: Food, Nightlife | "
        "activities: Hiking, Tea Ceremony | budget: Medium | role: Planner"
    )
    assert named_places_text(brief) == "- Tokyo, Japan"
    assert "- Shared by 2+ members: Food, Hiking" in wants_text(brief)
    assert "- Only one member asked for: Gerald: Nightlife, Gerald: Tea Ceremony" in wants_text(
        brief
    )


def test_typed_regions_count_as_trip_types_not_places():
    prefs = [{"member_id": "m1", "destinations": ["Europe", "Southeast Asia", "Lisbon, Portugal"]}]
    brief = build_party_brief(MEMBERS, prefs, [], [])

    assert brief.trip_types == [("Europe", 1), ("Southeast Asia", 1)]
    assert brief.named_places == ["Lisbon, Portugal"]


def test_nothing_known_still_renders():
    brief = build_party_brief([], [], None, [])

    assert trip_text(brief) == "Dates not set yet, departing from Singapore"
    assert "not stated" in budget_text(brief)
    assert named_places_text(brief) == "- none"
