"""Booking COM adapter and the flight provider chain (no real requests)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from app.agents.tools import booking_rapidapi, flights
from app.agents.tools.base import FlightSearchResponse
from app.agents.tools.booking_rapidapi import BookingRapidApiClient, to_flight_options
from app.agents.tools.flights import FlightSearchTool, NoFlightProviderAvailableError
from app.core.config import Settings

pytestmark = pytest.mark.anyio

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "booking_com15_search.json").read_text())
QUERY = {
    "origin": "SIN",
    "destination": "Penang, Malaysia",
    "depart_after": "2026-11-12",
    "depart_before": "2026-11-16",
}


@pytest.fixture(autouse=True)
def fresh_state():
    booking_rapidapi._place_cache.clear()
    flights._unavailable_until.clear()
    yield
    booking_rapidapi._place_cache.clear()
    flights._unavailable_until.clear()


def settings(provider: str = "booking_rapidapi") -> Settings:
    return Settings(
        supabase_url="https://x.supabase.co",
        supabase_service_role_key="k",
        flight_provider=provider,
        flight_api_key="rapid-key",
        flight_currency="SGD",
    )


def booking_transport(requests: list[httpx.Request]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("searchDestination"):
            code = "SIN" if request.url.params["query"] == "SIN" else "PEN"
            return httpx.Response(200, json={"status": True, "data": [{"id": f"{code}.AIRPORT"}]})
        return httpx.Response(200, json=FIXTURE)

    return httpx.MockTransport(handler)


# --- Booking COM adapter --------------------------------------------------------------


def test_offers_map_to_flight_options():
    options = to_flight_options(FIXTURE["data"]["flightOffers"])

    first = options[0]
    assert first == {
        "id": "1_AK1722_2_AK1721.SIN20261112.PEN20261116",
        "carrier": "Air Asia",
        "flight_number": "AK1722",
        "origin": "SIN",
        "destination": "PEN",
        "depart_at": "2026-11-12T13:50:00",
        "arrive_at": "2026-11-12T15:10:00",
        "price": 140.82,
        "duration_minutes": 80,
        "stops": 0,
        "return_depart_at": "2026-11-16T09:55:00",
        "return_arrive_at": "2026-11-16T11:20:00",
    }
    FlightSearchResponse.model_validate({"options": options})  # fits the agent's model


def test_malformed_offers_are_skipped():
    assert to_flight_options([{"segments": []}, {"flightKey": "x"}]) == []


async def test_search_resolves_places_once_and_sends_a_round_trip():
    requests: list[httpx.Request] = []
    client = BookingRapidApiClient(settings(), transport=booking_transport(requests))

    result = await client.search(**QUERY)
    await client.search(**QUERY)  # places come from the cache the second time

    assert len(result["options"]) == 3
    paths = [r.url.path.rsplit("/", 1)[-1] for r in requests]
    assert paths == ["searchDestination", "searchDestination", "searchFlights", "searchFlights"]
    search = requests[2]
    assert search.url.params["fromId"] == "SIN.AIRPORT"
    assert search.url.params["toId"] == "PEN.AIRPORT"
    assert search.url.params["returnDate"] == "2026-11-16"
    assert search.url.params["currency_code"] == "SGD"
    assert search.headers["x-rapidapi-host"] == "booking-com15.p.rapidapi.com"
    assert search.headers["x-rapidapi-key"] == "rapid-key"


# --- Provider chain -------------------------------------------------------------------


class FakeChain(FlightSearchTool):
    """The chain with scripted providers instead of HTTP."""

    def __init__(self, provider: str, answers: dict[str, Any]) -> None:
        super().__init__(settings(provider))
        self.answers = answers
        self.calls: list[str] = []

    async def _search(self, provider: str, **params: Any) -> dict[str, Any]:
        self.calls.append(provider)
        answer = self.answers[provider]
        if isinstance(answer, Exception):
            raise answer
        return answer


def http_error(status: int, headers: dict[str, str] | None = None) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "https://example.test")
    response = httpx.Response(status, headers=headers or {}, request=request)
    return httpx.HTTPStatusError("error", request=request, response=response)


FLIGHTS = {"options": [{"id": "f1"}]}


async def test_settings_parse_an_ordered_provider_list():
    chain = settings(
        " booking_rapidapi , skyscanner_rapidapi,booking_rapidapi"
    ).flight_provider_chain
    assert chain == ("booking_rapidapi", "skyscanner_rapidapi")
    with pytest.raises(ValueError):
        settings("booking_rapidapi,made_up")


async def test_the_first_provider_that_answers_wins():
    tool = FakeChain("booking_rapidapi,skyscanner_rapidapi", {"booking_rapidapi": FLIGHTS})

    assert await tool._call(**QUERY) == FLIGHTS
    assert tool.calls == ["booking_rapidapi"]


async def test_out_of_quota_falls_back_and_is_skipped_until_reset():
    tool = FakeChain(
        "skyscanner_rapidapi,booking_rapidapi",
        {
            "skyscanner_rapidapi": http_error(429, {"x-ratelimit-requests-reset": "86400"}),
            "booking_rapidapi": FLIGHTS,
        },
    )

    assert await tool._call(**QUERY) == FLIGHTS
    assert await tool._call(**QUERY) == FLIGHTS
    # Sky Scrapper was asked once, then rested; Booking answered both times.
    assert tool.calls == ["skyscanner_rapidapi", "booking_rapidapi", "booking_rapidapi"]


async def test_not_subscribed_and_other_errors_fall_back():
    tool = FakeChain(
        "skyscanner_rapidapi,generic,booking_rapidapi",
        {
            "skyscanner_rapidapi": http_error(403),
            "generic": booking_rapidapi.PlaceNotFoundError("no matching place"),
            "booking_rapidapi": FLIGHTS,
        },
    )

    assert await tool._call(**QUERY) == FLIGHTS
    assert "skyscanner_rapidapi" in flights._unavailable_until
    assert "generic" not in flights._unavailable_until  # a one-off failure, not a rest


async def test_zero_flights_tries_the_next_provider():
    tool = FakeChain(
        "booking_rapidapi,skyscanner_rapidapi",
        {"booking_rapidapi": {"options": []}, "skyscanner_rapidapi": FLIGHTS},
    )

    assert await tool._call(**QUERY) == FLIGHTS


async def test_every_provider_failing_raises_the_last_error():
    tool = FakeChain(
        "booking_rapidapi,skyscanner_rapidapi",
        {"booking_rapidapi": http_error(500), "skyscanner_rapidapi": http_error(502)},
    )

    with pytest.raises(httpx.HTTPStatusError) as caught:
        await tool._call(**QUERY)
    assert caught.value.response.status_code == 502


async def test_all_providers_resting_fails_fast_without_a_request():
    tool = FakeChain("booking_rapidapi", {"booking_rapidapi": FLIGHTS})
    flights._unavailable_until["booking_rapidapi"] = flights._now() + 999

    with pytest.raises(NoFlightProviderAvailableError):
        await tool._call(**QUERY)
    assert tool.calls == []


async def test_each_provider_gets_the_full_timeout():
    tool = FakeChain("booking_rapidapi,skyscanner_rapidapi", {})
    assert tool._call_timeout_seconds() == 2 * tool._settings.external_tool_timeout_seconds


# --- booking-com18 (v2 search, prices converted on our side) -------------------------

B18_FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "booking_com18_v2_search.json").read_text()
)


def b18_transport(requests: list[httpx.Request], body: dict[str, Any] | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("auto-complete"):
            return httpx.Response(200, json={"data": [{"iataCode": "PEN"}], "status": True})
        return httpx.Response(200, json=body or B18_FIXTURE)

    return httpx.MockTransport(handler)


def b18_client(requests, body=None, **overrides):
    from app.agents.tools.booking18_rapidapi import Booking18RapidApiClient

    s = settings("booking18_rapidapi").model_copy(update=overrides)
    return Booking18RapidApiClient(s, transport=b18_transport(requests, body))


@pytest.fixture(autouse=True)
def fresh_b18_cache():
    from app.agents.tools import booking18_rapidapi

    booking18_rapidapi._place_cache.clear()
    yield
    booking18_rapidapi._place_cache.clear()


async def test_booking18_searches_cheapest_first_and_converts_to_sgd():
    requests: list[httpx.Request] = []

    result = await b18_client(requests).search(**QUERY)

    first = result["options"][0]
    assert first["carrier"] == "Scoot" and first["flight_number"] == "TR430"
    assert first["price"] == round(156.98 * 0.93, 2)  # CAD -> SGD at the configured rate
    FlightSearchResponse.model_validate(result)
    # "SIN" is used as it is; only the destination name is looked up (by its city part).
    lookups = [r for r in requests if r.url.path.endswith("auto-complete")]
    assert [r.url.params["query"] for r in lookups] == ["Penang"]
    search = requests[-1]
    assert search.url.path == "/flights/v2/search-roundtrip"
    assert dict(search.url.params) == {
        "departId": "SIN",
        "arrivalId": "PEN",
        "departDate": "2026-11-12",
        "returnDate": "2026-11-16",
        "adults": "1",
        "cabinClass": "ECONOMY",
        "sort": "CHEAPEST",
        "page": "1",
    }
    assert search.headers["x-rapidapi-host"] == "booking-com18.p.rapidapi.com"


async def test_booking18_uses_the_rate_for_whatever_currency_comes_back():
    usd = json.loads(json.dumps(B18_FIXTURE))
    for offer in usd["data"]["flightOffers"]:
        offer["priceBreakdown"]["total"] = {"currencyCode": "USD", "units": 101, "nanos": 0}

    result = await b18_client([], usd, flight_fx_rates="USD:1.28").search(**QUERY)

    assert result["options"][0]["price"] == 129.28


async def test_booking18_refuses_a_currency_it_has_no_rate_for():
    from app.agents.tools.booking18_rapidapi import UnsupportedSearchError

    with pytest.raises(UnsupportedSearchError):
        await b18_client([], flight_fx_rates="USD:1.28").search(**QUERY)  # fixture is CAD


async def test_booking18_searches_one_way_without_a_return_date():
    requests: list[httpx.Request] = []

    await b18_client(requests).search(
        origin="SIN", destination="PEN", depart_after="2026-11-12", depart_before=None
    )

    assert requests[-1].url.path == "/flights/v2/search-oneway"
    assert "returnDate" not in requests[-1].url.params


async def test_booking18_tries_the_citys_next_airport_when_the_first_has_no_flights():
    """Yogyakarta's first code (JOG) is its old airport; flights go to YIA."""
    from app.agents.tools.booking18_rapidapi import Booking18RapidApiClient

    searched: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("auto-complete"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"type": "CITY", "cityCode": "JOG", "iataCode": "JOG"},
                        {"type": "AIRPORT", "cityCode": "JOG", "iataCode": "JOG"},
                        {"type": "AIRPORT", "cityCode": "JOG", "iataCode": "YIA"},
                        {"type": "AIRPORT", "cityCode": "SOC", "iataCode": "SOC"},
                    ]
                },
            )
        arrival = request.url.params["arrivalId"]
        searched.append(arrival)
        body = B18_FIXTURE if arrival == "YIA" else {"data": {"flightOffers": []}, "status": True}
        return httpx.Response(200, json=body)

    client = Booking18RapidApiClient(
        settings("booking18_rapidapi"), transport=httpx.MockTransport(handler)
    )
    result = await client.search(
        origin="SIN",
        destination="Yogyakarta, Indonesia",
        depart_after="2026-10-13",
        depart_before="2026-10-18",
    )

    assert searched == ["JOG", "YIA"]  # other cities' airports (SOC) are never tried
    assert len(result["options"]) == 3


async def test_fx_rates_setting_is_parsed_and_validated():
    assert settings().model_copy(
        update={"flight_fx_rates": "usd:1.28, CAD:0.93"}
    ).flight_fx_rate_table == {
        "USD": 1.28,
        "CAD": 0.93,
    }
    with pytest.raises(ValueError):
        Settings(
            supabase_url="https://x.supabase.co",
            supabase_service_role_key="k",
            flight_fx_rates="USD=1.28",
        )


# --- priceline-com2 (last resort: outbound flight + round-trip price) -----------------

PRICELINE_FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "priceline_com2_search.json").read_text()
)


def priceline_client(requests: list[httpx.Request], **overrides: Any):
    from app.agents.tools import priceline_rapidapi

    priceline_rapidapi._place_cache.clear()

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("auto-complete"):
            return httpx.Response(
                200, json={"data": {"searchItems": [{"type": "AIRPORT", "id": "PEN"}]}}
            )
        return httpx.Response(200, json=PRICELINE_FIXTURE)

    s = settings("priceline_rapidapi").model_copy(update=overrides)
    return priceline_rapidapi.PricelineRapidApiClient(s, transport=httpx.MockTransport(handler))


async def test_priceline_maps_listings_and_converts_usd_to_sgd():
    requests: list[httpx.Request] = []

    result = await priceline_client(requests).search(**QUERY)

    first = result["options"][0]
    assert first["carrier"] == "AirAsia" and first["flight_number"] == "AK1722"
    assert (first["origin"], first["destination"]) == ("SIN", "PEN")
    assert first["depart_at"] == "2026-11-12T13:50:00"
    assert first["price"] == round(109.36 * 1.28, 2)
    assert first["duration_minutes"] == 80 and first["stops"] == 0
    # Priceline prices the round trip but gives no return flight times: the return
    # date alone marks it as a round trip.
    assert first["return_depart_at"] == QUERY["depart_before"]
    assert "return_arrive_at" not in first
    assert result["options"][-1]["stops"] == 1  # a two-segment journey
    FlightSearchResponse.model_validate(result)
    search = requests[-1]
    assert search.url.path == "/flights/search-roundtrip"
    assert search.url.params["originAirportCode"] == "SIN"
    assert search.url.params["destinationAirportCode"] == "PEN"
    assert search.url.params["returnDate"] == "2026-11-16"


async def test_priceline_one_way_and_unknown_currency():
    from app.agents.tools.priceline_rapidapi import UnsupportedCurrencyError

    requests: list[httpx.Request] = []
    await priceline_client(requests).search(
        origin="SIN", destination="PEN", depart_after="2026-11-12", depart_before=None
    )
    assert requests[-1].url.path == "/flights/search-one-way"

    with pytest.raises(UnsupportedCurrencyError):
        await priceline_client([], flight_fx_rates="CAD:0.93").search(**QUERY)  # fixture is USD
