"""Flight search via the "Booking COM" listing on RapidAPI (``booking-com15``).

Selected with ``booking_rapidapi`` in ``FLIGHT_PROVIDER``. Uses the same RapidAPI key
as Sky Scrapper (one key covers every API the account is subscribed to; each API has
its own monthly quota). Translates the agent's generic flight query (``origin``,
``destination``, ``depart_after``, ``depart_before``) into the provider's calls:

1. ``GET /api/v1/flights/searchDestination?query=...`` for the origin and the
   destination, turning a name or code ("SIN", "Penang, Malaysia") into Booking's id
   ("PEN.AIRPORT", "TYO.CITY").
2. ``GET /api/v1/flights/searchFlights`` departing on ``depart_after`` and, when
   ``depart_before`` is a later date, returning on it (a round trip).

**Quota.** The free plan allows 600 requests a month; one search costs 1-3 of them.
Destination lookups are cached for the life of the process (public reference data).

**Errors.** An HTTP error (including 429 quota exhaustion) or an unresolvable place
raises; the provider chain in :mod:`app.agents.tools.flights` then tries the next
provider. No URL, header, key, or response body is put into an exception message.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://booking-com15.p.rapidapi.com"
DESTINATION_PATH = "/api/v1/flights/searchDestination"
SEARCH_PATH = "/api/v1/flights/searchFlights"

#: How many offers to hand to the agent; it ranks and keeps 3-5 of them.
MAX_OPTIONS = 10

#: ``query.lower() -> Booking id`` ("PEN.AIRPORT"). Process-wide to save quota.
_place_cache: dict[str, str] = {}


class PlaceNotFoundError(LookupError):
    """The provider returned no place for a query."""


class BookingRapidApiClient:
    """One flight search against Booking COM, returning the agent's response shape."""

    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._settings = settings
        self._transport = transport  # tests inject a fake transport; production uses None
        self._base_url = (settings.booking_flight_api_url or DEFAULT_BASE_URL).rstrip("/")

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
        """Search flights out on ``depart_after``, back on ``depart_before`` if later."""
        params: dict[str, Any] = {"departDate": depart_after}
        if depart_before and depart_before > depart_after:
            params["returnDate"] = depart_before
        async with httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers(),
            transport=self._transport,
            timeout=self._settings.external_tool_timeout_seconds,
        ) as http:
            from_id = await self._resolve_place(http, origin)
            to_id = await self._resolve_place(http, destination)
            payload = await self._get(
                http,
                SEARCH_PATH,
                {
                    "fromId": from_id,
                    "toId": to_id,
                    **params,
                    "adults": 1,
                    "sort": "BEST",
                    "cabinClass": "ECONOMY",
                    "currency_code": self._settings.flight_currency,
                },
            )
        offers = (payload.get("data") or {}).get("flightOffers") or []
        return {"options": to_flight_options(offers)}

    async def _resolve_place(self, http: httpx.AsyncClient, query: str) -> str:
        key = query.strip().lower()
        if not key:
            raise PlaceNotFoundError("empty place query")
        if key in _place_cache:
            return _place_cache[key]
        payload = await self._get(http, DESTINATION_PATH, {"query": query.strip()})
        for item in payload.get("data") or []:
            place_id = item.get("id") if isinstance(item, dict) else None
            if place_id:
                _place_cache[key] = str(place_id)
                return str(place_id)
        raise PlaceNotFoundError("no matching place")

    @staticmethod
    async def _get(http: httpx.AsyncClient, path: str, params: dict[str, Any]) -> dict[str, Any]:
        response = await http.get(path, params=params)
        if response.status_code != 200:
            logger.warning(
                "Booking COM %s returned HTTP %s: %s",
                path.rsplit("/", 1)[-1],
                response.status_code,
                _provider_message(response),
            )
        response.raise_for_status()
        body = response.json()
        if isinstance(body, dict) and body.get("status") is False:
            logger.warning(
                "Booking COM %s reported failure: %s",
                path.rsplit("/", 1)[-1],
                _provider_message(response),
            )
            # Some failures come back as HTTP 200 with "status": false.
            raise httpx.HTTPStatusError(
                "provider reported failure", request=response.request, response=response
            )
        return body if isinstance(body, dict) else {}


def _provider_message(response: httpx.Response) -> str:
    """The provider's own error message, for logs only (never the request or key)."""
    try:
        body = response.json()
    except ValueError:
        return "(non-JSON body)"
    if isinstance(body, dict):
        message = body.get("message") or body.get("error") or body.get("errors")
        return str(message)[:200] if message else "(no message)"
    return "(unexpected body)"


def to_flight_options(offers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map Booking offers to ``FlightOption`` dicts, skipping malformed ones."""
    options: list[dict[str, Any]] = []
    for offer in offers:
        option = _to_flight_option(offer)
        if option is not None:
            options.append(option)
        if len(options) >= MAX_OPTIONS:
            break
    return options


def _to_flight_option(offer: dict[str, Any]) -> dict[str, Any] | None:
    """One offer: segment 1 is the outbound journey, segment 2 (if any) the return."""
    try:
        segments = offer.get("segments") or []
        outbound = segments[0]
        legs = outbound.get("legs") or []
        first_leg = legs[0]
        carrier = (first_leg.get("carriersData") or [{}])[0]
        info = first_leg.get("flightInfo") or {}
        code = (info.get("carrierInfo") or {}).get("marketingCarrier") or carrier.get("code") or ""
        number = str(info.get("flightNumber") or "").strip()
        total = ((offer.get("priceBreakdown") or {}).get("total")) or {}
        option = {
            "id": str(offer.get("flightKey") or offer.get("token") or ""),
            "carrier": str(carrier.get("name") or code),
            "flight_number": f"{code}{number}" if number else str(code),
            "origin": str(outbound["departureAirport"]["code"]),
            "destination": str(outbound["arrivalAirport"]["code"]),
            "depart_at": str(outbound["departureTime"]),
            "arrive_at": str(outbound["arrivalTime"]),
            "price": round(float(total["units"]) + float(total.get("nanos") or 0) / 1e9, 2),
            "duration_minutes": int(outbound["totalTime"]) // 60,
            "stops": max(0, len(legs) - 1),
        }
        if len(segments) > 1:
            option["return_depart_at"] = str(segments[1]["departureTime"])
            option["return_arrive_at"] = str(segments[1]["arrivalTime"])
    except (KeyError, IndexError, TypeError, ValueError):
        return None
    required = ("id", "carrier", "flight_number", "origin", "destination", "depart_at")
    if any(not option[key] for key in required) or option["price"] < 0:
        return None
    return option
