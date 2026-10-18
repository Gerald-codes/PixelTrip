"""Tests for the Sky Scrapper (RapidAPI) flight adapter, using a fake HTTP transport.

No real requests are made, so these never spend the free-plan quota.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from app.agents.tools import skyscanner_rapidapi
from app.agents.tools.base import FlightSearchResponse
from app.agents.tools.skyscanner_rapidapi import (
    PlaceNotFoundError,
    SkyscannerRapidApiClient,
    to_flight_options,
)
from app.core.config import Settings

pytestmark = pytest.mark.anyio

PLACES = {
    "SIN": {"skyId": "SIN", "entityId": "95673375"},
    "Tokyo": {"skyId": "TYOA", "entityId": "27542089"},
}


def itinerary(**overrides: Any) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": "it-1",
        "price": {"raw": 612.4, "formatted": "S$613"},
        "legs": [
            {
                "origin": {"id": "SIN", "displayCode": "SIN"},
                "destination": {"id": "NRT", "displayCode": "NRT"},
                "departure": "2026-12-20T09:05:00",
                "arrival": "2026-12-20T17:05:00",
                "durationInMinutes": 420,
                "stopCount": 0,
                "carriers": {"marketing": [{"name": "Singapore Airlines", "alternateId": "SQ"}]},
                "segments": [{"flightNumber": "12", "marketingCarrier": {"alternateId": "SQ"}}],
            }
        ],
    }
    item.update(overrides)
    return item


@pytest.fixture(autouse=True)
def clear_place_cache():
    skyscanner_rapidapi._place_cache.clear()
    yield
    skyscanner_rapidapi._place_cache.clear()


@pytest.fixture
def settings() -> Settings:
    return Settings(
        supabase_url="https://x.supabase.co",
        supabase_service_role_key="k",
        flight_provider="skyscanner_rapidapi",
        flight_api_url="",  # use the provider's default base URL
        flight_api_key="rapid-key",
        flight_currency="SGD",
    )


class FakeProvider:
    """Records requests and answers like Sky Scrapper."""

    def __init__(self, search_bodies: list[dict[str, Any]], status: int = 200) -> None:
        self.requests: list[httpx.Request] = []
        self._search_bodies = list(search_bodies)
        self._status = status

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self._status != 200:
            return httpx.Response(self._status, json={"message": "quota"})
        if request.url.path.endswith("/searchAirport"):
            place = PLACES.get(request.url.params["query"])
            data = [{"skyId": "X", "navigation": {"relevantFlightParams": place}}] if place else []
            return httpx.Response(200, json={"status": True, "data": data})
        return httpx.Response(200, json=self._search_bodies.pop(0))

    def paths(self) -> list[str]:
        return [r.url.path.rsplit("/", 1)[-1] for r in self.requests]


async def search(settings: Settings, provider: FakeProvider, **params: Any) -> dict[str, Any]:
    client = SkyscannerRapidApiClient(settings, transport=httpx.MockTransport(provider.handler))
    query = {"origin": "SIN", "destination": "Tokyo", "depart_after": "2026-12-20"}
    query.update(params)
    return await client.search(**query)


async def test_search_resolves_places_and_maps_options(settings):
    provider = FakeProvider([{"status": True, "data": {"itineraries": [itinerary()]}}])

    result = await search(settings, provider)

    assert provider.paths() == ["searchAirport", "searchAirport", "searchFlights"]
    flight_request = provider.requests[2]
    assert flight_request.url.params["originSkyId"] == "SIN"
    assert flight_request.url.params["destinationSkyId"] == "TYOA"
    assert flight_request.url.params["destinationEntityId"] == "27542089"
    assert flight_request.url.params["date"] == "2026-12-20"
    assert flight_request.url.params["currency"] == "SGD"
    assert flight_request.headers["X-RapidAPI-Key"] == "rapid-key"
    assert flight_request.headers["X-RapidAPI-Host"] == "sky-scrapper.p.rapidapi.com"
    assert result == {
        "options": [
            {
                "id": "it-1",
                "carrier": "Singapore Airlines",
                "flight_number": "SQ12",
                "origin": "SIN",
                "destination": "NRT",
                "depart_at": "2026-12-20T09:05:00",
                "arrive_at": "2026-12-20T17:05:00",
                "price": 612.4,
                "duration_minutes": 420,
                "stops": 0,
            }
        ]
    }
    FlightSearchResponse.model_validate(result)  # the agent's strict model accepts it


async def test_place_lookups_are_cached_across_searches(settings):
    body = {"status": True, "data": {"itineraries": [itinerary()]}}
    provider = FakeProvider([body, body])

    await search(settings, provider)
    await search(settings, provider)

    assert provider.paths().count("searchAirport") == 2  # only the first search looks up


async def test_incomplete_search_gets_one_follow_up(settings):
    provider = FakeProvider(
        [
            {"status": True, "data": {"context": {"status": "incomplete", "sessionId": "s1"}}},
            {"status": True, "data": {"itineraries": [itinerary()]}},
        ]
    )

    result = await search(settings, provider)

    assert provider.paths()[-1] == "searchIncomplete"
    assert provider.requests[-1].url.params["sessionId"] == "s1"
    assert len(result["options"]) == 1


async def test_unknown_place_raises(settings):
    provider = FakeProvider([])

    with pytest.raises(PlaceNotFoundError):
        await search(settings, provider, destination="Atlantis")


async def test_http_error_raises(settings):
    provider = FakeProvider([], status=429)

    with pytest.raises(httpx.HTTPStatusError):
        await search(settings, provider)


async def test_provider_status_false_raises(settings):
    provider = FakeProvider([{"status": False, "message": "error"}])

    with pytest.raises(httpx.HTTPStatusError):
        await search(settings, provider)


def test_malformed_itineraries_are_skipped():
    broken_leg = itinerary(id="it-2")
    del broken_leg["legs"][0]["arrival"]
    options = to_flight_options([itinerary(), broken_leg, {"id": "it-3"}])

    assert [o["id"] for o in options] == ["it-1"]


def test_options_are_capped():
    options = to_flight_options([itinerary(id=f"it-{i}") for i in range(25)])

    assert len(options) == skyscanner_rapidapi.MAX_OPTIONS


async def test_flight_tool_routes_to_the_rapidapi_provider(settings, monkeypatch):
    from app.agents.tools.flights import FlightSearchTool

    calls: list[dict[str, Any]] = []

    async def fake_search(self, **params: Any) -> dict[str, Any]:
        calls.append(params)
        return {"options": []}

    monkeypatch.setattr(SkyscannerRapidApiClient, "search", fake_search)

    result = await FlightSearchTool(settings)._call(origin="SIN", destination="Tokyo")

    assert result == {"options": []}
    assert calls == [{"origin": "SIN", "destination": "Tokyo"}]


async def test_round_trip_when_the_party_has_a_later_date(settings):
    round_trip = itinerary()
    round_trip["legs"].append(
        {
            **round_trip["legs"][0],
            "origin": {"displayCode": "NRT"},
            "destination": {"displayCode": "SIN"},
            "departure": "2026-12-28T10:30:00",
            "arrival": "2026-12-28T16:40:00",
        }
    )
    provider = FakeProvider([{"status": True, "data": {"itineraries": [round_trip]}}])

    result = await search(settings, provider, depart_before="2026-12-28")

    assert provider.requests[-1].url.params["returnDate"] == "2026-12-28"
    option = result["options"][0]
    assert option["return_depart_at"] == "2026-12-28T10:30:00"
    assert option["return_arrive_at"] == "2026-12-28T16:40:00"
    FlightSearchResponse.model_validate(result)


async def test_one_way_without_a_later_date(settings):
    provider = FakeProvider([{"status": True, "data": {"itineraries": [itinerary()]}}])

    result = await search(settings, provider)

    assert "returnDate" not in provider.requests[-1].url.params
    assert "return_depart_at" not in result["options"][0]


def test_flight_number_prefers_the_iata_display_code():
    item = itinerary()
    item["legs"][0]["segments"][0] = {
        "flightNumber": "54",
        "marketingCarrier": {"alternateId": "_Z", "displayCode": "ZG", "name": "Zipair"},
    }

    assert to_flight_options([item])[0]["flight_number"] == "ZG54"


async def test_requests_use_the_configured_timeout(settings, monkeypatch):
    seen: list[httpx.Timeout] = []
    real_init = httpx.AsyncClient.__init__

    def recording_init(self, *args, **kwargs):
        seen.append(kwargs.get("timeout"))
        real_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", recording_init)
    provider = FakeProvider([{"status": True, "data": {"itineraries": [itinerary()]}}])

    await search(settings, provider)

    assert seen == [settings.external_tool_timeout_seconds]
