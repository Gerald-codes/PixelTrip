"""HTTP-facing voting service.

Thin wrapper over the agent layer's ``vote_service`` (``cast_vote`` / ``close_session`` /
``break_tie``), which owns tallying, the tie hold, the selection write, and the trip
status advance. This class adds what an HTTP caller needs on top: a 404 for an unknown
session, a check that the chosen option belongs to the session, response shapes, and
starting the ``tiebreak`` advice run when a vote ties.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from app.exceptions import ValidationError, VoteSessionNotFoundError
from app.schemas.planning import CastVoteResponse, TieInfo, VoteResolutionResponse
from app.services.vote_service import VoteResolution, break_tie, cast_vote, close_session

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import RepositoryBundle
    from app.services.run_endpoint_service import RunEndpointService

#: How a route hands work to FastAPI's background tasks.
Schedule = Callable[[Callable[[], Awaitable[None]]], None]


class VotingEndpointService:
    """Casts, closes and tie-breaks votes for the vote endpoints."""

    def __init__(
        self, repos: RepositoryBundle, run_service: RunEndpointService | None = None
    ) -> None:
        self._repos = repos
        self._run_service = run_service

    async def cast(
        self,
        vote_session_id: str,
        member_id: str,
        option_id: str,
        schedule: Schedule | None = None,
    ) -> CastVoteResponse:
        """Record (or replace) the member's vote; resolves the session if everyone voted."""
        session = await self._require_session(vote_session_id)
        option_ids = [str(option.get("id")) for option in session.get("options") or []]
        if option_id not in option_ids:
            raise ValidationError("'optionId' is not one of this vote's options.")

        await cast_vote(self._repos, vote_session_id, member_id, option_id)

        after = await self._repos.vote_session_repo.get_by_id(vote_session_id) or session
        status = after.get("status", "open")
        tie_pending = bool(after.get("tie_pending"))
        if status == "open":
            # Voting is this member's part of the current stage (also while a tie waits
            # for the leader). When the vote instead closed (this was the last vote), the
            # party has moved to the next stage and readiness was reset for it, so the
            # member is not marked ready there.
            await self._repos.member_repo.set_stage_ready(member_id, True)
        if tie_pending:
            await self._start_tiebreak(after, member_id, schedule)
        return CastVoteResponse(
            vote_session_id=vote_session_id,
            member_id=member_id,
            option_id=option_id,
            session_status=status,
            tie_pending=tie_pending,
        )

    async def close(
        self, vote_session_id: str, member_id: str, schedule: Schedule | None = None
    ) -> VoteResolutionResponse:
        """Close the vote early (room owner only): lock the winner, or hold a tie."""
        await self._require_session(vote_session_id)
        resolution = await close_session(self._repos, vote_session_id, member_id)
        if resolution.tie_pending:
            await self._start_tiebreak(resolution.closed_session, member_id, schedule)
        return _to_response(vote_session_id, resolution)

    async def break_tie(
        self, vote_session_id: str, member_id: str, option_id: str
    ) -> VoteResolutionResponse:
        """The room owner picks the winner of a tied vote."""
        await self._require_session(vote_session_id)
        resolution = await break_tie(self._repos, vote_session_id, member_id, option_id)
        return _to_response(vote_session_id, resolution)

    async def _start_tiebreak(
        self, session: dict, member_id: str, schedule: Schedule | None
    ) -> None:
        """Start the ``tiebreak`` advice run for this session (once per session)."""
        if self._run_service is None:
            return
        trip = await self._repos.trip_repo.get_by_room_id(session["room_id"])
        if trip is None:
            return
        started = await self._run_service.start_run(
            trip["id"], "tiebreak", member_id, idempotency_key=f"tiebreak-{session['id']}"
        )
        if started.execute is not None and schedule is not None:
            schedule(started.execute)

    async def _require_session(self, vote_session_id: str) -> dict:
        session = await self._repos.vote_session_repo.get_by_id(vote_session_id)
        if session is None:
            raise VoteSessionNotFoundError("Vote session not found.")
        return session


def _to_response(vote_session_id: str, resolution: VoteResolution) -> VoteResolutionResponse:
    tie = resolution.tie
    return VoteResolutionResponse(
        vote_session_id=vote_session_id,
        category=resolution.category,
        tie_pending=resolution.tie_pending,
        winning_option=resolution.winning_option,
        tie=TieInfo(tied_option_ids=tie.tied_ids, tied_count=tie.tied_count) if tie else None,
        selection_id=(resolution.selection or {}).get("id"),
    )
