"""Flight and destination details survive from the AI's recommendation to later stages.

Covers the round-trip return leg in the flight recommendation, the locked selection
keeping the winning option's full details, and destination names read from ``label``.
"""

from __future__ import annotations

from datetime import date

from app.agents.nodes.itinerary import _build_itinerary, _derive_day_count
from app.agents.nodes.logistics import _build_proposal
from app.agents.tools.base import FlightOption
from app.services.vote_service import selection_data

ROUND_TRIP = FlightOption(
    id="f1",
    carrier="Singapore Airlines",
    flight_number="SQ12",
    origin="SIN",
    destination="NRT",
    depart_at="2026-12-20T09:05:00",
    arrive_at="2026-12-20T17:05:00",
    price=980.0,
    duration_minutes=420,
    stops=0,
    return_depart_at="2026-12-27T10:30:00",
    return_arrive_at="2026-12-27T16:40:00",
)


def test_flight_recommendation_carries_the_return_leg():
    item = _build_proposal([ROUND_TRIP])["items"][0]

    assert item["meta"]["depart_at"] == "2026-12-20T09:05:00"
    assert item["meta"]["return_at"] == "2026-12-27T10:30:00"
    assert item["meta"]["return_arrive_at"] == "2026-12-27T16:40:00"


def test_one_way_option_has_no_return_leg():
    one_way = ROUND_TRIP.model_copy(update={"return_depart_at": None, "return_arrive_at": None})

    assert _build_proposal([one_way])["items"][0]["meta"]["return_at"] is None


def test_selection_keeps_the_winning_items_details():
    message = {"content": {"items": [_build_proposal([ROUND_TRIP])["items"][0]]}}

    data = selection_data({"id": "f1", "label": "Singapore Airlines SQ12"}, message)

    assert data["id"] == "f1"
    assert data["label"] == "Singapore Airlines SQ12"
    assert data["title"] == "Singapore Airlines SQ12"
    assert data["depart_at"] == "2026-12-20T09:05:00"
    assert data["return_at"] == "2026-12-27T10:30:00"
    assert data["price"] == 980.0


def test_selection_without_a_matching_item_is_just_the_option():
    data = selection_data({"id": "x", "label": "Tokyo"}, {"content": {"items": []}})

    assert data == {"id": "x", "label": "Tokyo"}


def test_itinerary_length_comes_from_the_locked_flight():
    flight = {
        "data": selection_data(
            {"id": "f1", "label": "SQ12"},
            {"content": {"items": [_build_proposal([ROUND_TRIP])["items"][0]]}},
        )
    }

    days = _derive_day_count(flight, {"availability_overlap": []})

    assert days == 8  # 20th to 27th inclusive


def test_itinerary_title_uses_the_destination_label():
    itinerary = _build_itinerary(
        "trip", "room", {"data": {"id": "tokyo", "label": "Tokyo"}}, date(2026, 12, 20), 2
    )

    assert "Tokyo" in itinerary.title
    assert "the destination" not in itinerary.title
