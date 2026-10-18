"""The sole writer of ``trips.status`` and ``party_rooms.planning_stage``.

Requirement 18.10 names this explicitly: no other module may call
``TripRepository.update_status``. The agent layer calls through
:func:`advance_trip_status` instead, which adds the two things a bare repository
write would not have — a monotonicity check and the status-to-stage derivation —
and nothing else, so a caller cannot bypass either by reaching for the
repository directly.

**Why monotonicity is enforced here and not in the database.** The ``trip_status``
enum has no ordering Postgres knows about; "lower rank" is a fact about this
service's :data:`_STATUS_RANK` table, not about the column type. Enforcing it in
SQL would mean duplicating that table in a CHECK constraint, out of sync risk
included.

**The one permitted regression.** ``refinement_completed -> feedback_collected``
is explicitly allowed to recur every time the party leaves feedback on a new
itinerary version during REFINE (Requirement 18.8) — that is the refine loop,
and it is the single exception to "status never moves backward".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import RepositoryBundle

#: Requirement 18.1: the ten `trip_status` enum values, ranked low to high.
STATUS_ORDER: tuple[str, ...] = (
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
)

#: ``status -> rank``, 1-indexed to match the requirement's own numbering.
_STATUS_RANK: dict[str, int] = {status: rank for rank, status in enumerate(STATUS_ORDER, start=1)}

#: Requirement 18.10: the fixed status -> planning-stage mapping. The sole
#: derivation path for ``party_rooms.planning_stage``.
STAGE_BY_STATUS: dict[str, str] = {
    "trip_created": "setup",
    "group_formed": "setup",
    "preferences_collected": "discover",
    "destination_selected": "logistics",
    "flight_selected": "build",
    "itinerary_generated": "refine",
    "feedback_collected": "refine",
    "refinement_completed": "refine",
    "trip_approved": "wrap",
    "trip_exported": "wrap",
}

#: Requirement 18.8: the single transition permitted to move rank backward,
#: and permitted to recur without limit.
_REFINE_LOOP_TRANSITION: tuple[str, str] = ("refinement_completed", "feedback_collected")


@dataclass(frozen=True)
class StatusAdvanceResult:
    """The outcome of one :func:`advance_trip_status` call.

    Attributes:
        status: The trip's status after this call — the new value if the write
            happened, or the unchanged current value if it was a no-op.
        advanced: Whether a write actually occurred.
        row: The updated ``trips`` row, or ``None`` on a no-op.
    """

    status: str
    advanced: bool
    row: dict | None = None


def is_refine_loop_transition(current_status: str, new_status: str) -> bool:
    """Return ``True`` for the one permitted backward transition."""
    return (current_status, new_status) == _REFINE_LOOP_TRANSITION


async def advance_trip_status(
    repos: RepositoryBundle,
    trip_id: str,
    new_status: str,
    current_status: str,
) -> StatusAdvanceResult:
    """Move the trip to ``new_status``, deriving its planning stage.

    A same-or-lower rank request is a no-op reporting the unchanged current
    status (Requirement 18.7), except for the refine-loop transition, which is
    permitted to recur (Requirement 18.8). The move is never advisory: either the
    row and its stage both change in one write, or nothing changes
    (Requirement 18.6, 18.10).

    Args:
        repos: The repository bundle. Only ``trip_repo`` is used.
        trip_id: The trip to advance.
        new_status: The requested ``trip_status`` value.
        current_status: The trip's status as read immediately before this call,
            supplied by the caller rather than re-read here so the caller's own
            read and this decision are made against the same observed value.

    Returns:
        A :class:`StatusAdvanceResult` describing what happened.

    Raises:
        KeyError: If either status is not one of the ten enum values. This is a
            caller bug — every call site works with values already drawn from
            the enum — so it is not wrapped in a domain exception.
        RepositoryError: If the underlying write fails.
    """
    if is_refine_loop_transition(current_status, new_status):
        advance = True
    else:
        advance = _STATUS_RANK[new_status] > _STATUS_RANK[current_status]

    if not advance:
        return StatusAdvanceResult(status=current_status, advanced=False)

    stage = STAGE_BY_STATUS[new_status]
    row = await repos.trip_repo.update_status(trip_id, new_status, stage)
    return StatusAdvanceResult(status=new_status, advanced=True, row=row)
