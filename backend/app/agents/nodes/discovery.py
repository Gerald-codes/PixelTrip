"""Discovery_Node — DISCOVER stage destination recommendation.

The flow, each step with exactly one way to fail without reaching the next:

1. **Load fresh context, compute the Group_Profile.** Zero ``travel_preferences``
   rows is a hard failure (``PreferencesNotCollectedError``) — there is nothing
   to reason over (Requirement 7.12).
2. **Escalate if the party shares no dates.** No plan can be scheduled at all,
   so this happens before any model call (Requirement 7.11).
3. **Ask the LLM once for the whole recommendation.** The party brief
   (:mod:`app.agents.party_brief`) describes what each member wants; the prompt
   lives in ``app/agents/prompts/discovery_*.md``. One call returns every card:
   the places the party named themselves plus new suggestions, each with copy,
   a "pick" badge, who it suits, a rough daily cost and four 0-10 sub-scores.
4. **Check the answer in code.** Names must be real "City, Country" places (never
   a region or a trip type such as "asia"), duplicates and a third card from one
   country are dropped, suggestions clearly over the budget are dropped while
   enough remain, and every named place is kept first (Requirement 7.5). The
   card ``score`` is computed here from the sub-scores with fixed weights
   (:data:`SCORE_WEIGHTS`), so it is consistent and explainable.
5. **Filter and validate.** Hard constraints still exclude candidates
   (Requirement 7.9-7.10), then the guardrail loop validates the proposal.
6. **On success, emit the recommendation and open its vote** (Requirement 7.6-7.8).

**The LLM is never a single point of failure.** If the call fails or returns too
little, the remaining slots are filled from :data:`FALLBACK_POOL`, narrowed to any
region the party named and ranked by the party's own words (:func:`_fallback_order`),
with plain card copy. Repair iterations of the
guardrail loop reuse the first answer and never call the model again.
"""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING, Any

from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel, ConfigDict, Field

from app.agents.errors import LLMGenerationError, PreferencesNotCollectedError
from app.agents.group_profile import compute_group_profile, is_region_word, vibe_keywords
from app.agents.guardrails import perform_human_escalation, run_guardrail_loop
from app.agents.llm import UNTRUSTED_INPUT_GUARD, clip_text
from app.agents.messages import RecommendationMessageContent, emit_npc_message
from app.agents.party_brief import (
    PartyBrief,
    budget_text,
    build_party_brief,
    members_text,
    named_places_text,
    trip_text,
    wants_text,
)
from app.agents.preference_labels import TRIP_TYPES
from app.agents.progress import report_phase
from app.agents.prompts import render
from app.agents.proposals import DestinationRecommendationProposal
from app.core.budget import CURRENCY, TIER_LABELS, band_text
from app.core.config import get_settings
from app.core.trip_dates import plan_trip

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import AgentState, RepositoryBundle

logger = logging.getLogger(__name__)

#: Requirement 7.6: a recommendation carries 3-5 items.
MIN_RECOMMENDATION_ITEMS = 3
MAX_RECOMMENDATION_ITEMS = 5

#: Region-aware safety net, used only when the LLM cannot suggest anything. Each entry is
#: ``(name, region/vibe keywords)``; the party's own words pick which ones are offered, so
#: an Asia-and-beach party is never padded out with European cities.
FALLBACK_POOL: tuple[tuple[str, frozenset[str]], ...] = (
    ("Kyoto, Japan", frozenset({"asia", "east asia", "japan", "culture", "temples", "food"})),
    ("Bali, Indonesia", frozenset({"asia", "southeast asia", "beach", "island", "nature"})),
    ("Phuket, Thailand", frozenset({"asia", "southeast asia", "beach", "island", "nightlife"})),
    ("Da Nang, Vietnam", frozenset({"asia", "southeast asia", "beach", "food", "budget"})),
    ("Bangkok, Thailand", frozenset({"asia", "southeast asia", "food", "city", "nightlife"})),
    ("Seoul, South Korea", frozenset({"asia", "east asia", "city", "food", "shopping"})),
    ("Lisbon, Portugal", frozenset({"europe", "city", "food", "culture", "coast"})),
    ("Barcelona, Spain", frozenset({"europe", "beach", "city", "food", "nightlife"})),
    ("Rome, Italy", frozenset({"europe", "culture", "history", "food", "city"})),
    ("Reykjavik, Iceland", frozenset({"europe", "nature", "adventure", "hiking"})),
    ("Cape Town, South Africa", frozenset({"africa", "beach", "nature", "adventure"})),
    ("Sydney, Australia", frozenset({"oceania", "beach", "city", "nature"})),
    ("Cancun, Mexico", frozenset({"north america", "beach", "island", "nightlife"})),
    (
        "Niseko, Japan",
        frozenset(
            {"asia", "east asia", "japan", "snow", "ski", "skiing", "snowboarding", "winter"}
        ),
    ),
    (
        "Chamonix, France",
        frozenset({"europe", "snow", "ski", "skiing", "snowboarding", "winter", "hiking", "alps"}),
    ),
    (
        "Banff, Canada",
        frozenset({"north america", "snow", "ski", "skiing", "snowboarding", "hiking", "nature"}),
    ),
    (
        "Queenstown, New Zealand",
        frozenset({"oceania", "adventure", "hiking", "ski", "skiing", "snowboarding", "nature"}),
    ),
    ("Kathmandu, Nepal", frozenset({"asia", "south asia", "hiking", "trekking", "mountains"})),
    (
        "Torres del Paine, Chile",
        frozenset({"south america", "hiking", "trekking", "mountains", "nature"}),
    ),
)


#: A name longer than this is not a destination name; treat it as junk.
MAX_DESTINATION_NAME_LENGTH = 80

#: Requirement 7.7: the vote question's length bound.
MAX_QUESTION_LENGTH = 200

STAGE = "DISCOVER"

#: Card copy limits: the frontend renders these on a small pixel card.
MAX_TAGS = 5
MAX_TAG_LENGTH = 24
MAX_DESCRIPTION_TEXT = 300
MAX_REASONING_TEXT = 600
MAX_DETAILS_TEXT = 1500

#: Fallback fit scores when no model answered for a card.
WISHLIST_SCORE = 85
SUGGESTED_SCORE = 70

#: How the card ``score`` (0-100) is built from the LLM's 0-10 sub-scores.
#: Tune here, not in the prompt; the weights must add up to 1.
SCORE_WEIGHTS: dict[str, float] = {
    "preferences": 0.4,
    "budget": 0.2,
    "season": 0.2,
    "tripLength": 0.2,
}

#: The badges the LLM chooses from; fallback cards use the last two.
PICKS: tuple[str, ...] = ("Best fit", "Budget pick", "Hidden gem", "Wildcard")
PARTY_PICK = "Party pick"
GUIDE_PICK = "Guide's pick"

#: At most this many cards from one country, so the vote has real choices.
MAX_PER_COUNTRY = 2

#: Never a destination on its own, whatever the model says.
_REGION_WORDS = frozenset(
    {
        "asia", "southeast asia", "east asia", "south asia", "europe", "western europe",
        "africa", "north america", "south america", "latin america", "oceania",
        "middle east", "caribbean", "scandinavia", "the world", "anywhere",
    }
)  # fmt: skip
_CITY_COUNTRY = re.compile(r"[^,]{2,},\s*[^,]{2,}")


def _slugify(name: str) -> str:
    """Turn a destination name into a short, stable item id."""
    return "".join(ch if ch.isalnum() else "-" for ch in name.lower()).strip("-") or "option"


def _profile_words(group_profile: dict[str, Any]) -> set[str]:
    """Lower-cased words and phrases the party used to describe what it wants."""
    words: set[str] = set()
    for key in ("interests", "activities", "destinations", "travel_styles"):
        for entry in group_profile.get(key) or []:
            text = str(entry).lower()
            words.add(text.strip())
            words.update(text.replace(",", " ").split())
            words.update(vibe_keywords(str(entry)))
    return words


def _fallback_order(group_profile: dict[str, Any]) -> list[str]:
    """The fallback pool ranked by how many of the party's own words each entry matches.

    When the party named a region ("Asia", "Europe") the pool is first narrowed to that
    region, so no ranking can pull a place from elsewhere back in. The narrowing is only
    applied while it leaves enough entries to fill a recommendation. Ties keep the pool
    order, so a party that said nothing useful gets the original spread.
    """
    words = _profile_words(group_profile)
    regions = {word for word in words if is_region_word(word)}
    pool = list(FALLBACK_POOL)
    if regions:
        in_region = [entry for entry in pool if entry[1] & regions]
        if len(in_region) >= MIN_RECOMMENDATION_ITEMS:
            pool = in_region
    ranked = sorted(
        enumerate(pool),
        key=lambda pair: (-len(pair[1][1] & words), pair[0]),
    )
    return [name for _index, (name, _keywords) in ranked]


# --- The LLM's answer -----------------------------------------------------------------


class _DestinationCard(BaseModel):
    """One destination in the LLM's answer. Explanations come before scores on
    purpose: the model reasons first, then scores, which gives steadier numbers."""

    model_config = ConfigDict(extra="ignore")

    name: str = Field(description='"City, Country". For places the party named, exactly as given.')
    pick: str = Field(description='One of "Best fit", "Budget pick", "Hidden gem", "Wildcard".')
    description: str = Field(description="1-2 sentences capturing the place's character.")
    why_this_fits: str = Field(
        description="2-3 sentences naming the party's own preferences it matches, with real "
        "examples, and how it suits their budget and dates."
    )
    best_for: list[str] = Field(
        description="Names of the members it suits best, exactly as given in the brief."
    )
    tags: list[str] = Field(description="3-5 short labels, 1-3 words each.")
    trade_off: str = Field(
        description="1-2 sentences: the biggest downside for this party and how to work around it."
    )
    details: str = Field(
        description="4-6 sentences: weather on their dates, top things to do for this party, "
        "the food scene, rough daily cost per person, where to stay or how to get around."
    )
    estimated_daily_cost_sgd: int = Field(
        description="Rough cost per person per day in SGD for stay, food and local "
        "transport, excluding flights and paid activities."
    )
    #: Optional so a model that omits them costs only the default trip length, not
    #: the whole answer.
    suggested_days: int = Field(
        default=0,
        description="How many days this party should spend there: what people typically "
        "need for this place and these activities, within the days they are free.",
    )
    why_this_long: str = Field(
        default="",
        description="One sentence on why that many days suits this place and party.",
    )
    preference_match: int = Field(description="0-10")
    budget_fit: int = Field(description="0-10")
    season_fit: int = Field(description="0-10")
    trip_length_fit: int = Field(description="0-10")


class _DiscoveryAnswer(BaseModel):
    model_config = ConfigDict(extra="ignore")

    destinations: list[_DestinationCard] = Field(min_length=1)


def build_discovery_prompts(brief: PartyBrief) -> tuple[str, str]:
    """The (system, user) prompts for ``brief``. Public for the comparison script."""
    system = render(
        "discovery_system",
        guard=UNTRUSTED_INPUT_GUARD,
        count=MAX_RECOMMENDATION_ITEMS,
        currency=CURRENCY,
    )
    user = render(
        "discovery_user",
        trip=trip_text(brief),
        party_size=brief.party_size,
        budget=budget_text(brief),
        wants=wants_text(brief),
        members=members_text(brief),
        named_places=named_places_text(brief),
        count=MAX_RECOMMENDATION_ITEMS,
    )
    return system, user


async def _ask_llm(brief: PartyBrief, llm: Any) -> list[_DestinationCard]:
    """One call for the whole recommendation. Never raises: ``[]`` on any failure."""
    if llm is None:
        return []
    system_prompt, user_prompt = build_discovery_prompts(brief)
    try:
        result = await llm.generate_structured(
            operation="destination_recommendation",
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            response_model=_DiscoveryAnswer,
        )
        return list(result.destinations)
    except LLMGenerationError:
        logger.info("LLM destination recommendation unavailable; using fallback places")
    except Exception:  # a malformed double or SDK surprise must not break DISCOVER
        logger.info("LLM destination recommendation was unusable; using fallback places")
    return []


# --- Checking the answer --------------------------------------------------------------


def _clean_name(raw: Any) -> str | None:
    """A real "City, Country" name, or ``None`` for junk, regions and trip types."""
    name = " ".join(str(raw).split()).strip(" .,-")
    if not 2 <= len(name) <= MAX_DESTINATION_NAME_LENGTH or not _CITY_COUNTRY.fullmatch(name):
        return None
    city = name.split(",", 1)[0].strip().lower()
    if (
        city in _REGION_WORDS
        or is_region_word(city)
        or is_region_word(name)
        or city in _TRIP_TYPE_LABELS
    ):
        return None
    return name


_TRIP_TYPE_LABELS = frozenset(label.lower() for label in TRIP_TYPES.values())


def _country(name: str) -> str:
    return name.rsplit(",", 1)[-1].strip().lower()


def _score(card: _DestinationCard) -> tuple[int, dict[str, int]]:
    """The 0-100 card score from the four 0-10 sub-scores, plus the breakdown."""
    parts = {
        "preferences": card.preference_match,
        "budget": card.budget_fit,
        "season": card.season_fit,
        "tripLength": card.trip_length_fit,
    }
    parts = {key: max(0, min(10, int(value))) for key, value in parts.items()}
    total = sum(SCORE_WEIGHTS[key] * value for key, value in parts.items()) * 10
    return max(0, min(100, round(total))), parts


def _clean_tags(raw: Any) -> list[str]:
    tags: list[str] = []
    for value in raw or []:
        tag = clip_text(str(value), MAX_TAG_LENGTH)
        if tag and tag.lower() not in {t.lower() for t in tags}:
            tags.append(tag)
    return tags[:MAX_TAGS]


def _forbidden_subjects(group_profile: dict[str, Any]) -> list[str]:
    subjects = (_negated_subject(str(c)) for c in group_profile.get("hard_constraints") or [])
    return [s for s in subjects if s]


def _card_from_llm(
    card: _DestinationCard, brief: PartyBrief, forbidden: list[str]
) -> dict[str, Any] | None:
    """Turn one LLM card into item copy, or ``None`` if it is unusable.

    Copy mentioning a hard-constraint subject is dropped: the business guardrail
    scans item text and would reject the whole proposal.
    """
    why = clip_text(card.why_this_fits, MAX_REASONING_TEXT)
    description = clip_text(card.description, MAX_DESCRIPTION_TEXT) or why
    if why is None or description is None:
        return None
    score, breakdown = _score(card)
    names = {n.lower(): n for n in brief.member_names}
    cost = card.estimated_daily_cost_sgd
    pick = next((p for p in PICKS if p.lower() == str(card.pick).strip().lower()), "Wildcard")
    copy = {
        "description": description,
        "meta": {
            "score": score,
            "whyThisFits": why,
            "tags": _clean_tags(card.tags),
            "tradeOff": clip_text(card.trade_off, MAX_REASONING_TEXT) or "",
            "details": clip_text(card.details, MAX_DETAILS_TEXT) or description,
            "pick": pick,
            "bestFor": [names[n.lower()] for n in card.best_for if n.lower() in names],
            "estimatedDailyCostSgd": cost if isinstance(cost, int) and cost > 0 else None,
            "scoreBreakdown": breakdown,
        },
    }
    meta = copy["meta"]
    budget = brief.budget
    meta.update(
        _trip_meta(
            brief,
            card.suggested_days,
            meta["estimatedDailyCostSgd"],
            clip_text(card.why_this_long, MAX_DESCRIPTION_TEXT),
        )
    )
    if not budget.is_hard and budget.above_level(meta["estimatedDailyCostSgd"]):
        # Soft guide: label, never drop.
        note = (
            f"Above the party's {TIER_LABELS[budget.tier or 'low']} budget level "
            f"(about {band_text(budget.tier or 'low')} a day)."
        )
        meta["tradeOff"] = f"{meta['tradeOff']} {note}".strip()
    text = " ".join(
        [copy["description"], why, meta["tradeOff"], meta["details"], *meta["tags"]]
    ).lower()
    if any(subject in text for subject in forbidden):
        return None
    return copy


def _fallback_card(name: str, brief: PartyBrief) -> dict[str, Any]:
    """Plain card copy for a place no usable LLM card covers."""
    named = name.lower() in {p.lower() for p in brief.named_places}
    if named:
        why = "Someone in the party named this place."
    else:
        why = "A backup pick that matches the party's trip types and interests."
    details = ""
    return {
        "description": why,
        "meta": {
            "score": WISHLIST_SCORE if named else SUGGESTED_SCORE,
            "whyThisFits": why,
            "tags": [PARTY_PICK if named else GUIDE_PICK],
            "tradeOff": "No cost estimate yet; check prices before you vote.",
            "details": (details + why).strip(),
            "pick": PARTY_PICK if named else GUIDE_PICK,
            "bestFor": [],
            "estimatedDailyCostSgd": None,
            "scoreBreakdown": None,
            **_trip_meta(brief, None, None, None),
        },
    }


def _trip_meta(
    brief: PartyBrief, suggested_days: int | None, daily_cost: float | None, why: str | None
) -> dict[str, Any]:
    """The card's trip plan: length and dates the code has checked.

    The AI only suggests a length; :func:`~app.core.trip_dates.plan_trip` fits it to
    the party's shared dates (weekends first) and, with a hard budget, to what the
    stay may cost.
    """
    plan = plan_trip(
        brief.overlap,
        suggested_days,
        daily_cost=daily_cost,
        budget_limit=brief.budget.limit,
    )
    if plan is None:
        return {"tripDays": None, "tripStart": None, "tripEnd": None, "whyThisLong": None}
    reason = " ".join(part for part in (why, plan.note) if part) or None
    return {
        "tripDays": plan.days,
        "tripStart": plan.start,
        "tripEnd": plan.end,
        "whyThisLong": reason,
    }


def _choose_destinations(
    brief: PartyBrief, answer: list[_DestinationCard], group_profile: dict[str, Any]
) -> tuple[list[str], dict[str, dict[str, Any]]]:
    """Pick the destination names, in order, and their card copy (keyed by lower name).

    Named places first (always kept), then the LLM's suggestions best-score first
    (over-budget ones dropped while enough remain, at most :data:`MAX_PER_COUNTRY`
    per country), then :data:`FALLBACK_POOL` ranked by the party's own words.
    """
    forbidden = _forbidden_subjects(group_profile)
    cards: dict[str, dict[str, Any]] = {}
    for card in answer:
        name = _clean_name(card.name)
        if name and name.lower() not in cards:
            copy = _card_from_llm(card, brief, forbidden)
            if copy is not None:
                cards[name.lower()] = {"name": name, **copy}

    names: list[str] = list(brief.named_places)
    taken = {n.lower() for n in names}
    per_country: dict[str, int] = {}
    for name in names:
        per_country[_country(name)] = per_country.get(_country(name), 0) + 1

    suggestions = sorted(
        (c for key, c in cards.items() if key not in taken),
        key=lambda c: -c["meta"]["score"],
    )
    affordable = [c for c in suggestions if not _over_budget(c, brief)]
    if len(names) + len(affordable) >= MIN_RECOMMENDATION_ITEMS:
        suggestions = affordable
    for card in suggestions:
        country = _country(card["name"])
        if len(names) >= MAX_RECOMMENDATION_ITEMS or per_country.get(country, 0) >= MAX_PER_COUNTRY:
            continue
        names.append(card["name"])
        taken.add(card["name"].lower())
        per_country[country] = per_country.get(country, 0) + 1

    for name in _fallback_order(group_profile):
        if len(names) >= MAX_RECOMMENDATION_ITEMS:
            break
        if name.lower() not in taken:
            names.append(name)
            taken.add(name.lower())

    return names, cards


def _over_budget(card: dict[str, Any], brief: PartyBrief) -> bool:
    """The stay alone (daily estimate x the card's trip days) is over the hard limit."""
    meta = card["meta"]
    stay = brief.budget.stay_estimate(meta.get("estimatedDailyCostSgd"), meta.get("tripDays"))
    return brief.budget.over_limit(stay)


def _mark_best_fit(items: list[dict[str, Any]]) -> None:
    """Exactly one "Best fit": the highest-scoring LLM card."""
    scored = [i for i in items if i["meta"].get("scoreBreakdown")]
    best = max(scored, key=lambda i: i["meta"]["score"], default=None)
    for item in scored:
        if item is best:
            item["meta"]["pick"] = "Best fit"
        elif item["meta"]["pick"] == "Best fit":
            item["meta"]["pick"] = "Wildcard"


def _build_proposal(
    names: list[str],
    cards: dict[str, dict[str, Any]] | None = None,
    brief: PartyBrief | None = None,
) -> dict[str, Any]:
    """Build a raw destination recommendation payload.

    Each item carries ``description`` and ``meta`` with ``score``, ``whyThisFits``,
    ``tags``, ``tradeOff``, ``details``, ``pick``, ``bestFor``,
    ``estimatedDailyCostSgd``, ``scoreBreakdown`` and the trip plan (``tripDays``,
    ``tripStart``, ``tripEnd``, ``whyThisLong``).
    """
    brief = brief or build_party_brief([], [], [], [])
    items = []
    for name in names[:MAX_RECOMMENDATION_ITEMS]:
        card = (cards or {}).get(name.lower()) or _fallback_card(name, brief)
        items.append(
            {
                "id": _slugify(name),
                "title": name,
                "description": card["description"],
                "meta": {**card["meta"]},
            }
        )
    _mark_best_fit(items)
    return {
        "title": "Where shall our journey begin?",
        "items": items,
        "question": "Which destination calls to the party?"[:MAX_QUESTION_LENGTH],
    }


# --- Hard constraints and budget (Requirement 7.9-7.10) --------------------------------


def _negated_subject(constraint: str) -> str | None:
    """Extract the forbidden subject from a negative constraint.

    Mirrors ``app.agents.guardrails.business._negated_constraint``: a
    constraint phrased as a prohibition (``"no "``, ``"not "``, ``"avoid "``,
    ``"without "``, ``"never "``) yields the subject it forbids; anything else
    is a preference, not something a candidate name can be checked against.
    """
    lowered = constraint.strip().lower()
    for prefix in ("no ", "not ", "avoid ", "without ", "never "):
        if lowered.startswith(prefix):
            return lowered[len(prefix) :].strip() or None
    return None


def _violates_hard_constraints(name: str, hard_constraints: list[str]) -> str | None:
    """Return the violated constraint's text, or ``None`` if the candidate is clear.

    A blunt case-insensitive substring scan against the constraint's forbidden
    subject — matching the same bluntness the business guardrail itself uses —
    so a false positive here only costs a repair iteration, while a false
    negative would hand the party something they explicitly ruled out.
    """
    lowered = name.lower()
    for constraint in hard_constraints:
        subject = _negated_subject(str(constraint))
        if subject and subject in lowered:
            return str(constraint)
    return None


def _estimate_cost(name: str, group_profile: dict[str, Any]) -> float | None:
    """Estimate a candidate's per-member cost.

    No pricing tool is wired yet, so this returns ``None`` (unestimated) for
    every candidate rather than inventing a figure — an unestimated candidate is
    never excluded by the budget filter below, exactly like an unconstrained
    ceiling never excludes anything. When a pricing tool lands, this is the one
    function that needs to change.
    """
    return None


def _filter_candidates(
    candidates: list[str], group_profile: dict[str, Any]
) -> tuple[list[str], str | None]:
    """Apply hard constraints and the budget ceiling (Requirement 7.9).

    Returns:
        ``(surviving_candidates, eliminating_reason)``. ``eliminating_reason`` is
        set only when filtering emptied the set, naming the constraint or the
        ceiling for the escalation message (Requirement 7.10).
    """
    hard_constraints = [str(c) for c in (group_profile.get("hard_constraints") or [])]
    ceiling = group_profile.get("budget_ceiling")

    survivors: list[str] = []
    last_violated_constraint: str | None = None
    for name in candidates:
        violated = _violates_hard_constraints(name, hard_constraints)
        if violated is not None:
            last_violated_constraint = violated
            continue
        cost = _estimate_cost(name, group_profile)
        if ceiling is not None and cost is not None and cost > float(ceiling):
            continue
        survivors.append(name)

    if survivors:
        return survivors, None

    if last_violated_constraint is not None:
        return [], f"the hard constraint {last_violated_constraint!r}"
    if ceiling is not None:
        return [], f"the party's budget ceiling of {ceiling}"
    return [], "the party's current constraints"


async def discovery_node(state: AgentState, config: RunnableConfig) -> AgentState:
    """Produce a destination recommendation for the DISCOVER stage.

    Raises:
        PreferencesNotCollectedError: If the room has no travel preferences at
            all (Requirement 7.12). No profile is computed, nothing is written.
        TripNotFoundError: If the trip does not exist.
        StagePreconditionNotMetError: If the room is closed or past this stage.
    """
    repos: RepositoryBundle = config["configurable"]["repos"]

    context = await _load_context(state, repos)
    state = state.with_trip_context(context)

    if not context["preferences"]:
        raise PreferencesNotCollectedError()

    profile = compute_group_profile(
        context["members"], context["preferences"], context["characters"]
    )
    state = state.with_group_profile(profile)

    if not profile["availability_overlap"]:
        await perform_human_escalation(
            state,
            repos,
            constraint="no shared travel dates exist across the party",
            question="Would the party like to widen their available dates?",
            options=[("widen_dates", "Widen our available dates")],
        )
        return state

    await report_phase(repos, state, "asking_guide")
    brief = build_party_brief(
        context["members"], context["preferences"], context["characters"],
        profile["availability_overlap"],
    )  # fmt: skip
    answer = await _ask_llm(brief, repos.llm)
    await report_phase(repos, state, "checking_budget")
    candidates, cards = _choose_destinations(brief, answer, profile)
    survivors, eliminating_reason = _filter_candidates(candidates, profile)
    if not survivors:
        await perform_human_escalation(
            state,
            repos,
            constraint=f"every candidate destination was eliminated by {eliminating_reason}",
            question="Would the party like to relax that constraint?",
            options=[
                ("relax_constraint", "Relax that constraint"),
                ("raise_budget", "Raise our budget"),
            ],
        )
        return state

    cap = get_settings().iteration_cap

    async def _producer(repair_state: AgentState) -> dict[str, Any]:
        """Re-load context and re-filter the same answer (Requirement 6.3).

        A repair never calls the model again: it must be fast and repeatable.
        """
        fresh_context = await _load_context(repair_state, repos)
        fresh_profile = compute_group_profile(
            fresh_context["members"], fresh_context["preferences"], fresh_context["characters"]
        )
        fresh_survivors, _reason = _filter_candidates(candidates, fresh_profile)
        return _build_proposal(fresh_survivors or survivors, cards, brief)

    await report_phase(repos, state, "checking_answer")
    loop_outcome = await run_guardrail_loop(
        state,
        repos,
        _build_proposal(survivors, cards, brief),
        "destination_recommendation",
        _producer,
        cap,
    )
    state = loop_outcome.state

    if loop_outcome.escalated:
        return state

    proposal: DestinationRecommendationProposal = loop_outcome.proposal
    state = state.with_proposal(proposal.model_dump(mode="json"))

    await report_phase(repos, state, "posting")
    await _close_prior_vote_session(repos, context["room_id"])
    message = await emit_npc_message(
        repos,
        state.trip_id,
        "recommendation",
        RecommendationMessageContent(
            title=proposal.title,
            category="destination",
            items=[item.model_dump(mode="json") for item in proposal.items],
            prompt=proposal.prompt,
            stage=STAGE,
        ),
    )
    await repos.vote_session_repo.create(
        room_id=context["room_id"],
        message_id=message["id"],
        question=proposal.question,
        options=[{"id": item.id, "label": item.title} for item in proposal.items],
    )

    return state


async def _load_context(state: AgentState, repos: RepositoryBundle) -> dict[str, Any]:
    """Re-fetch the trip context fresh (Requirement 6.1-6.3)."""
    from app.agents.state import load_trip_context

    return await load_trip_context(repos, state.trip_id, state.run_type)


async def _close_prior_vote_session(repos: RepositoryBundle, room_id: str) -> None:
    """Close any open destination vote session before opening a new one.

    Requirement 7.8: at most one open destination session per room.
    """
    existing = await repos.vote_session_repo.get_open_by_room_and_category(room_id, "destination")
    if existing is not None:
        await repos.vote_session_repo.close(existing["id"])
