"""Guardrail layer 1: structural validation.

Validates a proposal's *shape* against its Pydantic model before any other layer
runs. Two properties make this layer trustworthy:

* **Deterministic.** No LLM call, no tool call. The same proposal validated
  against the same model always yields the same findings (Requirement 11.4).
* **Exhaustive per pass.** Every validation error is reported in one pass rather
  than stopping at the first, so a repair iteration can fix everything at once
  instead of discovering problems one at a time (Requirement 11.5).

It also guards the database enums. A value destined for an enum column is checked
against that column's members here, before the write is attempted
(Requirement 11.8) — cheaper and clearer than letting Postgres reject it.
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from app.agents.proposals import PROPOSAL_MODELS

#: Every enum column the agent layer writes into, with its exact members.
#: Mirrors ``supabase/migrations/20260925000000_initial_schema.sql``.
ENUM_COLUMNS: dict[str, frozenset[str]] = {
    "message_kind": frozenset({"text", "recommendation", "vote", "summary"}),
    "sender_type": frozenset({"user", "ai"}),
    "itinerary_source": frozenset({"build", "refine"}),
    "itinerary_status": frozenset({"proposed", "approved", "rejected", "superseded"}),
    "vote_session_status": frozenset({"open", "closed"}),
    "selection_kind": frozenset({"destination", "flight"}),
    "feedback_status": frozenset({"open", "addressed"}),
    "planning_stage": frozenset({"setup", "discover", "logistics", "build", "refine", "wrap"}),
    "room_status": frozenset({"active", "finalised", "cancelled"}),
    "member_role": frozenset({"owner", "member"}),
    "trip_status": frozenset(
        {
            "trip_created",
            "group_formed",
            "preferences_collected",
            "destination_selected",
            "flight_selected",
            "itinerary_generated",
            "feedback_collected",
            "refinement_completed",
            "trip_approved",
            "trip_exported",
        }
    ),
    "agent_run_type": frozenset({"discovery", "logistics", "itinerary", "refinement", "tiebreak"}),
    "agent_run_status": frozenset({"pending", "running", "completed", "failed"}),
}

#: Finding kinds, so callers can branch on the failure class rather than parsing
#: message text.
FINDING_MISSING = "missing"
FINDING_UNKNOWN = "unknown"
FINDING_WRONG_TYPE = "wrong_type"
FINDING_CONSTRAINT = "constraint"
FINDING_UNPARSEABLE = "unparseable"
FINDING_INVALID_ENUM = "invalid_enum"

#: Pydantic error types that mean "this field was not provided".
_MISSING_ERROR_TYPES = frozenset({"missing", "model_attributes_type"})

#: Pydantic error types that mean "this field is not in the model".
_UNKNOWN_ERROR_TYPES = frozenset({"extra_forbidden"})


class UnknownProposalKindError(ValueError):
    """Raised when a proposal kind has no registered model."""


def validate_enum_column(column: str, value: Any) -> list[dict[str, Any]]:
    """Check ``value`` against the members of enum ``column``.

    Args:
        column: The enum column name, e.g. ``"message_kind"``.
        value: The candidate value.

    Returns:
        An empty list when valid, otherwise a single finding.

    Raises:
        UnknownProposalKindError: If ``column`` is not a known enum column. An
            unknown column name is a programming error, not a data problem, so it
            must not be silently reported as a validation finding.
    """
    if column not in ENUM_COLUMNS:
        raise UnknownProposalKindError(f"{column!r} is not a known enum column")

    members = ENUM_COLUMNS[column]
    if value in members:
        return []
    return [
        {
            "layer": "structural",
            "kind": FINDING_INVALID_ENUM,
            "field_path": column,
            "expected": sorted(members),
            "message": (
                f"{value!r} is not a valid {column} value; expected one of {sorted(members)}"
            ),
        }
    ]


def _classify(error: dict[str, Any]) -> str:
    """Map a Pydantic error to one of the finding kinds."""
    error_type = str(error.get("type", ""))
    if error_type in _MISSING_ERROR_TYPES:
        return FINDING_MISSING
    if error_type in _UNKNOWN_ERROR_TYPES:
        return FINDING_UNKNOWN
    if error_type.endswith("_type"):
        return FINDING_WRONG_TYPE
    return FINDING_CONSTRAINT


def _field_path(error: dict[str, Any]) -> str:
    """Render a Pydantic error location as a dotted path from the model root."""
    location = error.get("loc", ())
    return ".".join(str(part) for part in location) or "<root>"


def _finding_from_error(error: dict[str, Any]) -> dict[str, Any]:
    """Convert one Pydantic error into a repair-loop finding.

    Each finding names the field path, the expected type or constraint, and
    whether the field was missing, unknown, or wrongly typed
    (Requirement 11.7).
    """
    return {
        "layer": "structural",
        "kind": _classify(error),
        "field_path": _field_path(error),
        "expected": str(error.get("type", "")),
        "message": str(error.get("msg", "invalid value")),
    }


def validate_structural(
    proposal: Any,
    kind: str,
) -> tuple[Any | None, list[dict[str, Any]]]:
    """Validate ``proposal`` against the model registered for ``kind``.

    Args:
        proposal: The raw proposal — a mapping, or an already-built model
            instance (which revalidates, so this is safe either way).
        kind: One of the keys of
            :data:`~app.agents.proposals.PROPOSAL_MODELS`.

    Returns:
        ``(model, [])`` on success, or ``(None, findings)`` with one finding per
        validation error.

    Raises:
        UnknownProposalKindError: If ``kind`` has no registered model.
    """
    model_cls = PROPOSAL_MODELS.get(kind)
    if model_cls is None:
        raise UnknownProposalKindError(
            f"{kind!r} is not a known proposal kind; expected one of {sorted(PROPOSAL_MODELS)}"
        )

    if not isinstance(proposal, dict | model_cls):
        # Not structured data at all (a bare string, None, a list). There are no
        # field paths to report, so this is a single unparseable finding
        # (Requirement 11.9).
        return None, [
            {
                "layer": "structural",
                "kind": FINDING_UNPARSEABLE,
                "field_path": None,
                "expected": model_cls.__name__,
                "message": (
                    "generation did not return well-formed structured data "
                    f"(got {type(proposal).__name__})"
                ),
            }
        ]

    try:
        validated = model_cls.model_validate(proposal)
    except ValidationError as exc:
        # `errors()` returns every problem found in the pass, which is what makes
        # this layer exhaustive rather than first-failure-only.
        return None, [_finding_from_error(error) for error in exc.errors()]

    return validated, []
