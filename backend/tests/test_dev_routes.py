"""Tests for the development-only routes, and that they stay off by default."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from app.api import deps
from app.api.routes import dev
from app.core.config import Settings
from app.exceptions import BackendError
from app.main import app as real_app
from app.main import backend_error_handler
from fastapi import FastAPI
from fastapi.testclient import TestClient

TRIP = "22222222-2222-4222-8222-222222222222"
ROOM = "11111111-1111-4111-8111-111111111111"
MEMBER = "33333333-3333-4333-8333-333333333333"
VERSION = "44444444-4444-4444-8444-444444444444"


@pytest.fixture
def repos() -> SimpleNamespace:
    return SimpleNamespace(
        trip_repo=AsyncMock(),
        selection_repo=AsyncMock(),
        feedback_repo=AsyncMock(),
    )


@pytest.fixture
def client(repos: SimpleNamespace) -> TestClient:
    """The dev router on its own app, over mocked repositories."""
    app = FastAPI()
    app.include_router(dev.router)
    app.add_exception_handler(BackendError, backend_error_handler)
    app.dependency_overrides[deps.get_repository_bundle] = lambda: repos
    return TestClient(app, raise_server_exceptions=False)


FLIGHT = {"departAt": "2026-12-20T08:00:00", "returnAt": "2026-12-24T20:00:00"}


def test_the_dev_endpoints_are_off_by_default() -> None:
    assert (
        Settings(
            supabase_url="https://x.supabase.co", supabase_service_role_key="k"
        ).enable_dev_endpoints
        is False
    )


def test_the_real_app_exposes_no_dev_routes_by_default() -> None:
    """With default settings (the test environment sets no flag) nothing under /dev exists."""
    assert not [r for r in real_app.routes if getattr(r, "path", "").startswith("/dev")]
    response = TestClient(real_app).post(f"/dev/trips/{TRIP}/test-flight", json=FLIGHT)

    assert response.status_code == 404


def test_locking_a_test_flight_writes_the_rooms_flight_selection(client, repos) -> None:
    repos.trip_repo.get_room_id_for_trip.return_value = ROOM
    repos.selection_repo.upsert.return_value = {"id": "sel-1"}

    response = client.post(f"/dev/trips/{TRIP}/test-flight", json={**FLIGHT, "label": "Dev flight"})

    assert response.status_code == 200
    assert response.json() == {"selectionId": "sel-1", "roomId": ROOM}
    room_id, kind, data = repos.selection_repo.upsert.await_args.args
    assert (room_id, kind) == (ROOM, "flight")
    assert data == {
        "label": "Dev flight",
        "depart_at": "2026-12-20T08:00:00",
        "return_at": "2026-12-24T20:00:00",
    }


def test_an_unknown_trip_is_a_404_and_writes_nothing(client, repos) -> None:
    repos.trip_repo.get_room_id_for_trip.return_value = None

    response = client.post(f"/dev/trips/{TRIP}/test-flight", json=FLIGHT)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
    repos.selection_repo.upsert.assert_not_called()


def test_a_flight_returning_before_it_departs_is_rejected(client, repos) -> None:
    response = client.post(
        f"/dev/trips/{TRIP}/test-flight",
        json={"departAt": "2026-12-24T08:00:00", "returnAt": "2026-12-20T20:00:00"},
    )

    assert response.status_code == 422
    repos.selection_repo.upsert.assert_not_called()


@pytest.mark.parametrize(
    ("target_fields", "expected_target"),
    [({"itemId": "d2-i1"}, {"itemId": "d2-i1"}), ({"day": 3}, {"day": 3})],
)
def test_feedback_targets_an_item_or_a_day(client, repos, target_fields, expected_target) -> None:
    repos.trip_repo.get_by_id.return_value = {"id": TRIP}
    repos.feedback_repo.create.return_value = {"id": "fb-1"}

    response = client.post(
        f"/dev/trips/{TRIP}/feedback",
        json={
            "memberId": MEMBER,
            "itineraryVersionId": VERSION,
            "comment": "make it later",
            **target_fields,
        },
    )

    assert response.status_code == 200
    assert response.json() == {"feedbackId": "fb-1"}
    assert repos.feedback_repo.create.await_args.args == (
        TRIP,
        VERSION,
        MEMBER,
        expected_target,
        "make it later",
    )


@pytest.mark.parametrize("target_fields", [{}, {"itemId": "d1-i1", "day": 1}])
def test_feedback_needs_exactly_one_target(client, repos, target_fields) -> None:
    response = client.post(
        f"/dev/trips/{TRIP}/feedback",
        json={"memberId": MEMBER, "itineraryVersionId": VERSION, "comment": "x", **target_fields},
    )

    assert response.status_code == 422
    repos.feedback_repo.create.assert_not_called()


def test_feedback_on_an_unknown_trip_is_a_404(client, repos) -> None:
    repos.trip_repo.get_by_id.return_value = None

    response = client.post(
        f"/dev/trips/{TRIP}/feedback",
        json={"memberId": MEMBER, "itineraryVersionId": VERSION, "comment": "x", "day": 1},
    )

    assert response.status_code == 404
    repos.feedback_repo.create.assert_not_called()


async def test_recent_llm_calls_are_recorded_only_with_dev_endpoints_on(client, monkeypatch):
    from app.agents import llm as llm_module
    from app.core import llm_debug
    from pydantic import BaseModel

    class Reply(BaseModel):
        ok: bool

    class FakeModel:
        def with_structured_output(self, _model):
            return self

        async def ainvoke(self, _messages):
            return Reply(ok=True)

    llm_debug.RECENT_CALLS.clear()
    for enabled in (False, True):
        settings = Settings(
            supabase_url="https://example.supabase.co",
            supabase_service_role_key="service-role-key",
            ai_provider_api_key="test-key",
            enable_dev_endpoints=enabled,
        )
        llm = llm_module.LLMClient(settings)
        monkeypatch.setattr(llm, "_get_model", lambda _name=None: FakeModel())
        await llm.generate_structured(
            operation="demo", system_prompt="SYS", user_prompt="USER", response_model=Reply
        )

    calls = client.get("/dev/llm-calls").json()
    assert len(calls) == 1  # the call made with dev endpoints off was not kept
    assert calls[0]["systemPrompt"] == "SYS"
    assert calls[0]["userPrompt"] == "USER"
    assert calls[0]["response"] == {"ok": True}
    llm_debug.RECENT_CALLS.clear()
