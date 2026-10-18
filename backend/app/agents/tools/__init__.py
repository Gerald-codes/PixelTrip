"""Typed, capped clients for the external travel data sources."""

from app.agents.tools.base import (
    ExternalTool,
    FlightOption,
    FlightSearchResponse,
    PlaceResult,
    PlacesLookupResponse,
    WeatherDay,
    WeatherLookupResponse,
)
from app.agents.tools.flights import FlightSearchTool
from app.agents.tools.places import PlacesLookupTool
from app.agents.tools.weather import WeatherLookupTool

__all__ = [
    "ExternalTool",
    "FlightOption",
    "FlightSearchResponse",
    "FlightSearchTool",
    "PlaceResult",
    "PlacesLookupResponse",
    "PlacesLookupTool",
    "WeatherDay",
    "WeatherLookupResponse",
    "WeatherLookupTool",
]
