"""Per-member profiles and the party agreement summary the planning prompts read."""

from __future__ import annotations

from app.agents.group_profile import (
    compute_agreement,
    compute_group_profile,
    compute_member_profiles,
    format_party_for_prompt,
    is_region_word,
    member_origin,
)

ANDY = {"id": "m1", "display_name": "Andy", "role": "owner"}
BEE = {"id": "m2", "display_name": "Bee", "role": "member"}
CAL = {"id": "m3", "display_name": "Cal", "role": "member"}

ANDY_PREFS = {
    "member_id": "m1",
    "budget": 1500,
    "travel_style": "relaxed",
    "interests": ["Beach", "street food"],
    "activities": [{"name": "snorkelling", "priority": "must_have"}],
    "destinations": ["Asia"],
    "hard_constraints": ["no red-eye flights", {"type": "departure_origin", "value": "SIN"}],
}
BEE_PREFS = {
    "member_id": "m2",
    "budget": 900,
    "travel_style": "packed",
    "interests": ["street food", "nightlife"],
}


def test_each_member_keeps_their_own_values_and_the_leader_is_marked() -> None:
    profiles = compute_member_profiles([ANDY, BEE], [ANDY_PREFS, BEE_PREFS])

    andy, bee = profiles
    assert andy["name"] == "Andy" and andy["is_owner"] and not bee["is_owner"]
    assert (andy["budget"], bee["budget"]) == (1500, 900)
    assert andy["required_activities"] == ["snorkelling"]
    assert bee["required_activities"] == []


def test_the_mirrored_origin_is_read_but_never_listed_as_a_constraint() -> None:
    andy = compute_member_profiles([ANDY], [ANDY_PREFS])[0]

    assert andy["origin"] == member_origin(ANDY_PREFS) == "SIN"
    assert andy["hard_constraints"] == ["no red-eye flights"]


def test_a_member_without_saved_preferences_still_appears() -> None:
    profiles = compute_member_profiles([ANDY, CAL], [ANDY_PREFS])

    assert profiles[1]["name"] == "Cal" and not profiles[1]["has_preferences"]
    assert "has not saved any preferences" in format_party_for_prompt(
        {"member_profiles": profiles, "agreement": compute_agreement(profiles)}
    )


def test_agreement_separates_shared_interests_from_one_persons_ask() -> None:
    agreement = compute_agreement(compute_member_profiles([ANDY, BEE], [ANDY_PREFS, BEE_PREFS]))

    assert agreement["shared_interests"] == ["street food"]
    assert "Bee: nightlife" in agreement["solo_interests"]
    assert "Andy: Beach" in agreement["solo_interests"]
    assert agreement["style_split"] == ["Andy: relaxed", "Bee: packed"]
    assert agreement["origins"] == ["SIN"]


def test_the_group_profile_exposes_members_and_agreement() -> None:
    profile = compute_group_profile([ANDY, BEE], [ANDY_PREFS, BEE_PREFS])

    assert [p["name"] for p in profile["member_profiles"]] == ["Andy", "Bee"]
    assert profile["agreement"]["shared_interests"] == ["street food"]
    assert profile["budget_ceiling"] == 900  # unchanged: the lowest budget still governs


def test_prompt_block_is_empty_without_members() -> None:
    assert format_party_for_prompt({}) == ""


def test_prompt_values_are_clipped_as_untrusted_input() -> None:
    hostile = {**BEE_PREFS, "interests": ["x" * 5000]}
    block = format_party_for_prompt(compute_group_profile([BEE], [hostile]))

    assert len(block) < 2000


def test_region_words_are_recognised_case_insensitively() -> None:
    assert is_region_word(" Asia ") and is_region_word("Southeast Asia")
    assert not is_region_word("Bali, Indonesia") and not is_region_word("Tokyo")


def test_the_party_flies_from_singapore_unless_a_member_says_otherwise() -> None:
    no_origin = compute_agreement(compute_member_profiles([BEE], [BEE_PREFS]))
    explicit = compute_agreement(compute_member_profiles([ANDY], [ANDY_PREFS]))

    assert no_origin["origins"] == ["Singapore"]
    assert explicit["origins"] == ["SIN"]
    assert "flying from: Singapore" in format_party_for_prompt(
        compute_group_profile([BEE], [BEE_PREFS])
    )


def test_frontend_vibe_ids_are_steering_with_readable_labels_and_keywords() -> None:
    from app.agents.group_profile import describe_wishes, vibe_keywords

    for raw in ("beach-escape", "beach_escape", "Beach Escape", "beach_escaape"):
        assert is_region_word(raw) and "beach" in vibe_keywords(raw)
    assert is_region_word("western-cities") and "europe" in vibe_keywords("western-cities")
    assert describe_wishes(["asia", "beach-escape", "Bali, Indonesia"]) == [
        "Asia (region)",
        "beach escape (vibe)",
        "Bali, Indonesia",
    ]
    assert not is_region_word("Bali, Indonesia")
