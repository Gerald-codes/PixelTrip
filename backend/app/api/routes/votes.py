"""Vote routes: cast a vote, close a vote early, and break a tie (room owner).

Vote sessions are opened by the AI (discovery and logistics runs), not by an endpoint.
A session closes on its own once every member has voted. If the vote ties, it stays open
with ``tie_pending``, a ``tiebreak`` AI run posts advice, and the owner picks the winner.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends

from app.api.deps import get_voting_endpoint_service
from app.schemas.errors import ErrorResponse
from app.schemas.planning import (
    BreakTieRequest,
    CastVoteRequest,
    CastVoteResponse,
    CloseVoteRequest,
    VoteResolutionResponse,
)
from app.services.voting_endpoint_service import VotingEndpointService

router = APIRouter(prefix="/votes", tags=["votes"])

VotingServiceDep = Annotated[VotingEndpointService, Depends(get_voting_endpoint_service)]

_ERRORS = {
    404: {"model": ErrorResponse, "description": "Vote session not found"},
    422: {
        "model": ErrorResponse,
        "description": "Validation error, vote already closed, or member not allowed",
    },
    503: {"model": ErrorResponse, "description": "Database unavailable"},
}


@router.post(
    "/{vote_session_id}/cast",
    response_model=CastVoteResponse,
    summary="Cast or change a vote",
    description=(
        "Records the member's choice; voting again replaces it. When this is the last "
        "member to vote, the session closes, the winner is locked in as the destination "
        "or flight, and the trip advances (`sessionStatus` is then `closed`). If the "
        "last vote creates a tie, the session stays open with `tiePending: true`, the AI "
        "posts advice, and the room owner picks the winner with `break-tie`."
    ),
    responses={200: {"description": "Vote recorded"}, **_ERRORS},
)
async def cast_vote(
    vote_session_id: UUID,
    body: CastVoteRequest,
    background_tasks: BackgroundTasks,
    service: VotingServiceDep,
) -> CastVoteResponse:
    """Cast or change a member's vote."""
    return await service.cast(
        str(vote_session_id),
        str(body.member_id),
        body.option_id,
        schedule=background_tasks.add_task,
    )


@router.post(
    "/{vote_session_id}/close",
    response_model=VoteResolutionResponse,
    summary="Close a vote early (room owner only)",
    description=(
        "Closes the vote with the votes cast so far and locks in the winner. Ties go "
        "to the option listed first. Only the room owner may close a vote."
    ),
    responses={200: {"description": "Vote closed and winner locked in"}, **_ERRORS},
)
async def close_vote(
    vote_session_id: UUID,
    body: CloseVoteRequest,
    background_tasks: BackgroundTasks,
    service: VotingServiceDep,
) -> VoteResolutionResponse:
    """Close the vote and lock in the winner (or hold a tie for the owner)."""
    return await service.close(
        str(vote_session_id), str(body.member_id), schedule=background_tasks.add_task
    )


@router.post(
    "/{vote_session_id}/break-tie",
    response_model=VoteResolutionResponse,
    summary="Break a tied vote (room owner only)",
    description=(
        "When a destination or flight vote ties, the session waits with `tiePending: true` "
        "and the AI guide posts advice. The room owner picks one of the tied options here; "
        "it locks in exactly like a normal winner and the trip advances."
    ),
    responses={
        200: {"description": "Tie broken and winner locked in"},
        404: {"model": ErrorResponse, "description": "Vote session not found"},
        422: {
            "model": ErrorResponse,
            "description": "Vote closed, not tied, option not tied, or not the room owner",
        },
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def break_tie(
    vote_session_id: UUID,
    body: BreakTieRequest,
    service: VotingServiceDep,
) -> VoteResolutionResponse:
    """Pick the winner of a tied vote."""
    return await service.break_tie(str(vote_session_id), str(body.member_id), body.option_id)
