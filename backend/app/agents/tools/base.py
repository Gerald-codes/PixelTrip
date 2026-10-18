"""The external tool boundary: typed responses, caps, timeouts, retries, cache.

Every call the agent makes to the outside world goes through
:meth:`ExternalTool.invoke`. Concentrating the four mechanisms in one place means
a new tool gets all of them by subclassing and implementing a single method,
rather than re-deriving the retry policy and hoping it matches.

The four, and why each is shaped the way it is:

* **Typed responses** (Requirement 19.1, 19.6). Every payload is validated
  against a Pydantic model *before* any node, guardrail, or LLM prompt sees it. A
  validation failure is a failed call, and it is never retried — the provider
  answered, the answer was just unusable, so asking again with identical
  parameters would produce the same unusable answer.

* **The cap counts attempts, not successes** (Requirement 19.2). A timeout, a
  transport error, a validation failure, and a retry each consume budget. The
  design sketch checked ``len(state.external_tool_responses)``, which counts only
  *successes* — a tool that times out every time would then never consume
  anything and the cap would bound nothing. The check is against
  ``state.tool_call_count`` instead. **Deviation from design.md, following
  Requirement 19.2-19.3 over the sketch.**

* **Timeout and one retry** (Requirement 19.7, 19.8). Both read from
  ``Settings``; no endpoint, credential, or duration appears as a literal here
  (Requirement 19.4).

* **A per-run cache** (Requirement 19.9). Keyed on tool identity plus parameter
  values, so two nodes asking the same question cost one call. A cache hit
  consumes no budget, which is the point: it is not an invocation.

**On the cache's lifetime.** It lives on the tool instance, and a tool instance
is built per run by the service layer. That is deliberate — a process-wide cache
would let one party's flight prices leak into another party's plan.

**On secrets.** No exception raised from here carries a URL, a header, or a
response body. :class:`~app.agents.errors.ExternalToolUnavailableError` is
constructed from the tool *name* only (Requirement 19.5, 20.5).
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.agents.errors import ExternalToolUnavailableError, ToolCallCapExceededError
from app.core.config import Settings, get_settings

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.agents.state import AgentState

logger = logging.getLogger(__name__)

#: Requirement 19.8: the original attempt plus at most one retry.
MAX_ATTEMPTS = 2

#: Exceptions treated as transient transport faults, and so retried once. A
#: timeout is included via ``TimeoutError``, which ``asyncio.wait_for`` raises on
#: Python 3.11+ and which ``httpx.TimeoutException`` subclasses in turn.
TRANSPORT_ERRORS: tuple[type[BaseException], ...] = (
    TimeoutError,
    httpx.TransportError,
)


class _StrictModel(BaseModel):
    """Base for tool response models: unknown fields are an error.

    ``extra='forbid'`` is the point of these models. A provider that silently
    adds a field is a contract change the agent must notice, not absorb.
    """

    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------------
# Flight search
# ---------------------------------------------------------------------------


class FlightOption(_StrictModel):
    """One bookable flight itinerary.

    ``price``, ``duration_minutes``, and ``stops`` are the three keys the
    logistics ranking sorts on, and all three are factual fields the factual
    guardrail will overwrite model output with.
    """

    id: str = Field(min_length=1)
    carrier: str = Field(min_length=1)
    flight_number: str = Field(min_length=1)
    origin: str = Field(min_length=1)
    destination: str = Field(min_length=1)
    depart_at: str = Field(min_length=1)
    arrive_at: str = Field(min_length=1)
    price: float = Field(ge=0)
    duration_minutes: int = Field(ge=0)
    stops: int = Field(ge=0)
    #: Return leg of a round trip, when the provider searched one. ``price`` is then
    #: the round-trip total; ``duration_minutes`` and ``stops`` describe the outbound leg.
    return_depart_at: str | None = None
    return_arrive_at: str | None = None


class FlightSearchResponse(_StrictModel):
    """A flight search result set. May legitimately be empty."""

    options: list[FlightOption]


# ---------------------------------------------------------------------------
# Places lookup
# ---------------------------------------------------------------------------


class PlaceResult(_StrictModel):
    """One resolved place, used to verify itinerary item locations."""

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    opening_hours: str | None = None


class PlacesLookupResponse(_StrictModel):
    """A places lookup result set. May legitimately be empty."""

    places: list[PlaceResult]


# ---------------------------------------------------------------------------
# Weather lookup
# ---------------------------------------------------------------------------


class WeatherDay(_StrictModel):
    """Forecast for one day, used to inform itinerary pacing."""

    date: str = Field(min_length=1)
    temperature_c: float
    precipitation: str = Field(min_length=1)


class WeatherLookupResponse(_StrictModel):
    """A weather lookup result set. May legitimately be empty."""

    days: list[WeatherDay]


# ---------------------------------------------------------------------------
# ExternalTool
# ---------------------------------------------------------------------------


class ExternalTool:
    """Base class for a capped, typed, cached external data source.

    Subclasses set :attr:`name` and :attr:`_response_model`, and implement
    :meth:`_call` to perform the actual request. Everything else —
    caching, capping, timing out, retrying, and validating — is handled here.
    """

    #: A short, stable, human-readable identity. Appears in error messages and
    #: cache keys; never a credential or an endpoint.
    name: str
    #: The Pydantic model every raw response is validated against.
    _response_model: type[BaseModel]

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings if settings is not None else get_settings()
        self._cache: dict[tuple[Any, ...], BaseModel] = {}

    async def invoke(self, state: AgentState, **params: Any) -> tuple[BaseModel, AgentState]:
        """Invoke the tool, honoring the cache, the cap, the timeout, and retry.

        Args:
            state: The run's current state. Carries the ``Tool_Call_Cap`` and the
                attempt counter this call checks against.
            **params: The call's parameters. Must be hashable; they key the
                cache.

        Returns:
            ``(validated_response, updated_state)``. The returned state is the
            one the caller must keep using — on a cache hit it is the same
            object; on a fresh call it carries the appended response.

        Raises:
            ToolCallCapExceededError: If the cap is already exhausted
                (Requirement 19.3). The caller is expected to escalate rather
                than invoke a different tool to route around this.
            ExternalToolUnavailableError: If every attempt failed — by timeout,
                transport error, or response validation (Requirement 19.6,
                19.8, 19.10).
        """
        cache_key = self._cache_key(params)
        if cache_key in self._cache:
            # Requirement 19.9: a cache hit is not an invocation.
            return self._cache[cache_key], state

        if state.tool_call_count >= state.tool_call_cap:
            raise ToolCallCapExceededError(state.tool_call_cap)

        last_state = state
        for attempt in range(MAX_ATTEMPTS):
            last_state = last_state.with_failed_tool_attempt()
            try:
                raw = await asyncio.wait_for(
                    self._call(**params),
                    timeout=self._call_timeout_seconds(),
                )
            except TRANSPORT_ERRORS:
                if attempt == MAX_ATTEMPTS - 1:
                    logger.warning("External tool '%s' unavailable after retry", self.name)
                    raise ExternalToolUnavailableError(self.name) from None
                continue  # Requirement 19.8: exactly one retry, identical params.
            except Exception as exc:  # pragma: no cover - defensive: unexpected transport failure
                logger.warning("External tool '%s' failed: %s", self.name, type(exc).__name__)
                raise ExternalToolUnavailableError(self.name) from exc

            try:
                validated = self._response_model.model_validate(raw)
            except ValidationError as exc:
                # Requirement 19.6: a validation failure is never retried — the
                # provider answered, the shape was just wrong.
                logger.warning("External tool '%s' returned an invalid response", self.name)
                raise ExternalToolUnavailableError(self.name) from exc

            self._cache[cache_key] = validated
            updated_state = last_state.append_tool_response(validated.model_dump())
            return validated, updated_state

        # Unreachable: the loop above always returns or raises. Kept only so a
        # future refactor that breaks that invariant fails loudly instead of
        # returning ``None``.
        raise ExternalToolUnavailableError(self.name)  # pragma: no cover

    def _call_timeout_seconds(self) -> float:
        """How long one :meth:`_call` may take. Tools that try several providers in
        turn override this so each provider gets the configured timeout."""
        return float(self._settings.external_tool_timeout_seconds)

    async def _call(self, **params: Any) -> dict[str, Any]:
        """Perform the actual request and return the raw, unvalidated payload.

        Subclasses implement this against their concrete API. Raising
        ``httpx.TransportError`` or letting a timeout propagate from the
        underlying client is treated as transient by :meth:`invoke`; raising
        anything else is treated as a non-retryable failure.
        """
        raise NotImplementedError

    @staticmethod
    def _cache_key(params: dict[str, Any]) -> tuple[Any, ...]:
        """Build a stable cache key from a parameter mapping.

        Sorted by key so argument order never produces a spurious cache miss.
        """
        return tuple(sorted(params.items()))
