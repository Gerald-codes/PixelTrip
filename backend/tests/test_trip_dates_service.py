"""GET/PUT /trips/{tripId}/trip-dates: read the plan; the leader changes it."""

from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from app.agents.errors import DestinationNotSelectedError, UnresolvedMemberError
from app.exceptions import InvalidTripDatesError, TripDatesLockedError
from app.schemas.planning import ChangeTripDatesRequest
from app.services.trip_dates_service import LOCKED_BY_FLIGHT, TripDatesService

anyio = pytest.mark.anyio

TRIP = "22222222-2222-4222-8222-222222222222"
ROOM = "11111111-1111-4111-8111-111111111111"
OWNER = "33333333-3333-4333-8333-333333333331"
MEMBER = "33333333-3333-4333-8333-333333333332"

TODAY = date.today()
FREE_START = TODAY + timedelta(days=2)
FREE_END = TODAY + timedelta(days=31)


def iso(days_from_today: int) -> str:
    return (TODAY + timedelta(days=days_from_today)).isoformat()


def destination(**extra):
    return {
        "id": "penang",
        "title": "Penang, Malaysia",
        "estimatedDailyCostSgd": 32,
        "tripDays": 4,
        "tripStart": iso(5),
        "tripEnd": iso(8),
        "whyThisLong": "Four days covers it.",
        **extra,
    }


def repos(*, selections=None, open_flight_vote=None):
    r = SimpleNamespace(
        trip_repo=AsyncMock(),
        room_repo=AsyncMock(),
        member_repo=AsyncMock(),
        profile_repo=AsyncMock(),
        selection_repo=AsyncMock(),
        vote_session_repo=AsyncMock(),
        message_repo=AsyncMock(),
        agent_run_repo=AsyncMock(),
    )
    r.agent_run_repo.get_active.return_value = None
    r.room_repo.get_by_id.return_value = {"id": ROOM}
    r.trip_repo.get_by_id.return_value = {"id": TRIP, "room_id": ROOM}
    r.trip_repo.get_room_id_for_trip.return_value = ROOM
    members = [
        {"id": OWNER, "display_name": "Gerald", "role": "owner"},
        {"id": MEMBER, "display_name": "Priya", "role": "member"},
    ]
    r.member_repo.list_by_room.return_value = members
    r.member_repo.get_owner.return_value = members[0]
    dates = [{"start": FREE_START.isoformat(), "end": FREE_END.isoformat()}]
    r.profile_repo.list_preferences_by_member_ids.return_value = [
        {"member_id": OWNER, "budget": 1200, "available_dates": dates},
        {"member_id": MEMBER, "budget": None, "available_dates": dates},
    ]
    r.profile_repo.list_characters_by_member_ids.return_value = []
    rows = selections if selections is not None else {"destination": destination()}

    def row(kind):
        return {"kind": kind, "data": rows[kind], "vote_session_id": "vs-dest"}

    async def list_rows(_room):
        return [row(kind) for kind in rows]

    async def by_kind(_room, kind):
        return row(kind) if kind in rows else None

    r.selection_repo.list_by_room.side_effect = list_rows

    r.selection_repo.get_by_room_and_kind.side_effect = by_kind

    async def upsert(_room, kind, data, vote_session_id=None):
        rows[kind] = data

    r.selection_repo.upsert.side_effect = upsert
    r.vote_session_repo.get_open_by_room_and_category.return_value = open_flight_vote
    return r


def change(days: int, start_in: int, member: str = OWNER) -> ChangeTripDatesRequest:
    return ChangeTripDatesRequest(member_id=member, days=days, start=iso(start_in))


@anyio
async def test_get_returns_the_plan_and_what_it_may_change_to():
    dates = await TripDatesService(repos()).get(TRIP)

    assert dates.destination == "Penang, Malaysia"
    assert dates.trip_days == 4 and dates.trip_start.isoformat() == iso(5)
    assert [(w.start, w.end) for w in dates.windows] == [(FREE_START, FREE_END)]
    assert (dates.min_days, dates.max_days) == (2, 14)
    assert dates.daily_cost_sgd == 32 and dates.budget_limit == 1200
    assert dates.can_change and dates.locked_reason is None


@anyio
async def test_the_dates_lock_once_a_flight_is_chosen_or_before_a_destination():
    locked = await TripDatesService(
        repos(selections={"destination": destination(), "flight": {"id": "f1"}})
    ).get(TRIP)
    assert not locked.can_change and locked.locked_reason == LOCKED_BY_FLIGHT

    none_yet = await TripDatesService(repos(selections={})).get(TRIP)
    assert not none_yet.can_change and none_yet.trip_days is None


@anyio
async def test_the_leader_changes_the_dates_and_the_old_flight_vote_is_closed():
    r = repos(open_flight_vote={"id": "vs-flight", "tie_pending": True})

    dates = await TripDatesService(r).change(TRIP, change(days=6, start_in=10))

    assert dates.trip_days == 6
    assert (dates.trip_start.isoformat(), dates.trip_end.isoformat()) == (iso(10), iso(15))
    assert dates.why_this_long == "Set by the party leader."
    saved = r.selection_repo.upsert.await_args
    assert saved.args[1] == "destination" and saved.kwargs["vote_session_id"] == "vs-dest"
    assert saved.args[2]["title"] == "Penang, Malaysia"  # the rest of the choice is kept
    # The flight vote was for the old dates: tie cleared, vote closed, everyone un-readied.
    r.vote_session_repo.clear_tie_pending.assert_awaited_once_with("vs-flight")
    r.vote_session_repo.close.assert_awaited_once_with("vs-flight")
    assert [c.args for c in r.member_repo.set_stage_ready.await_args_list] == [
        (OWNER, False),
        (MEMBER, False),
    ]


@anyio
async def test_only_the_leader_may_change_and_only_before_the_flight_locks():
    with pytest.raises(UnresolvedMemberError):
        await TripDatesService(repos()).change(TRIP, change(4, 5, member=MEMBER))

    with pytest.raises(TripDatesLockedError):
        await TripDatesService(
            repos(selections={"destination": destination(), "flight": {"id": "f1"}})
        ).change(TRIP, change(4, 5))

    searching = repos()
    searching.agent_run_repo.get_active.return_value = {"id": "run-1", "status": "running"}
    with pytest.raises(TripDatesLockedError, match="searching flights"):
        await TripDatesService(searching).change(TRIP, change(4, 5))
    searching.selection_repo.upsert.assert_not_called()

    with pytest.raises(DestinationNotSelectedError):
        await TripDatesService(repos(selections={})).change(TRIP, change(4, 5))


@anyio
@pytest.mark.parametrize(
    ("days", "start_in", "message"),
    [
        (20, 5, "2 to 14 days"),  # too long
        (1, 5, "2 to 14 days"),  # too short
        (4, 0, "outside when the whole party is free"),  # before the free window
        (6, 28, "outside when the whole party is free"),  # runs past the free window
        (4, -3, "in the past"),
    ],
)
async def test_dates_that_do_not_fit_are_refused_and_nothing_is_saved(days, start_in, message):
    r = repos()

    with pytest.raises(InvalidTripDatesError, match=message):
        await TripDatesService(r).change(TRIP, change(days, start_in))

    r.selection_repo.upsert.assert_not_called()
    r.vote_session_repo.close.assert_not_called()


# --- routes -------------------------------------------------------------------------


@pytest.fixture
def api(mocker):
    from app.api.deps import get_trip_dates_service
    from app.main import app
    from fastapi.testclient import TestClient

    service = mocker.AsyncMock(spec=TripDatesService)
    app.dependency_overrides[get_trip_dates_service] = lambda: service
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, service
    app.dependency_overrides.clear()


def _dates(**overrides):
    from app.schemas.planning import TripDatesResponse

    return TripDatesResponse.model_validate(
        {
            "destination": "Penang, Malaysia",
            "trip_days": 4,
            "trip_start": iso(5),
            "trip_end": iso(8),
            "why_this_long": "Four days covers it.",
            "windows": [{"start": FREE_START.isoformat(), "end": FREE_END.isoformat()}],
            "min_days": 2,
            "max_days": 14,
            "daily_cost_sgd": 32,
            "budget_limit": 1200,
            "can_change": True,
            "locked_reason": None,
            **overrides,
        }
    )


def test_get_trip_dates_route_answers_in_camel_case(api):
    client, service = api
    service.get.return_value = _dates()

    response = client.get(f"/trips/{TRIP}/trip-dates")

    assert response.status_code == 200
    body = response.json()
    assert body["tripDays"] == 4 and body["tripStart"] == iso(5)
    assert body["canChange"] is True and body["minDays"] == 2
    assert body["windows"] == [{"start": FREE_START.isoformat(), "end": FREE_END.isoformat()}]


def test_put_trip_dates_route_passes_the_change_on(api):
    client, service = api
    service.change.return_value = _dates(trip_days=6)

    response = client.put(
        f"/trips/{TRIP}/trip-dates", json={"memberId": OWNER, "days": 6, "start": iso(10)}
    )

    assert response.status_code == 200 and response.json()["tripDays"] == 6
    request = service.change.await_args.args[1]
    assert (str(request.member_id), request.days, request.start.isoformat()) == (
        OWNER,
        6,
        iso(10),
    )


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (InvalidTripDatesError("The trip cannot start in the past."), 422, "INVALID_TRIP_DATES"),
        (TripDatesLockedError(LOCKED_BY_FLIGHT), 409, "TRIP_DATES_LOCKED"),
        (UnresolvedMemberError(MEMBER), 422, "MEMBER_NOT_RESOLVED"),
    ],
)
def test_put_trip_dates_route_reports_refusals_in_the_error_envelope(api, error, status, code):
    client, service = api
    service.change.side_effect = error

    response = client.put(
        f"/trips/{TRIP}/trip-dates", json={"memberId": OWNER, "days": 4, "start": iso(5)}
    )

    assert response.status_code == status
    assert response.json()["error"]["code"] == code
