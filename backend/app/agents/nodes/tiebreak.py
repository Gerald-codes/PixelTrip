"""Tiebreak_Node — advise the party leader on a tied destination or flight vote.

When a vote ties, the vote service holds the session (``tie_pending``) and the room
owner picks the winner (``POST /votes/{id}/break-tie``). This node only *advises*:

1. Find the room's ``tie_pending`` session and its category (destination or flight).
2. Gather what matters: each member's own preferences, the party's combined profile,
   who voted for which tied option, and each tied option's details from the linked
   recommendation message.
3. Score every tied option for the party and for each member. Items use the same
   card keys as recommendation items (CR-1): ``score`` (0-100 for the party),
   ``whyThisFits``, ``tags``, ``tradeOff`` and ``details``, plus ``memberFit`` (0-100
   and a one-line reason per member, from that member's budget, interests,
   activities, wish-list destinations and constraints). Flights are weighed on price,
   duration and stops against budgets and dates; destinations on interests,
   activities, vibe and budget.
4. Post it as one ``summary`` message (``category: destination_tiebreak`` or
   ``flight_tiebreak``) that the frontend shows to the owner. The suggested option is
   the highest-scoring one.

**The LLM never decides.** Its scores and pick are advice; the owner's choice is what
locks. Without an LLM (no key, a failure, or an unusable answer) the node falls back to a
simple rule-based score, so a tie always gets scored advice.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel, Field

from app.agents.errors import LLMGenerationError
from app.agents.group_profile import compute_group_profile
from app.agents.llm import UNTRUSTED_INPUT_GUARD, clip_for_prompt, clip_text
from app.agents.messages import (
    MAX_OPTION_LABEL_LENGTH,
    QuickReplyOption,
    SummaryMessageContent,
    emit_npc_message,
)
from app.agents.party_brief import (
    budget_text,
    build_party_brief,
    members_text,
    trip_text,
    wants_text,
)
from app.agents.progress import report_phase
from app.core.budget import is_valid_amount

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import AgentState, RepositoryBundle

logger = logging.getLogger(__name__)

STAGE_BY_CATEGORY = {"destination": "DISCOVER", "flight": "LOGISTICS"}
MAX_ANALYSIS_CHARS = 700
MAX_ADVICE_CHARS = 1500
MAX_REASON_CHARS = 300
MAX_DETAILS_CHARS = 600
MAX_TAGS = 4
MAX_TAG_CHARS = 24

#: Recommendation-item ``meta`` keys passed on as ``facts``, per category.
DETAIL_KEYS = {
    "flight": (
        "carrier",
        "flight_number",
        "price",
        "duration_minutes",
        "stops",
        "depart_at",
        "return_at",
    ),
    "destination": (
        "score",
        "whyThisFits",
        "tags",
        "tradeOff",
        "estimatedDailyCostSgd",
        "bestFor",
        "tripDays",
        "tripStart",
        "tripEnd",
    ),
}


# --- LLM response shape ---------------------------------------------------------------


class _MemberFit(BaseModel):
    member_id: str = Field(description="The member's id, exactly as given.")
    score: int = Field(description="0-100: how well this option fits this member's preferences.")
    reason: str = Field(
        description="1-2 sentences explaining the score using this member's own preferences."
    )


class _OptionAnalysis(BaseModel):
    option_id: str = Field(description="The id of one tied option, exactly as given.")
    score: int = Field(description="0-100: how well this option fits the whole party.")
    why_this_fits: str = Field(
        description="2-3 sentences on why it fits the party, naming their own preferences."
    )
    tags: list[str] = Field(description="2-4 short labels (1-3 words each), e.g. Direct.")
    trade_off: str = Field(
        description="1-2 sentences on the main downside for this party and its impact."
    )
    member_fit: list[_MemberFit] = Field(description="One entry per party member.")


class _TiebreakAdvice(BaseModel):
    analyses: list[_OptionAnalysis] = Field(description="One entry per tied option.")
    recommended_option_id: str = Field(description="The tied option id the guide leans towards.")
    advice: str = Field(
        description="3-5 sentences to the party leader: compare the options and who each "
        "suits, then say which you lean towards and why."
    )


# --- Advice ready to post -------------------------------------------------------------


class _OptionScore:
    """One tied option's scored analysis, ready to post."""

    def __init__(
        self,
        score: int,
        why_this_fits: str,
        tags: list[str],
        trade_off: str | None,
        member_fit: list[dict[str, Any]],
    ) -> None:
        self.score = score
        self.why_this_fits = why_this_fits
        self.tags = tags
        self.trade_off = trade_off
        self.member_fit = member_fit


class _Advice:
    """Advice ready to post, from the LLM or the fallback."""

    def __init__(
        self,
        advice: str,
        scores: dict[str, _OptionScore],
        recommended_option_id: str | None,
    ) -> None:
        self.advice = advice
        self.scores = scores
        self.recommended_option_id = recommended_option_id


# --- Node -----------------------------------------------------------------------------


async def tiebreak_node(state: AgentState, config: RunnableConfig) -> AgentState:
    """Post scored, leader-facing advice for the room's tied vote, if there is one."""
    repos: RepositoryBundle = config["configurable"]["repos"]
    context = state.trip_context or {}
    room_id = context.get("room_id")
    if not room_id:
        return state

    session = await repos.vote_session_repo.get_tie_pending_by_room(room_id)
    if session is None:
        logger.info("Tiebreak run %s found no tied vote; nothing to advise", state.run_id)
        return state

    category = session.get("category") or "destination"
    labels = {
        str(option["id"]): str(option.get("label") or option["id"])
        for option in session.get("options") or []
    }
    tied_ids = [
        str(option_id)
        for option_id in session.get("tie_option_ids") or []
        if str(option_id) in labels
    ]
    if len(tied_ids) < 2:
        return state

    members = context.get("members") or []
    preferences = context.get("preferences") or []
    cards = await _tied_option_cards(repos, session, tied_ids)
    details = {o: _facts(cards.get(o, {}), category) for o in tied_ids}
    votes_by_member = await _votes_by_member(repos, session["id"])
    names = _member_names(members)
    backers = _backers_by_option(votes_by_member, names)
    profile = compute_group_profile(members, preferences, context.get("characters"))

    await report_phase(repos, state, "weighing_options")
    advice = await _llm_advice(
        repos.llm,
        category,
        tied_ids,
        labels,
        details,
        backers,
        profile,
        members,
        preferences,
        context.get("characters"),
    ) or _fallback_advice(
        category, tied_ids, labels, cards, details, backers, members, preferences, votes_by_member
    )

    await report_phase(repos, state, "posting")
    await emit_npc_message(
        repos,
        state.trip_id,
        "summary",
        SummaryMessageContent(
            title="A tie for the leader to break",
            text=clip_text(advice.advice, MAX_ADVICE_CHARS) or "The party is split.",
            stage=STAGE_BY_CATEGORY.get(category),
            category=f"{category}_tiebreak",
            options=[
                QuickReplyOption(id=option_id, label=labels[option_id][:MAX_OPTION_LABEL_LENGTH])
                for option_id in tied_ids
            ],
            advice=clip_text(advice.advice, MAX_ADVICE_CHARS),
            items=[
                _item(
                    option_id,
                    labels,
                    cards.get(option_id, {}),
                    details.get(option_id, {}),
                    backers,
                    advice.scores.get(option_id),
                )
                for option_id in tied_ids
            ],
            vote_session_id=session["id"],
            recommended_option_id=advice.recommended_option_id,
        ),
    )
    return state


def _item(
    option_id: str,
    labels: dict[str, str],
    card: dict[str, Any],
    facts: dict[str, Any],
    backers: dict[str, list[str]],
    score: _OptionScore | None,
) -> dict[str, Any]:
    """One tied option, in the recommendation card shape (CR-1) plus tie extras."""
    meta = card.get("meta") or {}
    details = meta.get("details") if isinstance(meta.get("details"), str) else None
    item: dict[str, Any] = {
        "id": option_id,
        "title": labels[option_id],
        "label": labels[option_id],
        "description": card.get("description") or "",
        "votes": backers.get(option_id, []),
        "details": clip_text(details, MAX_DETAILS_CHARS) or _facts_text(facts),
        "facts": facts,
    }
    if score is not None:
        item.update(
            {
                "score": score.score,
                "whyThisFits": clip_text(score.why_this_fits, MAX_ANALYSIS_CHARS) or "",
                "tags": _clean_tags(score.tags),
                "tradeOff": clip_text(score.trade_off, MAX_REASON_CHARS) or "",
                "memberFit": score.member_fit,
            }
        )
    return item


def _clean_tags(raw: list[Any]) -> list[str]:
    tags: list[str] = []
    for value in raw or []:
        tag = clip_text(str(value), MAX_TAG_CHARS)
        if tag and tag.lower() not in {t.lower() for t in tags}:
            tags.append(tag)
    return tags[:MAX_TAGS]


def _facts_text(facts: dict[str, Any]) -> str:
    """A readable one-liner of the raw facts, for when no card ``details`` exist."""
    return ". ".join(
        f"{key.replace('_', ' ')}: {', '.join(map(str, v)) if isinstance(v, list) else v}"
        for key, v in facts.items()
    )


# --- Data gathering -------------------------------------------------------------------


async def _tied_option_cards(
    repos: RepositoryBundle, session: dict[str, Any], tied_ids: list[str]
) -> dict[str, dict[str, Any]]:
    """Each tied option's item from the linked recommendation message."""
    if not session.get("message_id"):
        return {}
    message = await repos.message_repo.get_by_id(session["message_id"])
    items = ((message or {}).get("content") or {}).get("items") or []
    return {
        str(item.get("id")): item
        for item in items
        if isinstance(item, dict) and str(item.get("id")) in tied_ids
    }


def _facts(card: dict[str, Any], category: str) -> dict[str, Any]:
    """The comparable facts worth showing the owner and the LLM."""
    meta = card.get("meta") or {}
    picked = {
        key: meta[key]
        for key in DETAIL_KEYS.get(category, ())
        if meta.get(key) not in (None, "", [])
    }
    if card.get("description"):
        picked["description"] = card["description"]
    return picked


async def _votes_by_member(repos: RepositoryBundle, vote_session_id: str) -> dict[str, str]:
    """``member_id -> option_id`` for every vote in the session."""
    return {
        str(vote["member_id"]): str(vote["option_id"])
        for vote in await repos.vote_repo.list_by_session(vote_session_id)
        if vote.get("member_id")
    }


def _member_names(members: list[dict[str, Any]]) -> dict[str, str]:
    return {str(m.get("id")): m.get("display_name") or "A party member" for m in members}


def _backers_by_option(
    votes_by_member: dict[str, str], names: dict[str, str]
) -> dict[str, list[str]]:
    """``option_id -> [display names]`` of the members who voted for it."""
    backers: dict[str, list[str]] = {}
    for member_id, option_id in votes_by_member.items():
        if member_id in names:
            backers.setdefault(option_id, []).append(names[member_id])
    return backers


# --- LLM path -------------------------------------------------------------------------


async def _llm_advice(
    llm: Any,
    category: str,
    tied_ids: list[str],
    labels: dict[str, str],
    details: dict[str, dict[str, Any]],
    backers: dict[str, list[str]],
    profile: dict[str, Any],
    members: list[dict[str, Any]],
    preferences: list[dict[str, Any]],
    characters: list[dict[str, Any]] | None = None,
) -> _Advice | None:
    if llm is None:
        return None

    focus = (
        "Score each flight on its price, duration, stops and times against each member's "
        "budget and the party's shared dates."
        if category == "flight"
        else "Score each destination on how its location suits each member's interests, "
        "activities, chosen trip types and budget level."
    )
    system_prompt = (
        f"{UNTRUSTED_INPUT_GUARD}\n\n"
        "You are an in-world NPC travel guide in a group trip-planning game. The party's "
        f"{category} vote is tied. Help the party leader, who will make the final call, by "
        f"scoring each tied option. {focus} For every tied option give: a 0-100 fit score "
        "for the whole party, a 0-100 score and one-sentence reason for EACH member, up to "
        "short tags (1-3 words each), and its main trade-off. Be fair and consistent: the "
        "option you recommend should be the one with the highest party fit score. Be "
        "specific: name each member's own budget, interests or wishes when explaining a "
        "score, and compare the options concretely (price, time, location, activities)."
    )
    brief = build_party_brief(members, preferences, characters, profile.get("availability_overlap"))
    option_lines = "\n".join(
        f"- id={option_id} | {labels[option_id]} | votes from: "
        f"{clip_for_prompt(backers.get(option_id, []))} | details: "
        f"{clip_for_prompt([f'{k}: {v}' for k, v in details.get(option_id, {}).items()])}"
        for option_id in tied_ids
    )
    user_prompt = (
        f"Dates: {trip_text(brief)}\n"
        f"{budget_text(brief)}\n\n"
        f"What the party wants (members who chose it):\n{wants_text(brief)}\n\n"
        f"Members (use each member_id exactly as given):\n"
        f"{members_text(brief, with_ids=True)}\n\n"
        f"Tied options:\n{option_lines}"
    )
    try:
        result = await llm.generate_structured(
            operation=f"{category}_tiebreak",
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            response_model=_TiebreakAdvice,
        )
    except LLMGenerationError:
        logger.info("LLM tiebreak advice unavailable; using fallback advice")
        return None
    except Exception:  # an SDK surprise must not leave the leader without advice
        logger.info("LLM tiebreak advice returned an unusable result; using fallback advice")
        return None

    names = _member_names(members)
    scores: dict[str, _OptionScore] = {}
    for analysis in result.analyses:
        if analysis.option_id not in tied_ids or analysis.option_id in scores:
            continue
        member_fit = [
            {
                "memberId": fit.member_id,
                "displayName": names[fit.member_id],
                "score": _clamp(fit.score),
                "reason": clip_text(fit.reason.strip(), MAX_REASON_CHARS) or "",
            }
            for fit in analysis.member_fit
            if fit.member_id in names
        ]
        scores[analysis.option_id] = _OptionScore(
            score=_clamp(analysis.score),
            why_this_fits=analysis.why_this_fits.strip(),
            tags=[t.strip() for t in analysis.tags if t.strip()],
            trade_off=analysis.trade_off.strip() or None,
            member_fit=member_fit,
        )
    if not result.advice.strip() or set(scores) != set(tied_ids):
        return None
    llm_pick = result.recommended_option_id if result.recommended_option_id in tied_ids else None
    return _Advice(result.advice.strip(), scores, _top_scorer(scores, tied_ids) or llm_pick)


# --- Fallback path --------------------------------------------------------------------


def _fallback_advice(
    category: str,
    tied_ids: list[str],
    labels: dict[str, str],
    cards: dict[str, dict[str, Any]],
    details: dict[str, dict[str, Any]],
    backers: dict[str, list[str]],
    members: list[dict[str, Any]],
    preferences: list[dict[str, Any]],
    votes_by_member: dict[str, str],
) -> _Advice:
    """A plain, explainable score when no LLM advice is available.

    Per member: 50 to start, +25 if they voted for the option, then for destinations +25
    if it matches one of their wish-list destinations, and for flights +25 if it is within
    their budget (-25 if over it). The party score is the members' average. Tags and the
    trade-off are carried over from the option's recommendation card, when it has them.
    """
    prefs_by_member = {str(p.get("member_id")): p for p in preferences}
    scores: dict[str, _OptionScore] = {}
    for option_id in tied_ids:
        info = details.get(option_id, {})
        member_fit = []
        for member in members:
            member_id = str(member.get("id"))
            prefs = prefs_by_member.get(member_id, {})
            score, why = 50, []
            if votes_by_member.get(member_id) == option_id:
                score += 25
                why.append("voted for it")
            if category == "destination":
                if _matches_wishlist(labels[option_id], prefs.get("destinations")):
                    score += 25
                    why.append("on their wish list")
            else:
                price, budget = info.get("price"), prefs.get("budget")
                if isinstance(price, int | float) and is_valid_amount(budget):
                    within = price <= budget
                    score += 25 if within else -25
                    why.append("within their budget" if within else "over their budget")
            member_fit.append(
                {
                    "memberId": member_id,
                    "displayName": member.get("display_name") or "A party member",
                    "score": _clamp(score),
                    "reason": ", ".join(why).capitalize()
                    if why
                    else "No strong signal either way.",
                }
            )
        party_score = (
            round(sum(f["score"] for f in member_fit) / len(member_fit)) if member_fit else 50
        )
        who = ", ".join(backers.get(option_id, [])) or "no one yet"
        if category == "flight" and info:
            facts = (
                f"S${info.get('price', '?')}, {info.get('duration_minutes', '?')} min, "
                f"{info.get('stops', '?')} stop(s)"
            )
            why = f"{facts}. Backed by {who}."
        else:
            why = f"Backed by {who}."
        card_meta = cards.get(option_id, {}).get("meta") or {}
        tags = card_meta.get("tags") if isinstance(card_meta.get("tags"), list) else []
        trade_off = (
            card_meta.get("tradeOff") if isinstance(card_meta.get("tradeOff"), str) else None
        )
        scores[option_id] = _OptionScore(party_score, why, tags, trade_off, member_fit)

    recommended = _top_scorer(scores, tied_ids)
    tied = " and ".join(labels[o] for o in tied_ids)
    advice = f"The party is evenly split between {tied}."
    if recommended and len({s.score for s in scores.values()}) > 1:
        advice += f" {labels[recommended]} scores highest on the party's preferences."
    advice += " The choice is yours, leader."
    return _Advice(advice, scores, recommended)


def _matches_wishlist(label: str, wishlist: Any) -> bool:
    if not isinstance(wishlist, list):
        return False
    words = {w.strip(",()").lower() for w in label.split()}
    for wish in wishlist:
        if (
            isinstance(wish, str)
            and wish.strip()
            and (wish.strip().lower() in label.lower() or wish.strip().lower() in words)
        ):
            return True
    return False


def _top_scorer(scores: dict[str, _OptionScore], tied_ids: list[str]) -> str | None:
    """The highest-scoring tied option; ``None`` when they are level."""
    ranked = sorted(tied_ids, key=lambda o: scores[o].score if o in scores else -1, reverse=True)
    if not ranked or ranked[0] not in scores:
        return None
    if (
        len(ranked) > 1
        and ranked[1] in scores
        and (scores[ranked[0]].score == scores[ranked[1]].score)
    ):
        return None
    return ranked[0]


def _clamp(value: int) -> int:
    return max(0, min(100, int(value)))
