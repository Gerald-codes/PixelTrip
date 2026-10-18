"""Tests for the three-layer guardrail pipeline and the group profile."""

from __future__ import annotations

from typing import Any

import pytest
from app.agents.group_profile import (
    compute_availability_overlap,
    compute_budget_ceiling,
    compute_group_profile,
    compute_required_activities,
)
from app.agents.guardrails import (
    LAYER_BUSINESS,
    LAYER_FACTUAL,
    LAYER_STRUCTURAL,
    run_guardrail_pipeline,
)
from app.agents.guardrails.business import (
    CHECK_BUDGET,
    CHECK_DATES,
    CHECK_HARD_CONSTRAINTS,
    CHECK_ORDER,
    CHECK_REQUIRED_ACTIVITIES,
    CHECK_TRAVEL_TIME,
    run_business_guardrail,
)
from app.agents.guardrails.factual import run_factual_guardrail
from app.agents.guardrails.structural import (
    ENUM_COLUMNS,
    FINDING_INVALID_ENUM,
    FINDING_MISSING,
    FINDING_UNKNOWN,
    FINDING_UNPARSEABLE,
    UnknownProposalKindError,
    validate_enum_column,
    validate_structural,
)
from app.agents.proposals import (
    FlightRecommendationProposal,
    ItineraryModel,
    ItineraryProposal,
)

TRIP = "11111111-1111-1111-1111-111111111111"
ROOM = "22222222-2222-2222-2222-222222222222"


def rec_items(count: int = 3) -> list[dict[str, Any]]:
    return [{"id": f"opt-{i}", "title": f"Option {i}"} for i in range(count)]


def itinerary_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "trip_id": TRIP,
        "room_id": ROOM,
        "title": "Kyoto Quest",
        "summary": "Temples and gardens",
        "destination": {"name": "Kyoto"},
        "days": [{"day": 1, "items": [{"id": "i1", "title": "Arrive"}]}],
    }
    payload.update(overrides)
    return payload


# ===========================================================================
# Group profile
# ===========================================================================


def test_availability_overlap_intersects_all_contributors() -> None:
    """The overlap is a true intersection across date-supplying members."""
    prefs = [
        {"available_dates": [{"start": "2026-06-01", "end": "2026-06-20"}]},
        {"available_dates": [{"start": "2026-06-10", "end": "2026-06-30"}]},
    ]

    assert compute_availability_overlap(prefs) == [{"start": "2026-06-10", "end": "2026-06-20"}]


def test_availability_overlap_is_empty_when_disjoint() -> None:
    """No shared window yields an empty overlap, not a union."""
    prefs = [
        {"available_dates": [{"start": "2026-06-01", "end": "2026-06-05"}]},
        {"available_dates": [{"start": "2026-07-01", "end": "2026-07-05"}]},
    ]

    assert compute_availability_overlap(prefs) == []


def test_member_without_dates_does_not_block_the_party() -> None:
    """A member supplying nothing is unconstrained, not a veto."""
    prefs = [
        {"available_dates": [{"start": "2026-06-01", "end": "2026-06-10"}]},
        {"available_dates": []},
        {"available_dates": None},
    ]

    assert compute_availability_overlap(prefs) == [{"start": "2026-06-01", "end": "2026-06-10"}]


def test_malformed_date_entries_are_skipped_not_fatal() -> None:
    """Sloppy member input must not abort a run."""
    prefs = [
        {
            "available_dates": [
                {"start": "not-a-date", "end": "2026-06-10"},
                {"start": "2026-06-01"},
                "nonsense",
                {"start": "2026-06-05", "end": "2026-06-08"},
            ]
        }
    ]

    assert compute_availability_overlap(prefs) == [{"start": "2026-06-05", "end": "2026-06-08"}]


def test_reversed_range_is_skipped() -> None:
    """An end before its start is not a usable window."""
    prefs = [{"available_dates": [{"start": "2026-06-10", "end": "2026-06-01"}]}]

    assert compute_availability_overlap(prefs) == []


def test_alternate_date_key_names_accepted() -> None:
    """Both ``start``/``end`` and ``from``/``to`` shapes are tolerated."""
    prefs = [{"available_dates": [{"from": "2026-06-01", "to": "2026-06-10"}]}]

    assert compute_availability_overlap(prefs) == [{"start": "2026-06-01", "end": "2026-06-10"}]


def test_budget_ceiling_is_the_lowest_non_null() -> None:
    """Requirement 7.3: the most constrained member governs."""
    prefs = [{"budget": 2000}, {"budget": 800}, {"budget": None}]

    assert compute_budget_ceiling(prefs) == 800.0


def test_budget_ceiling_is_none_when_all_null() -> None:
    """All-NULL budgets mean unconstrained, which is not zero."""
    assert compute_budget_ceiling([{"budget": None}, {}]) is None


def test_required_activities_read_priority_from_the_jsonb_objects() -> None:
    """Requirement 12.6: priority lives inside the activities entries."""
    prefs = [
        {
            "activities": [
                {"name": "Fushimi Inari", "priority": "must_have"},
                {"name": "Shopping", "priority": "optional"},
                {"name": "Tea ceremony", "required": True},
                {"name": "Museum"},
            ]
        }
    ]

    assert compute_required_activities(prefs) == ["Fushimi Inari", "Tea ceremony"]


def test_group_profile_unions_and_dedupes() -> None:
    """Interests and constraints are de-duplicated unions across the party."""
    profile = compute_group_profile(
        members=[{"id": "m1"}, {"id": "m2"}],
        preferences=[
            {
                "interests": ["food", "temples"],
                "hard_constraints": ["no red-eye flights"],
                "travel_style": "relaxed",
            },
            {
                "interests": ["food", "hiking"],
                "hard_constraints": ["no red-eye flights"],
                "travel_style": "relaxed",
            },
        ],
    )

    assert profile["member_count"] == 2
    assert profile["interests"] == ["food", "temples", "hiking"]
    assert profile["hard_constraints"] == ["no red-eye flights"]
    assert profile["travel_styles"] == ["relaxed"]


# ===========================================================================
# Structural layer
# ===========================================================================


def test_all_database_enums_registered() -> None:
    """Every enum the agent writes into is covered."""
    for expected in (
        "message_kind",
        "itinerary_source",
        "itinerary_status",
        "vote_session_status",
        "selection_kind",
        "feedback_status",
        "trip_status",
        "agent_run_type",
        "agent_run_status",
    ):
        assert expected in ENUM_COLUMNS


def test_trip_status_enum_has_all_ten_values() -> None:
    """The ten application states."""
    assert len(ENUM_COLUMNS["trip_status"]) == 10


def test_valid_enum_value_passes() -> None:
    """A member value yields no finding."""
    assert validate_enum_column("message_kind", "summary") == []


def test_invalid_enum_value_produces_a_finding() -> None:
    """Requirement 11.8: an out-of-enum value is caught before the write."""
    findings = validate_enum_column("message_kind", "progress")

    assert len(findings) == 1
    assert findings[0]["kind"] == FINDING_INVALID_ENUM
    assert "progress" in findings[0]["message"]


def test_unknown_enum_column_is_a_programming_error() -> None:
    """A bad column name must raise, not be reported as a data finding."""
    with pytest.raises(UnknownProposalKindError):
        validate_enum_column("not_a_column", "x")


def test_structural_validation_accepts_a_valid_proposal() -> None:
    """A well-formed proposal validates and returns the model."""
    model, findings = validate_structural(
        {"title": "t", "items": rec_items(), "question": "q"},
        "destination_recommendation",
    )

    assert findings == []
    assert model is not None
    assert model.category == "destination"


def test_structural_validation_reports_all_errors_in_one_pass() -> None:
    """Requirement 11.5: exhaustive, not first-failure-only."""
    _model, findings = validate_structural(
        {"items": rec_items(1), "bogus": 1}, "destination_recommendation"
    )

    kinds = {f["kind"] for f in findings}
    assert len(findings) >= 3
    assert FINDING_MISSING in kinds
    assert FINDING_UNKNOWN in kinds


def test_structural_findings_name_the_field_path() -> None:
    """Requirement 11.7: each finding names the path from the model root."""
    _model, findings = validate_structural(
        {
            "title": "t",
            "question": "q",
            "items": [{"id": "a", "title": "A", "bad": 1}, *rec_items(2)],
        },
        "destination_recommendation",
    )

    paths = [f["field_path"] for f in findings]
    assert any("items" in str(p) for p in paths)


@pytest.mark.parametrize("garbage", ["a string", None, 42, ["a", "list"]])
def test_unparseable_output_is_a_single_finding_without_field_paths(
    garbage: Any,
) -> None:
    """Requirement 11.9: not structured data at all means no paths to report."""
    model, findings = validate_structural(garbage, "itinerary")

    assert model is None
    assert len(findings) == 1
    assert findings[0]["kind"] == FINDING_UNPARSEABLE
    assert findings[0]["field_path"] is None


def test_unknown_proposal_kind_raises() -> None:
    """An unregistered kind is a programming error."""
    with pytest.raises(UnknownProposalKindError):
        validate_structural({}, "group_profile")


def test_structural_validation_is_deterministic() -> None:
    """Requirement 11.4: same input, same findings, every time."""
    payload = {"items": rec_items(1)}

    first = validate_structural(payload, "destination_recommendation")[1]
    second = validate_structural(payload, "destination_recommendation")[1]

    assert first == second


# ===========================================================================
# Business layer
# ===========================================================================


def test_check_order_is_the_documented_fixed_sequence() -> None:
    """Requirement 12.12: the order is fixed, not incidental."""
    assert CHECK_ORDER == (
        CHECK_BUDGET,
        CHECK_DATES,
        CHECK_TRAVEL_TIME,
        CHECK_HARD_CONSTRAINTS,
        CHECK_REQUIRED_ACTIVITIES,
    )


def test_unconstrained_budget_passes_without_a_finding() -> None:
    """Requirement 12.14: all-NULL budgets must not be read as a zero ceiling."""
    proposal = ItineraryProposal(
        itinerary=itinerary_payload(
            days=[{"day": 1, "items": [{"id": "i1", "title": "A", "cost": 9999}]}]
        )
    )

    findings = run_business_guardrail(proposal, {"budget_ceiling": None})

    assert [f for f in findings if f["check"] == CHECK_BUDGET] == []


def test_over_budget_itinerary_rejected() -> None:
    """A plan costing more than the ceiling is rejected."""
    proposal = ItineraryProposal(
        itinerary=itinerary_payload(
            days=[{"day": 1, "items": [{"id": "i1", "title": "A", "cost": 500}]}]
        )
    )

    findings = run_business_guardrail(proposal, {"budget_ceiling": 100})

    budget = [f for f in findings if f["check"] == CHECK_BUDGET]
    assert len(budget) == 1
    assert budget[0]["violated"] == 100


def test_empty_overlap_rejects_every_date() -> None:
    """Requirement 12.3: no shared window means no date can be scheduled."""
    proposal = ItineraryProposal(
        itinerary=itinerary_payload(
            days=[{"day": 1, "date": "2026-06-01", "items": [{"id": "i1", "title": "A"}]}]
        )
    )

    findings = run_business_guardrail(proposal, {"availability_overlap": []})

    assert [f for f in findings if f["check"] == CHECK_DATES]


def test_date_inside_the_overlap_passes() -> None:
    """A date within the shared window is fine."""
    proposal = ItineraryProposal(
        itinerary=itinerary_payload(
            days=[{"day": 1, "date": "2026-06-05", "items": [{"id": "i1", "title": "A"}]}]
        )
    )

    findings = run_business_guardrail(
        proposal,
        {"availability_overlap": [{"start": "2026-06-01", "end": "2026-06-10"}]},
    )

    assert [f for f in findings if f["check"] == CHECK_DATES] == []


def test_missing_travel_time_is_treated_as_infeasible() -> None:
    """Requirement 12.4: absent duration is a failure, never estimated."""
    proposal = ItineraryProposal(
        itinerary=itinerary_payload(
            days=[
                {
                    "day": 1,
                    "items": [
                        {"id": "a", "title": "A", "time": "09:00", "location_id": "p1"},
                        {"id": "b", "title": "B", "time": "09:30", "location_id": "p2"},
                    ],
                }
            ]
        )
    )

    findings = run_business_guardrail(proposal, {}, tool_responses=[])

    travel = [f for f in findings if f["check"] == CHECK_TRAVEL_TIME]
    assert len(travel) == 1
    assert "absent" in travel[0]["message"]


def test_travel_time_exceeding_the_gap_rejected() -> None:
    """A 90-minute journey cannot fit a 30-minute gap."""
    proposal = ItineraryProposal(
        itinerary=itinerary_payload(
            days=[
                {
                    "day": 1,
                    "items": [
                        {"id": "a", "title": "A", "time": "09:00", "location_id": "p1"},
                        {"id": "b", "title": "B", "time": "09:30", "location_id": "p2"},
                    ],
                }
            ]
        )
    )
    responses = [{"travel_times": [{"from": "p1", "to": "p2", "minutes": 90}]}]

    findings = run_business_guardrail(proposal, {}, tool_responses=responses)

    travel = [f for f in findings if f["check"] == CHECK_TRAVEL_TIME]
    assert len(travel) == 1
    assert travel[0]["violated"] == 30


def test_feasible_travel_time_passes() -> None:
    """A journey that fits the gap is accepted."""
    proposal = ItineraryProposal(
        itinerary=itinerary_payload(
            days=[
                {
                    "day": 1,
                    "items": [
                        {"id": "a", "title": "A", "time": "09:00", "location_id": "p1"},
                        {"id": "b", "title": "B", "time": "11:00", "location_id": "p2"},
                    ],
                }
            ]
        )
    )
    responses = [{"travel_times": [{"from": "p1", "to": "p2", "minutes": 30}]}]

    findings = run_business_guardrail(proposal, {}, tool_responses=responses)

    assert [f for f in findings if f["check"] == CHECK_TRAVEL_TIME] == []


def test_hard_constraint_violation_rejected() -> None:
    """A prohibition the plan breaks is caught."""
    proposal = ItineraryProposal(
        itinerary=itinerary_payload(
            days=[
                {
                    "day": 1,
                    "items": [{"id": "i1", "title": "Red-eye flight to Osaka"}],
                }
            ]
        )
    )

    findings = run_business_guardrail(proposal, {"hard_constraints": ["no red-eye flight"]})

    assert [f for f in findings if f["check"] == CHECK_HARD_CONSTRAINTS]


def test_non_prohibition_constraint_is_not_scanned() -> None:
    """A preference is not something a proposal can "contain" and violate."""
    proposal = ItineraryProposal(itinerary=itinerary_payload())

    findings = run_business_guardrail(proposal, {"hard_constraints": ["prefers window seats"]})

    assert [f for f in findings if f["check"] == CHECK_HARD_CONSTRAINTS] == []


def test_missing_required_activity_rejected() -> None:
    """Requirement 12.6: an omitted must-have activity fails."""
    proposal = ItineraryProposal(itinerary=itinerary_payload())

    findings = run_business_guardrail(proposal, {"required_activities": ["Fushimi Inari"]})

    required = [f for f in findings if f["check"] == CHECK_REQUIRED_ACTIVITIES]
    assert len(required) == 1
    assert required[0]["element"] == "Fushimi Inari"


def test_present_required_activity_passes() -> None:
    """A required activity that appears in the plan is satisfied."""
    proposal = ItineraryProposal(
        itinerary=itinerary_payload(
            days=[{"day": 1, "items": [{"id": "i1", "title": "Fushimi Inari hike"}]}]
        )
    )

    findings = run_business_guardrail(proposal, {"required_activities": ["Fushimi Inari"]})

    assert [f for f in findings if f["check"] == CHECK_REQUIRED_ACTIVITIES] == []


def test_all_checks_run_even_when_the_first_fails() -> None:
    """Requirement 12.12: no short-circuit, so one repair sees everything."""
    proposal = ItineraryProposal(
        itinerary=itinerary_payload(
            days=[
                {
                    "day": 1,
                    "date": "2030-01-01",
                    "items": [{"id": "i1", "title": "Pricey", "cost": 5000}],
                }
            ]
        )
    )

    findings = run_business_guardrail(
        proposal,
        {
            "budget_ceiling": 10,
            "availability_overlap": [{"start": "2026-06-01", "end": "2026-06-10"}],
            "required_activities": ["Missing Thing"],
        },
    )

    checks = {f["check"] for f in findings}
    assert CHECK_BUDGET in checks
    assert CHECK_DATES in checks
    assert CHECK_REQUIRED_ACTIVITIES in checks


def test_business_guardrail_is_deterministic() -> None:
    """Requirement 12.1: same proposal and context, same findings."""
    proposal = ItineraryProposal(
        itinerary=itinerary_payload(
            days=[{"day": 1, "items": [{"id": "i1", "title": "A", "cost": 900}]}]
        )
    )
    profile = {"budget_ceiling": 100}

    assert run_business_guardrail(proposal, profile) == run_business_guardrail(proposal, profile)


# ===========================================================================
# Factual layer
# ===========================================================================


def flight_proposal(**meta: Any) -> FlightRecommendationProposal:
    """A flight recommendation whose first item carries ``meta``."""
    base = [
        {"id": "f1", "title": "Flight 1", "meta": {"flight_id": "F-1", **meta}},
        {"id": "f2", "title": "Flight 2", "meta": {"flight_id": "F-2"}},
        {"id": "f3", "title": "Flight 3", "meta": {"flight_id": "F-3"}},
    ]
    return FlightRecommendationProposal(title="Flights", items=base, question="Which flight?")


def flight_tool_response() -> list[dict[str, Any]]:
    """Shaped like a recorded ``FlightSearchResponse.model_dump()`` — key is
    ``"options"``, matching that model's field name (not ``"flights"``).
    """
    return [
        {
            "options": [
                {"id": "F-1", "carrier": "ANA", "price": 700},
                {"id": "F-2", "carrier": "JAL", "price": 750},
                {"id": "F-3", "carrier": "ANA", "price": 800},
            ]
        }
    ]


def test_unmatched_flight_rejected() -> None:
    """Requirement 13.4: a flight absent from the tool response is rejected."""
    proposal = FlightRecommendationProposal(
        title="Flights",
        question="Pick",
        items=[
            {"id": "f1", "title": "Invented", "meta": {"flight_id": "GHOST"}},
            {"id": "f2", "title": "F2", "meta": {"flight_id": "F-2"}},
            {"id": "f3", "title": "F3", "meta": {"flight_id": "F-3"}},
        ],
    )

    _result, findings, provenance = run_factual_guardrail(proposal, flight_tool_response())

    assert len(findings) == 1
    assert findings[0]["element"] == "f1"
    assert provenance == {}


def test_matching_is_case_sensitive() -> None:
    """Requirement 13.3: no normalised matching — 'f-1' is not 'F-1'."""
    proposal = FlightRecommendationProposal(
        title="Flights",
        question="Pick",
        items=[
            {"id": "f1", "title": "A", "meta": {"flight_id": "f-1"}},
            {"id": "f2", "title": "B", "meta": {"flight_id": "F-2"}},
            {"id": "f3", "title": "C", "meta": {"flight_id": "F-3"}},
        ],
    )

    _result, findings, _prov = run_factual_guardrail(proposal, flight_tool_response())

    assert [f["element"] for f in findings] == ["f1"]


def test_drifted_factual_field_overwritten_from_the_tool() -> None:
    """Requirement 13.1: the tool value wins over the model's."""
    proposal = flight_proposal(carrier="Hallucinated Air", price=1)

    result, findings, provenance = run_factual_guardrail(proposal, flight_tool_response())

    assert findings == []
    assert result.items[0].meta["carrier"] == "ANA"
    assert result.items[0].meta["price"] == 700
    assert provenance["f1"]["id"] == "F-1"


def test_no_overwrite_when_any_item_is_unmatched() -> None:
    """Requirement 13.6: correspondence first, correction only after all match."""
    proposal = FlightRecommendationProposal(
        title="Flights",
        question="Pick",
        items=[
            {"id": "f1", "title": "A", "meta": {"flight_id": "F-1", "carrier": "Wrong"}},
            {"id": "f2", "title": "B", "meta": {"flight_id": "GHOST"}},
            {"id": "f3", "title": "C", "meta": {"flight_id": "F-3"}},
        ],
    )

    result, findings, _prov = run_factual_guardrail(proposal, flight_tool_response())

    assert findings
    # f1 matched, but nothing is corrected because f2 did not.
    assert result.items[0].meta["carrier"] == "Wrong"


def test_narrative_fields_never_overwritten() -> None:
    """Requirement 13.2: titles and descriptions stay the model's work."""
    proposal = flight_proposal(carrier="Wrong Air")

    result, _findings, _prov = run_factual_guardrail(proposal, flight_tool_response())

    assert result.items[0].title == "Flight 1"


def test_itinerary_location_without_id_but_with_name_rejected() -> None:
    """An item claiming a place must identify it."""
    proposal = ItineraryProposal(
        itinerary=itinerary_payload(
            days=[
                {
                    "day": 1,
                    "items": [{"id": "i1", "title": "Visit", "location": "Somewhere"}],
                }
            ]
        )
    )

    _result, findings, _prov = run_factual_guardrail(proposal, [])

    assert len(findings) == 1
    assert findings[0]["element"] == "i1"


def test_itinerary_item_without_any_location_is_skipped() -> None:
    """Free time and travel legs need no looked-up place."""
    proposal = ItineraryProposal(
        itinerary=itinerary_payload(
            days=[{"day": 1, "items": [{"id": "i1", "title": "Free afternoon"}]}]
        )
    )

    _result, findings, _prov = run_factual_guardrail(proposal, [])

    assert findings == []


def test_itinerary_location_name_corrected_from_the_places_tool() -> None:
    """A drifted location name is replaced with the tool's name."""
    proposal = ItineraryProposal(
        itinerary=itinerary_payload(
            days=[
                {
                    "day": 1,
                    "items": [
                        {
                            "id": "i1",
                            "title": "Visit the shrine",
                            "location": "Fushimi Inari-ish",
                            "location_id": "P-1",
                        }
                    ],
                }
            ]
        )
    )
    responses = [{"places": [{"id": "P-1", "name": "Fushimi Inari Taisha"}]}]

    result, findings, provenance = run_factual_guardrail(proposal, responses)

    assert findings == []
    assert result.itinerary.days[0].items[0].location == "Fushimi Inari Taisha"
    assert result.itinerary.days[0].items[0].title == "Visit the shrine"
    assert provenance["i1"]["id"] == "P-1"


def test_destination_recommendation_has_no_factual_fields_to_verify() -> None:
    """Destination meta is descriptive, so this layer has nothing to check."""
    model, _ = validate_structural(
        {"title": "t", "items": rec_items(), "question": "q"},
        "destination_recommendation",
    )

    result, findings, provenance = run_factual_guardrail(model, [])

    assert findings == []
    assert provenance == {}
    assert result is model


def test_provenance_is_not_persisted_anywhere() -> None:
    """Requirement 13.9: provenance is returned for state, not written."""
    proposal = flight_proposal()

    _result, _findings, provenance = run_factual_guardrail(proposal, flight_tool_response())

    # It is a plain mapping handed back to the caller; nothing writes it.
    assert isinstance(provenance, dict)
    assert set(provenance) == {"f1", "f2", "f3"}


# ===========================================================================
# Pipeline orchestration
# ===========================================================================


def test_pipeline_passes_a_fully_valid_proposal() -> None:
    """All three layers accept, and the corrected proposal comes back."""
    outcome = run_guardrail_pipeline(
        {
            "itinerary": itinerary_payload(
                days=[
                    {
                        "day": 1,
                        "items": [
                            {
                                "id": "i1",
                                "title": "Shrine",
                                "location": "Old name",
                                "location_id": "P-1",
                            }
                        ],
                    }
                ]
            )
        },
        "itinerary",
        group_profile={"budget_ceiling": None},
        tool_responses=[{"places": [{"id": "P-1", "name": "Correct Name"}]}],
    )

    assert outcome.passed
    assert outcome.failed_layer is None
    assert outcome.proposal.itinerary.days[0].items[0].location == "Correct Name"


def test_structural_failure_never_reaches_later_layers() -> None:
    """Requirement 11.3: layers run in strict sequence."""
    outcome = run_guardrail_pipeline({"items": rec_items(1)}, "destination_recommendation")

    assert outcome.rejected
    assert outcome.failed_layer == LAYER_STRUCTURAL
    assert all(f["layer"] == "structural" for f in outcome.findings)


def test_business_failure_reported_before_factual_runs() -> None:
    """A business rejection stops the pipeline before factual verification."""
    outcome = run_guardrail_pipeline(
        {
            "itinerary": itinerary_payload(
                days=[
                    {
                        "day": 1,
                        "items": [
                            {
                                "id": "i1",
                                "title": "Pricey",
                                "cost": 5000,
                                "location": "Named",
                            }
                        ],
                    }
                ]
            )
        },
        "itinerary",
        group_profile={"budget_ceiling": 10},
    )

    assert outcome.rejected
    assert outcome.failed_layer == LAYER_BUSINESS
    # The location has no id and would fail the factual layer too, but that layer
    # never ran, so no factual finding appears.
    assert all(f["layer"] == "business" for f in outcome.findings)


def test_factual_failure_surfaces_as_the_failed_layer() -> None:
    """A proposal passing the first two layers can still fail on facts."""
    outcome = run_guardrail_pipeline(
        {
            "itinerary": itinerary_payload(
                days=[
                    {
                        "day": 1,
                        "items": [{"id": "i1", "title": "Visit", "location": "Unverified"}],
                    }
                ]
            )
        },
        "itinerary",
        group_profile={"budget_ceiling": None},
        tool_responses=[],
    )

    assert outcome.rejected
    assert outcome.failed_layer == LAYER_FACTUAL


def test_rejected_outcome_exposes_no_proposal_to_persist() -> None:
    """Requirement 12.11: there is nothing for a caller to write."""
    outcome = run_guardrail_pipeline({}, "itinerary")

    assert outcome.rejected
    assert outcome.proposal is None


def test_finding_checks_summarises_the_rejection() -> None:
    """The helper gives callers a terse reason list for logs and messages."""
    outcome = run_guardrail_pipeline(
        {
            "itinerary": itinerary_payload(
                days=[{"day": 1, "items": [{"id": "i1", "title": "A", "cost": 900}]}]
            )
        },
        "itinerary",
        group_profile={"budget_ceiling": 1},
    )

    assert CHECK_BUDGET in outcome.finding_checks()


def test_outcome_is_immutable() -> None:
    """A node cannot rewrite a guardrail verdict."""
    import dataclasses

    outcome = run_guardrail_pipeline({}, "itinerary")

    with pytest.raises(dataclasses.FrozenInstanceError):
        outcome.passed = True  # type: ignore[misc]


def test_itinerary_model_is_reusable_across_layers() -> None:
    """The validated model is what later layers consume, not raw input."""
    model = ItineraryModel(**itinerary_payload())

    assert model.total_cost() == 0.0
    assert model.all_item_ids() == ["i1"]
