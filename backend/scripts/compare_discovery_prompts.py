"""Run the DISCOVER prompt live on a few example parties and print the cards.

Use it whenever you change app/agents/prompts/discovery_*.md (or the party
brief), to see whether the cards got better. It calls Gemini with the real
settings from .env and writes nothing to Supabase.

    cd backend
    python scripts/compare_discovery_prompts.py                 # all parties
    python scripts/compare_discovery_prompts.py --party split   # one party
    python scripts/compare_discovery_prompts.py --show-prompt   # also print prompts
    python scripts/compare_discovery_prompts.py --out run1.md   # save for comparing
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.group_profile import compute_group_profile  # noqa: E402
from app.agents.llm import LLMClient  # noqa: E402
from app.agents.nodes import discovery  # noqa: E402
from app.agents.party_brief import build_party_brief  # noqa: E402


def _party(
    members: list[tuple[str, dict[str, Any], str]], dates: tuple[str, str]
) -> dict[str, Any]:
    """Build member, preference and character rows from (name, prefs, budget tier)."""
    rows: dict[str, Any] = {"members": [], "preferences": [], "characters": []}
    for index, (name, prefs, tier) in enumerate(members, start=1):
        member_id = f"m{index}"
        rows["members"].append({"id": member_id, "display_name": name})
        rows["preferences"].append({"member_id": member_id, **prefs})
        rows["characters"].append({"member_id": member_id, "appearance": {"budgetTier": tier}})
    rows["overlap"] = [{"start": dates[0], "end": dates[1]}]
    return rows


PARTIES: dict[str, dict[str, Any]] = {
    "asia-budget": _party(
        [
            ("Gerald", {"destinations": ["asia"], "interests": ["food", "adventure"],
                        "activities": ["hiking"], "travel_style": "planner"}, "low"),
            ("Priya", {"destinations": ["asia", "beach-escape"],
                       "interests": ["food", "nightlife", "relaxation"],
                       "activities": ["beaches", "markets"], "travel_style": "chill"}, "low"),
        ],
        ("2026-10-12", "2026-10-16"),
    ),
    "split": _party(
        [
            ("Gerald", {"destinations": ["beach-escape"], "interests": ["relaxation", "food"],
                        "activities": ["beaches", "relaxing"], "travel_style": "chill"},
             "medium"),
            ("Priya", {"destinations": ["western-cities", "shopping-city"],
                       "interests": ["shopping", "culture", "nightlife"],
                       "activities": ["tours", "markets"], "travel_style": "planner"}, "high"),
            ("Ken", {"destinations": ["adventure-trip"], "interests": ["adventure", "scenery"],
                     "activities": ["hiking"], "travel_style": "adventurer"}, "medium"),
        ],
        ("2026-12-18", "2026-12-24"),
    ),
    "named-city": _party(
        [
            ("Gerald", {"destinations": ["Tokyo, Japan", "food-trip"],
                        "interests": ["food", "culture"], "activities": ["temples"],
                        "travel_style": "leader", "budget": 2500}, "medium"),
            ("Priya", {"destinations": ["cultural-trip"], "interests": ["culture", "scenery"],
                       "activities": ["tours"], "travel_style": "follower", "budget": 2}, "medium"),
        ],
        ("2026-11-02", "2026-11-07"),
    ),
    "long-trip": _party(
        [
            ("Gerald", {"destinations": ["nature-scenery", "hidden-gems"],
                        "interests": ["scenery", "hidden-gems", "adventure"],
                        "activities": ["hiking", "tours"], "travel_style": "adventurer",
                        "budget": 4000}, "high"),
            ("Priya", {"destinations": ["nature-scenery"], "interests": ["relaxation", "food"],
                       "activities": ["relaxing"], "travel_style": "chill"}, "medium"),
        ],
        ("2027-03-01", "2027-03-10"),
    ),
    "free-for-a-month": _party(
        [
            ("Gerald", {"destinations": ["adventure-trip"], "interests": ["adventure", "food"],
                        "activities": ["hiking"], "travel_style": "planner", "budget": 1200},
             "low"),
            ("Priya", {"destinations": ["beach-escape", "adventure-trip"],
                       "interests": ["relaxation", "nightlife"], "activities": ["beaches"],
                       "travel_style": "chill", "budget": 1600}, "high"),
        ],
        ("2026-10-12", "2026-11-12"),
    ),
}  # fmt: skip


def _render(name: str, items: list[dict[str, Any]], prompts: tuple[str, str] | None) -> str:
    lines = [f"## {name}", ""]
    if prompts:
        lines += ["### System prompt", "```", prompts[0], "```", "### User prompt", "```",
                  prompts[1], "```", ""]  # fmt: skip
    for item in items:
        meta = item["meta"]
        breakdown = meta.get("scoreBreakdown") or {}
        cost = meta.get("estimatedDailyCostSgd")
        lines += [
            f"### {item['title']} — {meta['score']}/100 · {meta['pick']}",
            f"- sub-scores: {breakdown or 'n/a (fallback card)'}",
            f"- best for: {', '.join(meta['bestFor']) or '-'} · "
            f"cost/day: {f'SGD {cost}' if cost else '-'} · tags: {', '.join(meta['tags'])}",
            f"- trip: {meta.get('tripDays')} days, {meta.get('tripStart')} to "
            f"{meta.get('tripEnd')} | {meta.get('whyThisLong')}",
            f"- description: {item['description']}",
            f"- why it fits: {meta['whyThisFits']}",
            f"- trade-off: {meta['tradeOff']}",
            f"- details: {meta['details']}",
            "",
        ]
    return "\n".join(lines)


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--party", choices=sorted(PARTIES), help="run just this party")
    parser.add_argument("--show-prompt", action="store_true", help="print the prompts too")
    parser.add_argument("--out", help="also save the output to this markdown file")
    args = parser.parse_args()

    llm = LLMClient()
    sections = []
    for name in [args.party] if args.party else list(PARTIES):
        party = PARTIES[name]
        brief = build_party_brief(
            party["members"], party["preferences"], party["characters"], party["overlap"]
        )
        answer = await discovery._ask_llm(brief, llm)
        profile = compute_group_profile(party["members"], party["preferences"], party["characters"])
        names, cards = discovery._choose_destinations(brief, answer, profile)
        items = discovery._build_proposal(names, cards, brief)["items"]
        note = "" if answer else "\n> LLM failed: these are fallback cards.\n"
        prompts = discovery.build_discovery_prompts(brief) if args.show_prompt else None
        section = _render(name, items, prompts) + note
        print(section, flush=True)
        sections.append(section)

    if args.out:
        Path(args.out).write_text("\n".join(sections), encoding="utf-8")
        print(f"Saved to {args.out}")


if __name__ == "__main__":
    asyncio.run(main())
