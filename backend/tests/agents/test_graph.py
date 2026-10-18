"""Tests for the Agent_Graph: dispatch mapping, orchestrator checks, compilation."""

from __future__ import annotations

from typing import Any

import pytest
from app.agents.errors import InvalidRunTypeError
from app.agents.graph import ENTRY_NODE_BY_RUN_TYPE, get_agent_graph, run_agent_graph
from app.agents.state import RUN_TYPES, AgentState
from app.exceptions import ValidationError as BackendValidationError

from tests.agents.conftest import FakeSupabaseClient
from tests.agents.test_messages import ROOM, TRIP, wired_bundle

RUN = "33333333-3333-3333-3333-333333333333"


def make_state(**overrides: Any) -> AgentState:
    base: dict[str, Any] = {"run_id": RUN, "trip_id": TRIP, "run_type": "discovery"}
    base.update(overrides)
    return AgentState(**base)


def resolvable_bundle(**trip_overrides: Any) -> tuple[FakeSupabaseClient, Any]:
    """A client/bundle pair wired so ``load_trip_context`` succeeds."""
    client = FakeSupabaseClient()
    trip_row = {"id": TRIP, "room_id": ROOM, "status": "trip_created"}
    trip_row.update(trip_overrides)
    client.set_default("trips", [trip_row])
    client.set_default(
        "party_rooms", [{"id": ROOM, "status": "active", "planning_stage": "discover"}]
    )
    client.set_default("room_members", [])
    client.set_default("selections", [])
    client.set_default("itinerary_versions", [])
    client.set_default("feedback", [])
    client.set_default("characters", [])
    client.set_default("travel_preferences", [])
    return client, wired_bundle(client)


# ===========================================================================
# Dispatch mapping (Requirement 1.1, 1.2)
# ===========================================================================


def test_the_mapping_is_total_over_the_four_run_types() -> None:
    """Requirement 1.2: every run type maps to exactly one entry node."""
    assert set(ENTRY_NODE_BY_RUN_TYPE) == set(RUN_TYPES)


def test_no_run_type_maps_to_more_than_one_node() -> None:
    """The mapping's values, by construction, are each a single node name."""
    assert all(isinstance(v, str) for v in ENTRY_NODE_BY_RUN_TYPE.values())


def test_the_graph_compiles_with_exactly_six_nodes() -> None:
    """Orchestrator plus the four specialists and the tiebreak advisor, no more."""
    graph = get_agent_graph()
    node_names = set(graph.get_graph().nodes) - {"__start__", "__end__"}

    assert node_names == {
        "orchestrator",
        "discovery",
        "logistics",
        "itinerary",
        "negotiation",
        "tiebreak",
    }


def test_the_graph_is_compiled_once_and_cached() -> None:
    """``get_agent_graph`` must not recompile on every call."""
    assert get_agent_graph() is get_agent_graph()


# ===========================================================================
# Dispatch through the compiled graph (Requirement 1.3, 1.4)
# ===========================================================================


@pytest.mark.parametrize(
    ("run_type", "expected_error"),
    [
        # All four specialists are implemented (tasks 16-20).
        ("discovery", "preferences"),
        ("logistics", "destination"),
        ("itinerary", "destination"),
        ("refinement", "quest log"),
    ],
)
async def test_each_run_type_dispatches_to_its_mapped_node(
    run_type: str, expected_error: str
) -> None:
    """Each run type reaches exactly its mapped specialist, and no other.

    All four specialists are implemented, so each one's own distinct failure
    mode, given the bare fixture here, stands in for the "reached the right
    node" signal. Negotiation fails with `NoItineraryToRefineError` ("no quest
    log yet to refine"), distinct from itinerary_node's own failure modes.
    """
    _client, bundle = resolvable_bundle()
    state = make_state(run_type=run_type)

    with pytest.raises(Exception, match=expected_error):
        await run_agent_graph(state, bundle)


async def test_dispatch_depends_only_on_run_type_not_on_trip_context() -> None:
    """Requirement 1.4: Trip_Context checks preconditions, never picks the node."""
    _client, bundle = resolvable_bundle(status="trip_approved")
    state = make_state(run_type="discovery")

    # A trip far past DISCOVER still dispatches to discovery's own node rather
    # than being silently routed elsewhere because the trip looks "later".
    with pytest.raises(Exception, match="preferences"):
        await run_agent_graph(state, bundle)


# ===========================================================================
# Orchestrator validation (Requirement 1.5, 1.6)
# ===========================================================================


async def test_an_invalid_run_type_cannot_even_be_constructed() -> None:
    """Requirement 1.5: an unrecognised run type never reaches the graph at all.

    ``AgentState.run_type`` is a Pydantic ``Literal`` over the four values, and
    LangGraph re-validates the state against that schema at every step — so an
    invalid value is rejected before ``orchestrator_node`` (or any specialist)
    ever runs. The orchestrator's own defensive check in
    ``app.agents.nodes.orchestrator`` exists for a caller that builds
    ``AgentState`` by some other path; this test documents that the type system
    is the primary enforcement point for a caller going through the ordinary
    constructor.
    """
    with pytest.raises(Exception, match="(?i)literal_error|run_type"):
        make_state(run_type="bogus")


async def test_the_orchestrator_also_defends_against_an_unrecognised_run_type() -> None:
    """The orchestrator's own check, exercised directly against a bypassed state."""
    from app.agents.nodes.orchestrator import orchestrator_node

    state = make_state()
    object.__setattr__(state, "run_type", "bogus")
    _client, bundle = resolvable_bundle()

    with pytest.raises(InvalidRunTypeError):
        await orchestrator_node(state, {"configurable": {"repos": bundle}})


async def test_an_unmet_stage_precondition_blocks_dispatch() -> None:
    """Requirement 1.6: a closed room fails the run before any specialist runs."""
    client, bundle = resolvable_bundle()
    client.set_default(
        "party_rooms", [{"id": ROOM, "status": "cancelled", "planning_stage": "discover"}]
    )
    state = make_state(run_type="discovery")

    with pytest.raises(BackendValidationError):
        await run_agent_graph(state, bundle)

    assert client.write_calls == []


async def test_a_missing_trip_blocks_dispatch() -> None:
    """No Trip_Context at all means no specialist can run."""
    client = FakeSupabaseClient()
    client.set_default("trips", [])
    bundle = wired_bundle(client)
    state = make_state(run_type="discovery")

    with pytest.raises(Exception, match="(?i)trip"):
        await run_agent_graph(state, bundle)

    assert client.write_calls == []
