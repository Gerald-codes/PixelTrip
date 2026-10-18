"""In-memory record of recent LLM calls, for prompt tuning (dev only).

The agent layer's LLM client writes here only when ``ENABLE_DEV_ENDPOINTS`` is on,
and ``GET /dev/llm-calls`` reads it. Nothing here is logged or stored: it lives in
this process's memory and is lost on restart.
"""

from __future__ import annotations

from collections import deque
from datetime import UTC, datetime
from typing import Any

#: Newest first.
RECENT_CALLS: deque[dict[str, Any]] = deque(maxlen=20)


def record_call(
    *,
    operation: str,
    model: str | None,
    system_prompt: str,
    user_prompt: str,
    response: dict[str, Any] | None,
    error: str | None = None,
) -> None:
    RECENT_CALLS.appendleft(
        {
            "at": datetime.now(UTC).isoformat(timespec="seconds"),
            "operation": operation,
            "model": model,
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "response": response,
            "error": error,
        }
    )
