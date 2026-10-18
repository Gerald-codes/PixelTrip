"""The trip budget: one set of rules every stage uses.

A member gives two budget signals in character creation:

* **Adventure funds** (optional): a typed amount in SGD, per person, for the whole
  trip *including flights*. Objective, so it is the **limit**. Accepted only from
  :data:`MIN_BUDGET` to :data:`MAX_BUDGET`; the preferences API refuses anything else.
* **Budget level** (always given): Low / Medium / High, saved on the character as
  ``appearance.budgetTier``. Subjective, so it is turned into a fixed daily spending
  range (:data:`DAILY_BANDS`, per person per day, excluding flights). It describes
  *how* the member likes to spend, and stands in for the amount when none is typed.

The party budget follows its tightest member:

* **Hard limit**: the lowest typed amount. Options that clearly do not fit are
  dropped (while enough remain).
* **Soft guide**: when nobody typed an amount, the lowest level's daily range. It
  ranks and labels options but never removes any.

The LLM only ever supplies *estimates* (a destination's daily cost, an activity's
cost). All arithmetic is here, and a missing estimate never excludes anything.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

CURRENCY = "SGD"

#: The accepted range for a typed budget (per person, whole trip, including flights).
MIN_BUDGET = 100
MAX_BUDGET = 50_000

#: Budget level -> (low, high, typical) spend per person per day in SGD, excluding
#: flights. ``high`` is open-ended (``None``). Tune here; nothing else hard-codes these.
DAILY_BANDS: dict[str, tuple[int, int | None, int]] = {
    "low": (50, 120, 80),
    "medium": (120, 250, 180),
    "high": (250, None, 350),
}
TIER_LABELS = {"low": "Low", "medium": "Medium", "high": "High"}


def is_valid_amount(value: Any) -> bool:
    """Whether a typed budget is within the accepted range."""
    return isinstance(value, int | float) and MIN_BUDGET <= value <= MAX_BUDGET


def band_text(tier: str) -> str:
    """``"SGD 50-120"`` or ``"SGD 250+"`` for a tier's daily range."""
    low, high, _typical = DAILY_BANDS[tier]
    return f"{CURRENCY} {low}-{high}" if high is not None else f"{CURRENCY} {low}+"


def tier_of(character: dict[str, Any] | None) -> str | None:
    """The member's budget level from their character, or ``None``."""
    appearance = (character or {}).get("appearance")
    if not isinstance(appearance, dict):
        return None
    tier = str(appearance.get("budgetTier") or "").strip().lower()
    return tier if tier in DAILY_BANDS else None


@dataclass(frozen=True)
class MemberBudget:
    member_id: str
    name: str
    amount: float | None  # typed and valid; ``None`` when not typed (or invalid old data)
    tier: str | None

    def estimate(self, days: int | None) -> float | None:
        """Their spend for the trip (excluding flights) from their level, if known."""
        if self.tier is None or not days:
            return None
        return float(DAILY_BANDS[self.tier][2] * days)


@dataclass(frozen=True)
class PartyBudget:
    days: int | None
    limit: float | None  # the lowest valid typed amount: a hard limit
    limit_member: str | None  # who set it
    tier: str | None  # the lowest level anyone picked
    tier_count: int  # how many members picked that level
    members: tuple[MemberBudget, ...]

    @property
    def is_hard(self) -> bool:
        return self.limit is not None

    @property
    def daily_band(self) -> tuple[int, int | None, int] | None:
        return DAILY_BANDS[self.tier] if self.tier else None

    def stay_estimate(self, daily_cost: float | None, days: int | None = None) -> float | None:
        """Stay, food and local transport for the trip from a daily estimate.

        ``days`` is the trip's own length (see ``app.core.trip_dates``); it defaults
        to this budget's ``days``.
        """
        length = days or self.days
        if not daily_cost or not length:
            return None
        return float(daily_cost) * length

    def over_limit(self, cost: float | None) -> bool:
        """Clearly over the hard limit. Never true without a limit or an estimate."""
        return self.limit is not None and cost is not None and cost > self.limit

    def above_level(self, daily_cost: float | None) -> bool:
        """A daily cost above the party's level range (a soft warning only)."""
        band = self.daily_band
        if band is None or not daily_cost or band[1] is None:
            return False
        return daily_cost > band[1]

    def money_for_flight(self, stay_estimate: float | None) -> float | None:
        """What the hard limit leaves for the flight once the stay is paid for."""
        if self.limit is None:
            return None
        return self.limit - (stay_estimate or 0.0)


def party_budget(
    members: list[dict[str, Any]],
    preferences: list[dict[str, Any]],
    characters: list[dict[str, Any]] | None,
    days: int | None,
) -> PartyBudget:
    """The party's budget from raw rows (no I/O). Members without preferences are skipped."""
    prefs_by_member = {str(p.get("member_id")): p for p in preferences}
    chars_by_member = {str(c.get("member_id")): c for c in characters or [] if isinstance(c, dict)}
    budgets: list[MemberBudget] = []
    for member in members:
        member_id = str(member.get("id"))
        prefs = prefs_by_member.get(member_id)
        if prefs is None:
            continue
        amount = prefs.get("budget")
        budgets.append(
            MemberBudget(
                member_id=member_id,
                name=member.get("display_name") or "A party member",
                amount=float(amount) if is_valid_amount(amount) else None,
                tier=tier_of(chars_by_member.get(member_id)),
            )
        )

    with_amount = [b for b in budgets if b.amount is not None]
    tightest = min(with_amount, key=lambda b: b.amount or 0.0, default=None)
    tiers = [b.tier for b in budgets if b.tier]
    order = list(DAILY_BANDS)
    lowest_tier = min(tiers, key=order.index) if tiers else None
    return PartyBudget(
        days=days,
        limit=tightest.amount if tightest else None,
        limit_member=tightest.name if tightest else None,
        tier=lowest_tier,
        tier_count=sum(1 for t in tiers if t == lowest_tier),
        members=tuple(budgets),
    )
