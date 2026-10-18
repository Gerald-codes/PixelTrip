"""Derivation of the party's combined travel profile.

The ``Group_Profile`` is computed fresh inside each ``discovery`` run and held
only in agent state — it is never persisted, because ``agent_run_type`` has no
``group_profile`` value and no table models it (Requirement 7.4).

Two derivations carry real product weight:

* **Availability overlap** is a true intersection. A member who supplied no dates
  contributes nothing rather than blocking the party, but a member who *did*
  supply dates genuinely constrains the result (Requirement 7.2).
* **Budget ceiling** is the *lowest* non-NULL per-member budget, so the most
  constrained traveller governs what the party is offered (Requirement 7.3).
  That is an MVP interpretation: ``product.md`` does not settle whether a party
  budget is per-person, pooled, or averaged, and the initial migration records it
  as an open question. Documented in requirements.md Assumption 9.
"""

from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Any

from app.agents.llm import clip_for_prompt
from app.core.budget import is_valid_amount

#: Keys accepted for a date range inside ``travel_preferences.available_dates``.
#: Tolerant of both shapes because the frontend contract and the mock fixtures
#: have historically used either.
_START_KEYS = ("start", "from", "start_date")
_END_KEYS = ("end", "to", "end_date")


def _parse_date(value: Any) -> date | None:
    """Parse an ISO date (or date-time) string, returning ``None`` if unusable."""
    if isinstance(value, date):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    # Accept a full timestamp by taking its date part.
    if "T" in text:
        text = text.split("T", 1)[0]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _first_key(mapping: dict[str, Any], keys: tuple[str, ...]) -> Any:
    """Return the value of the first present key in ``keys``."""
    for key in keys:
        if key in mapping:
            return mapping[key]
    return None


def _extract_ranges(available_dates: Any) -> list[tuple[date, date]]:
    """Pull well-formed ``(start, end)`` pairs out of a raw jsonb value.

    Malformed or partial entries are skipped rather than raising: a member's
    sloppy input should not abort a run, it should simply not constrain the
    overlap.
    """
    if not isinstance(available_dates, list):
        return []

    ranges: list[tuple[date, date]] = []
    for entry in available_dates:
        if not isinstance(entry, dict):
            continue
        start = _parse_date(_first_key(entry, _START_KEYS))
        end = _parse_date(_first_key(entry, _END_KEYS))
        if start is None or end is None or end < start:
            continue
        ranges.append((start, end))
    return ranges


def _intersect(
    left: list[tuple[date, date]],
    right: list[tuple[date, date]],
) -> list[tuple[date, date]]:
    """Return the pairwise intersection of two sets of date ranges."""
    overlaps: list[tuple[date, date]] = []
    for l_start, l_end in left:
        for r_start, r_end in right:
            start = max(l_start, r_start)
            end = min(l_end, r_end)
            if start <= end:
                overlaps.append((start, end))
    return _merge(overlaps)


def _merge(ranges: list[tuple[date, date]]) -> list[tuple[date, date]]:
    """Sort and coalesce touching or overlapping ranges."""
    if not ranges:
        return []
    ordered = sorted(ranges)
    merged = [ordered[0]]
    for start, end in ordered[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def compute_availability_overlap(
    preferences: list[dict[str, Any]],
) -> list[dict[str, str]]:
    """Return the date ranges every date-supplying member shares.

    Members who supplied no usable range are skipped: they are treated as
    unconstrained rather than as blocking the whole party (Requirement 7.2).

    Returns:
        A list of ``{"start": iso, "end": iso}`` mappings, empty when the
        date-supplying members share nothing.
    """
    per_member = [
        ranges
        for preference in preferences
        if (ranges := _extract_ranges(preference.get("available_dates")))
    ]
    if not per_member:
        return []

    overlap = _merge(per_member[0])
    for ranges in per_member[1:]:
        overlap = _intersect(overlap, ranges)
        if not overlap:
            break

    return [{"start": start.isoformat(), "end": end.isoformat()} for start, end in overlap]


def compute_budget_ceiling(preferences: list[dict[str, Any]]) -> float | None:
    """Return the lowest non-NULL per-member budget, or ``None`` if all are NULL.

    ``None`` means *unconstrained*, and every budget check must treat it that way
    rather than as zero (Requirement 7.3, 12.14).
    """
    budgets: list[float] = []
    for preference in preferences:
        raw = preference.get("budget")
        if raw is None:
            continue
        try:
            amount = float(raw)
        except (TypeError, ValueError):
            continue
        # Amounts outside the accepted range (e.g. a "2" saved before the API checked)
        # are treated as not stated rather than as a limit nobody can meet.
        if is_valid_amount(amount):
            budgets.append(amount)
    return min(budgets) if budgets else None


def _string_entries(value: Any) -> list[str]:
    """Flatten a jsonb array into trimmed, non-empty strings.

    Handles both a bare string list and a list of objects carrying a ``name``,
    ``label``, or ``title``, since ``interests``/``activities`` entries appear in
    both shapes.
    """
    if not isinstance(value, list):
        return []

    entries: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            entries.append(item.strip())
        elif isinstance(item, dict):
            for key in ("name", "label", "title", "activity"):
                candidate = item.get(key)
                if isinstance(candidate, str) and candidate.strip():
                    entries.append(candidate.strip())
                    break
    return entries


def _union_across(preferences: list[dict[str, Any]], column: str) -> list[str]:
    """Return the de-duplicated union of a jsonb string column, order preserved."""
    seen: dict[str, None] = {}
    for preference in preferences:
        for entry in _string_entries(preference.get(column)):
            seen.setdefault(entry, None)
    return list(seen)


def compute_required_activities(preferences: list[dict[str, Any]]) -> list[str]:
    """Return activities the party marked as required.

    Priority lives inside the ``activities`` jsonb objects rather than in a
    dedicated column (Requirement 12.6), so this reads the per-entry flag.
    An entry is required when it carries ``priority`` of ``"must_have"`` /
    ``"required"``, or a truthy ``required`` key.
    """
    required: dict[str, None] = {}
    for preference in preferences:
        activities = preference.get("activities")
        if not isinstance(activities, list):
            continue
        for item in activities:
            if not isinstance(item, dict):
                continue
            priority = str(item.get("priority", "")).strip().lower()
            is_required = bool(item.get("required")) or priority in {
                "must_have",
                "must-have",
                "required",
            }
            if not is_required:
                continue
            for key in ("name", "label", "title", "activity"):
                candidate = item.get(key)
                if isinstance(candidate, str) and candidate.strip():
                    required.setdefault(candidate.strip(), None)
                    break
    return list(required)


#: Where the party flies from when no member has set a departure city.
DEFAULT_ORIGIN = "Singapore"

#: ``hard_constraints`` entry the preferences service mirrors the departure origin into.
_ORIGIN_CONSTRAINT_TYPE = "departure_origin"

#: Wish-list words that name a region or a vibe rather than a place to book. The party
#: uses them to steer the guide ("Asia", "beach"), so they must never become a card.
REGION_WORDS = frozenset(
    {
        "asia",
        "southeast asia",
        "south east asia",
        "east asia",
        "south asia",
        "central asia",
        "europe",
        "western europe",
        "eastern europe",
        "scandinavia",
        "africa",
        "north africa",
        "middle east",
        "oceania",
        "australasia",
        "north america",
        "south america",
        "latin america",
        "central america",
        "caribbean",
        "anywhere",
        "any",
        "somewhere",
    }
)


#: The frontend's "destination vibe" cards are saved into ``destinations`` as ids. They
#: describe what the party wants, not a place to book. Keyed by the id with everything but
#: letters removed (so ``beach-escape``, ``beach_escape`` and ``Beach Escape`` all match,
#: as does the ``beach_escaape`` spelling an older build saved); each maps to a readable
#: label and the keywords it adds to the party's profile.
_VIBES: dict[str, tuple[str, frozenset[str]]] = {
    "asia": ("Asia (region)", frozenset({"asia"})),
    "westerncities": (
        "Western cities (Europe or North America)",
        frozenset({"europe", "north america", "city"}),
    ),
    "beachescape": ("beach escape (vibe)", frozenset({"beach", "island"})),
    "beachescaape": ("beach escape (vibe)", frozenset({"beach", "island"})),
    "naturescenery": ("nature and scenery (vibe)", frozenset({"nature"})),
    "natureandscenery": ("nature and scenery (vibe)", frozenset({"nature"})),
    "foodtrip": ("food trip (vibe)", frozenset({"food"})),
    "culturaltrip": ("cultural trip (vibe)", frozenset({"culture", "history", "temples"})),
    "adventuretrip": ("adventure trip (vibe)", frozenset({"adventure", "hiking"})),
    "shoppingcity": ("shopping city (vibe)", frozenset({"shopping", "city"})),
    "hiddengems": ("hidden gems (vibe)", frozenset()),
}


def _vibe_key(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalpha())


def vibe_keywords(value: str) -> frozenset[str]:
    """Keywords a vibe id adds to the profile; empty for anything that is not a vibe."""
    return _VIBES.get(_vibe_key(value), ("", frozenset()))[1]


def is_region_word(value: str) -> bool:
    """Whether a wish-list entry is a region or a vibe, not a bookable destination."""
    return value.strip().lower() in REGION_WORDS or _vibe_key(value) in _VIBES


def describe_wishes(values: Any) -> list[str]:
    """Wish-list entries as readable text: vibe ids get their label, places stay as typed."""
    if not isinstance(values, list):
        return []
    return [_VIBES.get(_vibe_key(str(v)), (str(v), frozenset()))[0] for v in values]


def member_origin(preference: dict[str, Any]) -> str | None:
    """The member's departure origin, mirrored into ``hard_constraints`` by the API."""
    for item in preference.get("hard_constraints") or []:
        if isinstance(item, dict) and item.get("type") == _ORIGIN_CONSTRAINT_TYPE:
            value = str(item.get("value") or "").strip()
            if value:
                return value
    return None


def _plain_constraints(preference: dict[str, Any]) -> list[str]:
    """Hard constraints written by the member, without the mirrored origin entry."""
    return _string_entries(
        [
            item
            for item in preference.get("hard_constraints") or []
            if not (isinstance(item, dict) and item.get("type") == _ORIGIN_CONSTRAINT_TYPE)
        ]
    )


def compute_member_profiles(
    members: list[dict[str, Any]],
    preferences: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """One profile per member, so the guide can weigh each person and not just the blend.

    A member who has not saved preferences still appears (name only): the guide should
    know they exist and that nothing is known about them.
    """
    prefs_by_member = {str(p.get("member_id")): p for p in preferences}
    profiles: list[dict[str, Any]] = []
    for member in members:
        member_id = str(member.get("id"))
        prefs = prefs_by_member.get(member_id) or {}
        ranges = _extract_ranges(prefs.get("available_dates"))
        profiles.append(
            {
                "member_id": member_id,
                "name": member.get("display_name") or "A party member",
                "is_owner": bool(member.get("is_owner") or member.get("role") == "owner"),
                "has_preferences": bool(prefs),
                "origin": member_origin(prefs),
                "budget": prefs.get("budget"),
                "travel_style": (prefs.get("travel_style") or "").strip() or None,
                "interests": _string_entries(prefs.get("interests")),
                "activities": _string_entries(prefs.get("activities")),
                "required_activities": compute_required_activities([prefs]),
                "destinations": _string_entries(prefs.get("destinations")),
                "hard_constraints": _plain_constraints(prefs),
                "available_dates": [f"{a.isoformat()} to {b.isoformat()}" for a, b in ranges],
            }
        )
    return profiles


def compute_agreement(profiles: list[dict[str, Any]]) -> dict[str, list[str]]:
    """What the party shares and where it pulls apart.

    * ``shared_interests``: named by two or more members, so a good pick serves them all.
    * ``solo_interests``: named by exactly one member, as ``"Name: interest"``, so the
      guide can make sure each person gets something, and flag a trade-off when the pick
      leaves one of them out.
    * ``style_split``: the members' travel styles when they differ.
    * ``origins``: where the party flies from (Singapore unless a member says otherwise),
      since the pick must be reachable.
    """
    owners_by_interest: dict[str, list[str]] = {}
    display: dict[str, str] = {}
    for profile in profiles:
        for interest in profile["interests"] + profile["activities"]:
            key = interest.lower()
            display.setdefault(key, interest)
            names = owners_by_interest.setdefault(key, [])
            if profile["name"] not in names:
                names.append(profile["name"])

    shared = [display[k] for k, owners in owners_by_interest.items() if len(owners) > 1]
    solo = [
        f"{owners[0]}: {display[k]}" for k, owners in owners_by_interest.items() if len(owners) == 1
    ]
    styles = Counter(p["travel_style"] for p in profiles if p["travel_style"])
    style_split = (
        [f"{p['name']}: {p['travel_style']}" for p in profiles if p["travel_style"]]
        if len(styles) > 1
        else []
    )
    origins = sorted({p["origin"] for p in profiles if p["origin"]}) or [DEFAULT_ORIGIN]
    return {
        "shared_interests": shared,
        "solo_interests": solo,
        "style_split": style_split,
        "origins": origins,
    }


def member_profile_line(profile: dict[str, Any]) -> str:
    """One member as a single prompt line (every value is clipped as untrusted input)."""
    if not profile["has_preferences"]:
        return f"- {profile['name']}: has not saved any preferences yet"
    budget = profile["budget"]
    parts = [
        f"budget: {budget if budget is not None else 'none stated'}",
        f"style: {profile['travel_style'] or 'any'}",
        f"flying from: {profile['origin'] or DEFAULT_ORIGIN}",
        f"interests: {clip_for_prompt(profile['interests'], max_items=8)}",
        f"activities: {clip_for_prompt(profile['activities'], max_items=8)}",
        f"must-do: {clip_for_prompt(profile['required_activities'], max_items=5)}",
        f"wish-list: {clip_for_prompt(describe_wishes(profile['destinations']), max_items=6)}",
        f"hard constraints: {clip_for_prompt(profile['hard_constraints'], max_items=6)}",
    ]
    label = f"{profile['name']} (party leader)" if profile["is_owner"] else profile["name"]
    return f"- {label} | " + " | ".join(parts)


def format_party_for_prompt(group_profile: dict[str, Any]) -> str:
    """The per-member block and agreement summary every planning prompt shares.

    Empty string when the profile carries no members, so callers can append it blindly.
    """
    profiles = group_profile.get("member_profiles") or []
    if not profiles:
        return ""
    agreement = group_profile.get("agreement") or {}
    lines = ["Party members (each person's own preferences):"]
    lines.extend(member_profile_line(p) for p in profiles)
    lines.append(f"Shared by 2+ members: {clip_for_prompt(agreement.get('shared_interests'))}")
    solo = clip_for_prompt(agreement.get("solo_interests"), max_items=12)
    lines.append(f"Only one member asked for: {solo}")
    if agreement.get("style_split"):
        lines.append(f"Travel styles differ: {clip_for_prompt(agreement['style_split'])}")
    if agreement.get("origins"):
        lines.append(f"Departure cities: {clip_for_prompt(agreement['origins'])}")
    return "\n".join(lines) + "\n"


def compute_group_profile(
    members: list[dict[str, Any]],
    preferences: list[dict[str, Any]],
    characters: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Derive the party's combined travel profile.

    Args:
        members: ``room_members`` rows for the party.
        preferences: ``travel_preferences`` rows for those members.
        characters: ``characters`` rows, included for persona context.

    Returns:
        A mapping with ``member_count``, ``availability_overlap``,
        ``budget_ceiling``, ``interests``, ``activities``,
        ``required_activities``, ``travel_styles``, ``hard_constraints``,
        ``destinations``, ``appearances``, ``member_profiles`` (one entry per
        member) and ``agreement`` (what the members share and where they differ).

        A member with a NULL or empty value for a column contributes nothing for
        that column (Requirement 7.2).
    """
    member_profiles = compute_member_profiles(members, preferences)
    return {
        "member_count": len(members),
        "member_profiles": member_profiles,
        "agreement": compute_agreement(member_profiles),
        "preference_count": len(preferences),
        "availability_overlap": compute_availability_overlap(preferences),
        "budget_ceiling": compute_budget_ceiling(preferences),
        "interests": _union_across(preferences, "interests"),
        "activities": _union_across(preferences, "activities"),
        "required_activities": compute_required_activities(preferences),
        "travel_styles": sorted(
            {
                str(p["travel_style"]).strip()
                for p in preferences
                if p.get("travel_style") and str(p["travel_style"]).strip()
            }
        ),
        "hard_constraints": _union_across(preferences, "hard_constraints"),
        "destinations": _union_across(preferences, "destinations"),
        "appearances": [c.get("appearance", {}) for c in (characters or []) if isinstance(c, dict)],
    }
