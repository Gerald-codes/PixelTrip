"""Shared repository behaviour.

Every repository extends :class:`BaseRepository`, which holds the injected
Supabase client and centralizes error wrapping so each concrete repository stays
focused on its own queries.

Two invariants this module enforces for the whole repository layer:

1. **No raw Supabase error escapes.** Every unexpected exception is wrapped in
   :class:`~app.exceptions.RepositoryError` carrying a developer-authored message
   that names the operation and table. The HTTP handler then substitutes a fixed
   safe message, so database internals never reach a response body.
2. **Postgres error codes are detected, not guessed.** Uniqueness violations are
   identified by the ``23505`` SQLSTATE marker via :func:`is_unique_violation`,
   letting callers distinguish "someone else won the race" from a genuine fault.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any, NoReturn
from uuid import UUID

from app.exceptions import RepositoryError, ValidationError

if TYPE_CHECKING:  # pragma: no cover - typing only
    from supabase import AsyncClient

#: PostgreSQL SQLSTATE for ``unique_violation``.
UNIQUE_VIOLATION_SQLSTATE = "23505"

#: Shape of a generated room code: 4-12 upper-case letters or digits.
ROOM_CODE_PATTERN = re.compile(r"^[A-Z0-9]{4,12}$")


def require_uuid(value: str, field: str) -> None:
    """Raise ``ValidationError`` unless ``value`` is a well-formed UUID string."""
    try:
        UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError(f"'{field}' must be a valid UUID.") from None


def require_text(value: str, field: str, max_length: int) -> None:
    """Raise ``ValidationError`` unless ``value`` is non-blank and within ``max_length``."""
    if not isinstance(value, str) or not value.strip() or len(value) > max_length:
        raise ValidationError(
            f"'{field}' must be 1-{max_length} characters and not whitespace-only."
        )


def is_unique_violation(exc: BaseException) -> bool:
    """Return ``True`` when ``exc`` represents a Postgres uniqueness violation.

    ``supabase-py`` surfaces Postgres errors as ``APIError``-style objects whose
    ``code`` attribute carries the SQLSTATE, but the exact type varies across
    versions. Checking the attribute first and falling back to a substring scan
    keeps detection working without pinning to one client internal.
    """
    code = getattr(exc, "code", None)
    if code is not None and str(code) == UNIQUE_VIOLATION_SQLSTATE:
        return True
    return UNIQUE_VIOLATION_SQLSTATE in str(exc)


def constraint_mentioned(exc: BaseException, constraint_fragment: str) -> bool:
    """Return ``True`` when ``exc``'s text names ``constraint_fragment``.

    Used to tell *which* unique constraint a ``23505`` came from, so a caller can
    treat a version collision differently from, say, an idempotency-key
    collision. Matching is case-insensitive.
    """
    return constraint_fragment.lower() in str(exc).lower()


class BaseRepository:
    """Base class for all repositories.

    Args:
        client: The injected async Supabase client. Repositories never construct
            their own client; it always arrives through dependency injection.
    """

    def __init__(self, client: AsyncClient) -> None:
        self._client = client

    def _handle_error(
        self,
        exc: BaseException,
        operation: str,
        table: str,
    ) -> NoReturn:
        """Wrap any Supabase exception in a :class:`RepositoryError` and raise.

        Args:
            exc: The originating exception, chained via ``from`` for internal logs.
            operation: Short verb naming what was attempted, e.g. ``"insert"``.
            table: The table involved, for internal diagnostics.

        Raises:
            RepositoryError: Always. This function never returns.
        """
        raise RepositoryError(f"Database operation '{operation}' on '{table}' failed.") from exc

    @staticmethod
    def _rows(response: Any) -> list[dict[str, Any]]:
        """Return the row list from a Supabase response, never ``None``."""
        data = getattr(response, "data", None)
        if data is None:
            return []
        if isinstance(data, list):
            return data
        return [data]

    @classmethod
    def _first_row(cls, response: Any) -> dict[str, Any] | None:
        """Return the first row of a Supabase response, or ``None`` if empty."""
        rows = cls._rows(response)
        return rows[0] if rows else None

    async def _insert_one(self, table: str, data: dict[str, Any]) -> dict:
        """Insert one row and return it, wrapping any failure."""
        try:
            response = await self._client.table(table).insert(data).execute()
        except Exception as exc:
            self._handle_error(exc, operation="insert", table=table)
        if not response.data:
            self._handle_error(ValueError("No data returned"), operation="insert", table=table)
        return response.data[0]

    async def _select_one(self, table: str, **filters: str) -> dict | None:
        """Return the first row matching all ``column=value`` filters, or ``None``."""
        try:
            query = self._client.table(table).select("*")
            for column, value in filters.items():
                query = query.eq(column, value)
            response = await query.limit(1).execute()
        except Exception as exc:
            self._handle_error(exc, operation="select", table=table)
        return response.data[0] if response.data else None
