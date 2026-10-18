"""Vote casting and resolution, including the leader-decided tiebreak.

A vote session is tallied by plain code (:func:`resolve_vote_session`):

* **A clear winner** locks automatically: the selection is written, the session closes,
  and the trip advances (``destination_selected`` / ``flight_selected``).
* **A tie** does not auto-pick. The session is marked ``tie_pending`` with the tied
  option ids, the party is told, and the room owner decides with
  :func:`break_tie` (``POST /votes/{id}/break-tie``). The HTTP layer also starts a
  ``tiebreak`` agent run that posts advice for the owner; that advice never decides.

Two independent triggers call into the tally:

* **Full participation** (:func:`on_vote_cast`, Requirement 17.11): every member
  still in the room has voted.
* **Owner-triggered early close** (:func:`close_session`, Requirement 17.12):
  the room's owner closes voting before everyone has responded, and resolution
  uses whatever is persisted at that moment.

Both funnel into the same :func:`resolve_vote_session`, and both the automatic winner
and the owner's tiebreak pick lock through the same :func:`_lock_winner`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from app.agents.errors import UnresolvedMemberError, VoteSessionClosedError
from app.agents.messages import SummaryMessageContent, build_message_row
from app.exceptions import ValidationError, VoteTiePendingError
from app.services.trip_status_service import advance_trip_status

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import RepositoryBundle

#: ``selections.kind`` a resolved vote locks in, keyed by the recommendation
#: category the vote session's linked message carried.
_KIND_BY_CATEGORY: dict[str, str] = {"destination": "destination", "flight": "flight"}

#: Requirement 17.4-17.5: the trip status set when each kind of selection locks in.
_STATUS_BY_KIND: dict[str, str] = {
    "destination": "destination_selected",
    "flight": "flight_selected",
}


@dataclass(frozen=True)
class TieNote:
    """Describes a tie the `Tiebreak_Flow` broke.

    Attributes:
        tied_ids: Every option id that held the highest count.
        tied_count: That shared highest count.
        winner_id: The option the `Option_Index_Rule` selected.
    """

    tied_ids: list[str]
    tied_count: int
    winner_id: str


@dataclass(frozen=True)
class VoteResolution:
    """The result of resolving one vote session.

    Attributes:
        winning_option: The ``{id, ...}`` option payload that won, or ``None`` while a
            tie is pending.
        category: ``"destination"`` or ``"flight"``.
        tie: The tie detail, or ``None`` when one option led outright. Also set on the
            resolution of a broken tie, to record what was tied.
        selection: The written ``selections`` row, or ``None`` while a tie is pending.
        closed_session: The closed ``vote_sessions`` row, or the still-open row while a
            tie is pending.
        tie_pending: ``True`` when the vote tied and now waits for the owner's pick.
    """

    winning_option: dict[str, Any] | None
    category: str
    tie: TieNote | None
    selection: dict[str, Any] | None
    closed_session: dict[str, Any]
    tie_pending: bool = False


def _resolve_category(vote_session: dict[str, Any], message: dict[str, Any] | None) -> str:
    """Resolve a session's category from its linked recommendation message.

    Category is not a column on ``vote_sessions``; it lives in the linked
    message's ``content.category``. Falls back to the session's own
    ``category`` key (set by callers that already know it, e.g. tests) so this
    does not hard-require a message round trip when the caller already has the
    answer.
    """
    content = (message or {}).get("content") or {}
    category = content.get("category") or vote_session.get("category")
    if category not in _KIND_BY_CATEGORY:
        raise ValueError(f"Could not resolve a vote session category from {vote_session!r}")
    return category


def pick_winner(
    counts: dict[str, int], options: list[dict[str, Any]]
) -> tuple[dict[str, Any], TieNote | None]:
    """Apply the `Option_Index_Rule` to a tally.

    Requirement 17.6-17.8: the winner is the option with the strictly highest
    count; a tie is broken by the lowest zero-based index in ``options``, using
    only the persisted array and the tally — no randomness, no clock, so
    re-running this over the same inputs always yields the same winner.

    Args:
        counts: ``{option_id: count}``, already restricted to eligible voters.
        options: The session's ``options`` array, in its persisted order.

    Returns:
        ``(winning_option, tie_note)``. ``tie_note`` is ``None`` unless two or
        more options shared the highest count.

    Raises:
        ValueError: If no option received any vote (an empty tally has no
            winner to pick).
    """
    if not counts:
        raise ValueError("cannot pick a winner from an empty tally")

    highest = max(counts.values())
    winners = [option_id for option_id, count in counts.items() if count == highest]
    ordered_ids = [opt["id"] for opt in options]
    winning_id = min(winners, key=ordered_ids.index)
    winning_option = next(opt for opt in options if opt["id"] == winning_id)

    tie = (
        TieNote(tied_ids=winners, tied_count=highest, winner_id=winning_id)
        if len(winners) > 1
        else None
    )
    return winning_option, tie


def selection_data(
    winning_option: dict[str, Any], message: dict[str, Any] | None
) -> dict[str, Any]:
    """Build the locked selection's ``data``: the winning option plus its full details.

    Vote options carry only ``{id, label}``. The details later stages need — a
    destination's title, a flight's ``depart_at`` / ``return_at`` / price — live on the
    matching item of the linked recommendation message, so they are merged in here.
    ``meta`` fields come first so the option's own ``id`` and ``label`` always win.
    """
    items = ((message or {}).get("content") or {}).get("items") or []
    item = next((i for i in items if i.get("id") == winning_option.get("id")), None)
    if item is None:
        return dict(winning_option)
    data = dict(item.get("meta") or {})
    for key in ("title", "description", "imageUrl", "spriteKey"):
        if item.get(key) is not None:
            data[key] = item[key]
    data.update(winning_option)
    return data


async def resolve_vote_session(
    repos: RepositoryBundle,
    vote_session: dict[str, Any],
) -> VoteResolution:
    """Tally ``vote_session``: lock a clear winner, or put a tie on hold for the owner.

    The tally restricts counts to members still present in the room
    (Requirement 17.6), so a member who left after voting cannot decide the outcome.

    Args:
        repos: The repository bundle.
        vote_session: The session row to resolve. Must be ``status='open'`` and not
            already ``tie_pending``; callers confirm that before calling.

    Returns:
        A :class:`VoteResolution`. On a tie it has ``tie_pending=True`` and no
        selection: nothing is locked and the trip does not advance.
    """
    message = await _linked_message(repos, vote_session)
    category = _resolve_category(vote_session, message)

    members = await repos.member_repo.list_by_room(vote_session["room_id"])
    eligible_ids = [m["id"] for m in members]

    counts = await repos.vote_repo.count_by_option(vote_session["id"], eligible_ids)
    winning_option, tie = pick_winner(counts, vote_session["options"])

    if tie is not None:
        return await _defer_tie(repos, vote_session, category, tie)

    return await _lock_winner(repos, vote_session, message, category, winning_option, tie=None)


async def _linked_message(
    repos: RepositoryBundle, vote_session: dict[str, Any]
) -> dict[str, Any] | None:
    if not vote_session.get("message_id"):
        return None
    return await repos.message_repo.get_by_id(vote_session["message_id"])


async def _defer_tie(
    repos: RepositoryBundle,
    vote_session: dict[str, Any],
    category: str,
    tie: TieNote,
) -> VoteResolution:
    """Hold a tied session for the owner's pick and tell the party.

    The ``tiebreak`` agent run (started by the HTTP layer) follows up with advice.
    """
    session = await repos.vote_session_repo.mark_tie_pending(
        vote_session["id"], tie.tied_ids, category
    )
    labels = {opt["id"]: opt.get("label") or opt["id"] for opt in vote_session["options"]}
    tied = " and ".join(labels.get(option_id, option_id) for option_id in tie.tied_ids)
    content = SummaryMessageContent(
        title="It's a tie!",
        text=(
            f"The party is split between {tied}. The guide will weigh in, "
            "and the party leader will make the final call."
        ),
        details={
            "tie_pending": True,
            "vote_session_id": vote_session["id"],
            "tied_ids": tie.tied_ids,
            "tied_count": tie.tied_count,
            "category": category,
        },
    )
    await repos.message_repo.insert_turn(
        vote_session["room_id"], [build_message_row("summary", content)]
    )
    return VoteResolution(
        winning_option=None,
        category=category,
        tie=tie,
        selection=None,
        closed_session=session,
        tie_pending=True,
    )


async def _lock_winner(
    repos: RepositoryBundle,
    vote_session: dict[str, Any],
    message: dict[str, Any] | None,
    category: str,
    winning_option: dict[str, Any],
    tie: TieNote | None,
) -> VoteResolution:
    """Write the selection, close the session, and advance the trip.

    Shared by a clear majority and by the owner's tiebreak pick. The selection keeps
    the winning item's full details from the recommendation message.
    """
    kind = _KIND_BY_CATEGORY[category]
    selection = await repos.selection_repo.upsert(
        room_id=vote_session["room_id"],
        kind=kind,
        data=selection_data(winning_option, message),
        vote_session_id=vote_session["id"],
    )
    closed_session = await repos.vote_session_repo.close(vote_session["id"])

    trip = await repos.trip_repo.get_by_room_id(vote_session["room_id"])
    if trip is not None:
        await advance_trip_status(
            repos, trip["id"], _STATUS_BY_KIND[kind], trip.get("status", "trip_created")
        )

    return VoteResolution(
        winning_option=winning_option,
        category=category,
        tie=tie,
        selection=selection,
        closed_session=closed_session,
    )


async def cast_vote(
    repos: RepositoryBundle,
    vote_session_id: str,
    member_id: str,
    option_id: str,
) -> dict[str, Any]:
    """Record one member's vote, then resolve the session if everyone has voted.

    Rejects before any write when the session is already closed
    (Requirement 17.13) or when ``member_id`` does not resolve to a real
    ``room_members`` row (Requirement 22.2-22.3) — a forged id must never reach
    ``votes``.

    Args:
        repos: The repository bundle.
        vote_session_id: The session being voted on.
        member_id: The voting member's id, as resolved by the caller against
            the triggering identity — not trusted here without a lookup.
        option_id: The chosen option's id.

    Returns:
        The inserted ``votes`` row.

    Raises:
        VoteSessionClosedError: If the session is not open.
        UnresolvedMemberError: If ``member_id`` is not a real room member.
    """
    session = await repos.vote_session_repo.get_by_id(vote_session_id)
    if session is None or session.get("status") != "open":
        raise VoteSessionClosedError(vote_session_id)
    if session.get("tie_pending"):
        raise VoteTiePendingError("This vote is tied; the party leader is choosing the winner.")

    member = await repos.member_repo.get_by_id(member_id)
    if member is None or member.get("room_id") != session.get("room_id"):
        raise UnresolvedMemberError(member_id)

    vote = await repos.vote_repo.upsert(vote_session_id, member_id, option_id)

    members = await repos.member_repo.list_by_room(session["room_id"])
    voter_count = await repos.vote_repo.count_distinct_voters(
        vote_session_id, [m["id"] for m in members]
    )
    if members and voter_count == len(members):
        await resolve_vote_session(repos, session)

    return vote


async def close_session(
    repos: RepositoryBundle,
    vote_session_id: str,
    requesting_member_id: str,
) -> VoteResolution:
    """Resolve ``vote_session_id`` early, at the room owner's request.

    Resolution uses only the votes persisted at the moment of the call
    (Requirement 17.12) — it does not wait for remaining members.

    Args:
        repos: The repository bundle.
        vote_session_id: The session to close.
        requesting_member_id: The member requesting closure. Must be the room's
            owner.

    Returns:
        The resolution.

    Raises:
        VoteSessionClosedError: If the session is not open.
        UnresolvedMemberError: If the requester is not the room's owner.
    """
    session = await repos.vote_session_repo.get_by_id(vote_session_id)
    if session is None or session.get("status") != "open":
        raise VoteSessionClosedError(vote_session_id)
    if session.get("tie_pending"):
        raise VoteTiePendingError("This vote is tied; use break-tie to choose the winner.")

    owner = await repos.member_repo.get_owner(session["room_id"])
    if owner is None or owner.get("id") != requesting_member_id:
        raise UnresolvedMemberError(requesting_member_id)

    return await resolve_vote_session(repos, session)


async def break_tie(
    repos: RepositoryBundle,
    vote_session_id: str,
    requesting_member_id: str,
    option_id: str,
) -> VoteResolution:
    """The room owner picks the winner of a tied vote, which then locks as usual.

    Raises:
        VoteSessionClosedError: If the session is missing or already closed.
        ValidationError: If the session is not waiting for a tiebreak, or
            ``option_id`` is not one of the tied options.
        UnresolvedMemberError: If the requester is not the room's owner.
    """
    session = await repos.vote_session_repo.get_by_id(vote_session_id)
    if session is None or session.get("status") != "open":
        raise VoteSessionClosedError(vote_session_id)
    if not session.get("tie_pending"):
        raise ValidationError("This vote is not tied, so there is no tie to break.")

    owner = await repos.member_repo.get_owner(session["room_id"])
    if owner is None or owner.get("id") != requesting_member_id:
        raise UnresolvedMemberError(requesting_member_id)

    tied_ids = [str(option_id_) for option_id_ in session.get("tie_option_ids") or []]
    if option_id not in tied_ids:
        raise ValidationError("'optionId' is not one of the tied options.")
    winning_option = next(opt for opt in session["options"] if str(opt["id"]) == option_id)

    message = await _linked_message(repos, session)
    category = session.get("category") or _resolve_category(session, message)
    counts = await repos.vote_repo.count_by_option(
        vote_session_id, [m["id"] for m in await repos.member_repo.list_by_room(session["room_id"])]
    )
    tie = TieNote(
        tied_ids=tied_ids,
        tied_count=max(counts.values()) if counts else 0,
        winner_id=option_id,
    )
    await repos.vote_session_repo.clear_tie_pending(vote_session_id)
    resolution = await _lock_winner(repos, session, message, category, winning_option, tie)

    label = winning_option.get("label") or winning_option.get("title") or option_id
    content = SummaryMessageContent(
        title="The leader has decided",
        text=f"The party leader broke the tie: {label} it is!",
        details={
            "vote_session_id": vote_session_id,
            "tied_ids": tied_ids,
            "winner": option_id,
            "category": category,
        },
    )
    await repos.message_repo.insert_turn(
        session["room_id"], [build_message_row("summary", content)]
    )
    return resolution
