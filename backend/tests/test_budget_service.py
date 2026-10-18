"""GET /trips/{tripId}/budget: the sidebar budget readout."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from app.agents.errors import TripNotFoundError
from app.services.budget_service import BudgetService

anyio = pytest.mark.anyio

TRIP = "22222222-2222-4222-8222-222222222222"
ROOM = "11111111-1111-4111-8111-111111111111"
M1 = "33333333-3333-4333-8333-333333333331"
M2 = "33333333-3333-4333-8333-333333333332"


FIVE_DAYS = {"tripDays": 5, "tripStart": "2026-10-12", "tripEnd": "2026-10-16"}


def repos(*, budgets=(1200, None), tiers=("low", "medium"), selections=(), itinerary=None):
    r = SimpleNamespace(
        trip_repo=AsyncMock(),
        member_repo=AsyncMock(),
        profile_repo=AsyncMock(),
        selection_repo=AsyncMock(),
        itinerary_version_repo=AsyncMock(),
    )
    r.trip_repo.get_by_id.return_value = {"id": TRIP, "room_id": ROOM}
    r.member_repo.list_by_room.return_value = [
        {"id": M1, "display_name": "Gerald"},
        {"id": M2, "display_name": "Priya"},
    ]
    dates = [{"start": "2026-10-12", "end": "2026-10-16"}]
    r.profile_repo.list_preferences_by_member_ids.return_value = [
        {"member_id": m, "budget": b, "available_dates": dates}
        for m, b in zip((M1, M2), budgets, strict=True)
    ]
    r.profile_repo.list_characters_by_member_ids.return_value = [
        {"member_id": m, "appearance": {"budgetTier": t}}
        for m, t in zip((M1, M2), tiers, strict=True)
    ]
    r.selection_repo.list_by_room.return_value = list(selections)
    r.itinerary_version_repo.get_approved.return_value = None
    r.itinerary_version_repo.get_latest.return_value = itinerary
    return r


@anyio
async def test_before_any_vote_shows_the_limit_level_and_full_remaining():
    budget = await BudgetService(repos()).get(TRIP)

    # The shared dates only say when the party is free; the trip length is unknown
    # until a destination (with its own length) is chosen.
    assert budget.days is None and budget.level_estimate is None
    assert budget.is_hard_limit and budget.limit == 1200 and budget.limit_set_by == "Gerald"
    assert budget.level == "low" and budget.level_count == 1
    assert budget.daily_range.low == 50 and budget.daily_range.typical == 80
    assert budget.estimates.total is None
    assert budget.remaining == 1200 and not budget.is_over_budget


@anyio
async def test_spend_adds_up_stay_flight_and_costed_activities():
    selections = [
        {"kind": "destination", "data": {"title": "Penang", "estimatedDailyCostSgd": 50}},
        {
            "kind": "flight",
            "data": {
                "price": 320,
                "depart_at": "2026-10-12T08:00:00",
                "return_at": "2026-10-15T20:00:00",
            },
        },
    ]
    itinerary = {
        "itinerary": {
            "days": [
                {"items": [{"cost": 30}, {"cost": None}, {"title": "free walk"}]},
                {"items": [{"cost": 45.5}]},
            ]
        }
    }

    budget = await BudgetService(repos(selections=selections, itinerary=itinerary)).get(TRIP)

    assert budget.days == 4  # the flight dates win over the shared dates
    assert budget.estimates.stay == 200  # 50 x 4
    assert budget.estimates.flight == 320
    assert budget.estimates.activities == 75.5
    assert budget.estimates.total == 595.5
    assert budget.remaining == 604.5 and not budget.is_over_budget


@anyio
async def test_levels_only_is_a_guide_with_no_limit_or_remaining():
    selections = [{"kind": "destination", "data": {"estimatedDailyCostSgd": 300, **FIVE_DAYS}}]

    budget = await BudgetService(repos(budgets=(None, None), selections=selections)).get(TRIP)

    assert budget.days == 5 and budget.level_estimate == 400  # the chosen trip's length
    assert not budget.is_hard_limit and budget.limit is None
    assert budget.estimates.total == 1500
    assert budget.remaining is None and not budget.is_over_budget


@anyio
async def test_over_the_limit_is_flagged():
    selections = [{"kind": "destination", "data": {"estimatedDailyCostSgd": 400, **FIVE_DAYS}}]

    budget = await BudgetService(repos(selections=selections)).get(TRIP)

    assert budget.estimates.total == 2000
    assert budget.remaining == -800 and budget.is_over_budget


@anyio
async def test_unknown_trip():
    r = repos()
    r.trip_repo.get_by_id.return_value = None

    with pytest.raises(TripNotFoundError):
        await BudgetService(r).get(TRIP)


def test_the_route_returns_camel_case_json():
    from app.api import deps
    from app.main import app
    from fastapi.testclient import TestClient

    app.dependency_overrides[deps.get_budget_service] = lambda: BudgetService(repos())
    try:
        response = TestClient(app).get(f"/trips/{TRIP}/budget")
    finally:
        app.dependency_overrides.pop(deps.get_budget_service, None)

    assert response.status_code == 200
    body = response.json()
    assert body["isHardLimit"] is True and body["limitSetBy"] == "Gerald"
    assert body["dailyRange"] == {"low": 50, "high": 120, "typical": 80}
    assert body["days"] is None
    assert body["estimates"] == {"stay": None, "flight": None, "activities": None, "total": None}
    assert body["remaining"] == 1200
