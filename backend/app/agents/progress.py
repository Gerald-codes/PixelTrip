"""Run progress: the step an AI run is on, for honest "the guide is…" lines.

Nodes call :func:`report_phase` as they move between real steps. The value lands
on ``agent_runs.phase`` and the frontend maps it to an in-world line (see
``frontend/src/features/party-lobby/lib/guidePhases.ts``). A failed run keeps the
step it failed on, which tells the party what went wrong.

Reporting is best-effort: a progress write must never fail a run, so every error
is swallowed (including a database that has not run the ``phase`` migration yet).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import AgentState, RepositoryBundle

logger = logging.getLogger(__name__)

Phase = Literal[
    "reading_party",  # loading members and preferences
    "asking_guide",  # waiting on the LLM
    "searching_flights",  # calling the flight search tool
    "checking_budget",  # applying budget, dates and constraints
    "checking_answer",  # guardrail validation
    "drafting_days",  # itinerary days being written
    "weighing_feedback",  # refinement: reading feedback, finding what to change
    "weighing_options",  # tiebreak: scoring the tied options
    "posting",  # writing the result for the party
]


async def report_phase(repos: RepositoryBundle, state: AgentState, phase: Phase) -> None:
    """Record ``phase`` on the run. Never raises."""
    try:
        await repos.agent_run_repo.set_phase(state.run_id, phase)
    except Exception:  # progress is a courtesy; the run's outcome is what matters
        logger.debug("Could not record phase %s for run %s", phase, state.run_id)
