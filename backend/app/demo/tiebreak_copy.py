"""Prewritten traveller-fit explanations for the prepared voting options."""

from app.demo.scenario import DESTINATION_MATCH_COPY

OPTION_COPY = {
    "demo-da-nang": {
        "recommendation": "Da Nang",
        "whyThisFits": (
            "Beach time, local food and lively evenings give the party variety "
            "without packing every day with travel."
        ),
        "details": (
            "Mix My Khe Beach, Marble Mountains, market stops "
            "and a Hoi An day trip across five days."
        ),
        "tradeOff": DESTINATION_MATCH_COPY["demo-da-nang"]["tradeOff"],
        "tags": ["Beach time", "Food", "Nightlife"],
    },
    "demo-bali": {
        "recommendation": "Bali",
        "whyThisFits": (
            "Beach sunsets and lively dining balance temple visits and rice-field scenery, "
            "giving the party both social evenings and cultural discovery."
        ),
        "details": (
            "Combine Seminyak beach time with Ubud's temples and art market, "
            "Tegallalang rice terraces and Uluwatu's clifftop views."
        ),
        "tradeOff": DESTINATION_MATCH_COPY["demo-bali"]["tradeOff"],
        "tags": ["Beach sunsets", "Temples", "Rice terraces"],
    },
    "demo-phuket": {
        "recommendation": "Phuket",
        "whyThisFits": (
            "Thai food and Patong nightlife pair with temple visits, heritage streets "
            "and quieter beaches for a varied coastal escape."
        ),
        "details": (
            "Mix Patong and Kamala beach breaks with Wat Chalong, "
            "Phuket Old Town and the views around Kata and Karon."
        ),
        "tradeOff": DESTINATION_MATCH_COPY["demo-phuket"]["tradeOff"],
        "tags": ["Thai food", "Coastal views", "Nightlife"],
    },
    "demo-hoi-an": {
        "recommendation": "Hoi An",
        "whyThisFits": (
            "A compact old town, cafés and lantern-lit riverside walks "
            "make it easy to explore together at a gentler pace."
        ),
        "details": (
            "Balance heritage walks and craft shops with countryside cycling "
            "and an An Bang beach day."
        ),
        "tradeOff": DESTINATION_MATCH_COPY["demo-hoi-an"]["tradeOff"],
        "tags": ["Heritage", "Cafés", "Relaxed pace"],
    },
    "demo-hue": {
        "recommendation": "Hue",
        "whyThisFits": (
            "Historic sites, regional food and riverside downtime suit a party "
            "that enjoys meaningful exploration between relaxed breaks."
        ),
        "details": (
            "Explore the Imperial City, pagoda, markets and royal gardens, "
            "with slower evenings by the river."
        ),
        "tradeOff": DESTINATION_MATCH_COPY["demo-hue"]["tradeOff"],
        "tags": ["History", "Local food", "River views"],
    },
    "demo-flight-1": {
        "recommendation": "the early direct flight",
        "whyThisFits": (
            "The earlier arrival leaves more room to settle in, explore the beach "
            "and enjoy dinner without rushing."
        ),
        "details": (
            "A direct route keeps the journey simple and the lower fare "
            "leaves more room in the party's activity budget."
        ),
        "tradeOff": "The earlier departure means getting to the airport sooner.",
        "tags": ["Direct route", "Earlier arrival", "Lower fare"],
    },
    "demo-flight-2": {
        "recommendation": "the mid-morning direct flight",
        "whyThisFits": (
            "A mid-morning departure balances an easier start with enough "
            "afternoon time to settle in before dinner."
        ),
        "details": (
            "The direct route avoids a connection, "
            "while the return schedule leaves a relaxed final morning."
        ),
        "tradeOff": (
            "It costs more than the earliest option without adding another day to the trip."
        ),
        "tags": ["Direct route", "Balanced timing", "Easy start"],
    },
    "demo-flight-3": {
        "recommendation": "the late-morning direct flight",
        "whyThisFits": (
            "The later outbound departure gives the party a gentler morning, "
            "and the later return offers more time before leaving."
        ),
        "details": (
            "A direct journey reduces travel friction; "
            "keep arrival-day activities light after the later landing."
        ),
        "tradeOff": (
            "The higher fare leaves less for activities, and the arrival-day window is shorter."
        ),
        "tags": ["Direct route", "Gentle morning", "Later return"],
    },
}

PREFERENCE_LABELS = {
    "food": "food",
    "nightlife": "nightlife",
    "scenery": "scenery",
    "culture": "culture",
    "adventure": "adventure",
    "shopping": "shopping",
    "relaxation": "a relaxed pace",
    "hidden-gems": "local discoveries",
    "flexibility": "flexibility",
}
ROLE_PREFERENCES = {
    "leader": "flexibility",
    "planner": "flexibility",
    "adventurer": "adventure",
    "chill": "relaxation",
    "follower": "relaxation",
}
DESTINATION_BENEFITS = {
    "demo-da-nang": {
        "food": "beachfront dining",
        "nightlife": "lively evenings",
        "scenery": "coastal views",
        "culture": "pagodas",
        "adventure": "mountain viewpoints",
        "shopping": "market stalls",
        "relaxation": "beach breaks",
        "hidden-gems": "local markets",
        "flexibility": "nearby sightseeing stops",
    },
    "demo-bali": {
        "food": "Balinese dining",
        "nightlife": "Seminyak evenings",
        "scenery": "rice terraces",
        "culture": "temple visits",
        "adventure": "clifftop viewpoints",
        "shopping": "Ubud craft stalls",
        "relaxation": "beach sunsets",
        "hidden-gems": "garden cafés",
        "flexibility": "varied day trips",
    },
    "demo-phuket": {
        "food": "Thai seafood",
        "nightlife": "Patong nightlife",
        "scenery": "coastal viewpoints",
        "culture": "Old Town heritage",
        "adventure": "coastal exploration",
        "shopping": "Old Town shops",
        "relaxation": "quieter beach breaks",
        "hidden-gems": "local food stops",
        "flexibility": "beach and city options",
    },
    "demo-hoi-an": {
        "food": "local market food",
        "nightlife": "riverside evenings",
        "scenery": "countryside views",
        "culture": "old-town heritage",
        "adventure": "countryside cycling",
        "shopping": "craft shops",
        "relaxation": "slow café stops",
        "hidden-gems": "village lanes",
        "flexibility": "walkable sights",
    },
    "demo-hue": {
        "food": "regional dishes",
        "nightlife": "quiet riverside evenings",
        "scenery": "river views",
        "culture": "imperial history",
        "adventure": "historic grounds",
        "shopping": "Dong Ba Market",
        "relaxation": "gentle riverside walks",
        "hidden-gems": "local food stops",
        "flexibility": "unhurried sightseeing",
    },
}


def _preferences(profile: dict) -> list[str]:
    keys = list(
        dict.fromkeys(
            value.strip().lower()
            for value in (profile.get("interests") or [])
            if isinstance(value, str) and value.strip().lower() in PREFERENCE_LABELS
        )
    )
    if not keys:
        keys = [ROLE_PREFERENCES.get(profile.get("travel_style"), "flexibility")]
    return keys[:2]


def member_reason(option_id: str, display_name: str, profile: dict) -> str:
    """One sentence using saved interests and fixed destination/timing benefits."""
    normalized = " ".join(display_name.split()).lower()
    name = {"demoalice": "Alice", "demobob": "Bob"}.get(normalized, display_name.strip())
    keys = _preferences(profile)
    preferences = " and ".join(PREFERENCE_LABELS[key] for key in keys)
    if option_id in DESTINATION_BENEFITS:
        benefits = " and ".join(DESTINATION_BENEFITS[option_id][key] for key in keys)
        place = OPTION_COPY[option_id]["recommendation"]
        return f"{name}'s preference for {preferences} fits {place}'s {benefits}."
    if option_id == "demo-flight-1":
        return (
            f"{name}'s preference for {preferences} suits the early arrival, "
            "leaving more time for activities without rushing."
        )
    if option_id == "demo-flight-2":
        return (
            f"{name}'s preference for {preferences} fits a mid-morning departure, "
            "with time to settle in before dinner."
        )
    return (
        f"{name}'s preference for {preferences} suits the later return, "
        "leaving more time to explore before heading home."
    )
