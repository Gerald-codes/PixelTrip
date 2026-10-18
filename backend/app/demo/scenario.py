"""Fixed sample content; dates/record identities adapt to the shared demo room."""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from app.agents.proposals import ItineraryModel, RecommendationItem

DESTINATIONS = {
    "demo-da-nang": ("Da Nang, Vietnam", "Beach days, local food and nightlife", 94, 60),
    "demo-bali": ("Bali, Indonesia", "Beach sunsets, temples and rice terraces", 88, 85),
    "demo-phuket": ("Phuket, Thailand", "Thai food, coastal views and lively evenings", 82, 75),
}

# Existing rooms can finish previously published votes without changing their destination.
LEGACY_DESTINATIONS = {
    "demo-hoi-an": ("Hoi An, Vietnam", "Lantern streets, heritage and relaxed cafés", 88, 65),
    "demo-hue": ("Hue, Vietnam", "Imperial history, river walks and regional food", 82, 55),
}
SUPPORTED_DESTINATIONS = {**DESTINATIONS, **LEGACY_DESTINATIONS}


@dataclass(frozen=True)
class FlightRoute:
    airport: str
    country: str
    utc_offset: int
    duration_minutes: int
    carriers: tuple[str, str, str]
    prices: tuple[int, int, int]


# Real airline names and routes, with illustrative schedules/fares (not live availability).
FLIGHT_ROUTES = {
    "demo-da-nang": FlightRoute(
        "DAD", "Vietnam", 7, 170, ("Scoot", "Vietjet Air", "Singapore Airlines"), (280, 320, 410)
    ),
    "demo-bali": FlightRoute(
        "DPS",
        "Indonesia",
        8,
        175,
        ("Scoot", "Garuda Indonesia", "Singapore Airlines"),
        (300, 380, 450),
    ),
    "demo-phuket": FlightRoute(
        "HKT", "Thailand", 7, 120, ("Scoot", "Thai AirAsia", "Singapore Airlines"), (220, 260, 350)
    ),
}
FLIGHT_ROUTES.update({key: FLIGHT_ROUTES["demo-da-nang"] for key in LEGACY_DESTINATIONS})

DESTINATION_MATCH_COPY = {
    "demo-da-nang": {
        "whyThisFits": (
            "Da Nang gives Alice beachfront seafood, market food and lively evenings, "
            "while Bob gets coastal views, Marble Mountains and a pagoda visit. "
            "The Hoi An day trip adds culture without making every day a long transfer."
        ),
        "tradeOff": (
            "Bob gets scenic coast and viewpoints, but less time for history "
            "than on a trip focused on heritage sites."
        ),
    },
    "demo-bali": {
        "whyThisFits": (
            "Bali pairs Seminyak dining and lively evenings for Alice with Ubud's temples, "
            "rice terraces and Uluwatu's coastal views for Bob. Beach breaks between "
            "sightseeing days give the party time to unwind together."
        ),
        "tradeOff": (
            "Bob gets more varied scenery, but traffic between the coast and Ubud "
            "can cut into his sightseeing time."
        ),
    },
    "demo-phuket": {
        "whyThisFits": (
            "Phuket gives Alice Thai food, seafood dinners and Patong nightlife, "
            "while Bob gets Wat Chalong, Old Town heritage and coastal viewpoints. "
            "Kata and Kamala beach stops balance lively evenings with quieter time together."
        ),
        "tradeOff": (
            "Alice gets lively nights in Patong, but its busy beachfront "
            "may feel crowded when she wants to relax."
        ),
    },
    "demo-hoi-an": {
        "whyThisFits": (
            "Hoi An's food stalls and cafés cater to Alice's food interests, "
            "while heritage streets and countryside cycling give Bob culture and scenery. "
            "Its compact centre lets the party explore together with beach breaks "
            "and relaxed riverside evenings."
        ),
        "tradeOff": "Alice may find the evenings too quiet if clubbing is a priority.",
    },
    "demo-hue": {
        "whyThisFits": (
            "Hue pairs regional food and markets for Alice with the Imperial City, "
            "pagoda and royal gardens for Bob's culture and scenery interests. "
            "Riverside downtime keeps the history-focused days from feeling crowded."
        ),
        "tradeOff": "Alice may have to trade lively club nights for quieter riverside evenings.",
    },
}

# time, title, location, description, sample SGD cost. All are demo estimates.
DA_NANG = [
    [
        (
            "16:30",
            "My Khe Beach Sunset",
            "My Khe Beach",
            "Settle in with a gentle beach walk after your flight.",
            0,
        ),
        (
            "19:00",
            "Local Seafood Dinner",
            "My Khe Beachfront",
            "Enjoy a relaxed beachfront dinner together.",
            35,
        ),
    ],
    [
        (
            "09:00",
            "Marble Mountains",
            "Ngu Hanh Son",
            "Explore the caves and viewpoints at an easy pace.",
            12,
        ),
        (
            "12:00",
            "Vietnamese Lunch",
            "Da Nang city centre",
            "Try a local lunch before the afternoon adventure.",
            15,
        ),
        (
            "15:00",
            "Han Market",
            "Han Market",
            "Browse local stalls and pick up small souvenirs.",
            10,
        ),
    ],
    [
        (
            "09:00",
            "Linh Ung Pagoda",
            "Son Tra Peninsula",
            "Visit the pagoda and take in the coastal views.",
            10,
        ),
        (
            "12:30",
            "City Café Lunch",
            "Hai Chau",
            "Share lunch and take a break in a city café.",
            15,
        ),
        (
            "19:30",
            "Dragon Bridge Evening Walk",
            "Dragon Bridge",
            "Explore the riverside lights; no scheduled fire show is assumed.",
            0,
        ),
    ],
    [
        (
            "09:00",
            "Hoi An Day Trip",
            "Hoi An Ancient Town",
            "Travel to the old town for a day of heritage and discovery.",
            30,
        ),
        (
            "13:00",
            "Local Food and Craft Stops",
            "Hoi An",
            "Sample local food and browse craft shops with the party.",
            20,
        ),
        (
            "18:00",
            "Lantern Streets",
            "Hoi An riverside",
            "Take an evening walk before returning to Da Nang.",
            10,
        ),
    ],
    [
        (
            "08:30",
            "Breakfast by the Beach",
            "My Khe",
            "Enjoy a final relaxed breakfast and pack for departure.",
            12,
        ),
        (
            "13:00",
            "Airport Transfer",
            "Da Nang International Airport",
            "Leave time for check-in before the fixed return flight.",
            15,
        ),
    ],
]

# Nearby destinations share DAD airport; each has its own prepared day content.
HOI_AN = [
    [
        (
            "16:30",
            "Ancient Town Arrival Walk",
            "Hoi An",
            "Settle in after the transfer from Da Nang airport.",
            10,
        ),
        (
            "19:00",
            "Cao Lau Dinner",
            "Hoi An Ancient Town",
            "Try regional noodles together in the old town.",
            20,
        ),
    ],
    [
        (
            "09:00",
            "Old Town Heritage Walk",
            "Hoi An Ancient Town",
            "Discover preserved streets and heritage buildings.",
            15,
        ),
        ("12:00", "Vietnamese Lunch", "Hoi An Market", "Pause for local dishes at the market.", 15),
        ("15:00", "Craft Shops", "Hoi An", "Browse handicrafts and souvenir stalls.", 10),
    ],
    [
        (
            "09:00",
            "Countryside Cycle",
            "Cam Thanh",
            "Explore quiet village lanes at an easy pace.",
            20,
        ),
        ("12:30", "Garden Café Lunch", "Hoi An", "Rest over lunch in a shady garden café.", 15),
        (
            "19:30",
            "Lantern Riverside Walk",
            "Thu Bon River",
            "Enjoy the lit streets and riverside atmosphere.",
            0,
        ),
    ],
    [
        ("09:00", "An Bang Beach", "An Bang", "Spend a relaxed morning at the beach.", 10),
        ("13:00", "Beach Café", "An Bang", "Enjoy food and conversation by the coast.", 20),
        (
            "18:00",
            "Old Town Evening",
            "Hoi An",
            "Return to the old town for a final evening stroll.",
            10,
        ),
    ],
    [
        (
            "08:30",
            "Breakfast in the Old Town",
            "Hoi An",
            "Have breakfast and prepare for the transfer.",
            12,
        ),
        (
            "13:00",
            "Airport Transfer",
            "Da Nang International Airport",
            "Transfer early enough for the fixed return flight.",
            25,
        ),
    ],
]
HUE = [
    [
        (
            "16:30",
            "Perfume River Arrival Walk",
            "Hue",
            "Settle in after the road transfer from Da Nang airport.",
            0,
        ),
        (
            "19:00",
            "Hue Regional Dinner",
            "Hue city centre",
            "Share a relaxed dinner of regional dishes.",
            20,
        ),
    ],
    [
        (
            "09:00",
            "Imperial City",
            "Hue Citadel",
            "Explore the historic courtyards and gardens.",
            20,
        ),
        (
            "12:00",
            "Vietnamese Lunch",
            "Hue city centre",
            "Enjoy regional food and a midday break.",
            15,
        ),
        ("15:00", "Dong Ba Market", "Dong Ba", "Browse local stalls and snacks.", 10),
    ],
    [
        (
            "09:00",
            "Thien Mu Pagoda",
            "Perfume River",
            "Visit the riverside pagoda and its grounds.",
            10,
        ),
        ("12:30", "Riverside Café Lunch", "Hue", "Pause over lunch near the river.", 15),
        (
            "19:30",
            "Hue Evening Walk",
            "Truong Tien Bridge",
            "Enjoy the riverside lights with the party.",
            0,
        ),
    ],
    [
        (
            "09:00",
            "Royal Tomb Gardens",
            "Hue outskirts",
            "Explore the landscaped historic grounds.",
            20,
        ),
        ("13:00", "Local Food Stops", "Hue", "Try regional snacks and local cafés.", 20),
        (
            "18:00",
            "Final River Evening",
            "Perfume River",
            "Enjoy a gentle last evening in Hue.",
            10,
        ),
    ],
    [
        (
            "08:30",
            "Breakfast and Check-out",
            "Hue",
            "Have breakfast and pack for the airport transfer.",
            12,
        ),
        (
            "11:30",
            "Airport Transfer",
            "Da Nang International Airport",
            "Allow extra road time to reach DAD for the return flight.",
            35,
        ),
    ],
]

BALI = [
    [
        (
            "16:30",
            "Seminyak Beach Sunset",
            "Seminyak Beach",
            "Settle in after your flight with a beach walk and ocean views.",
            0,
        ),
        (
            "19:00",
            "Balinese Dinner",
            "Seminyak",
            "Share local dishes at a relaxed restaurant near the beach.",
            35,
        ),
    ],
    [
        (
            "09:00",
            "Ubud Palace and Temple Walk",
            "Central Ubud",
            "Discover Balinese architecture and temple courtyards before lunch.",
            15,
        ),
        (
            "12:00",
            "Balinese Lunch",
            "Ubud",
            "Try nasi campur and local flavours during a shady midday break.",
            20,
        ),
        (
            "15:00",
            "Ubud Art Market",
            "Ubud Art Market",
            "Browse handmade crafts and souvenirs before returning to Seminyak.",
            15,
        ),
    ],
    [
        (
            "09:00",
            "Tegallalang Rice Terrace Walk",
            "Tegallalang",
            "Enjoy the rice-field scenery on an easy walk with time for photos.",
            20,
        ),
        (
            "12:30",
            "Garden Café Lunch",
            "Ubud",
            "Rest over lunch in a garden café before the drive back to the coast.",
            20,
        ),
        (
            "19:30",
            "Seminyak Evening Walk",
            "Seminyak",
            "Explore the neighbourhood's shops and evening atmosphere together.",
            0,
        ),
    ],
    [
        (
            "09:00",
            "Uluwatu Temple and Clifftop Views",
            "Uluwatu",
            "Visit the temple grounds and coastal viewpoints with a local driver.",
            25,
        ),
        (
            "13:00",
            "Jimbaran Lunch",
            "Jimbaran",
            "Pause for fresh local food near the coast after the temple visit.",
            25,
        ),
        (
            "18:00",
            "Jimbaran Sunset Stroll",
            "Jimbaran Beach",
            "Enjoy a gentle sunset walk before returning to Seminyak.",
            0,
        ),
    ],
    [
        (
            "08:30",
            "Breakfast and Beach Farewell",
            "Seminyak",
            "Enjoy a final breakfast and pack before leaving the coast.",
            15,
        ),
        (
            "13:00",
            "Airport Transfer",
            "I Gusti Ngurah Rai International Airport",
            "Head to DPS with time for traffic and check-in before the return flight.",
            25,
        ),
    ],
]
PHUKET = [
    [
        (
            "16:30",
            "Patong Beach Arrival Walk",
            "Patong Beach",
            "Unwind after the airport transfer with a relaxed walk by the sea.",
            0,
        ),
        (
            "19:00",
            "Thai Seafood Dinner",
            "Patong",
            "Share seafood and Thai dishes at a restaurant near the beachfront.",
            30,
        ),
    ],
    [
        (
            "09:00",
            "Wat Chalong Temple Visit",
            "Wat Chalong",
            "Explore the temple grounds and learn about local Buddhist traditions.",
            10,
        ),
        (
            "12:00",
            "Phuket Local Lunch",
            "Phuket Old Town",
            "Try Hokkien noodles and local Thai dishes during a midday break.",
            18,
        ),
        (
            "15:00",
            "Old Town Heritage and Shops",
            "Phuket Old Town",
            "Browse colourful streets, small shops and Sino-Portuguese architecture.",
            10,
        ),
    ],
    [
        (
            "09:00",
            "Karon Viewpoint",
            "Karon Viewpoint",
            "Take in views across the southern bays with time for photos.",
            10,
        ),
        (
            "12:30",
            "Kata Beach Café Lunch",
            "Kata Beach",
            "Relax over lunch near the beach before returning to Patong.",
            20,
        ),
        (
            "19:30",
            "Patong Evening Walk",
            "Patong",
            "Enjoy the neighbourhood's evening lights and lively atmosphere.",
            0,
        ),
    ],
    [
        (
            "09:00",
            "Kamala Beach Morning",
            "Kamala Beach",
            "Spend a quieter morning by the water away from the busiest streets.",
            10,
        ),
        (
            "13:00",
            "Beachside Thai Lunch",
            "Kamala",
            "Enjoy Thai food and a relaxed café break near the coast.",
            20,
        ),
        (
            "18:00",
            "Old Town Evening Stroll",
            "Phuket Old Town",
            "Explore the heritage streets at dusk before returning to Patong.",
            10,
        ),
    ],
    [
        (
            "08:30",
            "Breakfast by the Beach",
            "Patong",
            "Share a final breakfast and leave time to pack for the flight home.",
            12,
        ),
        (
            "13:00",
            "Airport Transfer",
            "Phuket International Airport",
            "Travel to HKT with time for the road journey and airport check-in.",
            25,
        ),
    ],
]

PLANS = {
    "demo-da-nang": DA_NANG,
    "demo-bali": BALI,
    "demo-phuket": PHUKET,
    "demo-hoi-an": HOI_AN,
    "demo-hue": HUE,
}
REFINEMENTS = {
    "Add a separate club visit after dinner": (1, "club"),
    "Replace lunch with a bar lunch": (2, "lunch"),
    "Add dinner before the evening walk": (3, "dinner"),
    "Start the morning later": (4, "later"),
    "Add a café stop before the airport transfer": (5, "cafe"),
}


def dates(room: dict) -> tuple[date, date]:
    start = date.fromisoformat(room["demo_start"])
    return start, start + timedelta(days=4)


def destination_items(room: dict) -> list[RecommendationItem]:
    start, end = dates(room)
    return [
        RecommendationItem(
            id=key,
            title=title,
            description=f"Prepared demo: {description}.",
            meta={
                "score": score,
                "pick": "Best fit" if index == 0 else "Wildcard",
                "tags": [FLIGHT_ROUTES[key].country, "Five days", "Sample plan"],
                "whyThisFits": DESTINATION_MATCH_COPY[key]["whyThisFits"],
                "bestFor": ["DemoAlice", "DemoBob"],
                "tradeOff": DESTINATION_MATCH_COPY[key]["tradeOff"],
                "details": (
                    f"Five-day sample adventure in {title}. "
                    f"Fly through {FLIGHT_ROUTES[key].airport} with local transfers."
                ),
                "estimatedDailyCostSgd": daily,
                "tripDays": 5,
                "tripStart": str(start),
                "tripEnd": str(end),
            },
        )
        for index, (key, (title, description, score, daily)) in enumerate(DESTINATIONS.items())
    ]


def flight_items(room: dict, destination_id: str) -> list[RecommendationItem]:
    start, end = dates(room)
    route = FLIGHT_ROUTES[destination_id]
    singapore_tz = timezone(timedelta(hours=8))
    destination_tz = timezone(timedelta(hours=route.utc_offset))
    duration = timedelta(minutes=route.duration_minutes)
    items = []
    for index, (carrier, price) in enumerate(zip(route.carriers, route.prices, strict=True)):
        depart = datetime.combine(start, time(9 + index), singapore_tz)
        arrive = (depart + duration).astimezone(destination_tz)
        return_depart = datetime.combine(end, time(16 + index), destination_tz)
        return_arrive = (return_depart + duration).astimezone(singapore_tz)
        items.append(
            RecommendationItem(
                id=f"demo-flight-{index + 1}",
                title=f"{carrier} · direct",
                description="Sample return flight; times and fares are illustrative, not bookable.",
                meta={
                    "price": price,
                    "currency": "SGD",
                    "carrier": carrier,
                    "origin": "SIN",
                    "destination": route.airport,
                    "duration_minutes": route.duration_minutes,
                    "stops": 0,
                    "depart_at": depart.isoformat(),
                    "arrive_at": arrive.isoformat(),
                    "return_at": return_depart.isoformat(),
                    "return_arrive_at": return_arrive.isoformat(),
                    "score": 94 - index * 5,
                    "pick": "Best fit" if index == 0 else "Wildcard",
                    "tags": ["Direct", "Sample flight"],
                    "whyThisFits": "Daytime flights leave time for the prepared activities.",
                    "tradeOff": (
                        "The earlier departure means reaching the airport sooner.",
                        "The balanced schedule costs more than the earliest option.",
                        "The later arrival leaves less time to explore on the first day.",
                    )[index],
                    "details": (
                        f"Direct sample SIN–{route.airport} return flight with {carrier}. "
                        "Flight cost is per person; all times are local."
                    ),
                },
            )
        )
    return items


def build_itinerary(trip_id: str, room: dict, destination_id: str) -> ItineraryModel:
    start, _ = dates(room)
    title = SUPPORTED_DESTINATIONS[destination_id][0]
    return ItineraryModel(
        trip_id=trip_id,
        room_id=room["id"],
        title=f"The {title} Demo Quest",
        summary="Five days with DemoAlice and DemoBob. Costs and availability are sample data.",
        destination={"name": title},
        days=[
            {
                "day": n,
                "date": str(start + timedelta(days=n - 1)),
                "items": [
                    {
                        "id": f"d{n}-i{i}",
                        "time": time,
                        "title": name,
                        "location": location,
                        "description": description,
                        "cost": cost,
                        "tags": [],
                    }
                    for i, (time, name, location, description, cost) in enumerate(activities, 1)
                ],
            }
            for n, activities in enumerate(PLANS[destination_id], 1)
        ],
    )
