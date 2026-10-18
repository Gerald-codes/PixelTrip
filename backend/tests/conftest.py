"""Shared pytest configuration for the backend test suite.

Required configuration is injected into ``os.environ`` at import time, before any
test module imports ``app.main``. That ordering matters: ``Settings`` declares
``supabase_url`` and ``supabase_service_role_key`` without defaults, so the app
cannot be imported at all without them, and ``get_settings()`` is ``lru_cache``d
so the first call wins for the whole session.

The values here are deliberately obvious fakes. No test in this suite reaches a
live Supabase project or a real external API: repositories are mocked, and
``tests/agents/conftest.py`` additionally blocks socket access outright.
"""

from __future__ import annotations

import os

import pytest

#: Sentinel secrets. The secret-non-disclosure tests assert these substrings
#: never appear in an error envelope, log record, or emitted message, so they are
#: distinctive enough to match on reliably.
FAKE_SERVICE_ROLE_KEY = "test-service-role-key-DO-NOT-LEAK"
FAKE_FLIGHT_API_KEY = "test-flight-key-DO-NOT-LEAK"
FAKE_PLACES_API_KEY = "test-places-key-DO-NOT-LEAK"
FAKE_WEATHER_API_KEY = "test-weather-key-DO-NOT-LEAK"
FAKE_AI_PROVIDER_API_KEY = "test-ai-provider-key-DO-NOT-LEAK"

_TEST_ENV = {
    "SUPABASE_URL": "https://test-project.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": FAKE_SERVICE_ROLE_KEY,
    "FRONTEND_URL": "http://localhost:3000",
    "FLIGHT_API_URL": "https://flights.test.invalid",
    "FLIGHT_API_KEY": FAKE_FLIGHT_API_KEY,
    "PLACES_API_URL": "https://places.test.invalid",
    "PLACES_API_KEY": FAKE_PLACES_API_KEY,
    "WEATHER_API_URL": "https://weather.test.invalid",
    "WEATHER_API_KEY": FAKE_WEATHER_API_KEY,
    "AI_PROVIDER_API_KEY": FAKE_AI_PROVIDER_API_KEY,
}

for _key, _value in _TEST_ENV.items():
    os.environ.setdefault(_key, _value)

# Never read the developer's real backend/.env during tests: anything not pinned above
# (e.g. FLIGHT_PROVIDER, EXTERNAL_TOOL_TIMEOUT_SECONDS) would otherwise leak in and make
# results depend on whose machine runs them.
from app.core.config import Settings  # noqa: E402

Settings.model_config["env_file"] = None


@pytest.fixture
def anyio_backend():
    """Run ``@pytest.mark.anyio`` async tests on asyncio only."""
    return "asyncio"
