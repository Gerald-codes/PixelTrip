"""SETUP guidance and WRAP summary — the two stages outside the Agent_Graph.

Neither SETUP nor WRAP corresponds to an `agent_run_type` value (there is no
`setup` or `wrap` entry in the enum), so neither creates an `agent_runs` row or
goes through `AgentRunService.trigger_run` — both are plain, synchronous
helpers the service layer calls directly (Requirement 1.11-1.13).

* **SETUP** just narrates: welcome the party, explain what happens next. No
  generation, no persisted decision, so nothing more than an `NPC_Message` is
  ever at stake.
* **WRAP** reads back the single `status='approved'` itinerary version and
  presents it as the adventure's final summary. It never writes a new
  `itinerary_versions` row — WRAP produces no new content, it packages
  content the party already approved.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from app.agents.errors import NoApprovedItineraryError
from app.agents.messages import SummaryMessageContent, TextMessageContent, emit_npc_message

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import RepositoryBundle

#: The `content.stage` value both helpers emit under.
_SETUP_STAGE = "SETUP"
_WRAP_STAGE = "WRAP"

#: Default SETUP welcome copy. Short, in-character, and asks nothing specific —
#: SETUP's job is to orient the party, not to collect an answer.
DEFAULT_SETUP_TEXT = (
    "Welcome, adventurers! Gather your party, build your characters, and share your "
    "travel preferences so our quest can begin."
)


async def emit_setup_guidance(
    repos: RepositoryBundle,
    trip_id: str,
    text: str = DEFAULT_SETUP_TEXT,
) -> dict[str, Any]:
    """Emit one SETUP-stage guidance message.

    Requirement 1.11: no `agent_runs` row is created for this — it is a plain
    message write, not an agent run.

    Args:
        repos: The repository bundle.
        trip_id: The trip whose room receives the guidance.
        text: The guidance copy. Defaults to a generic welcome; callers may
            pass something more specific (e.g. naming a missing character).

    Returns:
        The inserted ``messages`` row.
    """
    return await emit_npc_message(
        repos, trip_id, "text", TextMessageContent(text=text, stage=_SETUP_STAGE)
    )


async def produce_wrap_summary(
    repos: RepositoryBundle,
    trip_id: str,
) -> dict[str, Any]:
    """Produce the WRAP-stage final summary from the trip's approved version.

    Requirement 1.12: reads the single `status='approved'` version; never
    inserts a new one. Requirement 1.13: fails loudly, emitting nothing, when
    no version has been approved yet.

    Args:
        repos: The repository bundle.
        trip_id: The trip being wrapped up.

    Returns:
        The inserted ``summary`` ``messages`` row.

    Raises:
        NoApprovedItineraryError: If the trip has no `status='approved'`
            itinerary version. No message is emitted on this path.
    """
    approved = await repos.itinerary_version_repo.get_approved(trip_id)
    if approved is None:
        raise NoApprovedItineraryError()

    itinerary = approved.get("itinerary") or {}
    return await emit_npc_message(
        repos,
        trip_id,
        "summary",
        SummaryMessageContent(
            title=itinerary.get("title") or "The adventure's end",
            text=itinerary.get("summary") or "The party's journey is complete.",
            stage=_WRAP_STAGE,
            itinerary_version_id=approved["id"],
        ),
    )
