"""End-to-end node-dispatch integration tests, driving run_agent_graph with a
fully mocked RepositoryBundle (Requirement 21.1-21.9, 21.12-21.13).

For each `run_type` this exercises one representative happy path (through to
a repository write) and one guardrail-rejection / precondition-failure path,
using the shared mock fixtures from `conftest.py` rather than
`FakeSupabaseClient` — the point here is call-count assertions across the
whole graph, not query-chain fidelity.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.agents.errors import DestinationNotSelectedError, PreferencesNotCollectedError
from app.agents.graph import run_agent_graph
from app.agents.state import AgentState, RepositoryBundle

RUN = "33333333-3333-3333-3333-333333333333"
TRIP = "11111111-1111-1111-1111-111111111111"
ROOM = "22222222-2222-2222-2222-222222222222"
MEMBER = "44444444-4444-4444-4444-444444444444"


def make_state(**overrides: Any) -> AgentState:
    base: dict[str, Any] = {"run_id": RUN, "trip_id": TRIP, "run_type": "discovery"}
    base.update(overrides)
    return AgentState(**base)


def _wire_trip_context(
    bundle: RepositoryBundle,
    *,
    trip_status: str = "trip_created",
    planning_stage: str = "discover",
    selections: list[dict[str, Any]] | None = None,
    preferences: list[dict[str, Any]] | None = None,
    members: list[dict[str, Any]] | None = None,
    latest_itinerary_version: dict[str, Any] | None = None,
    open_feedback: list[dict[str, Any]] | None = None,
) -> None:
    """Wire the mocked bundle's reads so `load_trip_context` succeeds."""
    bundle.trip_repo.get_by_id = AsyncMock(
        return_value={"id": TRIP, "room_id": ROOM, "status": trip_status}
    )
    bundle.room_repo.get_by_id = AsyncMock(
        return_value={"id": ROOM, "status": "active", "planning_stage": planning_stage}
    )
    bundle.member_repo.list_by_room = AsyncMock(return_value=members or [{"id": MEMBER}])
    bundle.selection_repo.list_by_room = AsyncMock(return_value=selections or [])
    bundle.itinerary_version_repo.get_latest = AsyncMock(return_value=latest_itinerary_version)
    bundle.feedback_repo.list_open_by_trip = AsyncMock(return_value=open_feedback or [])
    bundle.profile_repo.list_characters_by_member_ids = AsyncMock(return_value=[])
    bundle.profile_repo.list_preferences_by_member_ids = AsyncMock(return_value=preferences or [])


def _preference_row(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "member_id": MEMBER,
        "available_dates": [{"start": "2026-06-01", "end": "2026-06-20"}],
        "destinations": ["Kyoto, Japan"],
        "hard_constraints": [],
        "budget": None,
        "interests": [],
        "activities": [],
        "travel_style": None,
    }
    base.update(overrides)
    return base


# ===========================================================================
# discovery
# ===========================================================================


async def test_discovery_happy_path_emits_a_recommendation_and_opens_a_vote(
    mock_repository_bundle: RepositoryBundle,
) -> None:
    bundle = mock_repository_bundle
    _wire_trip_context(bundle, preferences=[_preference_row()])
    bundle.vote_session_repo.get_open_by_room_and_category = AsyncMock(return_value=None)
    bundle.message_repo.insert_turn = AsyncMock(return_value=[{"id": "msg-1"}])
    bundle.vote_session_repo.create = AsyncMock(return_value={"id": "vs-1"})

    state = make_state(run_type="discovery")
    await run_agent_graph(state, bundle)

    assert bundle.message_repo.insert_turn.await_count == 1
    assert bundle.vote_session_repo.create.await_count == 1


async def test_discovery_rejection_path_zero_preferences_raises_with_no_writes(
    mock_repository_bundle: RepositoryBundle,
) -> None:
    """Precondition failure: no travel_preferences at all (Requirement 7.12)."""
    bundle = mock_repository_bundle
    _wire_trip_context(bundle, preferences=[])

    state = make_state(run_type="discovery")
    with pytest.raises(PreferencesNotCollectedError):
        await run_agent_graph(state, bundle)

    bundle.message_repo.insert_turn.assert_not_called()
    bundle.vote_session_repo.create.assert_not_called()


# ===========================================================================
# logistics
# ===========================================================================


async def test_logistics_rejection_path_no_destination_raises_with_no_writes(
    mock_repository_bundle: RepositoryBundle,
) -> None:
    """Precondition failure: no destination locked (Requirement 8.2)."""
    bundle = mock_repository_bundle
    _wire_trip_context(bundle, selections=[], preferences=[_preference_row()])

    state = make_state(run_type="logistics")
    with pytest.raises(DestinationNotSelectedError):
        await run_agent_graph(state, bundle)

    bundle.message_repo.insert_turn.assert_not_called()
    bundle.vote_session_repo.create.assert_not_called()


async def test_logistics_pretool_escalation_path_calls_no_flight_tool(
    mock_repository_bundle: RepositoryBundle,
) -> None:
    """Guardrail-adjacent escalation: no departure origin resolves (Requirement 8.11)."""
    bundle = mock_repository_bundle
    _wire_trip_context(
        bundle,
        selections=[{"room_id": ROOM, "kind": "destination", "data": {"title": "Osaka"}}],
        preferences=[_preference_row(hard_constraints=[])],
    )
    bundle.message_repo.insert_turn = AsyncMock(return_value=[{"id": "m1"}])
    bundle.agent_run_repo.mark_completed = AsyncMock(
        return_value={"id": RUN, "status": "completed"}
    )

    state = make_state(run_type="logistics")
    await run_agent_graph(state, bundle)

    bundle.flight_tool.invoke.assert_not_called()
    bundle.vote_session_repo.create.assert_not_called()


# ===========================================================================
# itinerary
# ===========================================================================


async def test_itinerary_rejection_path_missing_flight_raises_with_no_writes(
    mock_repository_bundle: RepositoryBundle,
) -> None:
    """Precondition failure: destination locked but flight is not (Requirement 9.11)."""
    bundle = mock_repository_bundle
    _wire_trip_context(
        bundle,
        selections=[{"room_id": ROOM, "kind": "destination", "data": {"title": "Osaka"}}],
        preferences=[_preference_row()],
    )

    state = make_state(run_type="itinerary")
    with pytest.raises(Exception, match="(?i)travel arrangements|flight"):
        await run_agent_graph(state, bundle)

    bundle.itinerary_version_repo.insert_version.assert_not_called()


async def test_itinerary_happy_path_persists_version_one(
    mock_repository_bundle: RepositoryBundle,
) -> None:
    bundle = mock_repository_bundle
    _wire_trip_context(
        bundle,
        selections=[
            {"room_id": ROOM, "kind": "destination", "data": {"title": "Osaka"}},
            {
                "room_id": ROOM,
                "kind": "flight",
                "data": {"depart_at": "2026-06-05T08:00:00", "return_at": "2026-06-07T20:00:00"},
            },
        ],
        preferences=[_preference_row()],
    )
    bundle.itinerary_version_repo.insert_version = AsyncMock(
        return_value={"id": "v1", "trip_id": TRIP, "version": 1}
    )
    bundle.itinerary_version_repo.supersede_lower_versions = AsyncMock(return_value=None)
    bundle.message_repo.insert_turn = AsyncMock(return_value=[{"id": "m1"}])
    bundle.trip_repo.update_status = AsyncMock(return_value={"id": TRIP})

    state = make_state(run_type="itinerary")
    await run_agent_graph(state, bundle)

    assert bundle.itinerary_version_repo.insert_version.await_count == 1
    assert bundle.message_repo.insert_turn.await_count == 1
    assert bundle.trip_repo.update_status.await_count == 1


# ===========================================================================
# refinement
# ===========================================================================


async def test_refinement_rejection_path_no_itinerary_version_raises_with_no_writes(
    mock_repository_bundle: RepositoryBundle,
) -> None:
    """Precondition failure: no itinerary_versions row at all (Requirement 10.12)."""
    bundle = mock_repository_bundle
    _wire_trip_context(bundle, latest_itinerary_version=None, preferences=[_preference_row()])

    state = make_state(run_type="refinement")
    with pytest.raises(Exception, match="(?i)quest log"):
        await run_agent_graph(state, bundle)

    bundle.itinerary_version_repo.insert_version.assert_not_called()


async def test_refinement_no_open_feedback_completes_with_no_insert(
    mock_repository_bundle: RepositoryBundle,
) -> None:
    """No open feedback: completes, nothing persisted (Requirement 10.13)."""
    bundle = mock_repository_bundle
    _wire_trip_context(
        bundle,
        latest_itinerary_version={
            "id": "v1",
            "version": 1,
            "itinerary": {
                "trip_id": TRIP,
                "room_id": ROOM,
                "title": "T",
                "summary": "S",
                "destination": {"name": "D"},
                "days": [{"day": 1, "items": [{"id": "i1", "title": "Item"}]}],
            },
        },
        open_feedback=[],
        preferences=[_preference_row()],
    )
    bundle.message_repo.insert_turn = AsyncMock(return_value=[{"id": "m1"}])

    state = make_state(run_type="refinement")
    await run_agent_graph(state, bundle)

    bundle.itinerary_version_repo.insert_version.assert_not_called()
    assert bundle.message_repo.insert_turn.await_count == 1
