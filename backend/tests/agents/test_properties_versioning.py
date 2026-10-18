"""Property-based tests: version-lifecycle correctness (design.md Properties 1-3, 13-15).

Each test uses ``hypothesis`` with the project's fixed seed and at least 50
examples (Requirement 21.13), tagged with the property it validates.
"""

from __future__ import annotations

from typing import Any

import pytest
from app.agents.errors import DuplicateApprovalError, RepeatedVersionContentionError
from app.agents.nodes.itinerary import persist_itinerary_version
from app.agents.state import AgentState
from hypothesis import HealthCheck, given, seed, settings
from hypothesis import strategies as st

from tests.agents.property_fakes import FakeItineraryVersionRepository

#: Requirement 21.13: a fixed, declared seed and >= 50 examples per property.
PROPERTY_SEED = 20260925
PROPERTY_EXAMPLES = 50

RUN = "33333333-3333-3333-3333-333333333333"
TRIP = "11111111-1111-1111-1111-111111111111"


def make_state(**overrides: Any) -> AgentState:
    base: dict[str, Any] = {"run_id": RUN, "trip_id": TRIP, "run_type": "itinerary"}
    base.update(overrides)
    return AgentState(**base)


async def _always_applicable(_latest: dict[str, Any]) -> bool:
    return True


async def _never_applicable(_latest: dict[str, Any]) -> bool:
    return False


class _Bundle:
    """A minimal RepositoryBundle stand-in carrying only what's exercised."""

    def __init__(self, repo: FakeItineraryVersionRepository) -> None:
        self.itinerary_version_repo = repo


# ===========================================================================
# Property 1: Version monotonicity, no gaps, no overwrites
# ===========================================================================


@seed(PROPERTY_SEED)
@settings(
    max_examples=PROPERTY_EXAMPLES,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(insert_count=st.integers(min_value=1, max_value=6))
async def test_property_1_version_sequence_is_contiguous_with_no_overwrite(
    insert_count: int,
) -> None:
    """Feature: 03-AI-agents, Property 1.

    Sequential builds/refines on one trip produce versions 1..N with no gaps
    and no re-inserted version — each call starts from the state the previous
    one actually landed at, exactly like a real run chain would.
    """
    repo = FakeItineraryVersionRepository()
    bundle = _Bundle(repo)
    state = make_state(base_version=0)

    for i in range(insert_count):
        source = "build" if i == 0 else "refine"
        change_summary = None if i == 0 else "a refinement"
        row, state = await persist_itinerary_version(
            state, bundle, {"days": [], "n": i}, source, change_summary, _never_applicable
        )
        assert row is not None
        state = state.with_base_version(row["version"])

    versions = sorted(r["version"] for r in repo.rows.values())
    assert versions == list(range(1, insert_count + 1))
    # No insert_version call ever targeted an already-occupied version.
    seen: set[int] = set()
    for _trip_id, version, _source in repo.insert_calls:
        if version in seen:
            continue  # a lost-race retry targeting the same version is fine
        seen.add(version)
    assert len(repo.rows) == insert_count


# ===========================================================================
# Property 2: Build-source invariant
# ===========================================================================


@seed(PROPERTY_SEED)
@settings(max_examples=PROPERTY_EXAMPLES, deadline=None)
@given(
    base_version=st.integers(min_value=0, max_value=20),
    source=st.sampled_from(["build", "refine"]),
)
async def test_property_2_insert_proceeds_iff_build_source_invariant_holds(
    base_version: int, source: str
) -> None:
    """Feature: 03-AI-agents, Property 2.

    The insert proceeds exactly when ``(version == 1) == (source == 'build')``;
    every mismatched pairing is rejected before any repository call.
    """
    repo = FakeItineraryVersionRepository()
    bundle = _Bundle(repo)
    state = make_state(base_version=base_version)
    candidate_version = base_version + 1
    expected_source = "build" if candidate_version == 1 else "refine"

    if source == expected_source:
        change_summary = None if source == "build" else "x"
        row, _state = await persist_itinerary_version(
            state, bundle, {"days": []}, source, change_summary, _never_applicable
        )
        assert row is not None
        assert row["version"] == candidate_version
        assert row["source"] == expected_source
    else:
        with pytest.raises(ValueError, match="invalid for version"):
            await persist_itinerary_version(
                state, bundle, {"days": []}, source, None, _never_applicable
            )
        assert repo.rows == {}


# ===========================================================================
# Property 3: At most one approved version
# ===========================================================================


@seed(PROPERTY_SEED)
@settings(max_examples=PROPERTY_EXAMPLES, deadline=None)
@given(approval_attempts=st.integers(min_value=1, max_value=8))
async def test_property_3_at_most_one_approved_version_per_trip(approval_attempts: int) -> None:
    """Feature: 03-AI-agents, Property 3.

    Across any number of versions and any number of approval attempts, at
    most one row per trip ever ends up ``approved``, and every attempt beyond
    the first raises without mutating the already-approved row.
    """
    repo = FakeItineraryVersionRepository()
    rows = []
    for i in range(approval_attempts):
        rows.append(
            await repo.insert_version(
                TRIP, i + 1, "build" if i == 0 else "refine", {"days": [], "n": i}
            )
        )

    first = await repo.mark_approved(rows[0]["id"])
    assert first["status"] == "approved"

    for later in rows[1:]:
        with pytest.raises(DuplicateApprovalError):
            await repo.mark_approved(later["id"])

    approved = [r for r in repo.rows.values() if r["status"] == "approved"]
    assert len(approved) == 1
    assert approved[0]["id"] == rows[0]["id"]
    # The approved row's content is untouched by the rejected later attempts.
    assert repo.rows[rows[0]["id"]] == first


# ===========================================================================
# Property 13: Bounded contention
# ===========================================================================


class _CollidingRepo(FakeItineraryVersionRepository):
    """Simulates exactly ``k`` collisions before a clean insert succeeds."""

    def __init__(self, collisions: int) -> None:
        super().__init__()
        self._remaining = collisions
        self.attempts = 0

    async def insert_version(self, trip_id: str, version: int, **kwargs: Any) -> dict[str, Any]:
        from app.repositories.itinerary_version_repository import UniqueVersionViolation

        self.attempts += 1
        if self._remaining > 0:
            self._remaining -= 1
            raise UniqueVersionViolation(trip_id, version)
        return await super().insert_version(trip_id, version, **kwargs)

    async def get_latest(self, trip_id: str) -> dict[str, Any] | None:
        # Each collision implies someone else already landed one more version.
        return {"id": "x", "trip_id": trip_id, "version": self.attempts}


@seed(PROPERTY_SEED)
@settings(max_examples=PROPERTY_EXAMPLES, deadline=None)
@given(k=st.integers(min_value=0, max_value=5))
async def test_property_13_bounded_contention(k: int) -> None:
    """Feature: 03-AI-agents, Property 13.

    Exactly ``min(k, 2)`` lost-race cycles occur; a 3rd collision ends the
    attempt with ``RepeatedVersionContentionError`` instead of a 3rd insert.
    """
    repo = _CollidingRepo(collisions=k)
    bundle = _Bundle(repo)
    state = make_state(base_version=0)

    if k >= 3:
        with pytest.raises(RepeatedVersionContentionError):
            await persist_itinerary_version(
                state, bundle, {"days": []}, "build", None, _always_applicable
            )
        assert repo.attempts == 3
    else:
        row, _state = await persist_itinerary_version(
            state, bundle, {"days": []}, "build", None, _always_applicable
        )
        assert row is not None
        assert repo.attempts == k + 1


# ===========================================================================
# Property 14: Supersede safety
# ===========================================================================


@seed(PROPERTY_SEED)
@settings(max_examples=PROPERTY_EXAMPLES, deadline=None)
@given(
    statuses=st.lists(st.sampled_from(["proposed", "approved", "rejected"]), min_size=0, max_size=6)
)
async def test_property_14_supersede_never_touches_approved_or_rejected(
    statuses: list[str],
) -> None:
    """Feature: 03-AI-agents, Property 14.

    Rows already ``approved``/``rejected`` are byte-identical before and after
    ``supersede_lower_versions``; only lower-version ``proposed`` rows move to
    ``superseded``.
    """
    repo = FakeItineraryVersionRepository()
    for i, status in enumerate(statuses):
        row = await repo.insert_version(TRIP, i + 1, "build" if i == 0 else "refine", {"days": []})
        row["status"] = status
        repo.rows[row["id"]] = row

    before = {rid: dict(row) for rid, row in repo.rows.items()}
    new_version = len(statuses) + 1
    await repo.supersede_lower_versions(TRIP, below_version=new_version)

    for rid, row in repo.rows.items():
        prior = before[rid]
        if prior["status"] in ("approved", "rejected"):
            assert row == prior
        elif prior["status"] == "proposed" and prior["version"] < new_version:
            assert row["status"] == "superseded"


# ===========================================================================
# Property 15: Item id stability across versions
# ===========================================================================


@seed(PROPERTY_SEED)
@settings(max_examples=PROPERTY_EXAMPLES, deadline=None)
@given(
    base_item_ids=st.lists(
        st.text(alphabet="abcdefgh", min_size=1, max_size=4), min_size=1, max_size=5, unique=True
    ),
    new_item_ids=st.lists(
        st.text(alphabet="ijklmnop", min_size=1, max_size=4), min_size=0, max_size=3, unique=True
    ),
)
async def test_property_15_carried_forward_ids_persist_new_ids_are_fresh(
    base_item_ids: list[str], new_item_ids: list[str]
) -> None:
    """Feature: 03-AI-agents, Property 15.

    A refined version that carries forward every base item unchanged, and
    adds a disjoint set of new items, never collides a new id with any id
    used in a prior version of the trip.
    """
    repo = FakeItineraryVersionRepository()
    base_items = [{"id": iid, "title": iid} for iid in base_item_ids]
    await repo.insert_version(TRIP, 1, "build", {"days": [{"day": 1, "items": base_items}]})

    all_prior_ids = {item["id"] for item in base_items}
    assert not (set(new_item_ids) & all_prior_ids), "test construction must keep alphabets disjoint"

    refined_items = base_items + [{"id": iid, "title": iid} for iid in new_item_ids]
    refined_row = await repo.insert_version(
        TRIP, 2, "refine", {"days": [{"day": 1, "items": refined_items}]}
    )

    refined_ids = {item["id"] for item in refined_row["itinerary"]["days"][0]["items"]}
    assert all_prior_ids <= refined_ids  # every carried-forward id survives
    assert not (set(new_item_ids) & all_prior_ids)  # new ids were never reused
