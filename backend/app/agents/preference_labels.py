"""Readable labels for the option ids character creation saves.

The frontend saves option *ids* (``"beach-escape"``, ``"hidden-gems"``), mirroring
``frontend/src/features/party-lobby/lib/characterOptions.ts``. Prompts should read
like the screen the member saw, so these maps turn ids back into the labels.

Keep these in step with ``characterOptions.ts``: an id missing here still works
(:func:`label_for` title-cases it), it just reads a little less naturally.
"""

from __future__ import annotations

#: "Where do you feel like going?" — trip types and regions, never real places.
TRIP_TYPES: dict[str, str] = {
    "asia": "Asia",
    "western-cities": "Western Cities",
    "beach-escape": "Beach Escape",
    "nature-scenery": "Nature & Scenery",
    "food-trip": "Food Trip",
    "cultural-trip": "Cultural Trip",
    "adventure-trip": "Adventure Trip",
    "shopping-city": "Shopping City",
    "hidden-gems": "Hidden Gems",
}

#: Trip priorities, saved as ``interests``.
PRIORITIES: dict[str, str] = {
    "food": "Food",
    "scenery": "Scenery",
    "adventure": "Adventure",
    "shopping": "Shopping",
    "nightlife": "Nightlife",
    "culture": "Culture",
    "relaxation": "Relaxation",
    "hidden-gems": "Hidden Gems",
    "flexibility": "Flexibility",
}

ACTIVITIES: dict[str, str] = {
    "hiking": "Hiking",
    "markets": "Markets",
    "beaches": "Beaches",
    "temples": "Temples",
    "tours": "Tours",
    "relaxing": "Relaxing",
}

#: Group roles, saved as ``travel_style`` (how a member acts in the group).
GROUP_ROLES: dict[str, str] = {
    "leader": "Leader",
    "planner": "Planner",
    "follower": "Follower",
    "chill": "Chill",
    "adventurer": "Adventurer",
}

#: Budget tiers, saved on the character's ``appearance.budgetTier``. Ordered
#: cheapest first, so the party's level is the lowest tier anyone picked.
BUDGET_TIERS: dict[str, str] = {"low": "Low", "medium": "Medium", "high": "High"}


def label_for(value: object, labels: dict[str, str]) -> str:
    """The screen label for an option id; unknown ids are tidied and title-cased."""
    text = " ".join(str(value).split())
    known = labels.get(text.lower())
    if known:
        return known
    return text.replace("-", " ").replace("_", " ").title() if text.islower() else text
