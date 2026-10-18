"""Guardrail layer 3: factual validation against external tool responses.

External tool responses are authoritative over LLM output for every field
classified as factual (Requirement 13.1). The model reasons over retrieved
facts; it does not get to invent them.

Three rules shape this layer, each chosen to close a specific hole:

* **Exact, case-sensitive identifier matching only** (Requirement 13.3). No fuzzy
  or normalised matching: "close enough" is how a hallucinated flight slips
  through wearing a real flight's name.
* **Reject-then-overwrite, never both.** Correspondence is checked for *all*
  items first; only if every item matches does any factual field get corrected
  (Requirement 13.6). Correcting fields on a proposal that already has a
  rejection would be patching something about to be thrown away.
* **Narrative fields are never touched.** Titles, descriptions, and NPC flavour
  text are the model's job (Requirement 13.2). Only the enumerated factual
  fields are overwritten.

Provenance — which tool entry each factual value came from — is held in agent
state for the life of the run only, and written to no table
(Requirement 13.9).
"""

from __future__ import annotations

from typing import Any

from app.agents.proposals import (
    FlightRecommendationProposal,
    ItineraryProposal,
    RefinementProposal,
)

#: Factual fields per entity, exactly as enumerated in Requirement 13.2.
#: Field names here must match ``FlightOption`` (``app.agents.tools.base``) field
#: by field: that model is the actual shape a recorded flight tool response
#: carries, so a name here that drifts from it would mean a correction this
#: layer is supposed to make silently never fires. ``depart_at``/``arrive_at``
#: (not ``departure_time``/``arrival_time``) is the real field pair.
FLIGHT_FACTUAL_FIELDS: frozenset[str] = frozenset(
    {
        "carrier",
        "flight_number",
        "origin",
        "destination",
        "depart_at",
        "arrive_at",
        "price",
    }
)
PLACE_FACTUAL_FIELDS: frozenset[str] = frozenset({"id", "name", "lat", "lng", "opening_hours"})
WEATHER_FACTUAL_FIELDS: frozenset[str] = frozenset({"date", "temperature", "precipitation"})

#: Fields that are the model's to write, and which this layer never corrects.
NARRATIVE_FIELDS: frozenset[str] = frozenset(
    {"title", "description", "summary", "prompt", "question", "tags", "label"}
)

FINDING_NO_IDENTIFIER = "missing_identifier"
FINDING_NO_MATCH = "no_tool_match"


def _finding(kind: str, element: str, message: str) -> dict[str, Any]:
    """Build one factual rejection finding."""
    return {
        "layer": "factual",
        "kind": kind,
        "element": element,
        "message": message,
    }


def _index_by_id(entries: list[dict[str, Any]], id_key: str) -> dict[str, dict[str, Any]]:
    """Index tool entries by their identifier, skipping entries without one."""
    indexed: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        identifier = entry.get(id_key)
        if isinstance(identifier, str) and identifier:
            indexed[identifier] = entry
    return indexed


def collect_tool_entries(
    tool_responses: list[dict[str, Any]],
    kind: str,
) -> list[dict[str, Any]]:
    """Return every entry of ``kind`` across the run's recorded tool responses.

    Args:
        tool_responses: Recorded responses from agent state.
        kind: ``"flights"``, ``"places"``, or ``"weather"``.
    """
    entries: list[dict[str, Any]] = []
    for response in tool_responses:
        if not isinstance(response, dict):
            continue
        for entry in response.get(kind) or []:
            if isinstance(entry, dict):
                entries.append(entry)
    return entries


# ---------------------------------------------------------------------------
# Flight recommendations
# ---------------------------------------------------------------------------


def _validate_flights(
    proposal: FlightRecommendationProposal,
    tool_responses: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Check each flight option against the flight tool response.

    Recorded flight tool responses are ``FlightSearchResponse.model_dump()``
    (``app.agents.tools.base``), which carries its entries under ``"options"``,
    not ``"flights"`` — the key here must match that model's field name, since
    that is what a run's ``external_tool_responses`` actually contain.
    """
    available = _index_by_id(collect_tool_entries(tool_responses, "options"), "id")
    findings: list[dict[str, Any]] = []
    provenance: dict[str, dict[str, Any]] = {}

    for item in proposal.items:
        identifier = item.meta.get("flight_id") or item.id
        if not isinstance(identifier, str) or not identifier:
            findings.append(
                _finding(
                    FINDING_NO_IDENTIFIER,
                    item.id,
                    f"flight option {item.id!r} carries no identifier, so it "
                    "corresponds to no tool entry",
                )
            )
            continue
        match = available.get(identifier)
        if match is None:
            findings.append(
                _finding(
                    FINDING_NO_MATCH,
                    item.id,
                    f"flight option {identifier!r} does not correspond to any "
                    "entry in the flight tool response",
                )
            )
            continue
        provenance[item.id] = match

    return findings, provenance


def _overwrite_flight_fields(
    proposal: FlightRecommendationProposal,
    provenance: dict[str, dict[str, Any]],
) -> FlightRecommendationProposal:
    """Replace drifted factual meta values with the tool's values."""
    corrected_items = []
    for item in proposal.items:
        source = provenance.get(item.id)
        if source is None:
            corrected_items.append(item)
            continue
        meta = dict(item.meta)
        for field in FLIGHT_FACTUAL_FIELDS:
            if field in source:
                meta[field] = source[field]
        corrected_items.append(item.model_copy(update={"meta": meta}))
    return proposal.model_copy(update={"items": corrected_items})


# ---------------------------------------------------------------------------
# Itinerary locations
# ---------------------------------------------------------------------------


def _validate_locations(
    itinerary_proposal: ItineraryProposal | RefinementProposal,
    tool_responses: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Check each located itinerary item against the places tool response.

    Items with no ``location_id`` are skipped: an activity need not reference a
    looked-up place (free time, travel, a meal with no fixed venue), and
    demanding one would make valid itineraries unbuildable. An item that *claims*
    a location but names no id is a different matter and is rejected.
    """
    available = _index_by_id(collect_tool_entries(tool_responses, "places"), "id")
    findings: list[dict[str, Any]] = []
    provenance: dict[str, dict[str, Any]] = {}

    for day in itinerary_proposal.itinerary.days:
        for item in day.items:
            if item.location_id is None:
                if item.location:
                    findings.append(
                        _finding(
                            FINDING_NO_IDENTIFIER,
                            item.id,
                            f"item {item.id!r} names a location but carries no "
                            "location_id, so it corresponds to no tool entry",
                        )
                    )
                continue
            match = available.get(item.location_id)
            if match is None:
                findings.append(
                    _finding(
                        FINDING_NO_MATCH,
                        item.id,
                        f"location {item.location_id!r} on item {item.id!r} does "
                        "not correspond to any entry in the places tool response",
                    )
                )
                continue
            provenance[item.id] = match

    return findings, provenance


def _overwrite_location_fields(
    itinerary_proposal: ItineraryProposal | RefinementProposal,
    provenance: dict[str, dict[str, Any]],
) -> ItineraryProposal | RefinementProposal:
    """Replace a drifted location name with the places tool's name.

    Only ``location`` is corrected. ``title`` and ``description`` stay as written
    even though they may mention the place, because they are narrative
    (Requirement 13.2).
    """
    corrected_days = []
    for day in itinerary_proposal.itinerary.days:
        corrected_items = []
        for item in day.items:
            source = provenance.get(item.id)
            if source is None or "name" not in source:
                corrected_items.append(item)
                continue
            corrected_items.append(item.model_copy(update={"location": source["name"]}))
        corrected_days.append(day.model_copy(update={"items": corrected_items}))

    corrected_itinerary = itinerary_proposal.itinerary.model_copy(update={"days": corrected_days})
    return itinerary_proposal.model_copy(update={"itinerary": corrected_itinerary})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def run_factual_guardrail(
    proposal: Any,
    tool_responses: list[dict[str, Any]] | None = None,
) -> tuple[Any, list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Validate factual claims and correct drifted values.

    Args:
        proposal: A proposal that already passed the structural and business
            layers.
        tool_responses: Recorded external tool responses for this run.

    Returns:
        ``(proposal, findings, provenance)``.

        On success ``findings`` is empty and ``proposal`` carries tool-sourced
        factual values. When ``findings`` is non-empty the proposal is returned
        **uncorrected**: correspondence failed, so nothing is overwritten
        (Requirement 13.6).

        ``provenance`` maps each validated element id to the tool entry its
        factual values came from — held in state for the run only, never
        persisted (Requirement 13.9).
    """
    responses = tool_responses or []

    if isinstance(proposal, FlightRecommendationProposal):
        findings, provenance = _validate_flights(proposal, responses)
        if findings:
            return proposal, findings, {}
        return _overwrite_flight_fields(proposal, provenance), [], provenance

    if isinstance(proposal, ItineraryProposal | RefinementProposal):
        findings, provenance = _validate_locations(proposal, responses)
        if findings:
            return proposal, findings, {}
        return _overwrite_location_fields(proposal, provenance), [], provenance

    # A destination recommendation carries no tool-sourced factual fields: its
    # meta is descriptive (region, budget band, highlights), so there is nothing
    # for this layer to verify.
    return proposal, [], {}
