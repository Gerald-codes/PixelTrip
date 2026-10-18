"""Flight search via the "Priceline COM" listing on RapidAPI (``priceline-com2``).

Selected with ``priceline_rapidapi`` in ``FLIGHT_PROVIDER``; same RapidAPI key as the
other providers (its own quota: 500 requests a month on the free plan).

1. ``GET /flights/auto-complete?query=...`` turns a place name into an airport code.
   A three-letter code ("SIN") is used as it is, with no lookup.
2. ``GET /flights/search-roundtrip`` (or ``search-one-way`` without a return date).

**A last-resort provider.** For a round trip Priceline lists only the *outbound*
flight with the round-trip total price; the return flight is chosen in a later step
this API does not expose here. So options carry no return times (the itinerary takes
its length from the trip plan instead). Prefer the Booking providers ahead of it.

**Currency.** Prices come in the currency each listing reports (USD) and are converted
into ``FLIGHT_CURRENCY`` with ``FLIGHT_FX_RATES``; a currency with no rate is refused.
No URL, header, key, or response body is put into an exception message.
"""

from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://priceline-com2.p.rapidapi.com"
AUTOCOMPLETE_PATH = "/flights/auto-complete"
ROUNDTRIP_PATH = "/flights/search-roundtrip"
ONEWAY_PATH = "/flights/search-one-way"

#: How many listings to hand to the agent; it ranks and keeps 3-5 of them.
MAX_OPTIONS = 10

_IATA = re.compile(r"[A-Za-z]{3}")

#: ``query.lower() -> airport code``. Process-wide to save quota.
_place_cache: dict[str, str] = {}


class PlaceNotFoundError(LookupError):
    """The provider returned no place for a query."""


class UnsupportedCurrencyError(ValueError):
    """The provider priced a listing in a currency with no configured rate."""


class PricelineRapidApiClient:
    """One flight search against priceline-com2, in the agent's response shape."""

    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._settings = settings
        self._transport = transport  # tests inject a fake transport; production uses None
        self._base_url = (settings.priceline_flight_api_url or DEFAULT_BASE_URL).rstrip("/")

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
        async with httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers(),
            transport=self._transport,
            timeout=self._settings.external_tool_timeout_seconds,
        ) as http:
            params = {
                "originAirportCode": await self._resolve_place(http, origin),
                "destinationAirportCode": await self._resolve_place(http, destination),
                "departureDate": depart_after,
            }
            if round_trip:
                params["returnDate"] = str(depart_before)
            payload = await self._get(http, ROUNDTRIP_PATH if round_trip else ONEWAY_PATH, params)

        listings = (payload.get("data") or {}).get("listings") or []
        options = [
            option
            for listing in listings
            if (option := self._to_flight_option(listing)) is not None
        ]
        if round_trip:
            # The price is for the round trip, but listings carry no return flight
            # times. Record the return date so the trip is shown as a round trip.
            for option in options:
                option["return_depart_at"] = str(depart_before)
        options.sort(key=lambda o: o["price"])
        return {"options": options[:MAX_OPTIONS]}

    def _to_flight_option(self, listing: dict[str, Any]) -> dict[str, Any] | None:
        """One listing's outbound flight, priced in ``FLIGHT_CURRENCY``."""
        try:
            outbound = (listing.get("slices") or [])[0]
            segments = outbound.get("segments") or []
            first, last = segments[0], segments[-1]
            code = str(first.get("marketingAirline") or "")
            number = str(first.get("flightNumber") or "").strip()
            prices = ((listing.get("fareBrands") or [{}])[0]).get("price") or [{}]
            currency = str(prices[0].get("currencyCode") or "USD").upper()
            amount = float(listing["totalPriceWithDecimal"]["price"])
            option = {
                "id": str(listing["id"]),
                "carrier": str(((listing.get("airlines") or [{}])[0]).get("name") or code),
                "flight_number": f"{code}{number}" if number else code,
                "origin": str(first["departInfo"]["airport"]["code"]),
                "destination": str(last["arrivalInfo"]["airport"]["code"]),
                "depart_at": str(first["departInfo"]["time"]["dateTime"]),
                "arrive_at": str(last["arrivalInfo"]["time"]["dateTime"]),
                "price": amount,
                "duration_minutes": int(outbound["durationInMinutes"]),
                "stops": len(segments) - 1 + sum(int(s.get("stopQuantity") or 0) for s in segments),
            }
        except (KeyError, IndexError, TypeError, ValueError):
            return None

        target = self._settings.flight_currency.upper()
        if currency != target:
            rate = self._settings.flight_fx_rate_table.get(currency)
            if rate is None:
                raise UnsupportedCurrencyError("no exchange rate for the provider's currency")
            option["price"] = round(amount * rate, 2)
        required = ("id", "carrier", "flight_number", "origin", "destination", "depart_at")
        if any(not option[key] for key in required) or option["price"] < 0:
            return None
        return option

    async def _resolve_place(self, http: httpx.AsyncClient, query: str) -> str:
        text = query.strip()
        if not text:
            raise PlaceNotFoundError("empty place query")
        if _IATA.fullmatch(text):
            return text.upper()
        key = text.lower()
        if key in _place_cache:
            return _place_cache[key]
        payload = await self._get(http, AUTOCOMPLETE_PATH, {"query": text.split(",")[0].strip()})
        for item in (payload.get("data") or {}).get("searchItems") or []:
            code = item.get("id") if isinstance(item, dict) else None
            if code and _IATA.fullmatch(str(code)):
                _place_cache[key] = str(code)
                return str(code)
        raise PlaceNotFoundError("no matching place")

    @staticmethod
    async def _get(http: httpx.AsyncClient, path: str, params: dict[str, Any]) -> dict[str, Any]:
        response = await http.get(path, params=params)
        if response.status_code != 200:
            logger.warning(
                "priceline-com2 %s returned HTTP %s", path.rsplit("/", 1)[-1], response.status_code
            )
        response.raise_for_status()
        body = response.json()
        if isinstance(body, dict) and (body.get("status") is False or body.get("errors")):
            logger.warning("priceline-com2 %s reported failure", path.rsplit("/", 1)[-1])
            raise httpx.HTTPStatusError(
                "provider reported failure", request=response.request, response=response
            )
        return body if isinstance(body, dict) else {}
