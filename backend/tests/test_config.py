"""Tests for settings validation and secret handling."""

from __future__ import annotations

import pytest
from app.core.config import ConfigError, Settings, get_settings
from pydantic import ValidationError as PydanticValidationError

from tests.conftest import FAKE_SERVICE_ROLE_KEY

_VALID = {
    "supabase_url": "https://project.supabase.co",
    "supabase_service_role_key": "a-key",
}


def test_valid_settings_construct() -> None:
    """A well-formed configuration constructs successfully."""
    settings = Settings(**_VALID)

    assert settings.supabase_url == "https://project.supabase.co"
    assert settings.iteration_cap == 3
    assert settings.tool_call_cap == 10
    assert settings.external_tool_timeout_seconds == 10


@pytest.mark.parametrize("bad_url", ["", "not-a-url", "://missing-scheme", "ftp:/x"])
def test_url_without_scheme_and_host_is_rejected(bad_url: str) -> None:
    """A URL missing a scheme or host fails fast at construction."""
    with pytest.raises(PydanticValidationError):
        Settings(**{**_VALID, "supabase_url": bad_url})


@pytest.mark.parametrize("bad_key", ["", "   ", "\t\n"])
def test_blank_service_role_key_is_rejected(bad_key: str) -> None:
    """An empty or whitespace-only service-role key fails fast."""
    with pytest.raises(PydanticValidationError):
        Settings(**{**_VALID, "supabase_service_role_key": bad_key})


@pytest.mark.parametrize(("field", "bad"), [("iteration_cap", 0), ("iteration_cap", 11)])
def test_iteration_cap_bounds_enforced(field: str, bad: int) -> None:
    """Iteration_Cap is constrained to 1..10 inclusive (Requirement 12.10)."""
    with pytest.raises(PydanticValidationError):
        Settings(**{**_VALID, field: bad})


@pytest.mark.parametrize(("field", "bad"), [("tool_call_cap", 0), ("tool_call_cap", 51)])
def test_tool_call_cap_bounds_enforced(field: str, bad: int) -> None:
    """Tool_Call_Cap is constrained to 1..50 inclusive (Requirement 12.10)."""
    with pytest.raises(PydanticValidationError):
        Settings(**{**_VALID, field: bad})


@pytest.mark.parametrize(("bad"), [0, 61])
def test_external_tool_timeout_bounds_enforced(bad: int) -> None:
    """The per-call timeout is constrained to 1..60 seconds (Requirement 19.7)."""
    with pytest.raises(PydanticValidationError):
        Settings(**{**_VALID, "external_tool_timeout_seconds": bad})


def test_service_role_key_absent_from_repr() -> None:
    """repr(settings) omits every secret-bearing field."""
    settings = Settings(
        **_VALID,
        flight_api_key="flight-secret",
        ai_provider_api_key="ai-secret",
    )

    rendered = repr(settings)

    assert "a-key" not in rendered
    assert "flight-secret" not in rendered
    assert "ai-secret" not in rendered


def test_secret_values_collects_non_empty_secrets_only() -> None:
    """secret_values() returns configured secrets and skips unset ones."""
    settings = Settings(**_VALID, flight_api_key="flight-secret", places_api_key="")

    secrets = settings.secret_values()

    assert "a-key" in secrets
    assert "flight-secret" in secrets
    assert "" not in secrets


def test_session_settings_expose_the_fake_service_role_key() -> None:
    """The session's settings come from tests/conftest.py's injected env."""
    assert FAKE_SERVICE_ROLE_KEY in get_settings().secret_values()


def test_config_error_is_raised_for_invalid_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """get_settings() surfaces invalid configuration as a clear ConfigError."""
    get_settings.cache_clear()
    monkeypatch.setenv("SUPABASE_URL", "not-a-url")
    try:
        with pytest.raises(ConfigError) as excinfo:
            get_settings()
        assert "configuration" in str(excinfo.value).lower()
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()


def test_cors_origins_splits_a_comma_separated_frontend_url() -> None:
    """Several frontends (production plus localhost) may call the API."""
    one = Settings(**_VALID, frontend_url="https://pixeltrip.vercel.app/")
    assert one.cors_origins == ["https://pixeltrip.vercel.app"]

    two = Settings(**_VALID, frontend_url="https://pixeltrip.vercel.app, http://localhost:3000,")
    assert two.cors_origins == ["https://pixeltrip.vercel.app", "http://localhost:3000"]
