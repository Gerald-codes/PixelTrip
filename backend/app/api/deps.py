"""FastAPI dependency providers.

This is the single place repositories and services are constructed. Two
consequences that the layering rules depend on:

* Routes and services never import the Supabase client — they declare a
  repository dependency and receive a ready instance.
* Tests override any provider through ``app.dependency_overrides`` without
  touching production wiring.

Spec 03 extends this module with the eight agent-layer repository providers and
the agent services; the pattern below is what those follow.

Two deliberate style choices, both load-bearing:

1. Dependencies are declared with ``Annotated[T, Depends(...)]`` rather than
   ``t: T = Depends(...)``. The latter trips ruff's ``B008`` (function call in an
   argument default) and is the older FastAPI idiom; ``Annotated`` is equivalent
   and lint-clean.
2. ``AsyncClient`` is imported at runtime, not under ``TYPE_CHECKING``. Because
   this module uses ``from __future__ import annotations``, every annotation is a
   string, and FastAPI resolves them via ``get_type_hints`` at startup — a
   type only available to the type checker would raise ``NameError`` there.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from supabase import AsyncClient

from app.agents.llm import LLMClient
from app.agents.state import RepositoryBundle
from app.db.supabase_client import create_supabase_client
from app.repositories.agent_run_repository import AgentRunRepository
from app.repositories.feedback_repository import FeedbackRepository
from app.repositories.itinerary_version_repository import ItineraryVersionRepository
from app.repositories.member_repository import MemberRepository
from app.repositories.message_repository import MessageRepository
from app.repositories.profile_repository import ProfileRepository
from app.repositories.room_repository import RoomRepository
from app.repositories.selection_repository import SelectionRepository
from app.repositories.trip_repository import TripRepository
from app.repositories.vote_repository import VoteRepository
from app.repositories.vote_session_repository import VoteSessionRepository
from app.services.agent_run_service import AgentRunService
from app.services.budget_service import BudgetService
from app.services.chat_service import ChatService
from app.services.export_service import ExportService
from app.services.itinerary_service import ItineraryService
from app.services.preference_service import PreferenceService
from app.services.refine_service import RefineService
from app.services.room_service import RoomService
from app.services.run_endpoint_service import RunEndpointService
from app.services.trip_dates_service import TripDatesService
from app.services.voting_endpoint_service import VotingEndpointService


async def get_supabase_client() -> AsyncClient:
    """Expose the client factory as a FastAPI dependency."""
    return await create_supabase_client()


#: Reusable alias so each provider below stays a single readable line.
SupabaseClient = Annotated[AsyncClient, Depends(get_supabase_client)]


# --- Spec 02 repositories (reused read-only by the agent layer) -------------


def get_member_repo(client: SupabaseClient) -> MemberRepository:
    """Provide a :class:`MemberRepository`."""
    return MemberRepository(client)


def get_profile_repo(client: SupabaseClient) -> ProfileRepository:
    """Provide a :class:`ProfileRepository`."""
    return ProfileRepository(client)


# --- Spec 03 agent-layer repositories ---------------------------------------


def get_trip_repo(client: SupabaseClient) -> TripRepository:
    """Provide a :class:`TripRepository`."""
    return TripRepository(client)


def get_room_repo(client: SupabaseClient) -> RoomRepository:
    """Provide a :class:`RoomRepository`."""
    return RoomRepository(client)


def get_message_repo(client: SupabaseClient) -> MessageRepository:
    """Provide a :class:`MessageRepository`."""
    return MessageRepository(client)


def get_vote_session_repo(client: SupabaseClient) -> VoteSessionRepository:
    """Provide a :class:`VoteSessionRepository`."""
    return VoteSessionRepository(client)


def get_vote_repo(client: SupabaseClient) -> VoteRepository:
    """Provide a :class:`VoteRepository`."""
    return VoteRepository(client)


def get_selection_repo(client: SupabaseClient) -> SelectionRepository:
    """Provide a :class:`SelectionRepository`."""
    return SelectionRepository(client)


def get_itinerary_version_repo(client: SupabaseClient) -> ItineraryVersionRepository:
    """Provide an :class:`ItineraryVersionRepository`."""
    return ItineraryVersionRepository(client)


def get_feedback_repo(client: SupabaseClient) -> FeedbackRepository:
    """Provide a :class:`FeedbackRepository`."""
    return FeedbackRepository(client)


def get_agent_run_repo(client: SupabaseClient) -> AgentRunRepository:
    """Provide an :class:`AgentRunRepository`."""
    return AgentRunRepository(client)


# --- LLM client (spec 03) ------------------------------------------------------


@lru_cache
def _shared_llm_client() -> LLMClient:
    """Build the process-wide client once.

    Shared so its per-model cooldowns survive across requests: a model found
    out of quota stays skipped for a few minutes instead of being retried first
    on every single request.
    """
    return LLMClient()


def get_llm_client() -> LLMClient:
    """Provide the shared :class:`LLMClient` (models are built lazily on first use)."""
    return _shared_llm_client()


# --- Spec 03 agent-layer services --------------------------------------------


def get_agent_run_service(
    agent_run_repo: Annotated[AgentRunRepository, Depends(get_agent_run_repo)],
    trip_repo: Annotated[TripRepository, Depends(get_trip_repo)],
    room_repo: Annotated[RoomRepository, Depends(get_room_repo)],
    message_repo: Annotated[MessageRepository, Depends(get_message_repo)],
    member_repo: Annotated[MemberRepository, Depends(get_member_repo)],
    profile_repo: Annotated[ProfileRepository, Depends(get_profile_repo)],
    itinerary_version_repo: Annotated[
        ItineraryVersionRepository, Depends(get_itinerary_version_repo)
    ],
    selection_repo: Annotated[SelectionRepository, Depends(get_selection_repo)],
    feedback_repo: Annotated[FeedbackRepository, Depends(get_feedback_repo)],
    vote_session_repo: Annotated[VoteSessionRepository, Depends(get_vote_session_repo)],
    vote_repo: Annotated[VoteRepository, Depends(get_vote_repo)],
    llm_client: Annotated[LLMClient, Depends(get_llm_client)],
) -> AgentRunService:
    """Provide an :class:`AgentRunService` wired to every repository it needs."""
    return AgentRunService(
        agent_run_repo=agent_run_repo,
        trip_repo=trip_repo,
        room_repo=room_repo,
        message_repo=message_repo,
        member_repo=member_repo,
        profile_repo=profile_repo,
        itinerary_version_repo=itinerary_version_repo,
        selection_repo=selection_repo,
        feedback_repo=feedback_repo,
        vote_session_repo=vote_session_repo,
        vote_repo=vote_repo,
        llm_client=llm_client,
    )


# --- Room API service (spec 02) ----------------------------------------------


def get_room_service(
    room_repo: Annotated[RoomRepository, Depends(get_room_repo)],
    member_repo: Annotated[MemberRepository, Depends(get_member_repo)],
    profile_repo: Annotated[ProfileRepository, Depends(get_profile_repo)],
    trip_repo: Annotated[TripRepository, Depends(get_trip_repo)],
) -> RoomService:
    """Compose the room service from its repositories."""
    return RoomService(room_repo, member_repo, profile_repo, trip_repo)


# --- Week-1 planning endpoint services ---------------------------------------


def get_repository_bundle(
    agent_run_repo: Annotated[AgentRunRepository, Depends(get_agent_run_repo)],
    trip_repo: Annotated[TripRepository, Depends(get_trip_repo)],
    room_repo: Annotated[RoomRepository, Depends(get_room_repo)],
    message_repo: Annotated[MessageRepository, Depends(get_message_repo)],
    member_repo: Annotated[MemberRepository, Depends(get_member_repo)],
    profile_repo: Annotated[ProfileRepository, Depends(get_profile_repo)],
    itinerary_version_repo: Annotated[
        ItineraryVersionRepository, Depends(get_itinerary_version_repo)
    ],
    selection_repo: Annotated[SelectionRepository, Depends(get_selection_repo)],
    feedback_repo: Annotated[FeedbackRepository, Depends(get_feedback_repo)],
    vote_session_repo: Annotated[VoteSessionRepository, Depends(get_vote_session_repo)],
    vote_repo: Annotated[VoteRepository, Depends(get_vote_repo)],
    llm_client: Annotated[LLMClient, Depends(get_llm_client)],
) -> RepositoryBundle:
    """Provide the agent layer's bundle: all repositories on one client, plus the LLM."""
    return RepositoryBundle(
        trip_repo=trip_repo,
        room_repo=room_repo,
        message_repo=message_repo,
        vote_session_repo=vote_session_repo,
        vote_repo=vote_repo,
        selection_repo=selection_repo,
        itinerary_version_repo=itinerary_version_repo,
        feedback_repo=feedback_repo,
        agent_run_repo=agent_run_repo,
        member_repo=member_repo,
        profile_repo=profile_repo,
        llm=llm_client,
    )


Repos = Annotated[RepositoryBundle, Depends(get_repository_bundle)]


def get_preference_service(repos: Repos) -> PreferenceService:
    """Provide the :class:`PreferenceService`."""
    return PreferenceService(
        repos.room_repo, repos.member_repo, repos.profile_repo, repos.trip_repo
    )


def get_voting_endpoint_service(
    repos: Repos,
    run_service: Annotated[RunEndpointService, Depends(get_run_endpoint_service)],
) -> VotingEndpointService:
    """Provide the :class:`VotingEndpointService` (starts tiebreak runs on a tie)."""
    return VotingEndpointService(repos, run_service)


def get_run_endpoint_service(repos: Repos) -> RunEndpointService:
    """Provide the :class:`RunEndpointService` (agent runs started from HTTP)."""
    return RunEndpointService(
        agent_run_repo=repos.agent_run_repo,
        trip_repo=repos.trip_repo,
        room_repo=repos.room_repo,
        message_repo=repos.message_repo,
        member_repo=repos.member_repo,
        profile_repo=repos.profile_repo,
        itinerary_version_repo=repos.itinerary_version_repo,
        selection_repo=repos.selection_repo,
        feedback_repo=repos.feedback_repo,
        vote_session_repo=repos.vote_session_repo,
        vote_repo=repos.vote_repo,
        # Without this, runs started over HTTP would never call the model and
        # silently take every node's deterministic fallback.
        llm_client=repos.llm,
    )


def get_itinerary_service(repos: Repos) -> ItineraryService:
    """Provide the :class:`ItineraryService`."""
    return ItineraryService(repos.trip_repo, repos.itinerary_version_repo)


def get_refine_service(repos: Repos) -> RefineService:
    """Provide the :class:`RefineService` (feedback and approve/reject)."""
    return RefineService(repos)


def get_trip_dates_service(repos: Repos) -> TripDatesService:
    """Provide the :class:`TripDatesService`."""
    return TripDatesService(repos)


def get_budget_service(repos: Repos) -> BudgetService:
    """Provide the :class:`BudgetService`."""
    return BudgetService(repos)


def get_export_service(repos: Repos) -> ExportService:
    """Provide the :class:`ExportService`."""
    return ExportService(repos)


def get_chat_service(repos: Repos) -> ChatService:
    """Provide the :class:`ChatService`."""
    return ChatService(repos)
