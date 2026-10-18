"""Flight search via the second "Booking COM" listing on RapidAPI (``booking-com18``).

Selected with ``booking18_rapidapi`` in ``FLIGHT_PROVIDER``; uses the same RapidAPI key
as the other providers (its own quota: 530 requests a month on the free plan).

1. ``GET /flights/auto-complete?query=...`` turns a place name into IATA codes: every
   airport the lookup lists for that city, in its order (e.g. Yogyakarta -> JOG, YIA).
   A three-letter code ("SIN") is used as it is, with no lookup.
2. ``GET /flights/v2/search-roundtrip`` (or ``search-oneway`` without a return date)
   with ``sort=CHEAPEST``: the cheapest offers first, 15 per page
   (``FLIGHT_RESULT_PAGES`` pages, default 1), in the same offer format as
   ``booking-com15``. If the first airport code has no flights (a city's old airport,
   say), the next one is tried.

**Currency.** This API has no working currency parameter and answers in whichever
currency its server picks (USD and CAD have both been seen for the same search). Prices
are therefore converted here into ``FLIGHT_CURRENCY`` using ``FLIGHT_FX_RATES``, by the
currency each response reports. A response in a currency with no configured rate is
refused (the provider chain then tries the next provider) rather than guessed.

No URL, header, key, or response body is put into an exception message.
"""

from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import urlparse

import httpx

from app.agents.tools.booking_rapidapi import MAX_OPTIONS, to_flight_options
from app.core.config import Settings

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://booking-com18.p.rapidapi.com"
AUTOCOMPLETE_PATH = "/flights/auto-complete"
ROUNDTRIP_PATH = "/flights/v2/search-roundtrip"
ONEWAY_PATH = "/flights/v2/search-oneway"

#: How many of a city's airport codes to try before giving up on this provider.
MAX_AIRPORTS_TRIED = 3

_IATA = re.compile(r"[A-Za-z]{3}")

#: ``query.lower() -> IATA codes`` (the place's airports, in lookup order). Process-wide
#: to save quota.
_place_cache: dict[str, list[str]] = {}


class PlaceNotFoundError(LookupError):
    """The provider returned no place for a query."""


class UnsupportedSearchError(ValueError):
    """This provider cannot serve the search (a currency it has no rate for)."""


class Booking18RapidApiClient:
    """One flight search against booking-com18, in the agent's response shape."""

    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._settings = settings
        self._transport = transport  # tests inject a fake transport; production uses None
        self._base_url = (settings.booking18_flight_api_url or DEFAULT_BASE_URL).rstrip("/")

    def _headers(self) -> dict[str, str]:
        return {
            "X-RapidAPI-Key": self._settings.flight_api_key,
            "X-RapidAPI-Host": urlparse(self._base_url).netloc,
        }

    async def search(
        self,
        origin: str,
        destination: str,
        depart_after: str,
        depart_before: str | None = None,
        **_ignored: Any,
    ) -> dict[str, Any]:
        round_trip = bool(depart_before and depart_before > depart_after)
        dates = {"departDate": depart_after}
        if round_trip:
            dates["returnDate"] = str(depart_before)

        offers: list[dict[str, Any]] = []
        async with httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers(),
            transport=self._transport,
            timeout=self._settings.external_tool_timeout_seconds,
        ) as http:
            depart_id = (await self._resolve_place(http, origin))[0]
            arrival_ids = await self._resolve_place(http, destination)
            for arrival_id in arrival_ids[:MAX_AIRPORTS_TRIED]:
                for page in range(1, self._settings.flight_result_pages + 1):
                    payload = await self._get(
                        http,
                        ROUNDTRIP_PATH if round_trip else ONEWAY_PATH,
                        {
                            "departId": depart_id,
                            "arrivalId": arrival_id,
                            **dates,
                            "adults": "1",
                            "cabinClass": "ECONOMY",
                            "sort": "CHEAPEST",
                            "page": str(page),
                        },
                    )
                    page_offers = (payload.get("data") or {}).get("flightOffers") or []
                    offers.extend(page_offers)
                    if not page_offers or len(offers) >= MAX_OPTIONS:
                        break
                if offers:
                    break  # this airport has flights; no need to try the city's others

        options = to_flight_options(offers)
        rates = self._settings.flight_fx_rate_table
        target = self._settings.flight_currency.upper()
        currency_by_id = {
            str(o.get("flightKey") or o.get("token") or ""): str(
                ((o.get("priceBreakdown") or {}).get("total") or {}).get("currencyCode") or ""
            ).upper()
            for o in offers
        }
        for option in options:
            currency = currency_by_id.get(option["id"], "")
            if currency == target:
                continue
            rate = rates.get(currency)
            if rate is None:
                raise UnsupportedSearchError("no exchange rate for the provider's currency")
            option["price"] = round(option["price"] * rate, 2)
        return {"options": options}

    async def _resolve_place(self, http: httpx.AsyncClient, query: str) -> list[str]:
        """The place's IATA codes, best first. Never empty (raises instead)."""
        text = query.strip()
        if not text:
            raise PlaceNotFoundError("empty place query")
        if _IATA.fullmatch(text):
            return [text.upper()]
        key = text.lower()
        if key in _place_cache:
            return _place_cache[key]
        # "Penang, Malaysia" -> "Penang": the lookup matches on the place name.
        payload = await self._get(http, AUTOCOMPLETE_PATH, {"query": text.split(",")[0].strip()})
        items = [i for i in payload.get("data") or [] if isinstance(i, dict) and i.get("iataCode")]
        if not items:
            raise PlaceNotFoundError("no matching place")
        # Keep the first result and every other airport of the same city, so a city
        # whose first code is a closed airport still finds its real one.
        city = items[0].get("cityCode")
        codes: list[str] = []
        for item in items:
            code = str(item["iataCode"])
            same_city = city is not None and item.get("cityCode") == city
            if (item is items[0] or same_city) and code not in codes:
                codes.append(code)
        _place_cache[key] = codes
        return codes

    @staticmethod
    async def _get(http: httpx.AsyncClient, path: str, params: dict[str, Any]) -> dict[str, Any]:
        response = await http.get(path, params=params)
        if response.status_code != 200:
            logger.warning(
                "booking-com18 %s returned HTTP %s", path.rsplit("/", 1)[-1], response.status_code
            )
        response.raise_for_status()
        body = response.json()
        if isinstance(body, dict) and (body.get("status") is False or body.get("errors")):
            logger.warning("booking-com18 %s reported failure", path.rsplit("/", 1)[-1])
            # Some failures come back as HTTP 200 with "status": false.
            raise httpx.HTTPStatusError(
                "provider reported failure", request=response.request, response=response
            )
        return body if isinstance(body, dict) else {}
