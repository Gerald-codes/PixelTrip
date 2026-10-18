"""Development-only routes for testing the AI agents by hand.

Mounted by ``app/main.py`` **only** when ``ENABLE_DEV_ENDPOINTS`` is true; with the
default settings these routes do not exist (a request gets a plain 404). They cover
the two inputs an agent run needs that no real endpoint provides yet:

* a locked flight, because the logistics run that normally produces it needs a paid
  flight-search API key;
* feedback on an itinerary, because there is no endpoint for members to submit it.

It also exposes the most recent LLM calls (``GET /dev/llm-calls``): the exact
prompts sent and the parsed replies, for tuning prompts. These are held in memory
only while dev endpoints are on, and are never logged or stored.

Both write through the same repositories the agent layer reads from, so a run
started afterwards sees them exactly as it would see real data.
"""

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Path
from pydantic import Field, model_validator

from app.api.deps import Repos
from app.core.llm_debug import RECENT_CALLS
from app.exceptions import NotFoundError
from app.schemas.errors import ErrorResponse
from app.schemas.room import _Base

router = APIRouter(prefix="/dev", tags=["dev (testing only)"])

TripId = Annotated[UUID, Path(description="The trip to write to.")]


class TestFlightRequest(_Base):
    """A made-up flight to lock for the trip's room."""

    # Not a pytest test class, despite the name.
    __test__ = False

    depart_at: datetime = Field(examples=["2026-12-20T08:00:00"])
    return_at: datetime = Field(examples=["2026-12-24T20:00:00"])
    label: str = Field(default="Test flight", min_length=1, max_length=100)

    @model_validator(mode="after")
    def _return_after_departure(self) -> "TestFlightRequest":
        if self.return_at < self.depart_at:
            raise ValueError("'returnAt' must not be before 'departAt'")
        return self


class TestFeedbackRequest(_Base):
    """A member's comment on one item (or a whole day) of an itinerary version."""

    __test__ = False

    member_id: UUID
    itinerary_version_id: UUID
    comment: str = Field(min_length=1, max_length=1000)
    item_id: str | None = Field(default=None, min_length=1, max_length=100)
    day: int | None = Field(default=None, ge=1, le=60)

    @model_validator(mode="after")
    def _exactly_one_target(self) -> "TestFeedbackRequest":
        if (self.item_id is None) == (self.day is None):
            raise ValueError("send exactly one of 'itemId' or 'day'")
        return self


@router.post(
    "/trips/{trip_id}/test-flight",
    summary="Lock a made-up flight (testing only)",
    description="Sets the room's flight selection directly so an itinerary run can start "
    "without a real flight search.",
    responses={404: {"model": ErrorResponse, "description": "Trip not found"}},
)
async def lock_test_flight(
    trip_id: TripId, body: TestFlightRequest, repos: Repos
) -> dict[str, str]:
    """Lock a test flight for the trip's room."""
    room_id = await repos.trip_repo.get_room_id_for_trip(str(trip_id))
    if room_id is None:
        raise NotFoundError("Trip not found.")
    selection = await repos.selection_repo.upsert(
        room_id,
        "flight",
        {
            "label": body.label,
            "depart_at": body.depart_at.isoformat(),
            "return_at": body.return_at.isoformat(),
        },
    )
    return {"selectionId": str(selection["id"]), "roomId": room_id}


@router.post(
    "/trips/{trip_id}/feedback",
    summary="Add feedback to an itinerary version (testing only)",
    description="Creates an open feedback row for the next refinement run to act on.",
    responses={404: {"model": ErrorResponse, "description": "Trip not found"}},
)
async def add_test_feedback(
    trip_id: TripId, body: TestFeedbackRequest, repos: Repos
) -> dict[str, str]:
    """Create an open feedback row on an itinerary version."""
    if await repos.trip_repo.get_by_id(str(trip_id)) is None:
        raise NotFoundError("Trip not found.")
    target: dict[str, object] = (
        {"itemId": body.item_id} if body.item_id is not None else {"day": body.day}
    )
    row = await repos.feedback_repo.create(
        str(trip_id),
        str(body.itinerary_version_id),
        str(body.member_id),
        target,
        body.comment,
    )
    return {"feedbackId": str(row["id"])}


@router.get(
    "/llm-calls",
    summary="The most recent LLM calls: exact prompts and replies (newest first)",
)
async def list_llm_calls(limit: int = 10) -> list[dict[str, Any]]:
    return [
        {
            "at": call["at"],
            "operation": call["operation"],
            "model": call["model"],
            "systemPrompt": call["system_prompt"],
            "userPrompt": call["user_prompt"],
            "response": call["response"],
            "error": call["error"],
        }
        for call in list(RECENT_CALLS)[: max(1, min(limit, 20))]
    ]
