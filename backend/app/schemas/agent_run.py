"""The ``agent_runs`` API shape, matching the "AI Runs" entry in `api-contracts.md`.

Exactly seven fields reach the wire (Requirement 4.6): ``idempotency_key``,
``created_by_member_id``, ``iteration_count``, ``started_at``, and
``completed_at`` are internal lifecycle bookkeeping and are deliberately absent
from this model rather than merely unset — a caller cannot read them even by
accident, because the attribute does not exist.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


def _to_camel(name: str) -> str:
    """Convert a ``snake_case`` field name to ``camelCase`` for the wire shape."""
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


class AgentRunSchema(BaseModel):
    """The serialized shape of one ``agent_runs`` row.

    Built with ``populate_by_name`` so the service layer can construct it from
    the snake_case repository row directly, while ``model_dump(by_alias=True)``
    produces the camelCase wire shape the frontend contract expects.
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=_to_camel)

    id: str
    trip_id: str
    run_type: Literal["discovery", "logistics", "itinerary", "refinement", "tiebreak"]
    status: Literal["pending", "running", "completed", "failed"]
    base_version: int
    result_version_id: str | None = None
    error: str | None = None

    @classmethod
    def from_row(cls, row: dict) -> AgentRunSchema:
        """Build the schema from a raw ``agent_runs`` repository row.

        Only the seven documented fields are read; every other column on the
        row (``idempotency_key``, ``created_by_member_id``, ``iteration_count``,
        ``started_at``, ``completed_at``, ...) is ignored rather than copied.
        """
        return cls(
            id=row["id"],
            trip_id=row["trip_id"],
            run_type=row["run_type"],
            status=row["status"],
            base_version=row["base_version"],
            result_version_id=row.get("result_version_id"),
            error=row.get("error"),
        )


class AgentRunProgressSchema(BaseModel):
    """Progress of a trip's latest run, for the "guide is thinking" UI.

    Separate from :class:`AgentRunSchema` (whose seven fields are fixed by
    Requirement 4.6): it adds the run's current ``phase`` and how long it has been
    going, and still exposes no internal column or timestamp.
    """

    model_config = ConfigDict(populate_by_name=True, alias_generator=_to_camel)

    id: str
    run_type: Literal["discovery", "logistics", "itinerary", "refinement", "tiebreak"]
    status: Literal["pending", "running", "completed", "failed"]
    #: The step the run is on, or failed on (see ``app.agents.progress``).
    phase: str | None = None
    #: Seconds since the run started (or was created), rounded.
    elapsed_seconds: int
