"""Low-level Supabase client factory.

This module's only job is constructing an initialized async Supabase client. It
defines no FastAPI dependencies: the ``Depends()``-compatible wrapper lives in
``app/api/deps.py`` so the infrastructure layer stays free of web-framework
concerns.

The client is created with the **service-role key**, which bypasses RLS. That key
is backend-only and must never reach the frontend.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.config import get_settings

if TYPE_CHECKING:  # pragma: no cover - typing only
    from supabase import AsyncClient


async def create_supabase_client() -> AsyncClient:
    """Create an initialized async Supabase client using the service-role key.

    Imported lazily so merely importing this module (as the test suite does when
    collecting) never requires the ``supabase`` package to be importable or the
    credentials to be present.

    Returns:
        A connected ``AsyncClient`` bound to the configured project.
    """
    from supabase import acreate_client

    settings = get_settings()
    return await acreate_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
    )
