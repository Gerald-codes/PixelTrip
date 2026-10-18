"""Trip routes: start an AI run, check a run, and list itinerary versions.

An AI run can take a minute or more, so ``POST /trips/{trip_id}/runs`` returns the run
straight away (HTTP 202) and executes it in the background. Progress and results reach
the party as chat messages and itinerary versions over Realtime; ``GET /runs/{run_id}``
reports the run's status.
"""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status

from app.api.deps import (
    get_budget_service,
    get_export_service,
    get_itinerary_service,
    get_refine_service,
    get_run_endpoint_service,
    get_trip_dates_service,
)
from app.schemas.agent_run import AgentRunProgressSchema, AgentRunSchema
from app.schemas.errors import ErrorResponse
from app.schemas.planning import (
    ChangeTripDatesRequest,
    ItineraryVersionSchema,
    ReviewItineraryRequest,
    ReviewItineraryResponse,
    StartRunRequest,
    SubmitFeedbackRequest,
    SubmitFeedbackResponse,
    TripBudgetResponse,
    TripDatesResponse,
    TripExportResponse,
    VersionDecisionRequest,
    VersionDecisionResponse,
)
from app.services.budget_service import BudgetService
from app.services.export_service import ExportService
from app.services.itinerary_service import ItineraryService
from app.services.refine_service import RefineService
from app.services.run_endpoint_service import RunEndpointService
from app.services.trip_dates_service import TripDatesService

router = APIRouter(tags=["ai-runs"])

RunServiceDep = Annotated[RunEndpointService, Depends(get_run_endpoint_service)]
ItineraryServiceDep = Annotated[ItineraryService, Depends(get_itinerary_service)]


@router.post(
    "/trips/{trip_id}/runs",
    response_model=AgentRunSchema,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Start an AI run",
    description=(
        "Starts a `discovery`, `logistics`, `itinerary`, or `refinement` run and returns "
        "it immediately with status `pending`; the AI works in the background. If a run "
        "of this type is already in progress for the trip, or the same `idempotencyKey` "
        "was used before, that existing run is returned instead of starting another."
    ),
    responses={
        202: {"description": "Run accepted (new or existing)"},
        404: {"model": ErrorResponse, "description": "Trip not found"},
        409: {"model": ErrorResponse, "description": "Idempotency key used for another run"},
        422: {
            "model": ErrorResponse,
            "description": "Validation error, or the member is not in this trip's room",
        },
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def start_run(
    trip_id: UUID,
    body: StartRunRequest,
    background_tasks: BackgroundTasks,
    service: RunServiceDep,
) -> AgentRunSchema:
    """Start (or return the existing) AI run for this trip and run type."""
    started = await service.start_run(
        str(trip_id), body.run_type, str(body.member_id), body.idempotency_key
    )
    if started.execute is not None:
        background_tasks.add_task(started.execute)
    return started.run


@router.get(
    "/trips/{trip_id}/runs/latest",
    response_model=AgentRunProgressSchema | None,
    summary="The trip's latest AI run and its step",
    description="The most recent run for the trip (optionally of one `runType`), with "
    "its `status` and `phase`, the step it is on or failed on (`reading_party`, "
    "`asking_guide`, `searching_flights`, `checking_budget`, `checking_answer`, "
    "`drafting_days`, `weighing_feedback`, `weighing_options`, `posting`). `null` when "
    "the trip has no run yet. `elapsedSeconds` is how long it has been going. Poll it "
    "every few seconds while the guide is working.",
    responses={
        200: {"description": "The run, or null"},
        404: {"model": ErrorResponse, "description": "Trip not found"},
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def get_latest_run(
    trip_id: UUID,
    service: RunServiceDep,
    run_type: Annotated[
        Literal["discovery", "logistics", "itinerary", "refinement", "tiebreak"] | None,
        Query(alias="runType"),
    ] = None,
) -> AgentRunProgressSchema | None:
    """Return the trip's latest AI run."""
    return await service.get_latest_run(str(trip_id), run_type)


@router.get(
    "/runs/{run_id}",
    response_model=AgentRunSchema,
    summary="Get an AI run's status",
    description="Returns the run with its current status (`pending`, `running`, "
    "`completed`, or `failed`) and, when finished, `resultVersionId` or `error`.",
    responses={
        200: {"description": "The run"},
        404: {"model": ErrorResponse, "description": "Run not found"},
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def get_run(run_id: UUID, service: RunServiceDep) -> AgentRunSchema:
    """Return the AI run's current status."""
    return await service.get_run(str(run_id))


@router.get(
    "/trips/{trip_id}/itinerary/versions",
    response_model=list[ItineraryVersionSchema],
    summary="List itinerary versions",
    description="Every itinerary version for the trip, oldest first. The version under "
    "review is the latest `proposed` one; at most one is `approved`.",
    responses={
        200: {"description": "The versions (possibly empty)"},
        404: {"model": ErrorResponse, "description": "Trip not found"},
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def list_itinerary_versions(
    trip_id: UUID, service: ItineraryServiceDep
) -> list[ItineraryVersionSchema]:
    """List the trip's itinerary versions."""
    return await service.list_versions(str(trip_id))


# --- REFINE: feedback and approve/reject ------------------------------------------------

RefineServiceDep = Annotated[RefineService, Depends(get_refine_service)]
ExportServiceDep = Annotated[ExportService, Depends(get_export_service)]


@router.post(
    "/trips/{trip_id}/itinerary/versions/{version_id}/review",
    response_model=ReviewItineraryResponse,
    summary="Review an itinerary version",
    description=(
        "Records one member's approval of the proposed itinerary. The version is approved "
        "and the trip moves to WRAP only after every room member approves."
    ),
    responses={
        200: {"description": "Review recorded"},
        404: {"model": ErrorResponse, "description": "Trip or itinerary version not found"},
        409: {"model": ErrorResponse, "description": "Version is not under review"},
        422: {"model": ErrorResponse, "description": "Member is not in the room"},
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def review_itinerary(
    trip_id: UUID,
    version_id: UUID,
    body: ReviewItineraryRequest,
    service: RefineServiceDep,
) -> ReviewItineraryResponse:
    """Record a party member's approve/refine review."""
    return await service.review(str(trip_id), str(version_id), body)


@router.post(
    "/trips/{trip_id}/feedback",
    response_model=SubmitFeedbackResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Give feedback on the itinerary",
    description=(
        "A member comments on the itinerary version under review (the latest `proposed` "
        "one): the whole plan, a day, an activity, or a section. Marks the member ready "
        "for this round and moves the trip to `feedback_collected`. Start a `refinement` "
        "run to have the AI address open feedback."
    ),
    responses={
        201: {"description": "Feedback recorded"},
        404: {"model": ErrorResponse, "description": "Trip or itinerary version not found"},
        409: {"model": ErrorResponse, "description": "Version is not the one under review"},
        422: {
            "model": ErrorResponse,
            "description": "Validation error, or the member is not in this trip's room",
        },
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def submit_feedback(
    trip_id: UUID, body: SubmitFeedbackRequest, service: RefineServiceDep
) -> SubmitFeedbackResponse:
    """Record a member's feedback on the itinerary under review."""
    return await service.submit_feedback(str(trip_id), body)


@router.post(
    "/trips/{trip_id}/itinerary/versions/{version_id}/decision",
    response_model=VersionDecisionResponse,
    summary="Approve or reject an itinerary version (room owner only)",
    description=(
        "`approve` locks the version in, moves the trip to `trip_approved` (stage `wrap`) "
        "and posts the guide's final summary message. `reject` marks it rejected so the "
        "party can keep refining. Only the version under review can be decided."
    ),
    responses={
        200: {"description": "Decision recorded"},
        404: {"model": ErrorResponse, "description": "Trip or itinerary version not found"},
        409: {
            "model": ErrorResponse,
            "description": "Version not under review, or another version is already approved",
        },
        422: {"model": ErrorResponse, "description": "Validation error, or not the room owner"},
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def decide_version(
    trip_id: UUID,
    version_id: UUID,
    body: VersionDecisionRequest,
    service: RefineServiceDep,
) -> VersionDecisionResponse:
    """Approve or reject the itinerary version under review."""
    return await service.decide(str(trip_id), str(version_id), body)


# --- WRAP: export ---------------------------------------------------------------------


@router.post(
    "/trips/{trip_id}/export",
    response_model=TripExportResponse,
    summary="Get the final, shareable trip",
    description=(
        "Returns the approved itinerary with the locked destination, flight, and party. "
        "The first call moves the trip to `trip_exported`; calling again returns the same "
        "trip."
    ),
    responses={
        200: {"description": "The final trip"},
        404: {
            "model": ErrorResponse,
            "description": "Trip not found, or no itinerary has been approved yet",
        },
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def export_trip(trip_id: UUID, service: ExportServiceDep) -> TripExportResponse:
    """Return the final trip."""
    return await service.export(str(trip_id))


# --- Budget (sidebar card) --------------------------------------------------------------

BudgetServiceDep = Annotated[BudgetService, Depends(get_budget_service)]


@router.get(
    "/trips/{trip_id}/budget",
    response_model=TripBudgetResponse,
    summary="The party's trip budget",
    description="Per-person budget for the sidebar: the hard limit (lowest typed amount) "
    "or the budget level as a guide, what the trip is estimated to cost so far (stay, "
    "flight, activities), and what is left. Re-fetch after a vote locks a destination or "
    "flight, or when an itinerary version arrives.",
    responses={
        200: {"description": "The budget"},
        404: {"model": ErrorResponse, "description": "Trip not found"},
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def get_trip_budget(trip_id: UUID, service: BudgetServiceDep) -> TripBudgetResponse:
    """The trip's budget readout."""
    return await service.get(str(trip_id))


# --- Trip dates (sidebar card + change dialog) -------------------------------------------

TripDatesServiceDep = Annotated[TripDatesService, Depends(get_trip_dates_service)]


@router.get(
    "/trips/{trip_id}/trip-dates",
    response_model=TripDatesResponse,
    summary="The trip's length and dates",
    description="The chosen destination's trip plan, when the whole party is free, the "
    "allowed length, and whether the dates can still be changed.",
    responses={
        200: {"description": "The trip dates"},
        404: {"model": ErrorResponse, "description": "Trip not found"},
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def get_trip_dates(trip_id: UUID, service: TripDatesServiceDep) -> TripDatesResponse:
    """The trip's dates and what they may be changed to."""
    return await service.get(str(trip_id))


@router.put(
    "/trips/{trip_id}/trip-dates",
    response_model=TripDatesResponse,
    summary="Change the trip's length and dates (owner only)",
    description="The party leader sets how long the trip is and when it starts. The dates "
    "must fit inside when the whole party is free. Any open flight vote is closed, because "
    "its flights were for the old dates: start a new `logistics` run afterwards. Not "
    "allowed once a flight is locked.",
    responses={
        200: {"description": "The new trip dates"},
        404: {"model": ErrorResponse, "description": "Trip or destination not found"},
        409: {"model": ErrorResponse, "description": "A flight is already locked"},
        422: {"model": ErrorResponse, "description": "Not the owner, or dates do not fit"},
        503: {"model": ErrorResponse, "description": "Database unavailable"},
    },
)
async def change_trip_dates(
    trip_id: UUID, body: ChangeTripDatesRequest, service: TripDatesServiceDep
) -> TripDatesResponse:
    """Set the trip's dates (party leader only)."""
    return await service.change(str(trip_id), body)
