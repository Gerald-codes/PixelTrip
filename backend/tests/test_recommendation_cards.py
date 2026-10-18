"""Recommendation items carry card copy the frontend renders (CR-1).

Every destination and flight item has a ``description`` and ``meta`` with ``score``
(0-100), ``whyThisFits``, ``tags``, ``tradeOff`` and ``details``. Destination
items also carry ``pick``, ``bestFor``, ``estimatedDailyCostSgd`` and
``scoreBreakdown``. Flights keep their factual meta keys alongside.
"""

from __future__ import annotations

from typing import Any

from app.agents.nodes import discovery
from app.agents.nodes.logistics import _build_proposal as build_flight_proposal
from app.agents.party_brief import build_party_brief
from app.agents.proposals import RecommendationItem
from app.agents.tools.base import FlightOption

CARD_KEYS = {"score", "whyThisFits", "tags", "tradeOff", "details"}
DESTINATION_KEYS = CARD_KEYS | {
    "pick",
    "bestFor",
    "estimatedDailyCostSgd",
    "scoreBreakdown",
    "tripDays",
    "tripStart",
    "tripEnd",
    "whyThisLong",
}

MEMBERS = [{"id": "m1", "display_name": "Gerald"}, {"id": "m2", "display_name": "Priya"}]


def brief(**prefs: Any):
    base = {
        "destinations": ["asia"],
        "interests": ["food"],
        "available_dates": [{"start": "2026-12-20", "end": "2026-12-24"}],
    }
    base.update(prefs)
    rows = [{"member_id": "m1", **base}, {"member_id": "m2", **base}]
    return build_party_brief(MEMBERS, rows, [], [{"start": "2026-12-20", "end": "2026-12-24"}])


def card(name: str, **overrides: Any) -> discovery._DestinationCard:
    data: dict[str, Any] = {
        "name": name,
        "pick": "Wildcard",
        "description": "Island beaches and night markets.",
        "why_this_fits": "Matches the party's love of food.",
        "best_for": ["Gerald", "Nobody"],
        "tags": ["Budget", "Low crowds", "Nightlife"],
        "trade_off": "Showers are possible.",
        "details": "Dry season with warm seas.",
        "estimated_daily_cost_sgd": 120,
        "preference_match": 9,
        "budget_fit": 8,
        "season_fit": 7,
        "trip_length_fit": 6,
    }
    data.update(overrides)
    return discovery._DestinationCard(**data)


def choose(party, *cards):
    names, copy = discovery._choose_destinations(party, list(cards), {})
    return discovery._build_proposal(names, copy, party)["items"]


# --- Destinations -------------------------------------------------------------------


def test_destination_items_carry_the_full_card():
    items = choose(brief(), card("Phuket, Thailand"))
    phuket = items[0]

    assert phuket["id"] == "phuket--thailand"
    assert phuket["description"] == "Island beaches and night markets."
    assert set(phuket["meta"]) == DESTINATION_KEYS
    meta = phuket["meta"]
    # 10 x (0.4*9 + 0.2*8 + 0.2*7 + 0.2*6) = 78
    assert meta["score"] == 78
    assert meta["scoreBreakdown"] == {"preferences": 9, "budget": 8, "season": 7, "tripLength": 6}
    assert meta["bestFor"] == ["Gerald"]  # unknown names dropped
    assert meta["estimatedDailyCostSgd"] == 120
    assert meta["pick"] == "Best fit"  # the only LLM card is the best fit
    for item in items:
        RecommendationItem.model_validate(item)  # contract shape unchanged


def test_sub_scores_are_clamped():
    meta = choose(brief(), card("Bali, Indonesia", preference_match=40, budget_fit=-3))[0]["meta"]

    assert meta["scoreBreakdown"]["preferences"] == 10
    assert meta["scoreBreakdown"]["budget"] == 0


def test_exactly_one_best_fit_the_highest_score():
    items = choose(
        brief(),
        card("Bali, Indonesia", pick="Best fit", preference_match=5),
        card("Hanoi, Vietnam", pick="Best fit", preference_match=10),
        card("Seoul, South Korea", pick="hidden gem"),
    )
    picks = {i["title"]: i["meta"]["pick"] for i in items}

    assert picks["Hanoi, Vietnam"] == "Best fit"
    assert picks["Bali, Indonesia"] == "Wildcard"
    assert picks["Seoul, South Korea"] == "Hidden gem"


def test_at_most_two_cards_per_country():
    items = choose(
        brief(),
        card("Bangkok, Thailand"),
        card("Phuket, Thailand"),
        card("Chiang Mai, Thailand"),
        card("Hanoi, Vietnam", preference_match=1),
    )
    titles = [i["title"] for i in items]

    assert sum(t.endswith("Thailand") for t in titles) == 2
    assert "Hanoi, Vietnam" in titles


def test_over_budget_suggestions_are_dropped_while_enough_remain():
    party = brief(budget=1000)  # even a 2-day stay at SGD 600 a day is over the limit
    items = choose(
        party,
        card("Tokyo, Japan", estimated_daily_cost_sgd=600, preference_match=10),
        card("Hanoi, Vietnam", estimated_daily_cost_sgd=90),
        card("Bali, Indonesia", estimated_daily_cost_sgd=120),
        card("Penang, Malaysia", estimated_daily_cost_sgd=80),
    )
    assert "Tokyo, Japan" not in [i["title"] for i in items]

    # Too few would remain, so an over-budget card is kept rather than lost.
    kept = choose(party, card("Tokyo, Japan", estimated_daily_cost_sgd=600))
    assert kept[0]["title"] == "Tokyo, Japan"


def test_named_places_are_always_kept_and_get_fallback_copy_if_skipped():
    party = brief(destinations=["Lisbon, Portugal", "asia"])
    items = choose(party, card("Bali, Indonesia"))
    lisbon = items[0]

    assert lisbon["title"] == "Lisbon, Portugal"
    assert set(lisbon["meta"]) == DESTINATION_KEYS
    assert lisbon["meta"]["score"] == discovery.WISHLIST_SCORE
    assert lisbon["meta"]["pick"] == discovery.PARTY_PICK


def test_copy_mentioning_a_hard_constraint_is_replaced():
    """The business guardrail scans item text; forbidden words would sink the proposal."""
    party = brief()
    names, copy = discovery._choose_destinations(
        party, [card("Phuket, Thailand", tags=["Casinos"])], {"hard_constraints": ["no casinos"]}
    )

    assert "phuket, thailand" not in copy


def test_no_llm_fills_from_the_fallback_pool_ranked_for_the_party():
    party = brief(destinations=["asia", "beach-escape"])
    names, copy = discovery._choose_destinations(
        party, [], {"destinations": ["asia", "beach-escape"], "interests": ["food"]}
    )
    items = discovery._build_proposal(names, copy, party)["items"]

    asian = {name for name, keywords in discovery.FALLBACK_POOL if "asia" in keywords}
    assert {i["title"] for i in items} <= asian and len(items) == 5
    assert items[0]["title"] in {"Bali, Indonesia", "Phuket, Thailand", "Da Nang, Vietnam"}
    assert items[0]["meta"]["tags"] == [discovery.GUIDE_PICK]
    assert items[0]["meta"]["score"] == discovery.SUGGESTED_SCORE


# --- Flights ------------------------------------------------------------------------

CHEAP = FlightOption(
    id="f1",
    carrier="Scoot",
    flight_number="TR808",
    origin="SIN",
    destination="NRT",
    depart_at="2026-12-20T01:00:00",
    arrive_at="2026-12-20T09:00:00",
    price=600.0,
    duration_minutes=480,
    stops=1,
)
FAST = CHEAP.model_copy(
    update={
        "id": "f2",
        "carrier": "Singapore Airlines",
        "flight_number": "SQ12",
        "price": 980.0,
        "duration_minutes": 405,
        "stops": 0,
        "return_depart_at": "2026-12-27T10:30:00",
    }
)


def test_flight_items_keep_their_facts_and_add_card_copy():
    proposal = build_flight_proposal([CHEAP, FAST], currency="SGD")
    cheap, fast = proposal["items"]

    # Factual keys the guardrail, itinerary and tiebreak rely on are untouched.
    assert cheap["meta"]["price"] == 600.0 and cheap["meta"]["flight_number"] == "TR808"
    assert CARD_KEYS <= set(cheap["meta"])
    assert cheap["meta"]["tags"] == ["SGD 600", "Scoot", "8h 00m", "1 stop"]
    assert fast["meta"]["tags"] == ["SGD 980", "Singapore Airlines", "6h 45m", "Direct"]
    assert cheap["meta"]["whyThisFits"] == "The cheapest option for the party."
    assert fast["meta"]["whyThisFits"] == "The quickest journey and a direct flight for the party."
    assert fast["meta"]["tradeOff"] == "SGD 380 more than the cheapest option."
    assert cheap["meta"]["tradeOff"] == "1 stop where other options fly with fewer."
    assert "round trip" in fast["meta"]["details"]
    assert "one way" in cheap["meta"]["details"]
    assert cheap["description"] == "SIN to NRT, 1 stop, 8h 00m, SGD 600."
    for item in proposal["items"]:
        RecommendationItem.model_validate(item)


def test_flight_score_is_value_for_money():
    cheap, fast = build_flight_proposal([CHEAP, FAST], currency="SGD")["items"]

    # Cheapest but slowest with a stop: 95 - 15 - 8. Priciest, fastest, direct: 95 - 30.
    assert cheap["meta"]["score"] == 72
    assert fast["meta"]["score"] == 65
    only = build_flight_proposal([FAST], currency="SGD")["items"][0]
    assert only["meta"]["score"] == 95
    assert only["meta"]["tradeOff"] == "Nothing stands out against the other options."
