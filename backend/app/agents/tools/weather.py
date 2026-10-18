"""Weather lookup, used to inform itinerary pacing and day planning.

Same shape as :mod:`~app.agents.tools.flights`: this client owns the HTTP call,
:class:`~app.agents.tools.base.WeatherLookupResponse` owns the shape.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.agents.tools.base import ExternalTool, WeatherLookupResponse


class WeatherLookupTool(ExternalTool):
    """Looks up a forecast for a destination over a date range."""

    name = "weather_lookup"
    _response_model = WeatherLookupResponse

    async def _call(self, **params: Any) -> dict[str, Any]:
        """Call the weather lookup endpoint.

        Args:
            **params: Forwarded as query parameters, e.g. a destination and a
                date range.

        Returns:
            The raw JSON response body.
        """
        timeout = self._settings.external_tool_timeout_seconds
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(
                self._settings.weather_api_url,
                params=params,
                headers={"Authorization": f"Bearer {self._settings.weather_api_key}"},
            )
            response.raise_for_status()
            return response.json()
