"""Tests for the four Proposal models and their invariants."""

from __future__ import annotations

from typing import Any

import pytest
from app.agents.proposals import (
    PROPOSAL_KIND_BY_RUN_TYPE,
    PROPOSAL_MODELS,
    DestinationRecommendationProposal,
    FlightRecommendationProposal,
    ItineraryModel,
    ItineraryProposal,
    ItineraryVersionModel,
    RefinementProposal,
)
from app.agents.state import RUN_TYPES
from pydantic import ValidationError

TRIP = "11111111-1111-1111-1111-111111111111"
ROOM = "22222222-2222-2222-2222-222222222222"


def items(count: int) -> list[dict[str, Any]]:
    """Build ``count`` recommendation items with unique ids."""
    return [{"id": f"opt-{i}", "title": f"Option {i}", "description": "d"} for i in range(count)]


def recommendation(**overrides: Any) -> dict[str, Any]:
    """Build a valid recommendation payload."""
    payload: dict[str, Any] = {
        "title": "Where shall we go?",
        "items": items(3),
        "question": "Pick a destination",
    }
    payload.update(overrides)
    return payload


def itinerary(**overrides: Any) -> dict[str, Any]:
    """Build a valid itinerary payload."""
    payload: dict[str, Any] = {
        "trip_id": TRIP,
        "room_id": ROOM,
        "title": "Kyoto Quest",
        "summary": "Five days",
        "destination": {"name": "Kyoto", "country": "Japan"},
        "days": [
            {"day": 1, "items": [{"id": "i1", "title": "Arrive"}]},
            {"day": 2, "items": [{"id": "i2", "title": "Temples"}]},
        ],
    }
    payload.update(overrides)
    return payload


# ===========================================================================
# Registry
# ===========================================================================


def test_four_proposal_kinds_registered() -> None:
    """Exactly four proposal kinds, one per run type except tiebreak (advice only)."""
    assert len(PROPOSAL_MODELS) == 4
    assert set(PROPOSAL_KIND_BY_RUN_TYPE) == set(RUN_TYPES) - {"tiebreak"}
    assert set(PROPOSAL_KIND_BY_RUN_TYPE.values()) == set(PROPOSAL_MODELS)


@pytest.mark.parametrize("model", PROPOSAL_MODELS.values(), ids=lambda m: m.__name__)
def test_every_model_forbids_unknown_fields(model: type) -> None:
    """Requirement 11.1: an invented field fails validation."""
    assert model.model_config.get("extra") == "forbid"


# ===========================================================================
# Recommendations
# ===========================================================================


@pytest.mark.parametrize("count", [3, 4, 5])
def test_recommendation_accepts_three_to_five_items(count: int) -> None:
    """The comparison UI expects 3-5 options."""
    proposal = DestinationRecommendationProposal(**recommendation(items=items(count)))

    assert len(proposal.items) == count


@pytest.mark.parametrize("count", [0, 1, 2, 6, 10])
def test_recommendation_rejects_out_of_range_item_counts(count: int) -> None:
    """Fewer than 3 is not a comparison; more than 5 does not fit."""
    with pytest.raises(ValidationError, match="3 to 5 items"):
        DestinationRecommendationProposal(**recommendation(items=items(count)))


def test_recommendation_rejects_duplicate_item_ids() -> None:
    """Vote options map to item ids one-to-one, so ids must be unique."""
    duplicated = [
        {"id": "same", "title": "A"},
        {"id": "same", "title": "B"},
        {"id": "other", "title": "C"},
    ]

    with pytest.raises(ValidationError, match="unique"):
        DestinationRecommendationProposal(**recommendation(items=duplicated))


def test_recommendation_question_is_bounded() -> None:
    """Requirement 7.7 caps the vote question at 200 characters."""
    with pytest.raises(ValidationError):
        DestinationRecommendationProposal(**recommendation(question="x" * 201))


def test_recommendation_requires_a_question() -> None:
    """A recommendation always pairs with a vote, so it needs a question."""
    payload = recommendation()
    del payload["question"]

    with pytest.raises(ValidationError):
        DestinationRecommendationProposal(**payload)


def test_category_is_fixed_per_recommendation_type() -> None:
    """Category is not caller-supplied; it is implied by the proposal type."""
    assert DestinationRecommendationProposal(**recommendation()).category == "destination"
    assert FlightRecommendationProposal(**recommendation()).category == "flight"


def test_option_ids_preserves_presentation_order() -> None:
    """Ranking is the node's job, so order must survive into the vote options."""
    proposal = FlightRecommendationProposal(**recommendation())

    assert proposal.option_ids() == ["opt-0", "opt-1", "opt-2"]


def test_recommendation_rejects_unknown_field() -> None:
    """An invented top-level field is rejected."""
    with pytest.raises(ValidationError):
        DestinationRecommendationProposal(**recommendation(bogus="x"))


def test_nested_item_rejects_unknown_field() -> None:
    """Requirement 11.1 applies recursively, not just at the top level."""
    bad = items(3)
    bad[0]["invented"] = "x"

    with pytest.raises(ValidationError):
        DestinationRecommendationProposal(**recommendation(items=bad))


# ===========================================================================
# Itinerary
# ===========================================================================


def test_itinerary_accepts_a_valid_payload() -> None:
    """A well-formed itinerary validates."""
    model = ItineraryModel(**itinerary())

    assert model.day_numbers() == [1, 2]
    assert model.all_item_ids() == ["i1", "i2"]


def test_itinerary_requires_at_least_one_day() -> None:
    """An empty plan is not an itinerary."""
    with pytest.raises(ValidationError, match="at least one day"):
        ItineraryModel(**itinerary(days=[]))


def test_itinerary_rejects_gapped_day_numbers() -> None:
    """Requirement 9.2: days increment by one with no gaps."""
    gapped = [
        {"day": 1, "items": [{"id": "a", "title": "A"}]},
        {"day": 3, "items": [{"id": "b", "title": "B"}]},
    ]

    with pytest.raises(ValidationError, match="no gaps"):
        ItineraryModel(**itinerary(days=gapped))


def test_itinerary_rejects_days_not_starting_at_one() -> None:
    """Day numbering starts at 1."""
    shifted = [{"day": 2, "items": [{"id": "a", "title": "A"}]}]

    with pytest.raises(ValidationError, match="no gaps"):
        ItineraryModel(**itinerary(days=shifted))


def test_itinerary_rejects_duplicate_item_ids_across_days() -> None:
    """Requirement 9.9: feedback.target.itemId must resolve to exactly one item."""
    clashing = [
        {"day": 1, "items": [{"id": "dup", "title": "A"}]},
        {"day": 2, "items": [{"id": "dup", "title": "B"}]},
    ]

    with pytest.raises(ValidationError, match="unique"):
        ItineraryModel(**itinerary(days=clashing))


def test_item_id_is_required() -> None:
    """An item without an id cannot be targeted by feedback."""
    with pytest.raises(ValidationError):
        ItineraryModel(**itinerary(days=[{"day": 1, "items": [{"title": "No id"}]}]))


@pytest.mark.parametrize("count", [0, 11])
def test_day_item_count_is_bounded(count: int) -> None:
    """Requirement 9.3 bounds a day at 1-10 items."""
    day = {
        "day": 1,
        "items": [{"id": f"x{i}", "title": "t"} for i in range(count)],
    }

    with pytest.raises(ValidationError):
        ItineraryModel(**itinerary(days=[day]))


def test_total_cost_treats_missing_cost_as_zero() -> None:
    """Requirement 12.2: an item with no costed value contributes 0."""
    model = ItineraryModel(
        **itinerary(
            days=[
                {
                    "day": 1,
                    "items": [
                        {"id": "a", "title": "A", "cost": 100.0},
                        {"id": "b", "title": "B"},
                    ],
                }
            ]
        )
    )

    assert model.total_cost() == 100.0


def test_negative_cost_rejected() -> None:
    """A negative cost is not a price."""
    with pytest.raises(ValidationError):
        ItineraryModel(
            **itinerary(days=[{"day": 1, "items": [{"id": "a", "title": "A", "cost": -5}]}])
        )


def test_map_point_coordinates_are_bounded() -> None:
    """Latitude and longitude are checked, so the map cannot plot nonsense."""
    with pytest.raises(ValidationError):
        ItineraryModel(**itinerary(map=[{"label": "x", "lat": 999, "lng": 0}]))


def test_to_persistable_strips_agent_internal_scope() -> None:
    """``affected_scope`` is bookkeeping and must not reach the database."""
    proposal = ItineraryProposal(
        itinerary=itinerary(), affected_scope={"days": [1], "item_ids": ["i1"]}
    )

    payload = proposal.to_persistable()

    assert "affected_scope" not in payload
    assert payload["title"] == "Kyoto Quest"


# ===========================================================================
# Refinement
# ===========================================================================


def test_refinement_requires_a_change_summary() -> None:
    """Requirement 10.5: a refine version always explains what changed."""
    with pytest.raises(ValidationError):
        RefinementProposal(itinerary=itinerary())


def test_refinement_change_summary_is_bounded() -> None:
    """The summary is capped at 500 characters."""
    with pytest.raises(ValidationError):
        RefinementProposal(itinerary=itinerary(), change_summary="x" * 501)


def test_refinement_tracks_addressed_and_unresolved_feedback() -> None:
    """Requirement 10.6-10.7: addressed and still-open rows are distinguished."""
    proposal = RefinementProposal(
        itinerary=itinerary(),
        change_summary="swapped day 2",
        addressed_feedback_ids=["f1"],
        unresolved_feedback_ids=["f2"],
    )

    assert proposal.addressed_feedback_ids == ["f1"]
    assert proposal.unresolved_feedback_ids == ["f2"]


# ===========================================================================
# Version envelope
# ===========================================================================


def version(**overrides: Any) -> dict[str, Any]:
    """Build a valid itinerary-version payload."""
    payload: dict[str, Any] = {
        "id": "66666666-6666-6666-6666-666666666666",
        "version": 1,
        "source": "build",
        "status": "proposed",
        "itinerary": itinerary(),
    }
    payload.update(overrides)
    return payload


def test_version_requires_id_and_status_despite_frontend_gap() -> None:
    """Requirement 9.16/10.16: output is not narrowed by the drifted frontend type."""
    model = ItineraryVersionModel(**version())

    assert model.id
    assert model.status == "proposed"

    without_id = version()
    del without_id["id"]
    with pytest.raises(ValidationError):
        ItineraryVersionModel(**without_id)

    without_status = version()
    del without_status["status"]
    with pytest.raises(ValidationError):
        ItineraryVersionModel(**without_status)


def test_version_rejects_is_current_substitute() -> None:
    """The frontend's ``isCurrent`` is not part of the agent's output contract."""
    with pytest.raises(ValidationError):
        ItineraryVersionModel(**version(isCurrent=True))


@pytest.mark.parametrize(
    ("version_number", "source"),
    [(1, "build"), (2, "refine"), (7, "refine")],
)
def test_valid_version_source_pairings(version_number: int, source: str) -> None:
    """Mirrors the DB CHECK: version 1 iff build."""
    model = ItineraryVersionModel(**version(version=version_number, source=source))

    assert model.version == version_number
    assert model.source == source


@pytest.mark.parametrize(
    ("version_number", "source"),
    [(1, "refine"), (2, "build"), (5, "build")],
)
def test_invalid_version_source_pairings_rejected(version_number: int, source: str) -> None:
    """Requirement 5.7: an invalid pairing fails before the write, not at the DB."""
    with pytest.raises(ValidationError, match="source"):
        ItineraryVersionModel(**version(version=version_number, source=source))


def test_version_zero_rejected() -> None:
    """Versions start at 1."""
    with pytest.raises(ValidationError):
        ItineraryVersionModel(**version(version=0, source="build"))
