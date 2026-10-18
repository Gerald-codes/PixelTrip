"""Flight search via the "Sky Scrapper" Skyscanner listing on RapidAPI (apiheya).

Selected with ``FLIGHT_PROVIDER=skyscanner_rapidapi``. Translates the agent's generic
flight query (``origin``, ``destination``, ``depart_after``, ``depart_before``) into the
provider's calls and its response into :class:`~app.agents.tools.base.FlightSearchResponse`:

1. ``GET /api/v1/flights/searchAirport?query=...`` for the origin and the destination,
   turning a name or code ("SIN", "Tokyo") into Skyscanner's ``skyId`` + ``entityId``.
2. ``GET /api/v1/flights/searchFlights`` departing on ``depart_after`` and, when
   ``depart_before`` is a later date, returning on it (a round trip).
3. If the provider reports the search as still ``incomplete`` with no results yet, one
   ``GET /api/v1/flights/searchIncomplete?sessionId=...`` follow-up.

**Quota.** The free plan allows ~100 requests a month, and one search costs 1-4 of them.
Airport lookups are cached for the life of the process (place ids are public reference
data, not party data, so sharing them across runs is safe); flight results are not.

**Errors.** An HTTP error (including 429 quota exhaustion) or an unresolvable place raises,
and :meth:`ExternalTool.invoke` turns that into ``ExternalToolUnavailableError``. No URL,
header, key, or response body is put into an exception message.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.config import Settings

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://sky-scrapper.p.rapidapi.com"
AIRPORT_PATH = "/api/v1/flights/searchAirport"
SEARCH_PATH = "/api/v1/flights/searchFlights"
INCOMPLETE_PATH = "/api/v1/flights/searchIncomplete"

#: How many itineraries to hand to the agent; it ranks and keeps 3-5 of them.
MAX_OPTIONS = 10

#: ``query.lower() -> (skyId, entityId)``. Process-wide to save quota (see module doc).
_place_cache: dict[str, tuple[str, str]] = {}


class PlaceNotFoundError(LookupError):
    """The provider returned no place for a query."""


class SkyscannerRapidApiClient:
    """One flight search against Sky Scrapper, returning the agent's response shape."""

    def __init__(
        self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._settings = settings
        self._transport = transport  # tests inject a fake transport; production uses None
        self._base_url = (settings.flight_api_url or DEFAULT_BASE_URL).rstrip("/")

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
        """Search flights out on ``depart_after``, back on ``depart_before`` if later.

        The party's shared availability runs from ``depart_after`` to ``depart_before``,
        so those are the outbound and return dates. Without a later ``depart_before``
        the search is one-way.
        """
        search_params: dict[str, Any] = {"date": depart_after}
        if depart_before and depart_before > depart_after:
            search_params["returnDate"] = depart_before
        # httpx's own default is 5s per request; a Skyscanner search often takes longer.
        # The whole call is also bounded by the same setting in ExternalTool.invoke.
        timeout = self._settings.external_tool_timeout_seconds
        async with httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers(),
            transport=self._transport,
            timeout=timeout,
        ) as http:
            origin_place = await self._resolve_place(http, origin)
            destination_place = await self._resolve_place(http, destination)
            payload = await self._get(
                http,
                SEARCH_PATH,
                {
                    "originSkyId": origin_place[0],
                    "originEntityId": origin_place[1],
                    "destinationSkyId": destination_place[0],
                    "destinationEntityId": destination_place[1],
                    **search_params,
                    "adults": 1,
                    "cabinClass": "economy",
                    "sortBy": "best",
                    "currency": self._settings.flight_currency,
                    "market": self._settings.flight_market,
                    "countryCode": self._settings.flight_country_code,
                },
            )
            data = payload.get("data") or {}
            context = data.get("context") or {}
            if not data.get("itineraries") and context.get("status") == "incomplete":
                session_id = context.get("sessionId")
                if session_id:
                    follow_up = await self._get(
                        http,
                        INCOMPLETE_PATH,
                        {
                            "sessionId": session_id,
                            "currency": self._settings.flight_currency,
                            "market": self._settings.flight_market,
                            "countryCode": self._settings.flight_country_code,
                        },
                    )
                    data = follow_up.get("data") or data

        return {"options": to_flight_options(data.get("itineraries") or [])}

    async def _resolve_place(self, http: httpx.AsyncClient, query: str) -> tuple[str, str]:
        key = query.strip().lower()
        if not key:
            raise PlaceNotFoundError("empty place query")
        if key in _place_cache:
            return _place_cache[key]

        payload = await self._get(http, AIRPORT_PATH, {"query": query.strip(), "locale": "en-US"})
        for item in payload.get("data") or []:
            params = (item.get("navigation") or {}).get("relevantFlightParams") or {}
            sky_id = params.get("skyId") or item.get("skyId")
            entity_id = params.get("entityId") or item.get("entityId")
            if sky_id and entity_id:
                place = (str(sky_id), str(entity_id))
                _place_cache[key] = place
                return place
        raise PlaceNotFoundError("no matching place")

    @staticmethod
    async def _get(http: httpx.AsyncClient, path: str, params: dict[str, Any]) -> dict[str, Any]:
        response = await http.get(path, params=params)
        if response.status_code != 200:
            logger.warning(
                "Sky Scrapper %s returned HTTP %s: %s",
                path.rsplit("/", 1)[-1],
                response.status_code,
                _provider_message(response),
            )
        response.raise_for_status()
        body = response.json()
        if isinstance(body, dict) and body.get("status") is False:
            logger.warning(
                "Sky Scrapper %s reported failure: %s",
                path.rsplit("/", 1)[-1],
                _provider_message(response),
            )
            # The provider signals some failures with HTTP 200 and "status": false.
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


def to_flight_options(itineraries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map provider itineraries to ``FlightOption`` dicts, skipping malformed ones.

    The first leg is the outbound flight; a second leg, when present, is the return.
    Only ``FlightOption`` fields are emitted, because the response model forbids extra
    keys.
    """
    options: list[dict[str, Any]] = []
    for itinerary in itineraries:
        option = _to_flight_option(itinerary)
        if option is not None:
            options.append(option)
        if len(options) >= MAX_OPTIONS:
            break
    return options


def _to_flight_option(itinerary: dict[str, Any]) -> dict[str, Any] | None:
    try:
        leg = (itinerary.get("legs") or [])[0]
        marketing = ((leg.get("carriers") or {}).get("marketing") or [{}])[0]
        segment = (leg.get("segments") or [{}])[0]
        segment_carrier = segment.get("marketingCarrier") or {}
        # displayCode is the real IATA code ("ZG"); alternateId is Skyscanner's own
        # ("_Z"), so it is only a fallback.
        carrier_code = (
            segment_carrier.get("displayCode")
            or segment_carrier.get("alternateId")
            or marketing.get("alternateId", "")
        )
        number = str(segment.get("flightNumber") or "").strip()
        flight_number = f"{carrier_code}{number}" if number else carrier_code
        option = {
            "id": str(itinerary["id"]),
            "carrier": str(marketing.get("name") or carrier_code),
            "flight_number": flight_number,
            "origin": str(leg["origin"]["displayCode"]),
            "destination": str(leg["destination"]["displayCode"]),
            "depart_at": str(leg["departure"]),
            "arrive_at": str(leg["arrival"]),
            "price": float(itinerary["price"]["raw"]),
            "duration_minutes": int(leg["durationInMinutes"]),
            "stops": int(leg.get("stopCount") or 0),
        }
        legs = itinerary.get("legs") or []
        if len(legs) > 1:
            option["return_depart_at"] = str(legs[1]["departure"])
            option["return_arrive_at"] = str(legs[1]["arrival"])
    except (KeyError, IndexError, TypeError, ValueError):
        return None
    required = ("id", "carrier", "flight_number", "origin", "destination", "depart_at")
    if any(not option[key] for key in required) or option["price"] < 0:
        return None
    return option
