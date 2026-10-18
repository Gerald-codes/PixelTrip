"""Property-based tests: guardrail soundness, caps, factual provenance, secrets
(design.md Properties 4, 8, 10, 12).
"""

from __future__ import annotations

from typing import Any

import pytest
from app.agents.errors import IterationCapExceededError, StateBoundExceededError
from app.agents.guardrails import run_guardrail_pipeline
from app.agents.guardrails.factual import run_factual_guardrail
from app.agents.proposals import FlightRecommendationProposal
from app.agents.state import AgentState
from app.main import resolve_error_mapping
from hypothesis import HealthCheck, given, seed, settings
from hypothesis import strategies as st

from tests.conftest import (
    FAKE_AI_PROVIDER_API_KEY,
    FAKE_FLIGHT_API_KEY,
    FAKE_PLACES_API_KEY,
    FAKE_SERVICE_ROLE_KEY,
    FAKE_WEATHER_API_KEY,
)

PROPERTY_SEED = 20260925
PROPERTY_EXAMPLES = 50

RUN = "33333333-3333-3333-3333-333333333333"
TRIP = "11111111-1111-1111-1111-111111111111"

ALL_SECRETS = (
    FAKE_SERVICE_ROLE_KEY,
    FAKE_FLIGHT_API_KEY,
    FAKE_PLACES_API_KEY,
    FAKE_WEATHER_API_KEY,
    FAKE_AI_PROVIDER_API_KEY,
)


def make_state(**overrides: Any) -> AgentState:
    base: dict[str, Any] = {"run_id": RUN, "trip_id": TRIP, "run_type": "discovery"}
    base.update(overrides)
    return AgentState(**base)


# ===========================================================================
# Property 4: Guardrail soundness
# ===========================================================================

#: Deliberately malformed destination-recommendation payloads, each breaking a
#: different structural rule.
_MALFORMED_DESTINATION_PAYLOADS: list[dict[str, Any]] = [
    {},  # missing everything
    {"title": "T", "items": [], "question": "Q"},  # too few items
    {
        "title": "T",
        "items": [{"id": "a", "title": "A"}] * 6,
        "question": "Q",
    },  # too many items (also duplicate ids)
    {
        "title": "T",
        "items": [{"id": "a", "title": "A"}, {"id": "b", "title": "B"}, {"id": "c", "title": "C"}],
        "question": "Q",
        "extra_unknown_field": True,
    },
    {
        "title": "T",
        "items": [{"id": "a", "title": "A"}, {"id": "a", "title": "A2"}, {"id": "c", "title": "C"}],
        "question": "Q",
    },  # duplicate item ids
]


@seed(PROPERTY_SEED)
@settings(
    max_examples=PROPERTY_EXAMPLES,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(payload=st.sampled_from(_MALFORMED_DESTINATION_PAYLOADS))
def test_property_4_malformed_proposal_never_passes_or_writes(payload: dict[str, Any]) -> None:
    """Feature: 03-AI-agents, Property 4.

    No malformed proposal ever reaches `passed=True`. Because
    `run_guardrail_pipeline` takes no repository argument at all, "zero
    repository writes for a rejected proposal" is structural — there is
    nothing in its signature capable of writing anywhere — so this test
    additionally asserts the function's own contract (no proposal, no
    provenance) to make that guarantee concrete rather than merely implied by
    the signature.
    """
    outcome = run_guardrail_pipeline(payload, "destination_recommendation")

    assert outcome.passed is False
    assert outcome.proposal is None
    assert outcome.provenance == {}
    assert outcome.failed_layer == "structural"


@seed(PROPERTY_SEED)
@settings(max_examples=PROPERTY_EXAMPLES, deadline=None)
@given(
    budget=st.integers(min_value=1, max_value=100),
    price=st.integers(min_value=101, max_value=10_000),
)
def test_property_4_a_budget_violation_never_passes(budget: int, price: int) -> None:
    """A structurally valid but over-budget proposal is still rejected, by
    the business layer this time rather than the structural one — but the
    "never passes" guarantee holds across both.
    """
    payload = {
        "title": "T",
        "items": [
            {"id": "a", "title": "A", "meta": {"price": price}},
            {"id": "b", "title": "B", "meta": {"price": price}},
            {"id": "c", "title": "C", "meta": {"price": price}},
        ],
        "question": "Q",
    }
    outcome = run_guardrail_pipeline(
        payload, "destination_recommendation", {"budget_ceiling": budget}
    )

    assert outcome.passed is False
    assert outcome.proposal is None


# ===========================================================================
# Property 8: Iteration and tool-call cap bound
# ===========================================================================


@seed(PROPERTY_SEED)
@settings(max_examples=PROPERTY_EXAMPLES, deadline=None)
@given(cap=st.integers(min_value=1, max_value=10), attempts=st.integers(min_value=0, max_value=20))
def test_property_8_iteration_count_never_exceeds_the_cap(cap: int, attempts: int) -> None:
    """Feature: 03-AI-agents, Property 8 (iteration half).

    Repeated increments never push `iteration_count` past `cap`; the first
    attempt that would raises `IterationCapExceededError` instead of
    silently clamping or wrapping.
    """
    state = make_state()
    successful = 0
    for _ in range(attempts):
        if state.iteration_count >= cap:
            with pytest.raises(IterationCapExceededError):
                state = state.with_incremented_iteration(cap)
            break
        state = state.with_incremented_iteration(cap)
        successful += 1

    assert state.iteration_count == min(successful, cap)
    assert state.iteration_count <= cap


@seed(PROPERTY_SEED)
@settings(max_examples=PROPERTY_EXAMPLES, deadline=None)
@given(cap=st.integers(min_value=1, max_value=50), attempts=st.integers(min_value=0, max_value=60))
def test_property_8_tool_response_count_never_exceeds_the_cap(cap: int, attempts: int) -> None:
    """Feature: 03-AI-agents, Property 8 (tool-call half).

    `external_tool_responses` never grows past the configured
    `Tool_Call_Cap`; the append that would exceed it raises
    `StateBoundExceededError` instead.
    """
    state = make_state().with_tool_call_cap(cap)
    appended = 0
    for i in range(attempts):
        if len(state.external_tool_responses) >= cap:
            with pytest.raises(StateBoundExceededError):
                state = state.append_tool_response({"n": i})
            break
        state = state.append_tool_response({"n": i})
        appended += 1

    assert len(state.external_tool_responses) == min(appended, cap)
    assert len(state.external_tool_responses) <= cap


# ===========================================================================
# Property 10: Factual provenance and completeness
# ===========================================================================


@seed(PROPERTY_SEED)
@settings(max_examples=PROPERTY_EXAMPLES, deadline=None)
@given(
    drifted_price=st.integers(min_value=0, max_value=5000),
    tool_price=st.integers(min_value=0, max_value=5000),
    drifted_carrier=st.text(alphabet="ABCDEFGH", min_size=1, max_size=6),
    tool_carrier=st.text(alphabet="ABCDEFGH", min_size=1, max_size=6),
)
def test_property_10_matched_items_always_equal_the_tool_response(
    drifted_price: int, tool_price: int, drifted_carrier: str, tool_carrier: str
) -> None:
    """Feature: 03-AI-agents, Property 10.

    For any drifted factual field on a matched item, the corrected proposal's
    value equals the tool response's value exactly, and the model's own
    (possibly different) value never survives.
    """
    proposal = FlightRecommendationProposal(
        title="Flights",
        question="Pick",
        items=[
            {
                "id": "f1",
                "title": "Flight",
                "meta": {"flight_id": "F-1", "price": drifted_price, "carrier": drifted_carrier},
            },
            {"id": "f2", "title": "Flight 2", "meta": {"flight_id": "F-2"}},
            {"id": "f3", "title": "Flight 3", "meta": {"flight_id": "F-3"}},
        ],
    )
    tool_responses = [
        {
            "options": [
                {"id": "F-1", "price": tool_price, "carrier": tool_carrier},
                {"id": "F-2", "price": 1, "carrier": "X"},
                {"id": "F-3", "price": 1, "carrier": "X"},
            ]
        }
    ]

    corrected, findings, provenance = run_factual_guardrail(proposal, tool_responses)

    assert findings == []
    assert corrected.items[0].meta["price"] == tool_price
    assert corrected.items[0].meta["carrier"] == tool_carrier
    assert provenance["f1"]["id"] == "F-1"


@seed(PROPERTY_SEED)
@settings(max_examples=PROPERTY_EXAMPLES, deadline=None)
@given(ghost_id=st.text(alphabet="XYZ123", min_size=1, max_size=6))
def test_property_10_an_unmatched_item_is_always_rejected_never_overwritten(
    ghost_id: str,
) -> None:
    """An item with no corresponding tool entry is rejected, never silently
    passed through with a model-invented value.
    """
    proposal = FlightRecommendationProposal(
        title="Flights",
        question="Pick",
        items=[
            {"id": "f1", "title": "A", "meta": {"flight_id": ghost_id}},
            {"id": "f2", "title": "B", "meta": {"flight_id": "F-2"}},
            {"id": "f3", "title": "C", "meta": {"flight_id": "F-3"}},
        ],
    )
    tool_responses = [{"options": [{"id": "F-2"}, {"id": "F-3"}]}]

    _result, findings, provenance = run_factual_guardrail(proposal, tool_responses)

    if ghost_id in ("F-2", "F-3"):
        return  # not actually a ghost in this draw; nothing to assert
    assert len(findings) == 1
    assert provenance == {}


# ===========================================================================
# Property 12: Secret non-disclosure
# ===========================================================================


@seed(PROPERTY_SEED)
@settings(max_examples=PROPERTY_EXAMPLES, deadline=None)
@given(secret=st.sampled_from(ALL_SECRETS), surrounding=st.text(max_size=40))
def test_property_12_no_configured_secret_reaches_an_error_mapping_message(
    secret: str, surrounding: str
) -> None:
    """Feature: 03-AI-agents, Property 12.

    An internal exception whose own message happens to embed a secret marker
    never leaks it through `resolve_error_mapping` — every registered agent
    exception's client-facing message is a fixed, developer-authored string
    (or the generic opaque fallback), never `str(exc)`.
    """
    from app.agents.errors import ExternalToolUnavailableError

    exc = ExternalToolUnavailableError(f"flight_search {surrounding} {secret}")

    _status, _code, message = resolve_error_mapping(exc)

    assert secret not in message


@seed(PROPERTY_SEED)
@settings(max_examples=PROPERTY_EXAMPLES, deadline=None)
@given(secret=st.sampled_from(ALL_SECRETS))
def test_property_12_mark_failed_summary_constants_contain_no_secret(secret: str) -> None:
    """The fixed, developer-authored failure summaries used across the agent
    layer (never `str(exc)`) cannot contain a secret by construction — this
    pins that as a checked fact rather than an assumption.
    """
    from app.agents.guardrails.escalation import ESCALATION_WRITE_FAILED_ERROR
    from app.services.agent_run_service import (
        OUTCOME_FAILED_TEXT,
        RUN_FAILED_ERROR,
        STALE_RUN_ERROR,
    )

    for summary in (
        ESCALATION_WRITE_FAILED_ERROR,
        OUTCOME_FAILED_TEXT,
        RUN_FAILED_ERROR,
        STALE_RUN_ERROR,
    ):
        assert secret not in summary
