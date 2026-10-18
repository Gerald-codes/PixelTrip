"""Repository tests with a fake Supabase client (no network).

Covers input guards, error wrapping, duplicate-name detection, and the case-insensitive
lookup.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from app.exceptions import MemberAlreadyExistsError, RepositoryError, ValidationError
from app.repositories.member_repository import MemberRepository
from app.repositories.profile_repository import ProfileRepository
from app.repositories.room_repository import RoomRepository
from postgrest.exceptions import APIError

pytestmark = pytest.mark.anyio

ROOM_ID = "11111111-1111-4111-8111-111111111111"
GUEST_ID = "22222222-2222-4222-8222-222222222222"


def fake_client(data=None, error: Exception | None = None) -> MagicMock:
    """A client whose query chain (table/select/eq/limit/insert/rpc) ends in ``execute``."""
    query = MagicMock()
    for method in ("select", "eq", "limit", "insert"):
        getattr(query, method).return_value = query
    if error is not None:
        query.execute = AsyncMock(side_effect=error)
    else:
        query.execute = AsyncMock(return_value=MagicMock(data=data))
    client = MagicMock()
    client.table.return_value = query
    client.rpc.return_value = query
    return client


async def test_member_lookup_uses_normalized_name():
    client = fake_client(data=[{"id": "m1"}])

    result = await MemberRepository(client).get_member_by_display_name(ROOM_ID, "  GERald ")

    assert result == {"id": "m1"}
    query = client.table.return_value
    query.eq.assert_any_call("room_id", ROOM_ID)
    query.eq.assert_any_call("normalized_name", "gerald")


async def test_member_lookup_returns_none_when_absent():
    client = fake_client(data=[])

    assert await MemberRepository(client).get_member_by_display_name(ROOM_ID, "Priya") is None


async def test_create_member_duplicate_raises_conflict():
    duplicate = APIError(
        {"code": "23505", "message": 'violates "room_members_room_id_normalized_name_key"'}
    )
    client = fake_client(error=duplicate)

    with pytest.raises(MemberAlreadyExistsError) as raised:
        await MemberRepository(client).create_member(ROOM_ID, GUEST_ID, "Gerald", "member")
    assert "room_members_room_id_normalized_name_key" not in str(raised.value)


async def test_supabase_error_is_wrapped_without_raw_details():
    client = fake_client(error=APIError({"code": "XX000", "message": "secret internals"}))

    with pytest.raises(RepositoryError) as raised:
        await ProfileRepository(client).create_guest("Gerald")
    assert "secret internals" not in str(raised.value)
    assert str(raised.value) == "Database operation 'insert' on 'guests' failed."


@pytest.mark.parametrize(
    "call",
    [
        lambda c: MemberRepository(c).create_member("not-a-uuid", GUEST_ID, "Gerald", "member"),
        lambda c: MemberRepository(c).create_member(ROOM_ID, GUEST_ID, "Gerald", "admin"),
        lambda c: MemberRepository(c).create_member(ROOM_ID, GUEST_ID, "x" * 51, "member"),
        lambda c: ProfileRepository(c).create_guest("   "),
        lambda c: ProfileRepository(c).get_character_by_member_id("123"),
        lambda c: RoomRepository(c).create_room_with_owner("Trip", "abc123", "Gerald"),
        lambda c: RoomRepository(c).create_room_with_owner("x" * 101, "ABC123", "Gerald"),
    ],
)
async def test_input_guards_reject_before_database_call(call):
    client = fake_client(data=[])

    with pytest.raises(ValidationError):
        await call(client)
    client.table.assert_not_called()
    client.rpc.assert_not_called()


async def test_create_room_calls_rpc_once():
    result = {
        key: {} for key in ("room", "guest", "member", "character", "travel_preferences", "trip")
    }
    client = fake_client(data=result)

    assert await RoomRepository(client).create_room_with_owner("Trip", "ABC123", "Gerald") == result
    client.rpc.assert_called_once_with(
        "create_room_with_owner",
        {
            "p_room_name": "Trip",
            "p_room_code": "ABC123",
            "p_owner_display_name": "Gerald",
            "p_appearance": {},
        },
    )
    client.table.assert_not_called()


async def test_create_room_unexpected_rpc_result_is_repository_error():
    client = fake_client(data={"room": {}})

    with pytest.raises(RepositoryError):
        await RoomRepository(client).create_room_with_owner("Trip", "ABC123", "Gerald")
