"""The party brief: everyone's saved preferences, summarised for a prompt.

Character creation saves option ids per member. A prompt needs more than a merged
list of them: it needs to know *how many* members want each thing, what each
member wants on their own, the trip length, and a budget it can trust. This
module builds that once, so every prompt describes the party the same way.

Rules that are easy to get wrong:

* ``destinations`` mixes two things. Trip types ("asia", "beach-escape") are
  wishes about the *kind* of trip; anything else is a real place a member typed.
  Only real places can ever become destination cards.
* ``travel_style`` holds the member's group role (leader, planner, ...), not a
  travel style, and is labelled that way.
* Budget comes from :mod:`app.core.budget`: the level (Low/Medium/High) is shown
  with its daily SGD range so it means something concrete, and the lowest typed
  amount is the hard limit. An out-of-range amount saved before the API checked
  is named as a likely typo, never used as a limit.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from app.agents.group_profile import is_region_word
from app.agents.preference_labels import (
    ACTIVITIES,
    GROUP_ROLES,
    PRIORITIES,
    TRIP_TYPES,
    label_for,
)
from app.core.budget import (
    CURRENCY,
    TIER_LABELS,
    PartyBudget,
    band_text,
    is_valid_amount,
    party_budget,
    tier_of,
)

#: Every trip departs from here (the frontend fixes the origin).
DEPARTURE_CITY = "Singapore"
MAX_NAME_CHARS = 40
MAX_PLACE_CHARS = 80


@dataclass
class MemberBrief:
    member_id: str
    name: str
    is_leader: bool
    role: str | None
    budget_level: str | None
    trip_types: list[str]
    priorities: list[str]
    activities: list[str]


@dataclass
class PartyBrief:
    party_size: int
    #: The longest stretch every member is free: availability, not the trip length.
    start: str | None
    end: str | None
    days: int | None
    #: Every shared date range, for picking the trip's actual dates.
    overlap: list[dict[str, str]]
    budget: PartyBudget
    budget_typos: list[str]
    trip_types: list[tuple[str, int]]
    priorities: list[tuple[str, int]]
    activities: list[tuple[str, int]]
    roles: list[str]
    named_places: list[str]
    members: list[MemberBrief] = field(default_factory=list)

    @property
    def budget_level(self) -> str | None:
        return TIER_LABELS.get(self.budget.tier) if self.budget.tier else None

    @property
    def budget_amount(self) -> float | None:
        return self.budget.limit

    @property
    def member_names(self) -> list[str]:
        return [m.name for m in self.members]


def build_party_brief(
    members: list[dict[str, Any]],
    preferences: list[dict[str, Any]],
    characters: list[dict[str, Any]] | None,
    availability_overlap: list[dict[str, str]] | None,
) -> PartyBrief:
    """Summarise the party from raw rows (no I/O)."""
    prefs_by_member = {str(p.get("member_id")): p for p in preferences}
    tier_by_member = {
        str(c.get("member_id")): tier_of(c) for c in characters or [] if isinstance(c, dict)
    }

    member_briefs: list[MemberBrief] = []
    trip_type_counts: Counter[str] = Counter()
    priority_counts: Counter[str] = Counter()
    activity_counts: Counter[str] = Counter()
    typos: list[str] = []
    roles: list[str] = []
    named_places: list[str] = []

    for index, member in enumerate(members, start=1):
        member_id = str(member.get("id"))
        prefs = prefs_by_member.get(member_id)
        if prefs is None:
            continue
        name = _clean(member.get("display_name"), MAX_NAME_CHARS) or f"Member {index}"
        trip_types = _unique(
            _trip_type_label(d) for d in _list(prefs.get("destinations")) if is_region_word(str(d))
        )
        for place in _list(prefs.get("destinations")):
            cleaned = _clean(place, MAX_PLACE_CHARS)
            if cleaned and not is_region_word(cleaned):
                if cleaned.lower() not in {p.lower() for p in named_places}:
                    named_places.append(cleaned)
        priorities = _unique(label_for(i, PRIORITIES) for i in _list(prefs.get("interests")))
        activities = _unique(
            label_for(_activity_name(a), ACTIVITIES)
            for a in _list(prefs.get("activities"))
            if _activity_name(a)
        )
        tier = tier_by_member.get(member_id)
        role = label_for(prefs["travel_style"], GROUP_ROLES) if prefs.get("travel_style") else None

        trip_type_counts.update(trip_types)
        priority_counts.update(priorities)
        activity_counts.update(activities)
        if role and role not in roles:
            roles.append(role)
        budget = prefs.get("budget")
        if budget is not None and not is_valid_amount(budget):
            typos.append(f"{name} entered {CURRENCY} {budget:,.0f}")
        member_budget = TIER_LABELS.get(tier) if tier else None
        if is_valid_amount(budget):
            amount = f"{CURRENCY} {budget:,.0f} total"
            member_budget = f"{member_budget}, {amount}" if member_budget else amount

        member_briefs.append(
            MemberBrief(
                member_id=member_id,
                name=name,
                is_leader=member.get("role") == "owner" or bool(member.get("is_owner")),
                role=role,
                budget_level=member_budget,
                trip_types=trip_types,
                priorities=priorities,
                activities=activities,
            )
        )

    start, end, days = _window(availability_overlap or [])
    return PartyBrief(
        party_size=len(member_briefs),
        start=start,
        end=end,
        days=days,
        overlap=list(availability_overlap or []),
        budget=party_budget(members, preferences, characters, days),
        budget_typos=typos,
        trip_types=_ranked(trip_type_counts),
        priorities=_ranked(priority_counts),
        activities=_ranked(activity_counts),
        roles=roles,
        named_places=named_places,
        members=member_briefs,
    )


# --- Rendering ------------------------------------------------------------------------


def trip_text(brief: PartyBrief) -> str:
    """When the party can travel. This is availability, never the trip length."""
    if brief.start and brief.end and brief.days:
        return (
            f"the whole party is free from {_pretty(brief.start)} to {_pretty(brief.end)} "
            f"({brief.days} days available; this is when they can travel, not how long "
            f"the trip is), departing from {DEPARTURE_CITY}"
        )
    return f"Dates not set yet, departing from {DEPARTURE_CITY}"


def budget_text(brief: PartyBrief) -> str:
    budget = brief.budget
    if budget.tier:
        label = TIER_LABELS[budget.tier]
        level = (
            f"Budget level: {label.lower()} ({budget.tier_count} of {brief.party_size} chose "
            f"{label} Budget), about {band_text(budget.tier)} per person per day, "
            "excluding flights"
        )
    else:
        level = "Budget level: not stated"
    if budget.limit is not None:
        amount = (
            f"Budget per person for the whole trip, including flights: {CURRENCY} "
            f"{budget.limit:,.0f} (a hard limit, set by {budget.limit_member}, the lowest "
            "in the party)"
        )
    else:
        amount = "Budget per person: no amount given, so treat the level as a guide"
    lines = [level, amount]
    if brief.budget_typos:
        lines.append(
            "Ignored as likely typos (outside SGD 100-50,000): " + "; ".join(brief.budget_typos)
        )
    return "\n".join(lines)


def wants_text(brief: PartyBrief) -> str:
    size = brief.party_size or 1
    shared = [label for label, count in brief.priorities + brief.activities if count > 1]
    solo = [
        f"{m.name}: {label}"
        for m in brief.members
        for label in m.priorities + m.activities
        if dict(brief.priorities + brief.activities).get(label) == 1
    ]

    def counted(items: list[tuple[str, int]]) -> str:
        return ", ".join(f"{label} ({count}/{size})" for label, count in items) or "none chosen"

    return (
        f"- Trip types / regions: {counted(brief.trip_types)}\n"
        f"- Priorities: {counted(brief.priorities)}\n"
        f"- Activities: {counted(brief.activities)}\n"
        f"- Group roles (how each member acts in the group, not a travel style): "
        f"{', '.join(brief.roles) or 'not given'}\n"
        f"- Shared by 2+ members: {', '.join(shared) or 'nothing yet'}\n"
        f"- Only one member asked for: {', '.join(solo) or 'nothing'}"
    )


def members_text(brief: PartyBrief, *, with_ids: bool = False) -> str:
    """One line per member. ``with_ids`` prefixes each with its ``member_id`` for
    prompts whose answer must refer back to members by id."""
    lines = []
    for member in brief.members:
        parts = [
            "trip types: " + (", ".join(member.trip_types) or "any"),
            "priorities: " + (", ".join(member.priorities) or "any"),
            "activities: " + (", ".join(member.activities) or "any"),
            "budget: " + (member.budget_level or "not stated"),
        ]
        if member.role:
            parts.append(f"role: {member.role}")
        name = f"{member.name} (party leader)" if member.is_leader else member.name
        prefix = f"member_id={member.member_id} | " if with_ids else ""
        lines.append(f"- {prefix}{name}: " + " | ".join(parts))
    return "\n".join(lines) or "- (no member details)"


def named_places_text(brief: PartyBrief) -> str:
    return "\n".join(f"- {place}" for place in brief.named_places) or "- none"


# --- Helpers --------------------------------------------------------------------------


def _trip_type_label(value: Any) -> str:
    """Screen label for a trip type id ("beach-escape"), or the typed region, tidied."""
    key = "".join(ch for ch in str(value).lower() if ch.isalpha())
    for trip_id, label in TRIP_TYPES.items():
        if key == "".join(ch for ch in trip_id if ch.isalpha()):
            return label
    return label_for(str(value).strip(), {})


def _window(overlap: list[dict[str, str]]) -> tuple[str | None, str | None, int | None]:
    """The longest shared date range, and its length in days."""
    best: tuple[str | None, str | None, int | None] = (None, None, None)
    for entry in overlap:
        try:
            start, end = date.fromisoformat(entry["start"]), date.fromisoformat(entry["end"])
        except (KeyError, TypeError, ValueError):
            continue
        days = (end - start).days + 1
        if days > 0 and (best[2] is None or days > best[2]):
            best = (entry["start"], entry["end"], days)
    return best


def _pretty(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.day} {d:%b %Y}"


def _activity_name(activity: Any) -> str:
    if isinstance(activity, dict):
        return str(activity.get("name") or "").strip()
    return str(activity or "").strip()


def _ranked(counts: Counter[str]) -> list[tuple[str, int]]:
    # Counter keeps first-seen order for ties, so members' own order breaks ties.
    return sorted(counts.items(), key=lambda kv: -kv[1])


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _clean(value: Any, limit: int) -> str | None:
    text = " ".join(str(value or "").split())[:limit].strip()
    return text or None


def _unique(values: Any) -> list[str]:
    seen: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.append(value)
    return seen
