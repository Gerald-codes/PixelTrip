"""Exercise prepared runs and real voting/reviews over one shared in-memory store."""

from collections import Counter
from copy import deepcopy
from datetime import date, datetime, time, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from app.agents.proposals import ItineraryModel
from app.agents.state import AgentState
from app.demo import SCENARIO, require_demo_pair
from app.demo.runner import dispatch_run, refine_itinerary
from app.demo.scenario import (
    DESTINATIONS,
    LEGACY_DESTINATIONS,
    REFINEMENTS,
    build_itinerary,
    destination_items,
    flight_items,
)
from app.exceptions import ValidationError
from app.schemas.planning import (
    ReviewItineraryRequest,
    SavePreferencesRequest,
    SubmitFeedbackRequest,
)
from app.schemas.room import CreateRoomRequest, JoinRoomRequest
from app.services.preference_service import PreferenceService
from app.services.refine_service import RefineService
from app.services.room_service import RoomService
from app.services.run_endpoint_service import RunEndpointService
from app.services.vote_service import break_tie, cast_vote

ROOM, TRIP, ALICE, BOB = [str(uuid4()) for _ in range(4)]


class World:
    def __init__(self):
        self.room = {
            "id": ROOM,
            "room_code": "DEMO12",
            "name": "Demo",
            "status": "active",
            "planning_stage": "discover",
            "demo_scenario": SCENARIO,
            "demo_start": str(date.today() + timedelta(days=7)),
        }
        self.trip = {
            "id": TRIP,
            "room_id": ROOM,
            "title": "Demo",
            "summary": None,
            "status": "preferences_collected",
        }
        self.members = [
            {
                "id": ALICE,
                "room_id": ROOM,
                "display_name": "DemoAlice",
                "role": "owner",
                "stage_ready": False,
            },
            {
                "id": BOB,
                "room_id": ROOM,
                "display_name": "DemoBob",
                "role": "member",
                "stage_ready": False,
            },
        ]
        self.messages, self.sessions, self.votes, self.selections = {}, {}, {}, {}
        self.versions, self.feedback, self.runs = [], [], {}
        names = [
            "trip",
            "room",
            "member",
            "profile",
            "message",
            "vote",
            "vote_session",
            "selection",
            "itinerary_version",
            "feedback",
            "agent_run",
        ]
        self.repos = SimpleNamespace(**{name + "_repo": AsyncMock() for name in names})
        r = self.repos
        r.trip_repo.get_by_id.side_effect = lambda _: deepcopy(self.trip)
        r.trip_repo.get_by_room_id.side_effect = lambda _: deepcopy(self.trip)
        r.trip_repo.get_room_id_for_trip.return_value = ROOM
        r.trip_repo.update_status.side_effect = self.advance
        r.room_repo.get_by_id.side_effect = lambda _: deepcopy(self.room)
        r.member_repo.list_by_room.side_effect = lambda _: deepcopy(self.members)
        r.member_repo.list_members_by_room.side_effect = lambda _: deepcopy(self.members)
        r.member_repo.get_by_id.side_effect = lambda mid: next(
            (deepcopy(m) for m in self.members if m["id"] == mid), None
        )
        r.member_repo.get_owner.side_effect = lambda _: deepcopy(self.members[0])
        r.member_repo.set_stage_ready.side_effect = self.ready
        r.profile_repo.list_characters_by_member_ids.return_value = []
        r.profile_repo.list_preferences_by_member_ids.side_effect = lambda ids: [
            {"member_id": mid, "submitted_at": "2026-10-13T00:00:00Z"} for mid in ids
        ]
        r.message_repo.insert_turn.side_effect = self.insert_messages
        r.message_repo.get_by_id.side_effect = lambda mid: self.messages.get(mid)
        r.message_repo.count_progress_messages.return_value = 0
        r.vote_session_repo.create.side_effect = self.create_vote
        r.vote_session_repo.get_by_id.side_effect = lambda sid: self.sessions.get(sid)
        r.vote_session_repo.get_open_by_room_and_category.side_effect = lambda rid, cat: next(
            (v for v in self.sessions.values() if v["status"] == "open" and v["category"] == cat),
            None,
        )
        r.vote_session_repo.get_tie_pending_by_room.side_effect = lambda rid: next(
            (v for v in self.sessions.values() if v.get("tie_pending")), None
        )
        r.vote_session_repo.close.side_effect = self.close_vote
        r.vote_session_repo.mark_tie_pending.side_effect = self.tie
        r.vote_session_repo.clear_tie_pending.side_effect = self.clear_tie
        r.vote_repo.upsert.side_effect = self.vote
        r.vote_repo.count_distinct_voters.side_effect = lambda sid, ids: len(
            {mid for (s, mid) in self.votes if s == sid and mid in ids}
        )
        r.vote_repo.count_by_option.side_effect = lambda sid, ids: dict(
            Counter(option for (s, mid), option in self.votes.items() if s == sid and mid in ids)
        )
        r.selection_repo.list_by_room.side_effect = lambda _: list(self.selections.values())
        r.selection_repo.upsert.side_effect = self.select
        r.itinerary_version_repo.get_latest.side_effect = lambda _: (
            deepcopy(self.versions[-1]) if self.versions else None
        )
        r.itinerary_version_repo.get_latest_version_number.side_effect = lambda _: len(
            self.versions
        )
        r.itinerary_version_repo.insert_version.side_effect = self.insert_version
        r.itinerary_version_repo.supersede_lower_versions.side_effect = self.supersede
        r.itinerary_version_repo.get_by_id.side_effect = lambda vid: next(
            (deepcopy(v) for v in self.versions if v["id"] == vid), None
        )
        r.itinerary_version_repo.mark_approved.side_effect = self.approve
        r.itinerary_version_repo.get_approved.side_effect = lambda _: next(
            (v for v in self.versions if v["status"] == "approved"), None
        )
        r.feedback_repo.create.side_effect = self.add_feedback
        r.feedback_repo.list_open_by_trip.side_effect = lambda _: [
            f for f in self.feedback if f["status"] == "open"
        ]
        r.feedback_repo.mark_addressed.side_effect = self.address
        r.agent_run_repo.get_by_idempotency_key.side_effect = lambda key: next(
            (v for v in self.runs.values() if v["idempotency_key"] == key), None
        )
        r.agent_run_repo.get_active.return_value = None
        r.agent_run_repo.create_pending.side_effect = self.pending
        r.agent_run_repo.mark_running.side_effect = lambda rid: self.run_status(rid, "running")
        r.agent_run_repo.mark_completed.side_effect = lambda rid, vid: self.run_status(
            rid, "completed", vid
        )
        r.agent_run_repo.mark_failed.side_effect = lambda rid, error: self.run_status(rid, "failed")
        self.llm = AsyncMock()
        self.llm.generate_structured.side_effect = AssertionError("Demo called Gemini")
        self.service = RunEndpointService(**vars(r), llm_client=self.llm)

    async def advance(self, tid, status, stage):
        if self.room["planning_stage"] != stage or status == "refinement_completed":
            for member in self.members:
                member["stage_ready"] = False
        self.room["planning_stage"] = stage
        self.trip["status"] = status
        return deepcopy(self.trip)

    async def ready(self, mid, value):
        next(m for m in self.members if m["id"] == mid)["stage_ready"] = value

    async def insert_messages(self, rid, rows):
        result = [{"id": str(uuid4()), "room_id": rid, **row} for row in rows]
        self.messages.update({r["id"]: r for r in result})
        return result

    async def create_vote(self, **fields):
        category = self.messages[fields["message_id"]]["content"]["category"]
        row = {"id": str(uuid4()), "status": "open", "category": category, **fields}
        self.sessions[row["id"]] = row
        return row

    async def close_vote(self, sid):
        self.sessions[sid]["status"] = "closed"
        return self.sessions[sid]

    async def tie(self, sid, ids, category):
        self.sessions[sid].update(tie_pending=True, tie_option_ids=ids, category=category)
        return self.sessions[sid]

    async def clear_tie(self, sid):
        self.sessions[sid]["tie_pending"] = False

    async def vote(self, sid, mid, option):
        self.votes[sid, mid] = option
        return {"id": str(uuid4()), "vote_session_id": sid, "member_id": mid, "option_id": option}

    async def select(self, room_id, kind, data, vote_session_id=None):
        row = {
            "id": str(uuid4()),
            "room_id": room_id,
            "kind": kind,
            "data": data,
            "vote_session_id": vote_session_id,
        }
        self.selections[kind] = row
        return row

    async def insert_version(self, **data):
        row = {"id": str(uuid4()), "status": "proposed", **data}
        self.versions.append(row)
        return row

    async def supersede(self, tid, below_version):
        for v in self.versions:
            if v["version"] < below_version:
                v["status"] = "superseded"

    async def approve(self, vid):
        row = next(v for v in self.versions if v["id"] == vid)
        row["status"] = "approved"
        return row

    async def add_feedback(self, **data):
        row = {"id": str(uuid4()), "status": "open", **data}
        self.feedback.append(row)
        return row

    async def address(self, ids):
        for row in self.feedback:
            if row["id"] in ids:
                row["status"] = "addressed"

    async def pending(self, tid, run_type, member_id, base_version, key):
        row = {
            "id": str(uuid4()),
            "trip_id": tid,
            "run_type": run_type,
            "base_version": base_version,
            "status": "pending",
            "created_by_member_id": member_id,
            "idempotency_key": key,
        }
        self.runs[row["id"]] = row
        return row

    def run_status(self, rid, status, result=None):
        self.runs[rid].update(status=status, result_version_id=result)
        return self.runs[rid]

    async def run(self, kind, key=None):
        started = await self.service.start_run(TRIP, kind, ALICE, key or f"{kind}-{len(self.runs)}")
        if started.execute:
            await started.execute()
        assert self.runs[started.run.id]["status"] == "completed"
        return started


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("destination", "airport"),
    [("demo-da-nang", "DAD"), ("demo-bali", "DPS"), ("demo-phuket", "HKT")],
)
@pytest.mark.parametrize("flight_id", ["demo-flight-1", "demo-flight-2", "demo-flight-3"])
async def test_two_clients_complete_the_demo_with_real_ties_reviews_and_no_external_calls(
    monkeypatch,
    destination,
    airport,
    flight_id,
):
    # Both execution entry points must bypass the live graph, not just its LLM.
    from app.agents.tools.flights import FlightSearchTool
    from app.services import run_endpoint_service

    live = AsyncMock(side_effect=AssertionError("Demo used the live graph"))
    flight = AsyncMock(side_effect=AssertionError("Demo searched live flights"))
    monkeypatch.setattr(run_endpoint_service, "run_agent_graph", live)
    monkeypatch.setattr(FlightSearchTool, "invoke", flight)
    w = World()
    await w.run("discovery", "discover-once")
    again = await w.service.start_run(TRIP, "discovery", ALICE, "discover-once")
    assert again.execute is None
    session = next(iter(w.sessions.values()))
    await cast_vote(w.repos, session["id"], ALICE, destination)
    assert not w.selections  # do not resolve after only one of two votes
    other_destination = next(key for key in DESTINATIONS if key != destination)
    await cast_vote(w.repos, session["id"], BOB, other_destination)
    assert session["tie_pending"] and not w.selections
    await w.run("tiebreak")
    assert not w.selections  # prepared advice never chooses for the owner
    await break_tie(w.repos, session["id"], ALICE, destination)
    await w.run("logistics")
    session = list(w.sessions.values())[-1]
    await cast_vote(w.repos, session["id"], ALICE, flight_id)
    other_flight = "demo-flight-2" if flight_id == "demo-flight-1" else "demo-flight-1"
    await cast_vote(w.repos, session["id"], BOB, other_flight)
    await w.run("tiebreak")
    await break_tie(w.repos, session["id"], ALICE, flight_id)
    assert w.selections["flight"]["data"]["destination"] == airport
    await w.run("itinerary")
    assert w.room["planning_stage"] == "refine"
    original = deepcopy(w.versions[-1])
    assert original["itinerary"]["destination"]["name"] == DESTINATIONS[destination][0]
    reviews = RefineService(w.repos)
    await reviews.submit_feedback(
        TRIP,
        SubmitFeedbackRequest(
            member_id=ALICE,
            itinerary_version_id=original["id"],
            target={"day": 1},
            comment="Add a separate club visit after dinner",
        ),
    )
    assert not any(m["stage_ready"] for m in w.members)
    first = await reviews.review(
        TRIP, original["id"], ReviewItineraryRequest(member_id=ALICE, decision="refine")
    )
    assert not first.all_ready
    second = await reviews.review(
        TRIP, original["id"], ReviewItineraryRequest(member_id=BOB, decision="approve")
    )
    assert second.needs_refinement and second.all_ready
    await w.run("refinement")
    refined = w.versions[-1]
    assert len(refined["itinerary"]["days"][0]["items"]) == 3
    assert refined["itinerary"]["days"][0]["items"][:2] == original["itinerary"]["days"][0]["items"]
    assert w.feedback[0]["status"] == "addressed"
    assert not any(m["stage_ready"] for m in w.members)
    await reviews.review(
        TRIP, refined["id"], ReviewItineraryRequest(member_id=BOB, decision="approve")
    )
    assert w.room["planning_stage"] == "refine"
    await reviews.review(
        TRIP, refined["id"], ReviewItineraryRequest(member_id=ALICE, decision="approve")
    )
    assert w.room["planning_stage"] == "wrap"
    live.assert_not_awaited()
    flight.assert_not_awaited()
    w.llm.generate_structured.assert_not_awaited()


@pytest.mark.parametrize("destination", list(DESTINATIONS))
def test_each_destination_has_a_valid_prepared_plan_and_all_scripted_changes(destination):
    w = World()
    base = build_itinerary(TRIP, w.room, destination).model_dump(mode="json")
    rows = [
        {"id": text, "target": {"day": day}, "comment": text}
        for text, (day, _) in REFINEMENTS.items()
    ]
    refined, ids = refine_itinerary(base, rows)
    ItineraryModel(**refined)
    assert len(ids) == 5
    assert len(refined["days"][0]["items"]) == len(base["days"][0]["items"]) + 1
    twice, _ = refine_itinerary(refined, rows)
    assert twice == refined  # duplicate clicks don't add repeated rows
    assert len(flight_items(w.room, destination)) == 3


def test_new_destination_vote_offers_three_countries_with_matching_airports():
    items = destination_items(World().room)
    assert {(item.title, item.meta["tags"][0]) for item in items} == {
        ("Da Nang, Vietnam", "Vietnam"),
        ("Bali, Indonesia", "Indonesia"),
        ("Phuket, Thailand", "Thailand"),
    }
    for item, airport in zip(items, ("DAD", "DPS", "HKT"), strict=True):
        assert airport in item.meta["details"]


@pytest.mark.parametrize(
    ("destination", "airport", "airport_name", "offset", "carriers"),
    [
        (
            "demo-da-nang",
            "DAD",
            "Da Nang International Airport",
            7,
            {"Scoot", "Vietjet Air", "Singapore Airlines"},
        ),
        (
            "demo-bali",
            "DPS",
            "I Gusti Ngurah Rai International Airport",
            8,
            {"Scoot", "Garuda Indonesia", "Singapore Airlines"},
        ),
        (
            "demo-phuket",
            "HKT",
            "Phuket International Airport",
            7,
            {"Scoot", "Thai AirAsia", "Singapore Airlines"},
        ),
    ],
)
def test_route_times_and_airport_transfers_fit_every_prepared_flight(
    destination,
    airport,
    airport_name,
    offset,
    carriers,
):
    w = World()
    itinerary = build_itinerary(TRIP, w.room, destination)
    flights = flight_items(w.room, destination)
    assert {flight.meta["carrier"] for flight in flights} == carriers
    assert itinerary.days[-1].items[-1].location == airport_name
    for flight in flights:
        meta = flight.meta
        depart, arrive, back, home = [
            datetime.fromisoformat(meta[key])
            for key in ("depart_at", "arrive_at", "return_at", "return_arrive_at")
        ]
        assert meta["origin"] == "SIN" and meta["destination"] == airport
        assert meta["currency"] == "SGD" and meta["stops"] == 0
        assert arrive - depart == home - back == timedelta(minutes=meta["duration_minutes"])
        assert depart.utcoffset() == home.utcoffset() == timedelta(hours=8)
        assert arrive.utcoffset() == back.utcoffset() == timedelta(hours=offset)
        assert depart.date().isoformat() == itinerary.days[0].date
        assert back.date().isoformat() == itinerary.days[-1].date
        first_activity = datetime.combine(
            arrive.date(),
            time.fromisoformat(itinerary.days[0].items[0].time),
            arrive.tzinfo,
        )
        airport_transfer = datetime.combine(
            back.date(),
            time.fromisoformat(itinerary.days[-1].items[-1].time),
            back.tzinfo,
        )
        assert first_activity - arrive >= timedelta(hours=2)
        assert back - airport_transfer >= timedelta(hours=3)


@pytest.mark.anyio
@pytest.mark.parametrize("destination", list(LEGACY_DESTINATIONS))
async def test_already_selected_legacy_destination_can_finish_after_the_content_update(destination):
    w = World()
    w.room["planning_stage"] = "logistics"
    w.trip["status"] = "destination_selected"
    w.selections["destination"] = {"kind": "destination", "data": {"id": destination}}
    await w.run("logistics")
    session = next(iter(w.sessions.values()))
    await cast_vote(w.repos, session["id"], ALICE, "demo-flight-1")
    await cast_vote(w.repos, session["id"], BOB, "demo-flight-1")
    await w.run("itinerary")
    assert w.selections["flight"]["data"]["destination"] == "DAD"
    assert w.versions[-1]["itinerary"]["destination"]["name"] == LEGACY_DESTINATIONS[destination][0]
    w.llm.generate_structured.assert_not_awaited()


@pytest.mark.anyio
async def test_normal_room_still_uses_the_live_graph():
    w = World()
    w.room["demo_scenario"] = None
    live = AsyncMock(return_value="live-result")
    assert (
        await dispatch_run(
            AgentState(run_id=str(uuid4()), trip_id=TRIP, run_type="discovery"), w.repos, live
        )
        == "live-result"
    )
    live.assert_awaited_once()


@pytest.mark.anyio
async def test_demo_rejects_unsupported_feedback_before_writing():
    w = World()
    await w.run("discovery")
    w.selections = {
        "destination": {"kind": "destination", "data": {"id": "demo-da-nang"}},
        "flight": {"kind": "flight", "data": {"id": "demo-flight-1"}},
    }
    w.room["planning_stage"] = "build"
    await w.run("itinerary")
    with pytest.raises(ValidationError):
        await RefineService(w.repos).submit_feedback(
            TRIP,
            SubmitFeedbackRequest(
                member_id=ALICE,
                itinerary_version_id=w.versions[-1]["id"],
                target={"day": 1},
                comment="Book me a hotel",
            ),
        )
    assert not w.feedback


@pytest.mark.anyio
async def test_reserved_room_rejects_a_third_name_before_creating_records():
    w = World()
    r = w.repos
    r.room_repo.get_room_by_code.return_value = w.room
    r.member_repo.get_member_by_display_name.return_value = None
    service = RoomService(r.room_repo, r.member_repo, r.profile_repo, r.trip_repo)
    with pytest.raises(ValidationError):
        await service.join_room("DEMO12", JoinRoomRequest(display_name="Eve"))
    r.profile_repo.create_guest.assert_not_awaited()
    with pytest.raises(ValidationError):
        await service.create_room(CreateRoomRequest(name="Demo", owner_display_name=" demobob "))
    r.room_repo.create_room_with_owner.assert_not_awaited()


@pytest.mark.parametrize(
    "names", [["DemoAlice"], ["DemoAlice", "DemoBob", "Eve"], ["DemoAlice", "DemoAlice"]]
)
def test_demo_requires_exactly_two_distinct_reserved_users(names):
    with pytest.raises(ValidationError):
        require_demo_pair([{"display_name": n} for n in names])


@pytest.mark.anyio
async def test_setup_waits_for_both_profiles_and_then_resets_readiness():
    w = World()
    w.room["planning_stage"] = "setup"
    w.trip["status"] = "group_formed"
    r = w.repos
    r.room_repo.get_room_by_code.return_value = w.room
    r.member_repo.get_member_by_id.side_effect = r.member_repo.get_by_id.side_effect
    saved = {}

    async def save(mid, fields):
        row = {
            "id": str(uuid4()),
            "member_id": mid,
            "submitted_at": "2026-10-13T00:00:00Z",
            **fields,
        }
        saved[mid] = row
        return row

    r.profile_repo.save_preferences.side_effect = save
    r.profile_repo.get_character_by_member_id.return_value = None
    r.profile_repo.list_preferences_by_member_ids.side_effect = lambda ids: list(saved.values())
    service = PreferenceService(r.room_repo, r.member_repo, r.profile_repo, r.trip_repo)
    await service.save("DEMO12", ALICE, SavePreferencesRequest(budget=2000))
    assert w.room["planning_stage"] == "setup"
    assert w.members[0]["stage_ready"]
    await service.save("DEMO12", BOB, SavePreferencesRequest(budget=2000))
    assert w.room["planning_stage"] == "discover"
    assert not any(m["stage_ready"] for m in w.members)


@pytest.mark.anyio
async def test_the_synchronous_agent_entry_also_bypasses_gemini(monkeypatch):
    from app.services import agent_run_service

    live = AsyncMock(side_effect=AssertionError("Synchronous demo used live graph"))
    monkeypatch.setattr(agent_run_service, "run_agent_graph", live)
    w = World()
    result = await w.service.trigger_run(TRIP, "discovery", ALICE, "sync-demo")
    assert result.status == "completed"
    live.assert_not_awaited()
    w.llm.generate_structured.assert_not_awaited()


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("category", "options"),
    [
        ("destination", ("demo-da-nang", "demo-bali")),
        ("destination", ("demo-bali", "demo-phuket")),
        ("flight", ("demo-flight-1", "demo-flight-2")),
        ("flight", ("demo-flight-2", "demo-flight-3")),
    ],
)
async def test_tiebreak_describes_each_traveller_without_demo_copy(category, options):
    import re

    w = World()
    w.repos.profile_repo.list_preferences_by_member_ids.side_effect = lambda ids: [
        {
            "member_id": mid,
            "submitted_at": "2026-10-13T00:00:00Z",
            "travel_style": "chill" if mid == ALICE else "adventurer",
        }
        for mid in ids
    ]
    if category == "flight":
        w.selections["destination"] = {"kind": "destination", "data": {"id": "demo-da-nang"}}
        w.room["planning_stage"] = "logistics"
    await w.run("discovery" if category == "destination" else "logistics")
    session = list(w.sessions.values())[-1]
    await cast_vote(w.repos, session["id"], ALICE, options[0])
    await cast_vote(w.repos, session["id"], BOB, options[1])
    await w.run("tiebreak")
    advice = next(
        m["content"]
        for m in reversed(list(w.messages.values()))
        if m["content"].get("category") == f"{category}_tiebreak"
    )
    for item in advice["items"]:
        assert item["whyThisFits"] and item["details"] and item["tradeOff"]
        alice = item["memberFit"][0]["reason"]
        bob = item["memberFit"][1]["reason"]
        assert alice.startswith("Alice") and "a relaxed pace" in alice
        assert bob.startswith("Bob") and "adventure" in bob
        assert alice.count(".") == bob.count(".") == 1
        assert len(alice.split()) <= 32 and len(bob.split()) <= 32
    assert advice["advice"].count(".") == 1
    assert advice["items"][0]["whyThisFits"] != advice["items"][1]["whyThisFits"]
    visible_copy = [advice["title"], advice["advice"]] + [
        text
        for item in advice["items"]
        for text in [
            item["whyThisFits"],
            item["details"],
            item["tradeOff"],
            *[fit["reason"] for fit in item["memberFit"]],
        ]
    ]
    assert not any(re.search(r"\b(demo|prepared|sample)\b", text, re.I) for text in visible_copy)
    assert not w.selections.get(category)  # advice still leaves the owner's decision pending
    w.llm.generate_structured.assert_not_awaited()


def test_tiebreak_reasons_name_specific_preferences_and_timing_in_one_sentence():
    from app.demo.tiebreak_copy import member_reason

    alice = {"travel_style": "leader", "interests": ["food", "nightlife"]}
    bob = {"travel_style": "adventurer", "interests": ["scenery", "culture"]}
    assert member_reason("demo-da-nang", "DemoAlice", alice) == (
        "Alice's preference for food and nightlife fits Da Nang's beachfront dining "
        "and lively evenings."
    )
    assert member_reason("demo-bali", "DemoBob", bob) == (
        "Bob's preference for scenery and culture fits Bali's rice terraces and temple visits."
    )
    assert member_reason("demo-phuket", "DemoAlice", alice) == (
        "Alice's preference for food and nightlife fits Phuket's Thai seafood and Patong nightlife."
    )
    for option_id in ["demo-flight-1", "demo-flight-2", "demo-flight-3"]:
        text = member_reason(option_id, "DemoBob", bob)
        assert text.startswith("Bob's preference for scenery and culture")
        assert text.count(".") == 1 and len(text.split()) <= 32
    assert "early arrival" in member_reason("demo-flight-1", "DemoAlice", alice)
    assert "without rushing" in member_reason("demo-flight-1", "DemoBob", bob)
