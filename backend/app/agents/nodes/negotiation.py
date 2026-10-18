"""Negotiation_Node — REFINE stage itinerary negotiation.

The flow, in order, each step narrowing what the next step has to consider:

1. **Require a base version.** No `itinerary_versions` row at all means there
   is nothing to refine (Requirement 10.12).
2. **Require open feedback.** Zero open rows completes the run with nothing
   written — not a failure, just nothing to do (Requirement 10.13).
3. **Resolve every open row's target** against the base itinerary, structured
   (`{day?, itemId?, section?}`) or legacy flat-string, splitting into
   resolvable and unresolvable (Requirement 10.14-10.15).
4. **Compute the Affected_Scope** from the resolvable rows: the targeted
   days/items, same-time-slot neighbours, and immediate adjacents
   (Requirement 10.2).
5. **Detect conflicts** between resolvable rows targeting the same day/item
   with incompatible requested outcomes, deterministically
   (Requirement 10.8-10.9).
6. **Regenerate only the Affected_Scope**, applying the (conflict-resolved)
   winning outcome per target; every day/item outside the scope is carried
   forward byte-identical (Requirement 10.3).
7. **Persist through the same optimistic-lock loop** `itinerary_node` uses,
   with a real applicability check this time — unlike a first build, a
   refine's lost race genuinely can still be worth retrying.
8. **Report**: mark addressed rows, narrate any conflict compromise, name
   whatever is still open, and advance `trips.status`.

**On the LLM's role: revising items and drafting requested additions.** Everything that
decides *what* may change stays deterministic and testable — Affected_Scope,
conflict detection (Requirement 10.9 requires it to be non-LLM), the choice of
the winning feedback row, Unaffected_Scope byte-identity, and the
addressed/still-open bookkeeping. The LLM interprets feedback as add/edit/remove/retain
once per run; that validated interpretation is shared by deterministic conflict
detection, drafting and application. Addition requests create separate activities
rather than editing their anchors. Keywords are only a fallback for recognized
requests; ambiguous requests stay open if interpretation is unavailable.

With no client, no API key or a failed interpretation, ambiguous feedback stays
open. A malformed individual revision still falls back to a note edit; missing
or rejected additions stay open and preserve existing activities.

**On the prompt-injection requirement (Requirement 10's "SHALL NOT execute...
any instruction phrased as an agent directive").** Feedback text is passed to the
LLM, so it is treated strictly as data: the system prompt carries
:data:`~app.agents.llm.UNTRUSTED_INPUT_GUARD`, every comment is flattened to a
single bounded line, and the model can only return revised fields for items this
node asked about. Additions must reference requested feedback and an existing
anchor in the targeted day; code assigns their IDs and checks placement,
capacity and constraints. The model cannot change an existing ID or any day
outside the Affected_Scope.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal
from uuid import NAMESPACE_URL, uuid5

from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel, ConfigDict, Field

from app.agents.errors import LLMGenerationError, NoItineraryToRefineError
from app.agents.llm import UNTRUSTED_INPUT_GUARD, clip_for_prompt, clip_text
from app.agents.messages import SummaryMessageContent, TextMessageContent, emit_npc_message
from app.agents.nodes.discovery import _violates_hard_constraints
from app.agents.nodes.itinerary import persist_itinerary_version
from app.agents.progress import report_phase
from app.agents.proposals import ItineraryModel, RefinementProposal
from app.services.trip_status_service import advance_trip_status

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import AgentState, RepositoryBundle

logger = logging.getLogger(__name__)

STAGE = "REFINE"

#: Requirement 10.5: a change summary is 1-500 characters.
MAX_CHANGE_SUMMARY_LENGTH = 500

#: Keyword scan used to classify a feedback row's requested outcome. Blunt by
#: design, matching the same bluntness the business guardrail's hard-constraint
#: scan uses: a false positive here costs nothing worse than an odd-sounding
#: compromise message, while silently misreading "remove" as "edit" could drop
#: the wrong thing.
#: Per-field ceilings applied to model text before it reaches the itinerary.
MAX_TITLE_CHARS = 120
MAX_DESCRIPTION_CHARS = 500
MAX_TIME_CHARS = 40
MAX_LOCATION_CHARS = 120

#: A feedback comment longer than this is truncated before it reaches a prompt.
MAX_COMMENT_PROMPT_CHARS = 300

_REMOVE_KEYWORDS = ("remove", "delete", "cut", "drop")
_RETAIN_KEYWORDS = ("keep", "retain", "don't remove", "do not remove")


@dataclass(frozen=True)
class ResolvedTarget:
    """A feedback row's target, resolved against the base itinerary.

    Attributes:
        day: The day number the target refers to.
        item_id: The specific item id, or ``None`` when the target names only
            a day (the whole day is in scope, no single item).
    """

    day: int
    item_id: str | None


# ---------------------------------------------------------------------------
# Target resolution (Requirement 10.14-10.15)
# ---------------------------------------------------------------------------


def _index_itinerary(
    itinerary: dict[str, Any],
) -> tuple[dict[int, dict[str, Any]], dict[str, tuple[int, int]]]:
    """Index an itinerary dict by day number and by item id.

    Returns:
        ``(days_by_number, item_location)`` where ``item_location`` maps an
        item id to ``(day_number, index_within_day)``.
    """
    days_by_number: dict[int, dict[str, Any]] = {}
    item_location: dict[str, tuple[int, int]] = {}
    for day in itinerary.get("days") or []:
        day_num = int(day["day"])
        days_by_number[day_num] = day
        for idx, item in enumerate(day.get("items") or []):
            item_location[item["id"]] = (day_num, idx)
    return days_by_number, item_location


def _resolve_target(
    target: Any,
    days_by_number: dict[int, dict[str, Any]],
    item_location: dict[str, tuple[int, int]],
) -> ResolvedTarget | None:
    """Resolve one feedback row's ``target`` against the base itinerary.

    Handles both the structured ``{day?, itemId?, section?}`` shape and a
    legacy flat string, attempting an exact match against an item id first and
    a day number second. Returns ``None`` when neither resolves
    (Requirement 10.14-10.15).
    """
    if isinstance(target, dict):
        item_id = target.get("itemId")
        if item_id is not None:
            location = item_location.get(item_id)
            return None if location is None else ResolvedTarget(day=location[0], item_id=item_id)
        day_value = target.get("day")
        if day_value is not None:
            try:
                day_num = int(day_value)
            except (TypeError, ValueError):
                return None
            return ResolvedTarget(day=day_num, item_id=None) if day_num in days_by_number else None
        return None

    if isinstance(target, str):
        text = target.strip()
        if not text:
            return None
        location = item_location.get(text)
        if location is not None:
            return ResolvedTarget(day=location[0], item_id=text)
        try:
            day_num = int(text)
        except ValueError:
            return None
        return ResolvedTarget(day=day_num, item_id=None) if day_num in days_by_number else None

    return None


def partition_by_target_resolution(
    feedback_rows: list[dict[str, Any]],
    base_itinerary: dict[str, Any],
) -> tuple[list[tuple[dict[str, Any], ResolvedTarget]], list[dict[str, Any]]]:
    """Split open feedback rows into resolvable and unresolvable.

    Args:
        feedback_rows: Open ``feedback`` rows, oldest first.
        base_itinerary: The base version's ``itinerary`` jsonb, as a dict.

    Returns:
        ``(resolvable, unresolvable)``. ``resolvable`` pairs each row with its
        :class:`ResolvedTarget`, in the same (creation-time) order the rows
        arrived in — later conflict and regeneration logic relies on that
        order to pick a deterministic "first wins" compromise.
    """
    days_by_number, item_location = _index_itinerary(base_itinerary)
    resolvable: list[tuple[dict[str, Any], ResolvedTarget]] = []
    unresolvable: list[dict[str, Any]] = []
    for row in feedback_rows:
        resolved = _resolve_target(row.get("target"), days_by_number, item_location)
        if resolved is None:
            unresolvable.append(row)
        else:
            resolvable.append((row, resolved))
    return resolvable, unresolvable


# ---------------------------------------------------------------------------
# Affected_Scope (Requirement 10.2)
# ---------------------------------------------------------------------------


def compute_affected_scope(
    resolvable: list[tuple[dict[str, Any], ResolvedTarget]],
    base_itinerary: dict[str, Any],
) -> dict[str, Any]:
    """Compute the Affected_Scope: targeted items, time-slot neighbours, adjacents.

    Returns:
        ``{"whole_days": [day, ...], "items": {day: [item_id, ...]}}``. Agent-
        internal bookkeeping only — never persisted (see
        :meth:`~app.agents.proposals.RefinementProposal.to_persistable`).
    """
    days_by_number, _item_location = _index_itinerary(base_itinerary)
    whole_days: set[int] = set()
    items_by_day: dict[int, set[str]] = {}

    for _row, resolved in resolvable:
        day = days_by_number.get(resolved.day)
        if day is None:
            continue
        day_items = day.get("items") or []

        if resolved.item_id is None:
            whole_days.add(resolved.day)
            for item in day_items:
                items_by_day.setdefault(resolved.day, set()).add(item["id"])
            continue

        idx = next((i for i, item in enumerate(day_items) if item["id"] == resolved.item_id), None)
        if idx is None:
            continue
        bucket = items_by_day.setdefault(resolved.day, set())
        changed_item = day_items[idx]
        bucket.add(changed_item["id"])

        # Same-day items sharing the changed item's time slot. "Resulting time
        # range" is read as the item's own `time` field, since no scheduling
        # engine exists to compute an actual post-change range yet.
        changed_time = changed_item.get("time")
        if changed_time:
            for item in day_items:
                if item.get("time") == changed_time:
                    bucket.add(item["id"])

        # The immediately adjacent items in the day's ordered list.
        if idx > 0:
            bucket.add(day_items[idx - 1]["id"])
        if idx < len(day_items) - 1:
            bucket.add(day_items[idx + 1]["id"])

    return {
        "whole_days": sorted(whole_days),
        "items": {day: sorted(ids) for day, ids in items_by_day.items()},
    }


def affected_days(affected_scope: dict[str, Any]) -> set[int]:
    """Return every day number touched by the Affected_Scope."""
    days = {int(d) for d in affected_scope.get("whole_days") or []}
    days.update(int(d) for d in (affected_scope.get("items") or {}))
    return days


# ---------------------------------------------------------------------------
# Conflict detection (Requirement 10.8-10.9)
# ---------------------------------------------------------------------------


def _classify_outcome(comment: str) -> str:
    """Classify a feedback comment's requested outcome: remove, retain, edit or add."""
    lowered = (comment or "").strip().lower()
    # "Remove lunch and change it to a bar lunch" requests a replacement,
    # not deletion. Use the same classification for conflicts and drafting.
    if re.search(
        r"\b(?:replace|swap|instead)\b|\b(?:change|switch)\b.+\b(?:to|with|for)\b", lowered
    ):
        return "edit"
    removal_text = lowered.replace("don't remove", "").replace("do not remove", "")
    if any(re.search(rf"\b{keyword}\b", removal_text) for keyword in _REMOVE_KEYWORDS):
        return "remove"
    explicit_addition = re.search(r"\b(?:add|insert|include|schedule)\b", lowered)
    extra_activity = re.search(
        r"\b(?:extra|additional|another|more|new|separate)\s+"
        r"(?:(?:\d+|one|two|three)\s+)?(?:activit(?:y|ies)|stops?|rows?|visits?|events?)\b",
        lowered,
    )
    planned_visit = re.search(
        r"\b(?:plan|suggest)\s+(?:\d+|one|two|three)\s+"
        r"(?:\w+\s+){0,2}(?:clubs?|activities|activity|visits?|stops?)\b",
        lowered,
    )
    if explicit_addition or extra_activity or planned_visit:
        return "add"
    if any(keyword in lowered for keyword in _RETAIN_KEYWORDS):
        return "retain"
    return "edit"


def _feedback_outcome(row: dict[str, Any]) -> str:
    """Use the validated semantic interpretation consistently throughout a run."""
    return row.get("_interpreted_outcome") or _classify_outcome(row.get("comment", ""))


class _FeedbackIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    feedback_id: str
    outcome: Literal["add", "edit", "remove", "retain"]
    addition_count: int = Field(default=1, ge=1, le=10)


class _FeedbackIntentBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intents: list[_FeedbackIntent]


async def interpret_feedback(
    llm: Any,
    base_itinerary: dict[str, Any],
    resolvable: list[tuple[dict[str, Any], ResolvedTarget]],
) -> list[tuple[dict[str, Any], ResolvedTarget]]:
    """Interpret natural language once; conflict resolution remains deterministic."""

    def fallback() -> list[tuple[dict[str, Any], ResolvedTarget]]:
        # An ambiguous request must not silently become an existing-item rewrite.
        return [
            (
                {
                    **row,
                    "_interpreted_outcome": (
                        outcome
                        if (outcome := _classify_outcome(row.get("comment", ""))) != "edit"
                        else "unresolved"
                    ),
                },
                target,
            )
            for row, target in resolvable
        ]

    if llm is None or not resolvable:
        return fallback()
    days, _ = _index_itinerary(base_itinerary)
    requests = []
    for row, target in resolvable:
        requests.append(
            f"feedback_id: {row['id']}\nrequested day: {target.day}\n"
            f"target item: {target.item_id or 'whole day'}\n"
            f"feedback: {clip_text(row.get('comment'), MAX_COMMENT_PROMPT_CHARS)}\n"
            "existing activities: "
            + "; ".join(
                f"{item['id']}: {clip_text(item.get('title'), MAX_TITLE_CHARS)}"
                for item in days[target.day]["items"]
            )
        )
    try:
        batch = await llm.generate_structured(
            operation="refinement_intent",
            system_prompt=(
                f"{UNTRUSTED_INPUT_GUARD}\n\n"
                "Interpret the meaning of each travel itinerary feedback request in context. "
                "Return its feedback_id unchanged and exactly one outcome: add means a NEW "
                "separate activity row; edit means revise or replace an existing activity; "
                "remove means delete an existing activity; retain means keep it unchanged. "
                "Do not require specific keywords or perfect spelling. 'Extra activity after "
                "dinner', 'something fun after we eat', 'a club to visit near dinner' and "
                "'dinner before the show' request separate activities, so use add. "
                "'Make dinner a bar lunch instead' is edit. Never interpret a request for "
                "another activity as combining it with an existing activity. "
                "Set addition_count to the number of new activity rows requested, default one. "
                "Do not treat a number of venues inside one activity as a number of rows."
            ),
            user_prompt="\n\n".join(requests),
            response_model=_FeedbackIntentBatch,
        )
        batch = _FeedbackIntentBatch.model_validate(batch)
        by_id = {entry.feedback_id: entry for entry in batch.intents}
        expected = {row["id"] for row, _ in resolvable}
        if len(by_id) != len(batch.intents) or set(by_id) != expected:
            raise ValueError("intent response must cover exactly the requested feedback")
    except Exception:
        logger.info("Feedback interpretation unavailable; using fallback classification")
        return fallback()
    return [
        (
            {
                **row,
                "_interpreted_outcome": by_id[row["id"]].outcome,
                "_addition_count": by_id[row["id"]].addition_count,
            },
            target,
        )
        for row, target in resolvable
    ]


def detect_conflicts(
    resolvable: list[tuple[dict[str, Any], ResolvedTarget]],
) -> list[dict[str, Any]]:
    """Detect incompatible outcomes requested for the same day/item.

    Deterministic and non-LLM (Requirement 10.9): grouping is by exact target
    equality, classification is a fixed keyword scan, and the input order
    (creation-time ascending) is itself deterministic — so the same open
    `feedback` rows always yield the same conflict set.

    A conflict is removal versus retention of the same target, or two or more
    distinctly-worded "edit" requests for the same target (Requirement 10.8).

    Returns:
        One entry per conflicting target, sorted for a stable return order:
        ``{"day": int, "item_id": str | None, "feedback_ids": [...],
        "outcomes": [...]}``.
    """
    grouped: dict[tuple[int, str | None], list[tuple[dict[str, Any], str]]] = {}
    for row, resolved in resolvable:
        key = (resolved.day, resolved.item_id)
        grouped.setdefault(key, []).append((row, _feedback_outcome(row)))

    conflicts: list[dict[str, Any]] = []
    for (day, item_id), entries in grouped.items():
        if len(entries) < 2:
            continue
        outcomes = {outcome for _row, outcome in entries}
        edit_texts = {
            row.get("comment", "").strip() for row, outcome in entries if outcome in {"edit", "add"}
        }
        is_conflict = (
            ("remove" in outcomes and "retain" in outcomes)
            or ("remove" in outcomes and bool(outcomes & {"edit", "add"}))
            or len(edit_texts) > 1
        )
        if not is_conflict:
            continue
        conflicts.append(
            {
                "day": day,
                "item_id": item_id,
                "feedback_ids": sorted(row["id"] for row, _outcome in entries),
                "outcomes": sorted(outcomes),
            }
        )

    conflicts.sort(key=lambda c: (c["day"], c["item_id"] or ""))
    return conflicts


def _winning_feedback(
    resolvable: list[tuple[dict[str, Any], ResolvedTarget]],
    conflicts: list[dict[str, Any]],
) -> dict[tuple[int, str | None], dict[str, Any]]:
    """Pick the one feedback row whose outcome is actually applied per target.

    For a conflicting target, the oldest row (resolvable rows arrive in
    creation-time order) wins — deterministic, and favors the party member
    who raised the issue first. The losing rows stay open; their requested
    change was not reflected (Requirement 10.6-10.7).
    """
    conflict_keys = {(c["day"], c["item_id"]) for c in conflicts}
    grouped: dict[tuple[int, str | None], list[dict[str, Any]]] = {}
    for row, resolved in resolvable:
        grouped.setdefault((resolved.day, resolved.item_id), []).append(row)

    winners: dict[tuple[int, str | None], dict[str, Any]] = {}
    for key, rows in grouped.items():
        winners[key] = rows[0] if key in conflict_keys else rows[-1]
    return winners


# ---------------------------------------------------------------------------
# Regeneration (Requirement 10.3, 10.6)
# ---------------------------------------------------------------------------


def _apply_outcome(
    item: dict[str, Any],
    outcome: str,
    comment: str,
    revision: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Apply one winning outcome to an item.

    Returns the (possibly updated) item, or ``None`` to drop it. For "edit",
    ``revision`` is the LLM's validated rewrite when one exists; without it the
    comment is appended to the description as a note, so an edit is never lost
    just because the model was unavailable.
    """
    if outcome == "remove":
        return None
    if outcome == "retain":
        return item
    if revision is not None:
        updated = {**item, **revision}
        if revision.get("location") != item.get("location"):
            # A changed place no longer matches the places-tool entry it came from.
            updated["location_id"] = None
        return updated
    note = comment.strip()
    if not note:
        return item
    updated = dict(item)
    existing = (item.get("description") or "").strip()
    updated["description"] = f"{existing} (Updated per feedback: {note})".strip()
    return updated


def regenerate_affected_only(
    base_itinerary: dict[str, Any],
    affected_scope: dict[str, Any],
    resolvable: list[tuple[dict[str, Any], ResolvedTarget]],
    conflicts: list[dict[str, Any]],
    revisions: dict[str, dict[str, Any]] | None = None,
    additions: dict[str, list[dict[str, Any]]] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    """Build the new itinerary dict, touching only the Affected_Scope.

    Every day outside the scope is carried forward as the exact same object
    (Requirement 10.3). Within an affected day, only the item directly named
    by a winning feedback row's target is changed; items in scope only because
    they are a time-slot neighbour or an adjacent item are carried forward
    unchanged — scope membership permits a change, it does not require one.

    Day-level edits are drafted with the whole day in scope. A day-level
    deletion without a replacement stays open: it cannot identify which item
    to delete. Deletions that would empty a day also stay open.

    Args:
        revisions: LLM-drafted rewrites keyed by item id, from
            :func:`draft_item_revisions`. Optional: an item without one falls
            back to the note-appending edit.
        additions: Validated new activities keyed by feedback id. Missing or
            inapplicable additions leave feedback open and existing items intact.

    Returns:
        ``(new_itinerary, addressed_feedback_ids)``.
    """
    winners = _winning_feedback(resolvable, conflicts)
    in_scope_days = affected_days(affected_scope)
    revisions = revisions or {}
    additions = additions or {}

    new_days: list[dict[str, Any]] = []
    addressed_ids: list[str] = []

    for day in base_itinerary.get("days") or []:
        day_num = int(day["day"])
        if day_num not in in_scope_days:
            new_days.append(day)
            continue

        new_items: list[dict[str, Any]] = []
        day_addressed_ids: list[str] = []
        for item in day.get("items") or []:
            winning_row = winners.get((day_num, item["id"])) or winners.get((day_num, None))
            if winning_row is None:
                new_items.append(item)
                continue
            outcome = _feedback_outcome(winning_row)
            if outcome in {"add", "unresolved"}:
                # Inserting an activity must never rewrite the anchor activity.
                new_items.append(item)
                continue
            if outcome == "remove" and winning_row is winners.get((day_num, None)):
                new_items.append(item)
                continue
            updated = _apply_outcome(
                item,
                outcome,
                winning_row.get("comment", ""),
                revisions.get(item["id"]),
            )
            if updated is not None:
                new_items.append(updated)
            day_addressed_ids.append(winning_row["id"])

        for (target_day, _item_id), row in winners.items():
            if target_day != day_num or _feedback_outcome(row) != "add":
                continue
            inserted = additions.get(row["id"], [])
            anchors = {item["id"] for item in new_items}
            if not inserted or len(new_items) + len(inserted) > 10:
                continue
            if any(entry["anchor_item_id"] not in anchors for entry in inserted):
                continue
            expanded: list[dict[str, Any]] = []
            for item in new_items:
                for placement in ("before", "after"):
                    if placement == "after":
                        expanded.append(item)
                    expanded.extend(
                        entry["item"]
                        for entry in sorted(inserted, key=lambda e: e["item"]["time"])
                        if entry["anchor_item_id"] == item["id"] and entry["placement"] == placement
                    )
            new_items = expanded
            day_addressed_ids.append(row["id"])

        if not new_items:
            # Never publish an invalid empty day or settle unapplied feedback.
            new_days.append(day)
            continue
        addressed_ids.extend(day_addressed_ids)

        new_days.append({**day, "items": new_items})

    return {**base_itinerary, "days": new_days}, list(dict.fromkeys(addressed_ids))


# ---------------------------------------------------------------------------
# LLM item revision
# ---------------------------------------------------------------------------


class _ItemRevision(BaseModel):
    """One revised item as drafted by the model. Lenient on length; trimmed in code."""

    model_config = ConfigDict(extra="forbid")

    item_id: str = Field(min_length=1, description="The id of the item being revised, unchanged.")
    title: str = Field(min_length=1, description="Revised short name of the activity.")
    time: str | None = Field(default=None, description="Start time, 24-hour HH:MM.")
    description: str = Field(default="", description="One or two sentences.")
    location: str | None = Field(default=None, description="Neighbourhood or venue name.")


class _RevisionBatch(BaseModel):
    """The model's answer: one revision per item it was asked about."""

    model_config = ConfigDict(extra="forbid")

    revisions: list[_ItemRevision] = Field(min_length=1)


class _ActivityAddition(BaseModel):
    """A separate new activity, positioned relative to an existing activity."""

    model_config = ConfigDict(extra="forbid")
    feedback_id: str
    anchor_item_id: str
    placement: str = Field(pattern="^(before|after)$")
    title: str = Field(min_length=1)
    time: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    description: str = Field(min_length=1)
    location: str | None = None


class _AdditionBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    additions: list[_ActivityAddition] = Field(max_length=10)


async def draft_activity_additions(
    llm: Any,
    base_itinerary: dict[str, Any],
    resolvable: list[tuple[dict[str, Any], ResolvedTarget]],
    conflicts: list[dict[str, Any]],
    hard_constraints: list[str],
) -> dict[str, list[dict[str, Any]]]:
    """Draft insertions separately from edits; failed additions remain open."""
    winners = _winning_feedback(resolvable, conflicts)
    days, _ = _index_itinerary(base_itinerary)
    requests = {
        row["id"]: (row, day, item_id)
        for (day, item_id), row in winners.items()
        if _feedback_outcome(row) == "add" and len(days[day]["items"]) < 10
    }
    if llm is None or not requests:
        return {}
    prompts = []
    for fid, (row, day, item_id) in requests.items():
        prompts.append(
            f"feedback_id: {fid}\nday: {day}\n"
            f"required anchor: {item_id or 'choose an existing activity on this day'}\n"
            f"feedback: {clip_text(row.get('comment'), MAX_COMMENT_PROMPT_CHARS)}\n"
            "existing activities:\n"
            + "\n".join(
                f"{item['id']}: {clip_text(item.get('title'), MAX_TITLE_CHARS)} "
                f"at {clip_text(item.get('time'), MAX_TIME_CHARS)}; "
                f"{clip_text(item.get('description'), MAX_DESCRIPTION_CHARS)}"
                for item in days[day]["items"]
            )
        )
    try:
        batch = await llm.generate_structured(
            operation="itinerary_addition",
            system_prompt=(
                f"{UNTRUSTED_INPUT_GUARD}\n\n"
                "Add separate activity rows requested by the party. Never combine the new "
                "activity with an existing activity or rewrite the existing activities. "
                "For each request return one new activity unless an explicit count asks for more. "
                "Each must have its own title, HH:MM time, description and location. "
                "Use feedback_id exactly as given and an existing anchor_item_id from that day. "
                "Respect before/after ordering and choose a time that fits between adjacent "
                "activities. Keep the day at no more than 10 activities. "
                "Never state prices, opening hours or booking details. "
                f"Hard constraints: {clip_for_prompt(hard_constraints)}"
            ),
            user_prompt="\n\n".join(prompts),
            response_model=_AdditionBatch,
        )
        # Validate even test doubles or SDK responses before applying any insertion.
        batch = _AdditionBatch.model_validate(batch)
    except Exception:
        logger.info("Activity additions unavailable; leaving addition feedback open")
        return {}

    grouped: dict[str, list[_ActivityAddition]] = {}
    for entry in batch.additions:
        if entry.feedback_id in requests:
            grouped.setdefault(entry.feedback_id, []).append(entry)
    accepted: dict[str, list[dict[str, Any]]] = {}
    existing_ids = {item["id"] for day in days.values() for item in day["items"]}
    for fid, entries in grouped.items():
        row, day, item_id = requests[fid]
        items = days[day]["items"]
        anchors = {item["id"]: index for index, item in enumerate(items)}
        comment = row.get("comment", "").lower()
        count_match = re.search(
            r"\b(?:add|insert|include|schedule)\s+(\d+|one|two|three)\b", comment
        )
        count_text = count_match.group(1) if count_match else "1"
        count = {"one": 1, "two": 2, "three": 3}.get(count_text)
        if count is None:
            count = int(count_text)
        count = row.get("_addition_count", count)
        if len(entries) != count or len(items) + len(entries) > 10:
            continue
        prepared = []
        for index, entry in enumerate(entries):
            if entry.anchor_item_id not in anchors or (item_id and entry.anchor_item_id != item_id):
                break
            directions = set(re.findall(r"\b(before|after)\b", comment))
            if len(directions) == 1 and entry.placement not in directions:
                break
            anchor_index = anchors[entry.anchor_item_id]
            gap = anchor_index if entry.placement == "before" else anchor_index + 1
            previous_time = items[gap - 1].get("time") if gap else None
            next_time = items[gap].get("time") if gap < len(items) else None
            valid_time = r"^(?:[01]\d|2[0-3]):[0-5]\d$"
            if (
                previous_time
                and re.fullmatch(valid_time, previous_time)
                and entry.time <= previous_time
            ):
                break
            if next_time and re.fullmatch(valid_time, next_time) and entry.time >= next_time:
                break
            title = clip_text(entry.title, MAX_TITLE_CHARS)
            description = clip_text(entry.description, MAX_DESCRIPTION_CHARS)
            location = clip_text(entry.location, MAX_LOCATION_CHARS)
            if not title or not description:
                break
            if _violates_hard_constraints(
                " ".join(filter(None, (title, description, location))), hard_constraints
            ):
                break
            new_id = f"d{day}-added-{uuid5(NAMESPACE_URL, f'{fid}:{index}').hex}"
            if new_id in existing_ids:
                break
            prepared.append(
                {
                    "anchor_item_id": entry.anchor_item_id,
                    "placement": entry.placement,
                    "item": {
                        "id": new_id,
                        "title": title,
                        "time": entry.time,
                        "description": description,
                        "location": location,
                        "location_id": None,
                        "tags": [],
                        "cost": None,
                    },
                }
            )
        else:
            accepted[fid] = prepared
    return accepted


def _items_needing_revision(
    base_itinerary: dict[str, Any],
    affected_scope: dict[str, Any],
    resolvable: list[tuple[dict[str, Any], ResolvedTarget]],
    conflicts: list[dict[str, Any]],
) -> list[tuple[dict[str, Any], str]]:
    """Return ``(item, comment)`` for each item whose winning outcome is an edit.

    Mirrors the selection :func:`regenerate_affected_only` makes, so the model is
    asked about exactly the items that function would otherwise only annotate.
    """
    winners = _winning_feedback(resolvable, conflicts)
    in_scope_days = affected_days(affected_scope)
    needing: list[tuple[dict[str, Any], str]] = []
    for day in base_itinerary.get("days") or []:
        if int(day["day"]) not in in_scope_days:
            continue
        day_feedback = winners.get((int(day["day"]), None))
        for item in day.get("items") or []:
            row = winners.get((int(day["day"]), item["id"])) or day_feedback
            if row is None:
                continue
            comment = row.get("comment", "")
            if _feedback_outcome(row) == "edit" and comment.strip():
                needing.append((item, comment))
    return needing


async def draft_item_revisions(
    llm: Any,
    base_itinerary: dict[str, Any],
    affected_scope: dict[str, Any],
    resolvable: list[tuple[dict[str, Any], ResolvedTarget]],
    conflicts: list[dict[str, Any]],
    hard_constraints: list[str],
) -> dict[str, dict[str, Any]]:
    """Ask the LLM to rewrite each item whose winning outcome is an edit.

    One call covers every such item. Returns validated field updates keyed by
    item id, containing only ``title``, ``time``, ``description`` and
    ``location`` — never an id or any other field. Never raises: on any failure,
    or for any revision that is unrequested, duplicated, malformed or breaks a
    hard constraint, the item is simply absent and falls back to the note edit.
    """
    if llm is None:
        return {}
    needing = _items_needing_revision(base_itinerary, affected_scope, resolvable, conflicts)
    if not needing:
        return {}

    entries = []
    for item, comment in needing:
        entries.append(
            f"requested day: {item['id'].split('-')[0].removeprefix('d')}\n"
            f"item_id: {item['id']}\n"
            f"current title: {clip_text(item.get('title'), MAX_TITLE_CHARS) or ''}\n"
            f"current time: {item.get('time') or 'not set'}\n"
            "current description: "
            f"{clip_text(item.get('description'), MAX_DESCRIPTION_CHARS) or 'not set'}\n"
            f"current location: {item.get('location') or 'not set'}\n"
            f"feedback: {clip_text(comment, MAX_COMMENT_PROMPT_CHARS) or ''}"
        )
    system_prompt = (
        f"{UNTRUSTED_INPUT_GUARD}\n\n"
        "You are an in-world NPC travel guide revising individual items of a group trip "
        "itinerary after party feedback. For each item below, return a revised version that "
        "reflects the feedback. Change only what the feedback asks for and keep the rest of "
        "the requested day coherent: day-level feedback applies to the activities on that "
        "day, while item-level feedback applies only to the named item. "
        "Keep unrelated fields of each item as they are. Return exactly one revision per item, "
        "repeating its item_id "
        "unchanged. Never state prices, opening hours or booking details, and never include "
        "anything that violates a stated hard constraint.\n"
        f"Hard constraints: {clip_for_prompt(hard_constraints)}"
    )
    try:
        batch = await llm.generate_structured(
            operation="itinerary_revision",
            system_prompt=system_prompt,
            user_prompt="Revise these items:\n\n" + "\n\n".join(entries),
            response_model=_RevisionBatch,
        )
        drafted = batch.revisions
    except LLMGenerationError:
        logger.info("LLM item revision unavailable; falling back to note edits")
        return {}
    except Exception:  # a malformed double or SDK surprise must not break REFINE
        logger.info("LLM item revision returned an unusable result; falling back to note edits")
        return {}

    originals = {item["id"]: item for item, _comment in needing}
    revisions: dict[str, dict[str, Any]] = {}
    for entry in drafted:
        original = originals.get(entry.item_id)
        if original is None or entry.item_id in revisions:
            continue
        title = clip_text(entry.title, MAX_TITLE_CHARS)
        if title is None:
            continue
        description = clip_text(entry.description, MAX_DESCRIPTION_CHARS)
        location = clip_text(entry.location, MAX_LOCATION_CHARS)
        searchable = " ".join(filter(None, (title, description, location)))
        if _violates_hard_constraints(searchable, hard_constraints) is not None:
            continue
        revisions[entry.item_id] = {
            "title": title,
            "time": clip_text(entry.time, MAX_TIME_CHARS) or original.get("time"),
            "description": description if description is not None else original.get("description"),
            "location": location if location is not None else original.get("location"),
        }
    return revisions


def build_change_summary(
    affected_scope: dict[str, Any],
    conflicts: list[dict[str, Any]],
) -> str:
    """Build a 1-500 character summary naming every affected day/item (Requirement 10.5)."""
    items_by_day = affected_scope.get("items") or {}
    parts = []
    for day in sorted(affected_days(affected_scope)):
        if items_by_day.get(day):
            parts.append(f"day {day}: items {', '.join(items_by_day[day])}")
        else:
            parts.append(f"day {day}")
    summary = f"Refined {'; '.join(parts)} per party feedback." if parts else "No changes applied."
    if conflicts:
        summary += f" Resolved {len(conflicts)} conflicting request(s)."
    return summary[:MAX_CHANGE_SUMMARY_LENGTH]


# ---------------------------------------------------------------------------
# Lost-race re-evaluation (Requirement 5.4)
# ---------------------------------------------------------------------------


def _affected_scope_content_differs(
    base_itinerary: dict[str, Any],
    refetched_itinerary: dict[str, Any],
    affected_scope: dict[str, Any],
) -> bool:
    """Return ``True`` if any day in scope differs between base and refetched."""
    base_days = {int(d["day"]): d for d in base_itinerary.get("days") or []}
    refetched_days = {int(d["day"]): d for d in refetched_itinerary.get("days") or []}
    return any(
        base_days.get(day_num) != refetched_days.get(day_num)
        for day_num in affected_days(affected_scope)
    )


async def _is_still_applicable(
    repos: RepositoryBundle,
    state: AgentState,
    affected_scope: dict[str, Any],
    resolvable: list[tuple[dict[str, Any], ResolvedTarget]],
    latest_row: dict[str, Any],
) -> bool:
    """Requirement 5.4: decide whether a lost race's proposal is still worth retrying.

    Inapplicable when any of: the Affected_Scope's content already differs
    from the base version in the re-fetched row (someone else already made
    this exact change); every feedback row this proposal addresses is already
    `addressed`; or either locked selection has changed since generation.
    """
    base_context = state.trip_context or {}
    base_itinerary = (base_context.get("latest_itinerary_version") or {}).get("itinerary") or {}
    refetched_itinerary = latest_row.get("itinerary") or {}
    if _affected_scope_content_differs(base_itinerary, refetched_itinerary, affected_scope):
        return False

    feedback_ids = {row["id"] for row, _resolved in resolvable}
    if feedback_ids:
        still_open = await repos.feedback_repo.list_open_by_trip(state.trip_id)
        still_open_ids = {row["id"] for row in still_open}
        if not (feedback_ids & still_open_ids):
            return False

    room_id = base_context.get("room_id")
    base_selections = base_context.get("selections") or {}
    if room_id is not None:
        current_rows = await repos.selection_repo.list_by_room(room_id)
        current_selections = {s["kind"]: s for s in current_rows}
        for kind in ("destination", "flight"):
            current_data = (current_selections.get(kind) or {}).get("data")
            base_data = (base_selections.get(kind) or {}).get("data")
            if current_data != base_data:
                return False

    return True


# ---------------------------------------------------------------------------
# The node
# ---------------------------------------------------------------------------


async def negotiation_node(state: AgentState, config: RunnableConfig) -> AgentState:
    """Negotiate open feedback into a new refined itinerary version.

    Raises:
        NoItineraryToRefineError: If the trip has no itinerary version at all
            (Requirement 10.12). No write happens on this path.
        RepeatedVersionContentionError: After a 3rd lost-race collision.
        ItineraryPersistenceError: If the insert fails for a non-contention
            reason.
        TripNotFoundError: If the trip does not exist.
        StagePreconditionNotMetError: If the room is closed or past this stage.
    """
    repos: RepositoryBundle = config["configurable"]["repos"]

    context = await _load_context(state, repos)
    state = state.with_trip_context(context)

    base_version = context["latest_itinerary_version"]
    if base_version is None:
        raise NoItineraryToRefineError()

    open_feedback = context["open_feedback"]
    if not open_feedback:
        await emit_npc_message(
            repos,
            state.trip_id,
            "text",
            TextMessageContent(text="There is no outstanding feedback to negotiate.", stage=STAGE),
        )
        return state

    state = state.with_base_version(int(base_version["version"]))
    base_itinerary = base_version["itinerary"]
    resolvable, unresolvable = partition_by_target_resolution(open_feedback, base_itinerary)

    if unresolvable:
        await emit_npc_message(
            repos,
            state.trip_id,
            "text",
            TextMessageContent(
                text=(
                    f"{len(unresolvable)} piece(s) of feedback referenced a part of the "
                    "plan the guide could not locate."
                ),
                stage=STAGE,
            ),
        )

    if not resolvable:
        return state

    await report_phase(repos, state, "weighing_feedback")
    await report_phase(repos, state, "asking_guide")
    resolvable = await interpret_feedback(repos.llm, base_itinerary, resolvable)
    affected_scope = compute_affected_scope(resolvable, base_itinerary)
    conflicts = detect_conflicts(resolvable)
    await report_phase(repos, state, "asking_guide")
    revisions = await draft_item_revisions(
        repos.llm,
        base_itinerary,
        affected_scope,
        resolvable,
        conflicts,
        _hard_constraints(context.get("preferences") or []),
    )
    additions = await draft_activity_additions(
        repos.llm,
        base_itinerary,
        resolvable,
        conflicts,
        _hard_constraints(context.get("preferences") or []),
    )
    await report_phase(repos, state, "checking_answer")
    new_itinerary_dict, addressed_ids = regenerate_affected_only(
        base_itinerary, affected_scope, resolvable, conflicts, revisions, additions
    )
    change_summary = build_change_summary(affected_scope, conflicts)

    proposal = RefinementProposal(
        itinerary=ItineraryModel(**new_itinerary_dict),
        change_summary=change_summary,
        addressed_feedback_ids=addressed_ids,
        unresolved_feedback_ids=[
            row["id"] for row in open_feedback if row["id"] not in addressed_ids
        ],
        affected_scope=affected_scope,
        conflicts=conflicts,
    )
    state = state.with_proposal(proposal.model_dump(mode="json"))

    async def _applicable(latest_row: dict[str, Any]) -> bool:
        return await _is_still_applicable(repos, state, affected_scope, resolvable, latest_row)

    await report_phase(repos, state, "posting")
    row, state = await persist_itinerary_version(
        state,
        repos,
        proposal.to_persistable(),
        source="refine",
        change_summary=change_summary,
        is_still_applicable=_applicable,
    )

    if row is None:
        # Requirement 5.6: the party's plan already moved on.
        await emit_npc_message(
            repos,
            state.trip_id,
            "text",
            TextMessageContent(
                text="The party's plan already moved on, so this attempt made no changes.",
                stage=STAGE,
            ),
        )
        return state

    if addressed_ids:
        await repos.feedback_repo.mark_addressed(addressed_ids)

    if conflicts:
        await emit_npc_message(
            repos,
            state.trip_id,
            "summary",
            SummaryMessageContent(
                title="A compromise on the plan",
                text="The party's feedback included conflicting requests; here is the compromise.",
                stage=STAGE,
                details={"conflicts": conflicts},
            ),
        )

    still_open_targets = [
        row["target"] for row, _resolved in resolvable if row["id"] not in addressed_ids
    ] + [row["target"] for row in unresolvable]
    if still_open_targets:
        await emit_npc_message(
            repos,
            state.trip_id,
            "summary",
            SummaryMessageContent(
                title="Some feedback remains open",
                text=f"{len(still_open_targets)} piece(s) of feedback are still open.",
                stage=STAGE,
                details={"still_open_targets": still_open_targets},
            ),
        )

    await advance_trip_status(
        repos, state.trip_id, "refinement_completed", context["trip"]["status"]
    )

    return state


def _hard_constraints(preferences: list[dict[str, Any]]) -> list[str]:
    """Collect the party's hard constraints (as text) from its preference rows."""
    return [
        str(constraint) for row in preferences for constraint in (row.get("hard_constraints") or [])
    ]


async def _load_context(state: AgentState, repos: RepositoryBundle) -> dict[str, Any]:
    """Re-fetch the trip context fresh (Requirement 6.1-6.3)."""
    from app.agents.state import load_trip_context

    return await load_trip_context(repos, state.trip_id, state.run_type)
