"""Property-based tests: run idempotency and terminality (design.md Properties 6, 7)."""

from __future__ import annotations

import asyncio
from typing import Any

from app.repositories.agent_run_repository import AgentRunRepository
from hypothesis import HealthCheck, given, seed, settings
from hypothesis import strategies as st

from tests.agents.property_fakes import FakeAgentRunRepository

PROPERTY_SEED = 20260925
PROPERTY_EXAMPLES = 50

TRIP = "11111111-1111-1111-1111-111111111111"


class _Response:
    def __init__(self, data: Any) -> None:
        self.data = data


class _StatefulQueryBuilder:
    """Mutates a single in-memory row, so repeated updates are visible to later reads."""

    def __init__(self, client: _StatefulAgentRunsClient) -> None:
        self._client = client
        self._op: str | None = None
        self._payload: dict[str, Any] | None = None

    def select(self, _columns: str = "*") -> _StatefulQueryBuilder:
        self._op = "select"
        return self

    def update(self, payload: dict[str, Any]) -> _StatefulQueryBuilder:
        self._op = "update"
        self._payload = payload
        return self

    def eq(self, _column: str, _value: Any) -> _StatefulQueryBuilder:
        return self

    def limit(self, _count: int) -> _StatefulQueryBuilder:
        return self

    async def execute(self) -> _Response:
        if self._op == "update" and self._payload:
            self._client.row.update(self._payload)
        return _Response([dict(self._client.row)])


class _StatefulAgentRunsClient:
    """A single-row fake Supabase client: every update mutates that one row in place."""

    def __init__(self, row: dict[str, Any]) -> None:
        self.row = row

    def table(self, _name: str) -> _StatefulQueryBuilder:
        return _StatefulQueryBuilder(self)


# ===========================================================================
# Property 6: Idempotency replay
# ===========================================================================


@seed(PROPERTY_SEED)
@settings(
    max_examples=PROPERTY_EXAMPLES,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(call_count=st.integers(min_value=2, max_value=10))
def test_property_6_repeated_calls_with_the_same_key_share_one_row(call_count: int) -> None:
    """Feature: 03-AI-agents, Property 6.

    Any number of repeated `create_pending` calls carrying the same
    `idempotencyKey` ever insert exactly one row, and every caller receives
    that same run's id — simulating the `23505` race the real repository
    resolves via a re-read.
    """
    repo = FakeAgentRunRepository()
    key = "shared-key"

    async def run() -> list[dict[str, Any]]:
        return [
            await repo.create_pending(TRIP, "discovery", None, 0, key) for _ in range(call_count)
        ]

    results = asyncio.run(run())

    ids = {r["id"] for r in results}
    assert len(ids) == 1
    assert len(repo.rows_by_id) == 1


@seed(PROPERTY_SEED)
@settings(max_examples=PROPERTY_EXAMPLES, deadline=None)
@given(call_count=st.integers(min_value=1, max_value=10))
def test_property_6_no_key_never_deduplicates_across_calls(call_count: int) -> None:
    """Calls with no idempotency key are independent: each gets its own row."""
    repo = FakeAgentRunRepository()

    async def run() -> list[dict[str, Any]]:
        return [
            await repo.create_pending(TRIP, "discovery", None, 0, None) for _ in range(call_count)
        ]

    results = asyncio.run(run())

    ids = {r["id"] for r in results}
    assert len(ids) == call_count


# ===========================================================================
# Property 7: Run terminality
# ===========================================================================


@seed(PROPERTY_SEED)
@settings(
    max_examples=PROPERTY_EXAMPLES,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(fails=st.booleans())
def test_property_7_every_path_ends_completed_or_failed_with_a_timestamp(fails: bool) -> None:
    """Feature: 03-AI-agents, Property 7.

    Whichever path a run takes — straight through to success, or any
    failure injected along the way — its final `agent_runs.status` is
    `completed` or `failed`, and `completed_at` is non-NULL in both cases.
    """

    async def run() -> dict[str, Any]:
        client = _StatefulAgentRunsClient(
            {
                "id": "r1",
                "status": "pending",
                "started_at": None,
                "completed_at": None,
                "error": None,
            }
        )
        repo = AgentRunRepository(client)

        await repo.mark_running("r1")
        if fails:
            return await repo.mark_failed("r1", "a failure summary")
        return await repo.mark_completed("r1", result_version_id=None)

    final_row = asyncio.run(run())

    assert final_row["status"] in ("completed", "failed")
    assert final_row["completed_at"] is not None
    if fails:
        assert final_row["status"] == "failed"
        assert final_row["error"]
    else:
        assert final_row["status"] == "completed"
        assert final_row["error"] is None
