"""Tests for TripStatusService: monotonicity, the refine loop, and the mapping."""

from __future__ import annotations

import pytest
from app.services.trip_status_service import (
    STAGE_BY_STATUS,
    STATUS_ORDER,
    advance_trip_status,
)

from tests.agents.conftest import FakeSupabaseClient
from tests.agents.test_messages import TRIP, wired_bundle


async def test_a_forward_transition_writes_through_the_rpc() -> None:
    """A higher-rank status reaches ``trip_repo.update_status``."""
    client = FakeSupabaseClient()
    client.queue("rpc:set_trip_status_and_stage", [{"id": TRIP, "status": "group_formed"}])

    result = await advance_trip_status(wired_bundle(client), TRIP, "group_formed", "trip_created")

    assert result.advanced is True
    assert result.status == "group_formed"
    call = client.calls_for("rpc:set_trip_status_and_stage")[0]
    assert call.payload["p_status"] == "group_formed"
    assert call.payload["p_planning_stage"] == "setup"


@pytest.mark.parametrize(
    ("current", "attempted"),
    [
        ("destination_selected", "destination_selected"),
        ("destination_selected", "preferences_collected"),
        ("trip_approved", "trip_created"),
    ],
)
async def test_same_or_lower_rank_is_a_no_op(current: str, attempted: str) -> None:
    """Requirement 18.7: a non-advancing write changes nothing and costs no call."""
    client = FakeSupabaseClient()

    result = await advance_trip_status(wired_bundle(client), TRIP, attempted, current)

    assert result.advanced is False
    assert result.status == current
    assert client.calls == []


async def test_the_refine_loop_transition_is_permitted_to_recur() -> None:
    """Requirement 18.8: the one backward move, and it is not a one-shot."""
    client = FakeSupabaseClient()
    client.set_default(
        "rpc:set_trip_status_and_stage", [{"id": TRIP, "status": "feedback_collected"}]
    )

    first = await advance_trip_status(
        wired_bundle(client), TRIP, "feedback_collected", "refinement_completed"
    )
    second = await advance_trip_status(
        wired_bundle(client), TRIP, "feedback_collected", "refinement_completed"
    )

    assert first.advanced is True
    assert second.advanced is True
    assert len(client.calls_for("rpc:set_trip_status_and_stage")) == 2


async def test_every_enum_value_maps_to_a_stage() -> None:
    """Requirement 18.10: all ten statuses resolve through the fixed table."""
    assert set(STAGE_BY_STATUS) == set(STATUS_ORDER)
    assert len(STATUS_ORDER) == 10


@pytest.mark.parametrize(
    ("status", "stage"),
    [
        ("trip_created", "setup"),
        ("group_formed", "setup"),
        ("preferences_collected", "discover"),
        ("destination_selected", "logistics"),
        ("flight_selected", "build"),
        ("itinerary_generated", "refine"),
        ("feedback_collected", "refine"),
        ("refinement_completed", "refine"),
        ("trip_approved", "wrap"),
        ("trip_exported", "wrap"),
    ],
)
async def test_the_mapping_matches_the_documented_table(status: str, stage: str) -> None:
    """Requirement 18.10's table, value by value."""
    assert STAGE_BY_STATUS[status] == stage


async def test_status_and_stage_are_written_in_the_same_call() -> None:
    """No two-step write exists for a reader to observe halfway through."""
    client = FakeSupabaseClient()
    client.queue("rpc:set_trip_status_and_stage", [{"id": TRIP, "status": "flight_selected"}])

    await advance_trip_status(wired_bundle(client), TRIP, "flight_selected", "destination_selected")

    assert len(client.calls_for("rpc:set_trip_status_and_stage")) == 1
    assert client.calls_for("trips") == []
