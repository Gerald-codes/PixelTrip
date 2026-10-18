"""Tests for SETUP guidance and WRAP summary helpers."""

from __future__ import annotations

import pytest
from app.agents.errors import NoApprovedItineraryError
from app.services.stage_helpers import emit_setup_guidance, produce_wrap_summary

from tests.agents.conftest import FakeSupabaseClient
from tests.agents.test_messages import TRIP, resolvable, wired_bundle


async def test_setup_guidance_emits_a_text_message() -> None:
    """SETUP produces one guidance message, nothing else."""
    client = resolvable(FakeSupabaseClient())
    client.queue("rpc:insert_message_turn", [{"id": "m1", "kind": "text"}])

    row = await emit_setup_guidance(wired_bundle(client), TRIP)

    assert row == {"id": "m1", "kind": "text"}
    sent = client.calls_for("rpc:insert_message_turn")[0].payload["p_messages"][0]
    assert sent["kind"] == "text"
    assert sent["content"]["stage"] == "SETUP"


async def test_setup_guidance_creates_zero_agent_runs_rows() -> None:
    """Requirement 1.11: SETUP never creates an agent_runs row."""
    client = resolvable(FakeSupabaseClient())
    client.queue("rpc:insert_message_turn", [{"id": "m1", "kind": "text"}])

    await emit_setup_guidance(wired_bundle(client), TRIP)

    assert client.calls_for("agent_runs") == []


async def test_setup_guidance_accepts_custom_text() -> None:
    client = resolvable(FakeSupabaseClient())
    client.queue("rpc:insert_message_turn", [{"id": "m1", "kind": "text"}])

    await emit_setup_guidance(wired_bundle(client), TRIP, text="Build your character first!")

    sent = client.calls_for("rpc:insert_message_turn")[0].payload["p_messages"][0]
    assert sent["content"]["text"] == "Build your character first!"


async def test_wrap_summary_reads_the_approved_version() -> None:
    """Requirement 1.12: reads the approved version, inserts no new one."""
    client = resolvable(FakeSupabaseClient())
    client.queue(
        "itinerary_versions",
        [
            {
                "id": "approved-v3",
                "status": "approved",
                "itinerary": {"title": "The Osaka Quest", "summary": "A grand adventure."},
            }
        ],
    )
    client.queue("rpc:insert_message_turn", [{"id": "m1", "kind": "summary"}])

    await produce_wrap_summary(wired_bundle(client), TRIP)

    sent = client.calls_for("rpc:insert_message_turn")[0].payload["p_messages"][0]
    assert sent["kind"] == "summary"
    assert sent["content"]["title"] == "The Osaka Quest"
    assert sent["content"]["itinerary_version_id"] == "approved-v3"
    assert sent["content"]["stage"] == "WRAP"
    assert client.calls_for("itinerary_versions") == [
        c for c in client.calls_for("itinerary_versions") if c.op == "select"
    ]


async def test_wrap_with_no_approved_version_raises_with_no_message() -> None:
    """Requirement 1.13: no approved version, no summary, loud failure."""
    client = resolvable(FakeSupabaseClient())
    client.queue("itinerary_versions", [])

    with pytest.raises(NoApprovedItineraryError):
        await produce_wrap_summary(wired_bundle(client), TRIP)

    assert client.write_calls == []


async def test_wrap_approved_version_lookup_is_scoped_to_approved_status() -> None:
    """The read filters on status='approved', never guessing from 'latest'."""
    client = resolvable(FakeSupabaseClient())
    client.queue(
        "itinerary_versions",
        [{"id": "v2", "status": "approved", "itinerary": {}}],
    )
    client.queue("rpc:insert_message_turn", [{"id": "m1"}])

    await produce_wrap_summary(wired_bundle(client), TRIP)

    lookup = client.calls_for("itinerary_versions")[0]
    assert lookup.has_filter("status", "approved")
    assert lookup.has_filter("trip_id", TRIP)
