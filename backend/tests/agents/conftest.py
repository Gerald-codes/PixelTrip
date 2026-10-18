"""Fixtures for the agent-layer test suite.

Two things live here:

1. **A network blocker.** An autouse fixture replaces ``socket.socket`` so any
   accidental outbound connection fails loudly instead of silently reaching a
   real service (Requirement 21.7, 21.11).
2. **A fake Supabase client.** Repository tests drive real query-builder chains
   (``.table().select().eq().limit().execute()``) against an in-memory recorder
   rather than asserting on a bare ``AsyncMock``. That catches a wrong column,
   a missing filter, or a wrong table name — all of which a loose mock would
   happily accept.
"""

from __future__ import annotations

import socket
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.agents.errors import LLMGenerationError
from app.agents.llm import LLMClient
from app.agents.state import RepositoryBundle
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

# ---------------------------------------------------------------------------
# No-network enforcement
# ---------------------------------------------------------------------------


_NETWORK_BLOCKED_MESSAGE = (
    "Outbound network access is not permitted in this test suite. "
    "Mock the External_Tool or repository instead."
)


def _blocked(*_args: object, **_kwargs: object) -> None:
    """Refuse an outbound connection attempt."""
    raise AssertionError(_NETWORK_BLOCKED_MESSAGE)


@pytest.fixture(autouse=True)
def block_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fail any test that attempts a real outbound connection.

    Patches the *connect* entry points rather than ``socket.socket`` itself.
    Replacing the class outright also breaks asyncio: the event loop builds an
    internal self-pipe via ``socket.socketpair()`` during setup, so a blanket
    patch makes every async test error out before its body runs.

    Blocking ``connect``/``connect_ex``/``create_connection`` still catches a real
    HTTP call while leaving loop construction and local socket pairs working.
    """
    monkeypatch.setattr(socket.socket, "connect", _blocked, raising=True)
    monkeypatch.setattr(socket.socket, "connect_ex", _blocked, raising=True)
    monkeypatch.setattr(socket, "create_connection", _blocked, raising=True)


# ---------------------------------------------------------------------------
# Fake Supabase client
# ---------------------------------------------------------------------------


@dataclass
class RecordedCall:
    """One query-builder chain, captured for assertions."""

    table: str
    op: str
    filters: list[tuple[str, str, Any]] = field(default_factory=list)
    payload: Any = None
    order: list[tuple[str, bool]] = field(default_factory=list)
    limit: int | None = None
    columns: str | None = None
    on_conflict: str | None = None

    def filter_values(self, column: str) -> list[Any]:
        """Return every value filtered against ``column``."""
        return [value for col, _op, value in self.filters if col == column]

    def has_filter(self, column: str, value: Any) -> bool:
        """Return ``True`` if ``column`` was filtered to exactly ``value``."""
        return value in self.filter_values(column)


class _Response:
    """Mimics a Supabase response object's ``.data`` attribute."""

    def __init__(self, data: Any) -> None:
        self.data = data


class _QueryBuilder:
    """Records a fluent query chain and returns a canned response."""

    def __init__(self, client: FakeSupabaseClient, table: str) -> None:
        self._client = client
        self._call = RecordedCall(table=table, op="select")

    # -- terminal-op starters ------------------------------------------------

    def select(self, columns: str = "*") -> _QueryBuilder:
        self._call.op = "select"
        self._call.columns = columns
        return self

    def insert(self, payload: Any) -> _QueryBuilder:
        self._call.op = "insert"
        self._call.payload = payload
        return self

    def update(self, payload: Any) -> _QueryBuilder:
        self._call.op = "update"
        self._call.payload = payload
        return self

    def upsert(self, payload: Any, on_conflict: str | None = None) -> _QueryBuilder:
        self._call.op = "upsert"
        self._call.payload = payload
        self._call.on_conflict = on_conflict
        return self

    def delete(self) -> _QueryBuilder:
        self._call.op = "delete"
        return self

    # -- filters -------------------------------------------------------------

    def eq(self, column: str, value: Any) -> _QueryBuilder:
        self._call.filters.append((column, "eq", value))
        return self

    def neq(self, column: str, value: Any) -> _QueryBuilder:
        self._call.filters.append((column, "neq", value))
        return self

    def lt(self, column: str, value: Any) -> _QueryBuilder:
        self._call.filters.append((column, "lt", value))
        return self

    def gt(self, column: str, value: Any) -> _QueryBuilder:
        self._call.filters.append((column, "gt", value))
        return self

    def in_(self, column: str, values: Any) -> _QueryBuilder:
        self._call.filters.append((column, "in", list(values)))
        return self

    def contains(self, column: str, value: Any) -> _QueryBuilder:
        self._call.filters.append((column, "contains", value))
        return self

    def order(self, column: str, desc: bool = False) -> _QueryBuilder:
        self._call.order.append((column, desc))
        return self

    def limit(self, count: int) -> _QueryBuilder:
        self._call.limit = count
        return self

    # -- execution -----------------------------------------------------------

    async def execute(self) -> _Response:
        """Record the chain and return the queued response (or raise)."""
        self._client.calls.append(self._call)
        return self._client._next_response(self._call)


class _RpcBuilder:
    """Records an RPC invocation and returns a canned response."""

    def __init__(self, client: FakeSupabaseClient, name: str, params: Any) -> None:
        self._client = client
        self._call = RecordedCall(table=f"rpc:{name}", op="rpc", payload=params)

    async def execute(self) -> _Response:
        self._client.calls.append(self._call)
        return self._client._next_response(self._call)


class FakeSupabaseClient:
    """In-memory stand-in for ``supabase.AsyncClient``.

    Responses are queued per table (or ``rpc:<name>``). A queued entry may be a
    value to return or an exception instance to raise, which is how the tests
    simulate a ``23505`` without a real database.
    """

    def __init__(self) -> None:
        self.calls: list[RecordedCall] = []
        self._queues: dict[str, list[Any]] = {}
        self._defaults: dict[str, Any] = {}

    # -- test-side configuration --------------------------------------------

    def queue(self, target: str, *results: Any) -> FakeSupabaseClient:
        """Queue one or more results (or exceptions) for ``target`` in order."""
        self._queues.setdefault(target, []).extend(results)
        return self

    def set_default(self, target: str, result: Any) -> FakeSupabaseClient:
        """Set the response returned for ``target`` once its queue is empty."""
        self._defaults[target] = result
        return self

    def calls_for(self, target: str) -> list[RecordedCall]:
        """Return every recorded call against ``target``."""
        return [c for c in self.calls if c.table == target]

    def ops_for(self, target: str) -> list[str]:
        """Return the operation names recorded against ``target``."""
        return [c.op for c in self.calls_for(target)]

    @property
    def write_calls(self) -> list[RecordedCall]:
        """Return every recorded mutating call (insert / update / upsert / delete / rpc)."""
        return [c for c in self.calls if c.op in {"insert", "update", "upsert", "delete", "rpc"}]

    # -- client surface ------------------------------------------------------

    def table(self, name: str) -> _QueryBuilder:
        return _QueryBuilder(self, name)

    def rpc(self, name: str, params: Any = None) -> _RpcBuilder:
        return _RpcBuilder(self, name, params)

    # -- internals -----------------------------------------------------------

    def _next_response(self, call: RecordedCall) -> _Response:
        queue = self._queues.get(call.table, [])
        result = queue.pop(0) if queue else self._defaults.get(call.table, [])
        if isinstance(result, BaseException):
            raise result
        return _Response(result)


@pytest.fixture
def fake_client() -> FakeSupabaseClient:
    """Provide a fresh :class:`FakeSupabaseClient`."""
    return FakeSupabaseClient()


# ---------------------------------------------------------------------------
# Simulated Postgres errors
# ---------------------------------------------------------------------------


class FakePostgresError(Exception):
    """A Supabase-style error exposing a SQLSTATE ``code`` attribute."""

    def __init__(self, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


def unique_violation(constraint: str) -> FakePostgresError:
    """Build a ``23505`` naming ``constraint``, as supabase-py would surface it."""
    return FakePostgresError(
        f'duplicate key value violates unique constraint "{constraint}"',
        code="23505",
    )


# ---------------------------------------------------------------------------
# Shared repository/tool mock fixtures (Requirement 21.7-21.8, 21.10)
# ---------------------------------------------------------------------------
#
# Each fixture is an ``AsyncMock(spec=...)`` against the real repository
# class, following spec 02's fixture pattern: ``spec=`` means calling a method
# that does not exist on the real class fails loudly, the same way a typo
# would against the genuine object, rather than silently returning another
# mock. These are for tests that only need "a repository was/wasn't called
# with X", not the full query-chain fidelity ``FakeSupabaseClient`` gives
# the repository-layer tests themselves.


@pytest.fixture
def mock_trip_repo() -> AsyncMock:
    return AsyncMock(spec=TripRepository)


@pytest.fixture
def mock_room_repo() -> AsyncMock:
    return AsyncMock(spec=RoomRepository)


@pytest.fixture
def mock_message_repo() -> AsyncMock:
    return AsyncMock(spec=MessageRepository)


@pytest.fixture
def mock_vote_session_repo() -> AsyncMock:
    return AsyncMock(spec=VoteSessionRepository)


@pytest.fixture
def mock_vote_repo() -> AsyncMock:
    return AsyncMock(spec=VoteRepository)


@pytest.fixture
def mock_selection_repo() -> AsyncMock:
    return AsyncMock(spec=SelectionRepository)


@pytest.fixture
def mock_itinerary_version_repo() -> AsyncMock:
    return AsyncMock(spec=ItineraryVersionRepository)


@pytest.fixture
def mock_feedback_repo() -> AsyncMock:
    return AsyncMock(spec=FeedbackRepository)


@pytest.fixture
def mock_agent_run_repo() -> AsyncMock:
    return AsyncMock(spec=AgentRunRepository)


@pytest.fixture
def mock_member_repo() -> AsyncMock:
    return AsyncMock(spec=MemberRepository)


@pytest.fixture
def mock_profile_repo() -> AsyncMock:
    return AsyncMock(spec=ProfileRepository)


@pytest.fixture
def mock_llm() -> AsyncMock:
    """A test double for :class:`~app.agents.llm.LLMClient`.

    Pinned to the real class's interface so a call to something that does not
    exist fails loudly. Defaults to "the model is unavailable": every node then
    takes its deterministic path, which is what a test that is not about the
    LLM wants. A test of LLM behaviour overrides ``generate_structured``.
    """
    llm = AsyncMock(spec=LLMClient)
    llm.generate_structured.side_effect = LLMGenerationError("mock_llm")
    return llm


@pytest.fixture
def mock_flight_tool() -> AsyncMock:
    """A test double for ``FlightSearchTool``, returning ``(response, state)``."""
    return AsyncMock()


@pytest.fixture
def mock_places_tool() -> AsyncMock:
    """A test double for ``PlacesLookupTool``, returning ``(response, state)``."""
    return AsyncMock()


@pytest.fixture
def mock_weather_tool() -> AsyncMock:
    """A test double for ``WeatherLookupTool``, returning ``(response, state)``."""
    return AsyncMock()


@pytest.fixture
def mock_repository_bundle(
    mock_trip_repo: AsyncMock,
    mock_room_repo: AsyncMock,
    mock_message_repo: AsyncMock,
    mock_vote_session_repo: AsyncMock,
    mock_vote_repo: AsyncMock,
    mock_selection_repo: AsyncMock,
    mock_itinerary_version_repo: AsyncMock,
    mock_feedback_repo: AsyncMock,
    mock_agent_run_repo: AsyncMock,
    mock_member_repo: AsyncMock,
    mock_profile_repo: AsyncMock,
    mock_llm: AsyncMock,
    mock_flight_tool: AsyncMock,
    mock_places_tool: AsyncMock,
    mock_weather_tool: AsyncMock,
) -> RepositoryBundle:
    """A :class:`RepositoryBundle` built entirely from the mocks above.

    Convenient for a test that drives a node or ``run_agent_graph`` and wants
    to assert on call counts across every dependency at once, rather than
    assembling the bundle by hand each time.
    """
    return RepositoryBundle(
        trip_repo=mock_trip_repo,
        room_repo=mock_room_repo,
        message_repo=mock_message_repo,
        vote_session_repo=mock_vote_session_repo,
        vote_repo=mock_vote_repo,
        selection_repo=mock_selection_repo,
        itinerary_version_repo=mock_itinerary_version_repo,
        feedback_repo=mock_feedback_repo,
        agent_run_repo=mock_agent_run_repo,
        member_repo=mock_member_repo,
        profile_repo=mock_profile_repo,
        flight_tool=mock_flight_tool,
        places_tool=mock_places_tool,
        weather_tool=mock_weather_tool,
        llm=mock_llm,
    )
