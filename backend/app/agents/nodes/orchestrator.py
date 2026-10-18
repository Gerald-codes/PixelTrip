"""Orchestrator_Node — the one node every run passes through first.

Two checks happen here, in order, and nothing else does:

1. **The run type is one of the four recognised values.** In practice this is
   defensive rather than load-bearing: ``AgentState.run_type`` is typed
   ``Literal["discovery", "logistics", "itinerary", "refinement"]``, so an
   ``AgentState`` carrying anything else fails to construct before
   :func:`~app.agents.graph.run_agent_graph` is ever called — the real
   enforcement point is wherever a raw string becomes an ``AgentState``
   (:meth:`~app.services.agent_run_service.AgentRunService.trigger_run`). This
   check stays here anyway so a future caller that constructs ``AgentState``
   some other way still gets Requirement 1.5's guarantee: no dispatch, no
   write, before an invalid type is caught.

2. **The run's stage preconditions hold.** Delegated entirely to
   :func:`~app.agents.state.load_trip_context`, which already raises
   :class:`~app.agents.errors.TripNotFoundError` or
   :class:`~app.agents.errors.StagePreconditionNotMetError` from a live
   repository read — never from ``Trip_Context`` the caller carried in
   (Requirement 1.4, Requirement 6). This node does not re-implement that
   logic; doing so twice would be exactly the kind of duplication that drifts.

Dispatch itself is not performed by this function — it returns the state with
trip context attached, and :mod:`app.agents.graph`'s conditional edge reads
``state.run_type`` to pick the one entry node (Requirement 1.3). That keeps the
"exactly one dispatch" guarantee structural: a graph conditional edge can only
route to one node.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from langchain_core.runnables import RunnableConfig

from app.agents.errors import InvalidRunTypeError
from app.agents.state import RUN_TYPES, load_trip_context

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import AgentState


async def orchestrator_node(state: AgentState, config: RunnableConfig) -> AgentState:
    """Validate the run type and stage preconditions, then hand off to dispatch.

    Args:
        state: The run's state, carrying the run type to validate against.
        config: The LangGraph run config. ``config["configurable"]["repos"]``
            carries the :class:`~app.agents.state.RepositoryBundle` the service
            layer attached when invoking the graph (Requirement 1.10, 20.1).

    Returns:
        The state with a freshly loaded ``trip_context``, ready for
        :mod:`app.agents.graph` to dispatch on ``state.run_type``.

    Raises:
        InvalidRunTypeError: If ``run_type`` is outside the four recognised
            values (Requirement 1.5). No write happens on this path.
        TripNotFoundError: If the trip does not exist.
        StagePreconditionNotMetError: If the room is closed or the trip has
            already advanced past this run's stage (Requirement 1.6).
    """
    if state.run_type not in RUN_TYPES:
        raise InvalidRunTypeError(state.run_type)

    repos = config["configurable"]["repos"]
    context = await load_trip_context(repos, state.trip_id, state.run_type)
    return state.with_trip_context(context)
