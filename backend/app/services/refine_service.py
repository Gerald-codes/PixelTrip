"""REFINE stage: members give feedback on the itinerary, and the owner approves or rejects.

The loop: an itinerary version is ``proposed`` -> members submit feedback (trip status
``feedback_collected``) -> someone starts a ``refinement`` AI run, which proposes a new
version (``refinement_completed``) -> repeat until the room owner approves a version,
which moves the trip to ``trip_approved`` (planning stage WRAP).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from app.agents.errors import TripNotFoundError, UnresolvedMemberError
from app.demo import is_demo, require_demo_pair
from app.demo.scenario import REFINEMENTS
from app.exceptions import (
    BackendError,
    ItineraryVersionNotFoundError,
    ValidationError,
    VersionNotProposedError,
)
from app.schemas.planning import (
    FeedbackSchema,
    ItineraryVersionSchema,
    ReviewItineraryRequest,
    ReviewItineraryResponse,
    SubmitFeedbackRequest,
    SubmitFeedbackResponse,
    VersionDecisionRequest,
    VersionDecisionResponse,
)
from app.schemas.room import TripSchema
from app.services.stage_helpers import produce_wrap_summary
from app.services.trip_progress import advance_trip

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import RepositoryBundle

logger = logging.getLogger(__name__)


class RefineService:
    """Feedback and approve/reject decisions on itinerary versions."""

    def __init__(self, repos: RepositoryBundle) -> None:
        self._repos = repos

    async def submit_feedback(
        self, trip_id: str, request: SubmitFeedbackRequest
    ) -> SubmitFeedbackResponse:
        """Record a member's feedback on the version under review."""
        trip = await self._require_trip(trip_id)
        member_id = str(request.member_id)
        await self._require_member_of(trip, member_id)
        version = await self._require_proposed_version(trip_id, str(request.itinerary_version_id))

        room = await self._repos.room_repo.get_by_id(trip["room_id"])
        demo = bool(room and is_demo(room))
        if demo:
            require_demo_pair(await self._repos.member_repo.list_by_room(trip["room_id"]))
            script = REFINEMENTS.get(request.comment)
            if (
                script is None
                or request.target.day != script[0]
                or request.target.item_id is not None
            ):
                raise ValidationError("Choose the prepared demo change for this day.")

        row = await self._repos.feedback_repo.create(
            trip_id=trip_id,
            itinerary_version_id=version["id"],
            member_id=member_id,
            # camelCase keys ({"day", "itemId", "section"}), as the refinement agent and
            # api-contracts.md expect.
            target=request.target.model_dump(by_alias=True, exclude_none=True),
            comment=request.comment,
        )
        # Giving feedback is this member's part of the current REFINE round.
        if not demo:
            await self._repos.member_repo.set_stage_ready(member_id, True)
        trip = await advance_trip(self._repos.trip_repo, trip, "feedback_collected")

        return SubmitFeedbackResponse(
            feedback=FeedbackSchema.model_validate(row), trip=TripSchema.model_validate(trip)
        )

    async def review(
        self, trip_id: str, version_id: str, request: ReviewItineraryRequest
    ) -> ReviewItineraryResponse:
        """Record a member's review and approve only after the whole party agrees."""
        trip = await self._require_trip(trip_id)
        member_id = str(request.member_id)
        await self._require_member_of(trip, member_id)
        version = await self._require_proposed_version(trip_id, version_id)

        room = await self._repos.room_repo.get_by_id(trip["room_id"])
        if room and is_demo(room):
            require_demo_pair(await self._repos.member_repo.list_by_room(trip["room_id"]))

        if request.decision == "refine":
            await self._repos.member_repo.set_stage_ready(member_id, True)
            members = await self._repos.member_repo.list_members_by_room(trip["room_id"])
            all_ready = bool(members) and all(bool(member.get("stage_ready")) for member in members)
            needs_refinement = bool(await self._repos.feedback_repo.list_open_by_trip(trip_id))
            return ReviewItineraryResponse(
                version=ItineraryVersionSchema.model_validate(version),
                trip=TripSchema.model_validate(trip),
                all_ready=all_ready,
                needs_refinement=all_ready and needs_refinement,
            )

        await self._repos.member_repo.set_stage_ready(member_id, True)
        members = await self._repos.member_repo.list_members_by_room(trip["room_id"])
        all_ready = bool(members) and all(bool(member.get("stage_ready")) for member in members)
        needs_refinement = bool(await self._repos.feedback_repo.list_open_by_trip(trip_id))
        if not all_ready:
            return ReviewItineraryResponse(
                version=ItineraryVersionSchema.model_validate(version),
                trip=TripSchema.model_validate(trip),
                all_ready=False,
                needs_refinement=False,
            )
        if needs_refinement:
            return ReviewItineraryResponse(
                version=ItineraryVersionSchema.model_validate(version),
                trip=TripSchema.model_validate(trip),
                all_ready=True,
                needs_refinement=True,
            )

        approved = await self._repos.itinerary_version_repo.mark_approved(version_id)
        trip = await advance_trip(self._repos.trip_repo, trip, "trip_approved")
        await self._announce_wrap(trip_id)
        return ReviewItineraryResponse(
            version=ItineraryVersionSchema.model_validate(approved),
            trip=TripSchema.model_validate(trip),
            all_ready=True,
            needs_refinement=False,
        )

    async def decide(
        self, trip_id: str, version_id: str, request: VersionDecisionRequest
    ) -> VersionDecisionResponse:
        """Approve or reject the version under review. Room owner only."""
        trip = await self._require_trip(trip_id)
        member_id = str(request.member_id)
        owner = await self._repos.member_repo.get_owner(trip["room_id"])
        if owner is None or owner.get("id") != member_id:
            raise UnresolvedMemberError(member_id)
        await self._require_proposed_version(trip_id, version_id)

        if request.decision == "reject":
            version = await self._repos.itinerary_version_repo.mark_rejected(version_id)
            return VersionDecisionResponse(
                version=ItineraryVersionSchema.model_validate(version),
                trip=TripSchema.model_validate(trip),
            )

        version = await self._repos.itinerary_version_repo.mark_approved(version_id)
        trip = await advance_trip(self._repos.trip_repo, trip, "trip_approved")
        await self._announce_wrap(trip_id)
        return VersionDecisionResponse(
            version=ItineraryVersionSchema.model_validate(version),
            trip=TripSchema.model_validate(trip),
        )

    async def _announce_wrap(self, trip_id: str) -> None:
        """Post the guide's final summary message. Best-effort: never undoes the approval."""
        try:
            await produce_wrap_summary(self._repos, trip_id)
        except BackendError as exc:
            logger.info("WRAP summary skipped for trip %s: %s", trip_id, type(exc).__name__)

    async def _require_trip(self, trip_id: str) -> dict[str, Any]:
        trip = await self._repos.trip_repo.get_by_id(trip_id)
        if trip is None:
            raise TripNotFoundError(trip_id)
        return trip

    async def _require_member_of(self, trip: dict[str, Any], member_id: str) -> None:
        member = await self._repos.member_repo.get_by_id(member_id)
        if member is None or member.get("room_id") != trip.get("room_id"):
            raise UnresolvedMemberError(member_id)

    async def _require_proposed_version(self, trip_id: str, version_id: str) -> dict[str, Any]:
        version = await self._repos.itinerary_version_repo.get_by_id(version_id)
        if version is None or version.get("trip_id") != trip_id:
            raise ItineraryVersionNotFoundError("Itinerary version not found.")
        if version.get("status") != "proposed":
            raise VersionNotProposedError(
                f"This version is {version.get('status')}; only the version under review "
                "can be commented on or decided."
            )
        return version
