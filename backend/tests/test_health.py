"""Smoke test for the ``GET /health`` liveness probe.

Covers Requirement 4.5: the backend provides a smoke test that issues a
``GET /health`` request and asserts both a success status and the exact JSON body
``{"status": "ok"}``. It also asserts a non-GET method yields ``405`` and never
returns the ``{"status": "ok"}`` body (Requirement 4.4).

Uses FastAPI's ``TestClient`` (backed by ``httpx``) so the app is exercised
in-process with no running server.
"""

from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def test_get_health_returns_ok() -> None:
    """GET /health responds with 200 and exactly {"status": "ok"}."""
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_post_health_returns_405() -> None:
    """A non-GET method at /health is rejected and never returns the OK body."""
    response = client.post("/health")

    assert response.status_code == 405
    assert response.json() != {"status": "ok"}
