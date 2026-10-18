"""The compiled Agent_Graph: exactly five nodes, one dispatch edge.

:func:`get_agent_graph` compiles the graph once per process and caches it
(Requirement 1.1) — compilation is pure structure, so there is nothing to gain
from repeating it per run, and every run safely shares the same compiled
object. :func:`run_agent_graph` is the one public entry point the service layer
calls (Requirement 1.8); nothing else under ``app/agents/`` is meant to be
reached from outside this package.

**How repositories reach the nodes without `app/agents/` importing Supabase.**
A node is a plain function of ``(state, config) -> state``. LangGraph passes
whatever was given as ``config={"configurable": {...}}`` at invocation time
through to every node, so :class:`~app.agents.state.RepositoryBundle` rides
along in ``config["configurable"]["repos"]`` rather than being a graph node
constructor argument. The service layer builds that bundle from its injected
repositories and hands it to :func:`run_agent_graph`; this module never
constructs a repository itself (Requirement 1.10, 20.1).

**The dispatch edge is the only place `Run_Type` selects a node.** The
conditional edge below reads ``state.run_type`` — set once at state
construction and frozen thereafter — never anything the orchestrator computed
from ``Trip_Context`` (Requirement 1.4). A graph conditional edge can only ever
route to exactly one of its mapped targets, which is what makes "exactly one
dispatch" (Requirement 1.3) a structural property of the graph rather than
something a node has to remember to uphold.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING, Any

from langgraph.graph import END, StateGraph

from app.agents.nodes.discovery import discovery_node
from app.agents.nodes.itinerary import itinerary_node
from app.agents.nodes.logistics import logistics_node
from app.agents.nodes.negotiation import negotiation_node
from app.agents.nodes.orchestrator import orchestrator_node
from app.agents.nodes.tiebreak import tiebreak_node
from app.agents.state import AgentState

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import RepositoryBundle

#: Requirement 1.2: the total mapping from `agent_run_type` to its entry node.
#: Every value in `app.agents.state.RUN_TYPES` appears exactly once as a key,
#: and no run type maps to more than one node.
ENTRY_NODE_BY_RUN_TYPE: dict[str, str] = {
    "discovery": "discovery",
    "logistics": "logistics",
    "itinerary": "itinerary",
    "refinement": "negotiation",
    "tiebreak": "tiebreak",
}


def _dispatch(state: AgentState) -> str:
    """Read the run's type and return its one entry node's name.

    The run type was validated against the same four values by
    :func:`~app.agents.nodes.orchestrator.orchestrator_node` (defensively) and,
    before that, by ``AgentState``'s own field type — so a lookup miss here
    would mean the orchestrator was skipped, which is itself a programming
    error worth a loud ``KeyError`` rather than a silent fallback.
    """
    return ENTRY_NODE_BY_RUN_TYPE[state.run_type]


def _build_graph() -> StateGraph:
    """Assemble the five-node graph: orchestrator, then one specialist."""
    graph = StateGraph(AgentState)
    graph.add_node("orchestrator", orchestrator_node)
    graph.add_node("discovery", discovery_node)
    graph.add_node("logistics", logistics_node)
    graph.add_node("itinerary", itinerary_node)
    graph.add_node("negotiation", negotiation_node)
    graph.add_node("tiebreak", tiebreak_node)

    node_names = set(ENTRY_NODE_BY_RUN_TYPE.values())
    graph.set_entry_point("orchestrator")
    # `_dispatch` returns a node name directly, so the path map is the identity
    # map over that set of names — not `ENTRY_NODE_BY_RUN_TYPE` itself, whose
    # *keys* are run types rather than the values `_dispatch` returns.
    graph.add_conditional_edges("orchestrator", _dispatch, {name: name for name in node_names})
    for node_name in node_names:
        graph.add_edge(node_name, END)

    return graph


@lru_cache(maxsize=1)
def get_agent_graph() -> Any:
    """Return the process-wide compiled Agent_Graph, compiling it on first use."""
    return _build_graph().compile()


async def run_agent_graph(state: AgentState, repos: RepositoryBundle) -> AgentState:
    """Run the Agent_Graph for one run and return its final state.

    The single public entry point the service layer calls (Requirement 1.8).
    Everything else in :mod:`app.agents` is reached only from here, from a
    node, or from a test.

    Args:
        state: The run's starting state, with run-identity fields already set.
        repos: The repository bundle every node reads and writes through.

    Returns:
        The final :class:`~app.agents.state.AgentState` after the dispatched
        specialist node completes.
    """
    graph = get_agent_graph()
    result = await graph.ainvoke(state, config={"configurable": {"repos": repos}})
    return AgentState.model_validate(result)
