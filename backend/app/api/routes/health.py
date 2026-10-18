"""Health route module.

Exposes the liveness probe for the PixelArt Trip Planner backend. ``GET /health``
returns exactly ``{"status": "ok"}`` so the frontend (and any orchestrator) can
confirm the service is up without touching any business logic.

Only GET is defined for ``/health``. FastAPI/Starlette responds to any other HTTP
method on this path with ``405 Method Not Allowed`` automatically, so non-GET
requests never receive the ``{"status": "ok"}`` body.
"""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def get_health() -> dict[str, str]:
    """Liveness probe: return exactly ``{"status": "ok"}``.

    The handler does no I/O and returns a constant literal, so it responds well
    within the 1000 ms budget required by the Foundation spec.
    """
    return {"status": "ok"}
