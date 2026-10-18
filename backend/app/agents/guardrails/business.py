"""Guardrail layer 2: deterministic business rules.

Plain Python, no LLM (Requirement 12.1). That is the point of this layer:
compliance with the party's budget, dates, and hard constraints must not depend
on the model behaving well.

All five checks run on every evaluation, in a fixed order, and none
short-circuits (Requirement 12.12). A repair iteration therefore sees every
problem at once instead of fixing one and rediscovering the next — which also
means the iteration cap is spent on genuinely distinct attempts.

Two "absent value" rules are deliberate and worth stating plainly:

* An **unconstrained budget** (every member's budget NULL) *passes* the budget
  check rather than failing it (Requirement 12.14).
* A **missing travel time** between two items is treated as *exceeding* the gap
  rather than estimated from model output (Requirement 12.4). Guessing here would
  let the model invent feasibility.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from app.agents.proposals import (
    ItineraryModel,
    ItineraryProposal,
    RecommendationProposalBase,
    RefinementProposal,
)

#: Check identifiers, in the fixed evaluation order of Requirement 12.12.
CHECK_BUDGET = "budget_ceiling"
CHECK_DATES = "availability_overlap"
CHECK_TRAVEL_TIME = "travel_time_feasibility"
CHECK_HARD_CONSTRAINTS = "hard_constraints"
CHECK_REQUIRED_ACTIVITIES = "required_activities"

#: The order every evaluation walks. Exposed so a test can assert the order is
#: fixed rather than incidental.
CHECK_ORDER: tuple[str, ...] = (
    CHECK_BUDGET,
    CHECK_DATES,
    CHECK_TRAVEL_TIME,
    CHECK_HARD_CONSTRAINTS,
    CHECK_REQUIRED_ACTIVITIES,
)


def _finding(
    check: str,
    element: str | None,
    violated: Any,
    message: str,
) -> dict[str, Any]:
    """Build one rejection finding.

    Each names the failing check, the offending element, and the bound that was
    violated (Requirement 12.13), so the producing node can act on it without
    parsing prose.
    """
    return {
        "layer": "business",
        "check": check,
        "element": element,
        "violated": violated,
        "message": message,
    }


def _parse_date(value: Any) -> date | None:
    """Parse an ISO date string, returning ``None`` when unusable."""
    if isinstance(value, date):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().split("T", 1)[0]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _overlap_ranges(group_profile: dict[str, Any]) -> list[tuple[date, date]]:
    """Return the availability overlap as parsed date pairs."""
    ranges: list[tuple[date, date]] = []
    for entry in group_profile.get("availability_overlap") or []:
        start = _parse_date(entry.get("start"))
        end = _parse_date(entry.get("end"))
        if start is not None and end is not None:
            ranges.append((start, end))
    return ranges


def _itinerary_of(proposal: Any) -> ItineraryModel | None:
    """Return the itinerary carried by a proposal, if it carries one."""
    if isinstance(proposal, ItineraryProposal | RefinementProposal):
        return proposal.itinerary
    return None


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------


def check_budget(proposal: Any, group_profile: dict[str, Any]) -> list[dict[str, Any]]:
    """Reject a proposal whose total costed value exceeds the budget ceiling.

    An unconstrained ceiling passes without emitting a finding
    (Requirement 12.14).
    """
    ceiling = group_profile.get("budget_ceiling")
    if ceiling is None:
        return []

    itinerary = _itinerary_of(proposal)
    if itinerary is None:
        return _check_recommendation_prices(proposal, float(ceiling))

    total = itinerary.total_cost()
    if total > float(ceiling):
        return [
            _finding(
                CHECK_BUDGET,
                "itinerary.total_cost",
                ceiling,
                f"total costed value {total} exceeds the budget ceiling {ceiling}",
            )
        ]
    return []


def _check_recommendation_prices(proposal: Any, ceiling: float) -> list[dict[str, Any]]:
    """Reject recommendation items priced above the ceiling."""
    if not isinstance(proposal, RecommendationProposalBase):
        return []

    findings: list[dict[str, Any]] = []
    for item in proposal.items:
        raw_price = item.meta.get("price")
        if raw_price is None:
            continue
        try:
            price = float(raw_price)
        except (TypeError, ValueError):
            continue
        if price > ceiling:
            findings.append(
                _finding(
                    CHECK_BUDGET,
                    item.id,
                    ceiling,
                    f"option {item.id!r} priced {price} exceeds the ceiling {ceiling}",
                )
            )
    return findings


def check_dates(proposal: Any, group_profile: dict[str, Any]) -> list[dict[str, Any]]:
    """Reject dates falling outside the party's availability overlap.

    When the overlap is empty, *every* date is outside it (Requirement 12.3) —
    an empty intersection means there is no shared window at all, so no date can
    be valid.
    """
    itinerary = _itinerary_of(proposal)
    if itinerary is None:
        return []

    proposal_dates: list[tuple[str, date]] = []
    if itinerary.dates is not None:
        bounds = (
            ("dates.start", itinerary.dates.start),
            ("dates.end", itinerary.dates.end),
        )
        for label, raw in bounds:
            parsed = _parse_date(raw)
            if parsed is not None:
                proposal_dates.append((label, parsed))
    for day in itinerary.days:
        parsed = _parse_date(day.date)
        if parsed is not None:
            proposal_dates.append((f"days[{day.day}].date", parsed))

    if not proposal_dates:
        return []

    ranges = _overlap_ranges(group_profile)
    if not ranges:
        return [
            _finding(
                CHECK_DATES,
                label,
                "empty availability overlap",
                f"{label} ({value.isoformat()}) cannot be scheduled: the party "
                "shares no available dates",
            )
            for label, value in proposal_dates
        ]

    findings: list[dict[str, Any]] = []
    for label, value in proposal_dates:
        if not any(start <= value <= end for start, end in ranges):
            findings.append(
                _finding(
                    CHECK_DATES,
                    label,
                    [{"start": s.isoformat(), "end": e.isoformat()} for s, e in ranges],
                    f"{label} ({value.isoformat()}) falls outside the party's available dates",
                )
            )
    return findings


def _minutes_between(earlier: str | None, later: str | None) -> int | None:
    """Return whole minutes between two ``HH:MM`` times, or ``None`` if unparseable."""

    def _to_minutes(value: str | None) -> int | None:
        if not isinstance(value, str) or ":" not in value:
            return None
        head = value.strip().split("+", 1)[0]
        parts = head.split(":")
        try:
            return int(parts[0]) * 60 + int(parts[1])
        except (ValueError, IndexError):
            return None

    start = _to_minutes(earlier)
    end = _to_minutes(later)
    if start is None or end is None:
        return None
    return end - start


def check_travel_time(
    proposal: Any,
    group_profile: dict[str, Any],
    tool_responses: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Reject a day whose consecutive items cannot physically be reached in time.

    Travel durations come from the recorded tool responses, never from model
    output. A pair whose duration is absent is treated as infeasible rather than
    estimated (Requirement 12.4).

    Only *timed* consecutive pairs are checked: two untimed items impose no
    schedule, so there is nothing to violate.
    """
    itinerary = _itinerary_of(proposal)
    if itinerary is None:
        return []

    durations = _travel_durations(tool_responses or [])
    findings: list[dict[str, Any]] = []

    for day in itinerary.days:
        timed = [item for item in day.items if item.time]
        for first, second in zip(timed, timed[1:], strict=False):
            gap = _minutes_between(first.time, second.time)
            if gap is None:
                continue
            key = (first.location_id or first.id, second.location_id or second.id)
            travel = durations.get(key)
            if travel is None:
                findings.append(
                    _finding(
                        CHECK_TRAVEL_TIME,
                        f"{first.id}->{second.id}",
                        "no recorded travel time",
                        f"travel time from {first.id!r} to {second.id!r} is absent "
                        "from the tool response, so feasibility cannot be confirmed",
                    )
                )
                continue
            if travel > gap:
                findings.append(
                    _finding(
                        CHECK_TRAVEL_TIME,
                        f"{first.id}->{second.id}",
                        gap,
                        f"travel of {travel} minutes exceeds the {gap} minute gap "
                        f"between {first.id!r} and {second.id!r}",
                    )
                )
    return findings


def _travel_durations(
    tool_responses: list[dict[str, Any]],
) -> dict[tuple[str, str], int]:
    """Index recorded travel durations by ``(origin_id, destination_id)``."""
    durations: dict[tuple[str, str], int] = {}
    for response in tool_responses:
        for leg in response.get("travel_times") or []:
            if not isinstance(leg, dict):
                continue
            origin = leg.get("from")
            destination = leg.get("to")
            minutes = leg.get("minutes")
            if origin is None or destination is None or minutes is None:
                continue
            try:
                durations[(str(origin), str(destination))] = int(minutes)
            except (TypeError, ValueError):
                continue
    return durations


def check_hard_constraints(proposal: Any, group_profile: dict[str, Any]) -> list[dict[str, Any]]:
    """Reject a proposal violating any member's hard constraint.

    Matching is a case-insensitive substring scan over the proposal's text. Blunt
    by design: a hard constraint is a veto, so a false positive (asking the model
    to try again) is far cheaper than a false negative (handing the party a plan
    that breaks a stated requirement).
    """
    constraints = group_profile.get("hard_constraints") or []
    if not constraints:
        return []

    haystack = _proposal_text(proposal).lower()
    findings: list[dict[str, Any]] = []
    for constraint in constraints:
        text = str(constraint).strip()
        if not text:
            continue
        violation = _negated_constraint(text)
        if violation and violation in haystack:
            findings.append(
                _finding(
                    CHECK_HARD_CONSTRAINTS,
                    violation,
                    text,
                    f"proposal appears to violate the hard constraint {text!r}",
                )
            )
    return findings


def _negated_constraint(constraint: str) -> str | None:
    """Extract the forbidden subject from a negative constraint.

    ``"no flights over 8 hours"`` yields ``"flights over 8 hours"``. A constraint
    that is not phrased as a prohibition yields ``None``: it states a preference
    rather than something a proposal can contain and thereby violate.
    """
    lowered = constraint.strip().lower()
    for prefix in ("no ", "not ", "avoid ", "without ", "never "):
        if lowered.startswith(prefix):
            return lowered[len(prefix) :].strip() or None
    return None


def _proposal_text(proposal: Any) -> str:
    """Flatten a proposal's human-readable text for constraint scanning."""
    parts: list[str] = []

    itinerary = _itinerary_of(proposal)
    if itinerary is not None:
        parts.extend([itinerary.title, itinerary.summary, itinerary.destination.name])
        for day in itinerary.days:
            for item in day.items:
                parts.extend(
                    [
                        item.title,
                        item.description or "",
                        item.location or "",
                        " ".join(item.tags),
                    ]
                )
    elif isinstance(proposal, RecommendationProposalBase):
        parts.append(proposal.title)
        for item in proposal.items:
            parts.extend([item.title, item.description])
            parts.extend(str(v) for v in item.meta.values())

    return " ".join(part for part in parts if part)


def check_required_activities(proposal: Any, group_profile: dict[str, Any]) -> list[dict[str, Any]]:
    """Reject an itinerary omitting an activity the party marked required.

    Only applies to itinerary proposals: a destination or flight recommendation
    is not where an activity would appear (Requirement 12.6).
    """
    itinerary = _itinerary_of(proposal)
    if itinerary is None:
        return []

    required = group_profile.get("required_activities") or []
    if not required:
        return []

    haystack = _proposal_text(proposal).lower()
    findings: list[dict[str, Any]] = []
    for activity in required:
        text = str(activity).strip()
        if text and text.lower() not in haystack:
            findings.append(
                _finding(
                    CHECK_REQUIRED_ACTIVITIES,
                    text,
                    "required activity",
                    f"required activity {text!r} does not appear in the itinerary",
                )
            )
    return findings


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def run_business_guardrail(
    proposal: Any,
    group_profile: dict[str, Any],
    tool_responses: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Run all five checks in fixed order and return every finding.

    No check short-circuits: the evaluation is exhaustive so one repair iteration
    can address everything at once (Requirement 12.12).

    Args:
        proposal: A structurally valid proposal model.
        group_profile: The derived group profile.
        tool_responses: Recorded external tool responses, used by the travel-time
            check.

    Returns:
        Every finding from every failing check, grouped in :data:`CHECK_ORDER`.
        Empty means the proposal passed.
    """
    findings: list[dict[str, Any]] = []
    findings.extend(check_budget(proposal, group_profile))
    findings.extend(check_dates(proposal, group_profile))
    findings.extend(check_travel_time(proposal, group_profile, tool_responses))
    findings.extend(check_hard_constraints(proposal, group_profile))
    findings.extend(check_required_activities(proposal, group_profile))
    return findings
