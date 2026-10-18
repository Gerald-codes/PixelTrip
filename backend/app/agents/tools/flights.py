"""Flight search, backed by one or more flight data providers tried in order.

``Settings.flight_provider`` lists the providers (comma-separated), for example
``booking_rapidapi,skyscanner_rapidapi``:

* ``generic``: ``GET flight_api_url`` with the query params, returning the
  ``{"options": [...]}`` shape directly. Used by the tests and by any adapter service.
* ``skyscanner_rapidapi``: the Sky Scrapper listing on RapidAPI
  (:mod:`app.agents.tools.skyscanner_rapidapi`).
* ``booking_rapidapi``: the Booking COM listing on RapidAPI
  (:mod:`app.agents.tools.booking_rapidapi`).
* ``booking18_rapidapi``: a second Booking COM listing, prices converted on our side
  (:mod:`app.agents.tools.booking18_rapidapi`).
* ``priceline_rapidapi``: Priceline COM, a last resort with no return flight times
  (:mod:`app.agents.tools.priceline_rapidapi`).

**Fallback.** Each provider is tried in turn until one returns flights:

* HTTP 429 (monthly quota used up) puts the provider aside until the reset time it
  reports, so later searches skip it without spending a request;
* HTTP 403 (not subscribed) puts it aside for an hour;
* any other failure, an unknown place, or zero flights moves on to the next provider.

If every provider fails, the last error propagates and :meth:`ExternalTool.invoke`
turns it into ``ExternalToolUnavailableError``. Validation is left to
:class:`~app.agents.tools.base.FlightSearchResponse` in the base class.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from app.agents.tools.base import ExternalTool, FlightSearchResponse
from app.agents.tools.booking18_rapidapi import Booking18RapidApiClient
from app.agents.tools.booking_rapidapi import BookingRapidApiClient
from app.agents.tools.priceline_rapidapi import PricelineRapidApiClient
from app.agents.tools.skyscanner_rapidapi import SkyscannerRapidApiClient

logger = logging.getLogger(__name__)

#: How long a provider is skipped after "not subscribed", and the cap on a quota reset.
NOT_SUBSCRIBED_COOLDOWN_SECONDS = 3600
MAX_QUOTA_COOLDOWN_SECONDS = 31 * 24 * 3600
DEFAULT_QUOTA_COOLDOWN_SECONDS = 3600

#: provider name -> monotonic time before which it is skipped. Process-wide.
_unavailable_until: dict[str, float] = {}


def _now() -> float:
    return time.monotonic()


class NoFlightProviderAvailableError(RuntimeError):
    """Every configured provider is out of quota or unsubscribed right now."""


class FlightSearchTool(ExternalTool):
    """Searches flights between an origin and a destination."""

    name = "flight_search"
    _response_model = FlightSearchResponse

    def _call_timeout_seconds(self) -> float:
        # Each provider in the chain gets the full configured timeout.
        per_provider = float(self._settings.external_tool_timeout_seconds)
        return per_provider * max(1, len(self._settings.flight_provider_chain))

    async def _call(self, **params: Any) -> dict[str, Any]:
        """Try each provider in order; return the first non-empty result."""
        now = _now()
        chain = [
            p for p in self._settings.flight_provider_chain if _unavailable_until.get(p, 0) <= now
        ]
        if not chain:
            raise NoFlightProviderAvailableError("every flight provider is resting")

        last_error: BaseException | None = None
        empty: dict[str, Any] | None = None
        for provider in chain:
            try:
                result = await self._search(provider, **params)
            except httpx.HTTPStatusError as exc:
                _rest_after_http_error(provider, exc.response)
                last_error = exc
                continue
            except Exception as exc:  # unknown place, transport error, timeout, bad body
                logger.info("Flight provider %s failed (%s)", provider, type(exc).__name__)
                last_error = exc
                continue
            if result.get("options"):
                return result
            logger.info("Flight provider %s found no flights; trying the next", provider)
            empty = result

        if empty is not None:
            return empty
        assert last_error is not None
        raise last_error

    async def _search(self, provider: str, **params: Any) -> dict[str, Any]:
        if provider == "booking_rapidapi":
            return await BookingRapidApiClient(self._settings).search(**params)
        if provider == "booking18_rapidapi":
            return await Booking18RapidApiClient(self._settings).search(**params)
        if provider == "priceline_rapidapi":
            return await PricelineRapidApiClient(self._settings).search(**params)
        if provider == "skyscanner_rapidapi":
            return await SkyscannerRapidApiClient(self._settings).search(**params)

        timeout = self._settings.external_tool_timeout_seconds
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(
                self._settings.flight_api_url,
                params=params,
                headers={"Authorization": f"Bearer {self._settings.flight_api_key}"},
            )
            response.raise_for_status()
            return response.json()


def _rest_after_http_error(provider: str, response: httpx.Response) -> None:
    """Put a provider aside when retrying it soon would only waste requests."""
    status = response.status_code
    if status == 429:
        reset = response.headers.get("x-ratelimit-requests-reset")
        try:
            seconds = min(float(reset), MAX_QUOTA_COOLDOWN_SECONDS) if reset else None
        except ValueError:
            seconds = None
        rest = seconds if seconds and seconds > 0 else DEFAULT_QUOTA_COOLDOWN_SECONDS
        _unavailable_until[provider] = _now() + rest
        logger.warning("Flight provider %s is out of quota; skipping it for %.0fs", provider, rest)
    elif status == 403:
        _unavailable_until[provider] = _now() + NOT_SUBSCRIBED_COOLDOWN_SECONDS
        logger.warning("Flight provider %s refused the key (not subscribed?)", provider)
    else:
        logger.info("Flight provider %s returned HTTP %s; trying the next", provider, status)
