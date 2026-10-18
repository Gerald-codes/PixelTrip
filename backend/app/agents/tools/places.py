"""Places lookup, used to verify and enrich itinerary locations.

Same shape as :mod:`~app.agents.tools.flights`: this client owns the HTTP call,
:class:`~app.agents.tools.base.PlacesLookupResponse` owns the shape.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.agents.tools.base import ExternalTool, PlacesLookupResponse


class PlacesLookupTool(ExternalTool):
    """Looks up places by name or id, for itinerary location verification."""

    name = "places_lookup"
    _response_model = PlacesLookupResponse

    async def _call(self, **params: Any) -> dict[str, Any]:
        """Call the places lookup endpoint.

        Args:
            **params: Forwarded as query parameters, e.g. a place name or a
                destination to scope the search.

        Returns:
            The raw JSON response body.
        """
        timeout = self._settings.external_tool_timeout_seconds
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(
                self._settings.places_api_url,
                params=params,
                headers={"Authorization": f"Bearer {self._settings.places_api_key}"},
            )
            response.raise_for_status()
            return response.json()
