"""Tests for feedback, approve/reject, export, and chat (services and routes).

Repositories and services are mocked; no network.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.agents.errors import NoApprovedItineraryError, TripNotFoundError, UnresolvedMemberError
from app.api.deps import get_chat_service, get_export_service, get_refine_service
from app.exceptions import (
    ItineraryVersionNotFoundError,
    RoomNotFoundError,
    VersionNotProposedError,
)
from app.main import app
from app.repositories.feedback_repository import FeedbackRepository
from app.repositories.itinerary_version_repository import ItineraryVersionRepository
from app.repositories.member_repository import MemberRepository
from app.repositories.message_repository import MessageRepository
from app.repositories.profile_repository import ProfileRepository
from app.repositories.room_repository import RoomRepository
from app.repositories.selection_repository import SelectionRepository
from app.repositories.trip_repository import TripRepository
from app.schemas.planning import (
    ReviewItineraryRequest,
    SendMessageRequest,
    SubmitFeedbackRequest,
    VersionDecisionRequest,
)
from app.services import refine_service
from app.services.chat_service import ChatService
from app.services.export_service import ExportService
from app.services.refine_service import RefineService
from fastapi.testclient import TestClient

ROOM_ID = "11111111-1111-4111-8111-111111111111"
OTHER_ROOM = "99999999-9999-4999-8999-999999999999"
TRIP_ID = "22222222-2222-4222-8222-222222222222"
OWNER = "33333333-3333-4333-8333-333333333333"
MEMBER = "44444444-4444-4444-8444-444444444444"
VERSION = "55555555-5555-4555-8555-555555555555"

TRIP = {"id": TRIP_ID, "room_id": ROOM_ID, "title": "Trip", "status": "itinerary_generated"}
ROOM = {
    "id": ROOM_ID,
    "room_code": "ABC123",
    "name": "Trip",
    "status": "active",
    "planning_stage": "refine",
}


def version(status: str = "proposed", trip_id: str = TRIP_ID) -> dict[str, Any]:
    return {
        "id": VERSION,
        "trip_id": trip_id,
        "version": 1,
        "source": "build",
        "status": status,
        "itinerary": {"title": "The Tokyo Quest", "days": []},
        "change_summary": None,
    }


def bundle() -> SimpleNamespace:
    r = SimpleNamespace(
        trip_repo=AsyncMock(spec=TripRepository),
        room_repo=AsyncMock(spec=RoomRepository),
        member_repo=AsyncMock(spec=MemberRepository),
        profile_repo=AsyncMock(spec=ProfileRepository),
        itinerary_version_repo=AsyncMock(spec=ItineraryVersionRepository),
        feedback_repo=AsyncMock(spec=FeedbackRepository),
        selection_repo=AsyncMock(spec=SelectionRepository),
        message_repo=AsyncMock(spec=MessageRepository),
    )
    r.trip_repo.get_by_id.return_value = TRIP
    r.member_repo.get_by_id.return_value = {"id": MEMBER, "room_id": ROOM_ID}
    r.member_repo.get_owner.return_value = {"id": OWNER, "room_id": ROOM_ID}
    r.itinerary_version_repo.get_by_id.return_value = version()
    return r


pytestmark_async = pytest.mark.anyio


# --- feedback -------------------------------------------------------------------------


def feedback_request(**overrides: Any) -> SubmitFeedbackRequest:
    data: dict[str, Any] = {
        "member_id": MEMBER,
        "itinerary_version_id": VERSION,
        "target": {"day": 2, "item_id": "d2-i1"},
        "comment": "  Swap the museum for a market. ",
    }
    data.update(overrides)
    return SubmitFeedbackRequest(**data)


@pytestmark_async
async def test_feedback_is_recorded_marks_ready_and_advances():
    r = bundle()
    r.feedback_repo.create.return_value = {
        "id": "f1",
        "trip_id": TRIP_ID,
        "itinerary_version_id": VERSION,
        "member_id": MEMBER,
        "target": {"day": 2, "item_id": "d2-i1"},
        "comment": "Swap the museum for a market.",
        "status": "open",
    }
    r.trip_repo.update_status.return_value = {**TRIP, "status": "feedback_collected"}

    response = await RefineService(r).submit_feedback(TRIP_ID, feedback_request())

    r.feedback_repo.create.assert_awaited_once_with(
        trip_id=TRIP_ID,
        itinerary_version_id=VERSION,
        member_id=MEMBER,
        target={"day": 2, "itemId": "d2-i1"},
        comment="Swap the museum for a market.",
    )
    r.member_repo.set_stage_ready.assert_awaited_once_with(MEMBER, True)
    r.trip_repo.update_status.assert_awaited_once_with(TRIP_ID, "feedback_collected", "refine")
    assert response.trip.status == "feedback_collected"


@pytestmark_async
async def test_feedback_on_a_version_not_under_review_is_rejected():
    r = bundle()
    r.itinerary_version_repo.get_by_id.return_value = version(status="superseded")

    with pytest.raises(VersionNotProposedError):
        await RefineService(r).submit_feedback(TRIP_ID, feedback_request())
    r.feedback_repo.create.assert_not_awaited()


@pytestmark_async
async def test_feedback_on_another_trips_version_is_not_found():
    r = bundle()
    r.itinerary_version_repo.get_by_id.return_value = version(trip_id="other-trip")

    with pytest.raises(ItineraryVersionNotFoundError):
        await RefineService(r).submit_feedback(TRIP_ID, feedback_request())


@pytestmark_async
async def test_feedback_from_outside_the_room_is_rejected():
    r = bundle()
    r.member_repo.get_by_id.return_value = {"id": MEMBER, "room_id": OTHER_ROOM}

    with pytest.raises(UnresolvedMemberError):
        await RefineService(r).submit_feedback(TRIP_ID, feedback_request())
    r.feedback_repo.create.assert_not_awaited()


@pytestmark_async
async def test_feedback_on_unknown_trip():
    r = bundle()
    r.trip_repo.get_by_id.return_value = None

    with pytest.raises(TripNotFoundError):
        await RefineService(r).submit_feedback(TRIP_ID, feedback_request())


@pytestmark_async
async def test_all_keep_review_approves_directly_without_refinement(monkeypatch):
    """A fully positive lock-in moves straight to WRAP; no refinement is needed."""
    r = bundle()
    r.member_repo.list_members_by_room.return_value = [
        {"id": OWNER, "room_id": ROOM_ID, "stage_ready": True},
        {"id": MEMBER, "room_id": ROOM_ID, "stage_ready": True},
    ]
    r.itinerary_version_repo.mark_approved.return_value = version(status="approved")
    r.trip_repo.update_status.return_value = {**TRIP, "status": "trip_approved"}
    r.feedback_repo.list_open_by_trip.return_value = []
    summary = AsyncMock()
    monkeypatch.setattr(refine_service, "produce_wrap_summary", summary)

    response = await RefineService(r).review(
        TRIP_ID,
        VERSION,
        ReviewItineraryRequest(member_id=MEMBER, decision="approve"),
    )

    r.itinerary_version_repo.mark_approved.assert_awaited_once_with(VERSION)
    r.trip_repo.update_status.assert_awaited_once_with(TRIP_ID, "trip_approved", "wrap")
    r.feedback_repo.list_open_by_trip.assert_awaited_once_with(TRIP_ID)
    summary.assert_awaited_once()
    assert response.all_ready is True
    assert response.trip.status == "trip_approved"


@pytestmark_async
async def test_all_locked_with_open_feedback_requests_refinement_without_approving():
    """The final lock-in reports refinement separately from party readiness."""
    r = bundle()
    r.member_repo.list_members_by_room.return_value = [
        {"id": OWNER, "room_id": ROOM_ID, "stage_ready": True},
        {"id": MEMBER, "room_id": ROOM_ID, "stage_ready": True},
    ]
    r.feedback_repo.list_open_by_trip.return_value = [{"id": "feedback-1", "status": "open"}]
    r.trip_repo.update_status.return_value = {**TRIP, "status": "feedback_collected"}

    response = await RefineService(r).review(
        TRIP_ID,
        VERSION,
        ReviewItineraryRequest(member_id=MEMBER, decision="approve"),
    )

    r.itinerary_version_repo.mark_approved.assert_not_awaited()
    r.trip_repo.update_status.assert_not_awaited()
    assert response.all_ready is True
    assert response.needs_refinement is True


def test_blank_feedback_comment_is_invalid():
    with pytest.raises(ValueError):
        feedback_request(comment="   ")


def test_feedback_must_name_a_day_or_activity():
    with pytest.raises(ValueError):
        feedback_request(target={})
    with pytest.raises(ValueError):
        feedback_request(target={"section": "dinner"})
    assert feedback_request(target={"day": 3}).target.day == 3
    assert feedback_request(target={"itemId": "d1-i2"}).target.item_id == "d1-i2"


# --- approve / reject -----------------------------------------------------------------


@pytestmark_async
async def test_owner_approves_moves_to_wrap_and_announces(monkeypatch):
    r = bundle()
    r.itinerary_version_repo.mark_approved.return_value = version(status="approved")
    r.trip_repo.update_status.return_value = {**TRIP, "status": "trip_approved"}
    summary = AsyncMock()
    monkeypatch.setattr(refine_service, "produce_wrap_summary", summary)

    response = await RefineService(r).decide(
        TRIP_ID, VERSION, VersionDecisionRequest(member_id=OWNER, decision="approve")
    )

    r.itinerary_version_repo.mark_approved.assert_awaited_once_with(VERSION)
    r.trip_repo.update_status.assert_awaited_once_with(TRIP_ID, "trip_approved", "wrap")
    summary.assert_awaited_once()
    assert response.version.status == "approved"
    assert response.trip.status == "trip_approved"


@pytestmark_async
async def test_owner_rejects_keeps_refining():
    r = bundle()
    r.itinerary_version_repo.mark_rejected.return_value = version(status="rejected")

    response = await RefineService(r).decide(
        TRIP_ID, VERSION, VersionDecisionRequest(member_id=OWNER, decision="reject")
    )

    r.trip_repo.update_status.assert_not_awaited()
    assert response.version.status == "rejected"


@pytestmark_async
async def test_only_the_owner_can_decide():
    r = bundle()

    with pytest.raises(UnresolvedMemberError):
        await RefineService(r).decide(
            TRIP_ID, VERSION, VersionDecisionRequest(member_id=MEMBER, decision="approve")
        )
    r.itinerary_version_repo.mark_approved.assert_not_awaited()


@pytestmark_async
async def test_summary_failure_does_not_undo_approval(monkeypatch):
    r = bundle()
    r.itinerary_version_repo.mark_approved.return_value = version(status="approved")
    r.trip_repo.update_status.return_value = {**TRIP, "status": "trip_approved"}
    monkeypatch.setattr(
        refine_service, "produce_wrap_summary", AsyncMock(side_effect=NoApprovedItineraryError())
    )

    response = await RefineService(r).decide(
        TRIP_ID, VERSION, VersionDecisionRequest(member_id=OWNER, decision="approve")
    )

    assert response.trip.status == "trip_approved"


# --- export ---------------------------------------------------------------------------


@pytestmark_async
async def test_export_packages_the_approved_trip():
    r = bundle()
    r.trip_repo.get_by_id.return_value = {**TRIP, "status": "trip_approved"}
    r.itinerary_version_repo.get_approved.return_value = version(status="approved")
    r.room_repo.get_by_id.return_value = ROOM
    r.member_repo.list_by_room.return_value = [
        {"id": OWNER, "display_name": "Gerald", "role": "owner"},
        {"id": MEMBER, "display_name": "Priya", "role": "member"},
    ]
    r.profile_repo.list_characters_by_member_ids.return_value = [
        {"member_id": OWNER, "sprite_key": "explorer-01"}
    ]
    r.selection_repo.list_by_room.return_value = [
        {"kind": "destination", "data": {"id": "tokyo", "title": "Tokyo"}},
        {"kind": "flight", "data": {"id": "f1", "title": "Scoot TR804"}},
    ]
    r.trip_repo.update_status.return_value = {**TRIP, "status": "trip_exported"}

    response = await ExportService(r).export(TRIP_ID)

    assert response.itinerary.status == "approved"
    assert response.destination == {"id": "tokyo", "title": "Tokyo"}
    assert response.flight == {"id": "f1", "title": "Scoot TR804"}
    assert [(m.display_name, m.sprite_key) for m in response.party] == [
        ("Gerald", "explorer-01"),
        ("Priya", None),
    ]
    assert response.trip.status == "trip_exported"


@pytestmark_async
async def test_export_before_approval_is_not_found():
    r = bundle()
    r.itinerary_version_repo.get_approved.return_value = None

    with pytest.raises(NoApprovedItineraryError):
        await ExportService(r).export(TRIP_ID)


# --- chat -----------------------------------------------------------------------------


@pytestmark_async
async def test_send_message_writes_a_user_text_message():
    r = bundle()
    r.room_repo.get_room_by_code.return_value = ROOM
    r.message_repo.insert_turn.return_value = [
        {
            "id": "m1",
            "room_id": ROOM_ID,
            "created_at": "2026-10-08T10:00:00+00:00",
            "sender_type": "user",
            "sender_member_id": MEMBER,
            "kind": "text",
            "content": {"text": "Ramen first?"},
        }
    ]

    message = await ChatService(r).send(
        "ABC123", SendMessageRequest(member_id=MEMBER, text="  Ramen first? ")
    )

    r.message_repo.insert_turn.assert_awaited_once_with(
        ROOM_ID,
        [
            {
                "sender_type": "user",
                "sender_member_id": MEMBER,
                "kind": "text",
                "content": {"text": "Ramen first?"},
            }
        ],
    )
    assert message.sender_id == MEMBER
    assert message.content == {"text": "Ramen first?"}


@pytestmark_async
async def test_send_message_unknown_room():
    r = bundle()
    r.room_repo.get_room_by_code.return_value = None

    with pytest.raises(RoomNotFoundError):
        await ChatService(r).send("ZZZZ99", SendMessageRequest(member_id=MEMBER, text="hi"))


@pytestmark_async
async def test_send_message_from_outside_the_room():
    r = bundle()
    r.room_repo.get_room_by_code.return_value = ROOM
    r.member_repo.get_by_id.return_value = {"id": MEMBER, "room_id": OTHER_ROOM}

    with pytest.raises(UnresolvedMemberError):
        await ChatService(r).send("ABC123", SendMessageRequest(member_id=MEMBER, text="hi"))
    r.message_repo.insert_turn.assert_not_awaited()


# --- routes ---------------------------------------------------------------------------


def _returning(value):
    return lambda: value


@pytest.fixture
def client(mocker):
    mocks = {
        get_refine_service: mocker.AsyncMock(spec=RefineService),
        get_export_service: mocker.AsyncMock(spec=ExportService),
        get_chat_service: mocker.AsyncMock(spec=ChatService),
    }
    for provider, mock in mocks.items():
        app.dependency_overrides[provider] = _returning(mock)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client, mocks
    app.dependency_overrides.clear()


def test_feedback_route_201(client):
    test_client, mocks = client
    mocks[get_refine_service].submit_feedback.return_value = {
        "feedback": {
            "id": "f1",
            "trip_id": TRIP_ID,
            "itinerary_version_id": VERSION,
            "member_id": MEMBER,
            "target": {"day": 2},
            "comment": "More food",
            "status": "open",
        },
        "trip": {**TRIP, "status": "feedback_collected"},
    }

    response = test_client.post(
        f"/trips/{TRIP_ID}/feedback",
        json={
            "memberId": MEMBER,
            "itineraryVersionId": VERSION,
            "target": {"day": 2},
            "comment": "More food",
        },
    )

    assert response.status_code == 201
    assert response.json()["feedback"]["itineraryVersionId"] == VERSION


def test_version_conflict_maps_to_409(client):
    test_client, mocks = client
    mocks[get_refine_service].decide.side_effect = VersionNotProposedError("not under review")

    response = test_client.post(
        f"/trips/{TRIP_ID}/itinerary/versions/{VERSION}/decision",
        json={"memberId": OWNER, "decision": "approve"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "VERSION_NOT_PROPOSED"


def test_decision_rejects_unknown_decision(client):
    test_client, _ = client

    response = test_client.post(
        f"/trips/{TRIP_ID}/itinerary/versions/{VERSION}/decision",
        json={"memberId": OWNER, "decision": "maybe"},
    )

    assert response.status_code == 422


def test_export_before_approval_maps_to_404(client):
    test_client, mocks = client
    mocks[get_export_service].export.side_effect = NoApprovedItineraryError()

    response = test_client.post(f"/trips/{TRIP_ID}/export")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NO_APPROVED_ITINERARY"


def test_message_route_201(client):
    test_client, mocks = client
    mocks[get_chat_service].send.return_value = {
        "id": "m1",
        "room_id": ROOM_ID,
        "created_at": "2026-10-08T10:00:00+00:00",
        "sender_type": "user",
        "sender_id": MEMBER,
        "kind": "text",
        "content": {"text": "hi"},
    }

    response = test_client.post("/rooms/ABC123/messages", json={"memberId": MEMBER, "text": "hi"})

    assert response.status_code == 201
    assert response.json()["senderId"] == MEMBER
    assert response.json()["createdAt"]


def test_message_route_rejects_blank_text(client):
    test_client, mocks = client

    response = test_client.post("/rooms/ABC123/messages", json={"memberId": MEMBER, "text": "  "})

    assert response.status_code == 422
    mocks[get_chat_service].send.assert_not_awaited()
