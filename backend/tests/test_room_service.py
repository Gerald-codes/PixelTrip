"""Unit tests for ``RoomService`` with mocked repositories (Requirement 19).

No Supabase calls are made: every repository is an ``AsyncMock`` with the real class as
its spec, so calling a method that does not exist fails the test.
"""

import re

import pytest
from app.exceptions import RepositoryError, RoomNotFoundError
from app.repositories.member_repository import (
    MemberRepository,
    normalize_display_name,
)
from app.repositories.profile_repository import ProfileRepository
from app.repositories.room_repository import RoomRepository
from app.repositories.trip_repository import TripRepository
from app.schemas.room import CreateRoomRequest, CreateRoomResponse, JoinRoomRequest
from app.services.room_service import RoomService, generate_room_code

pytestmark = pytest.mark.anyio

ROOM_ID = "11111111-1111-4111-8111-111111111111"
GUEST_ID = "22222222-2222-4222-8222-222222222222"
MEMBER_ID = "33333333-3333-4333-8333-333333333333"

ROOM = {
    "id": ROOM_ID,
    "room_code": "ABC123",
    "name": "Adventure Club",
    "status": "active",
    "planning_stage": "setup",
}
GUEST = {"id": GUEST_ID, "display_name": "Gerald", "avatar_url": None}
CHARACTER = {
    "id": "44444444-4444-4444-8444-444444444444",
    "member_id": MEMBER_ID,
    "appearance": {},
    "sprite_key": None,
}
PREFS = {
    "id": "55555555-5555-4555-8555-555555555555",
    "member_id": MEMBER_ID,
    "available_dates": [],
    "destinations": [],
    "travel_style": None,
    "budget": None,
    "interests": [],
    "activities": [],
    "hard_constraints": [],
}

TRIP = {
    "id": "66666666-6666-4666-8666-666666666666",
    "room_id": ROOM_ID,
    "title": "Adventure Club",
    "summary": None,
    "status": "trip_created",
}

CREATE_METHODS = (
    ("profile", "create_guest"),
    ("member", "create_member"),
    ("profile", "create_character"),
    ("profile", "create_preferences"),
)


def make_member(role: str = "member", display_name: str = "Gerald") -> dict:
    return {
        "id": MEMBER_ID,
        "room_id": ROOM_ID,
        "guest_id": GUEST_ID,
        "display_name": display_name,
        "role": role,
    }


@pytest.fixture
def room_repo(mocker):
    return mocker.AsyncMock(spec=RoomRepository)


@pytest.fixture
def member_repo(mocker):
    return mocker.AsyncMock(spec=MemberRepository)


@pytest.fixture
def profile_repo(mocker):
    return mocker.AsyncMock(spec=ProfileRepository)


@pytest.fixture
def repos(room_repo, member_repo, profile_repo):
    return {"room": room_repo, "member": member_repo, "profile": profile_repo}


@pytest.fixture
def trip_repo(mocker):
    repo = mocker.AsyncMock(spec=TripRepository)
    repo.get_by_room_id.return_value = TRIP
    return repo


@pytest.fixture
def room_service(room_repo, member_repo, profile_repo, trip_repo):
    return RoomService(room_repo, member_repo, profile_repo, trip_repo)


def assert_no_create_calls(repos: dict) -> None:
    for repo, method in CREATE_METHODS:
        getattr(repos[repo], method).assert_not_awaited()


def assert_each_create_called_once(repos: dict) -> None:
    for repo, method in CREATE_METHODS:
        getattr(repos[repo], method).assert_awaited_once()


# --- create_room ------------------------------------------------------------------------


@pytest.fixture
def rpc_result():
    return {
        "room": ROOM,
        "guest": GUEST,
        "member": make_member(role="owner"),
        "character": CHARACTER,
        "travel_preferences": PREFS,
        "trip": TRIP,
    }


async def test_create_room_happy_path(room_service, room_repo, rpc_result):
    room_repo.get_room_by_code.return_value = None
    room_repo.create_room_with_owner.return_value = rpc_result

    response = await room_service.create_room(
        CreateRoomRequest(name="Adventure Club", owner_display_name="Gerald")
    )

    assert isinstance(response, CreateRoomResponse)
    assert response.room.room_code == "ABC123"
    assert response.member.role == "owner"
    assert response.guest.display_name == "Gerald"
    assert response.character.member_id == MEMBER_ID
    assert response.travel_preferences.member_id == MEMBER_ID


async def test_create_room_uses_rpc(room_service, room_repo, repos, rpc_result):
    room_repo.get_room_by_code.return_value = None
    room_repo.create_room_with_owner.return_value = rpc_result

    await room_service.create_room(
        CreateRoomRequest(name="Adventure Club", owner_display_name="Gerald")
    )

    room_repo.create_room_with_owner.assert_awaited_once()
    kwargs = room_repo.create_room_with_owner.await_args.kwargs
    assert kwargs["name"] == "Adventure Club"
    assert kwargs["owner_display_name"] == "Gerald"
    assert re.fullmatch(r"[A-Z0-9]{4,12}", kwargs["room_code"])
    assert_no_create_calls(repos)


async def test_create_room_retries_taken_codes(room_service, room_repo, rpc_result):
    room_repo.get_room_by_code.side_effect = [ROOM, ROOM, None]
    room_repo.create_room_with_owner.return_value = rpc_result

    await room_service.create_room(
        CreateRoomRequest(name="Adventure Club", owner_display_name="Gerald")
    )

    assert room_repo.get_room_by_code.await_count == 3


async def test_create_room_repo_failure(room_service, room_repo):
    room_repo.get_room_by_code.return_value = None
    error = RepositoryError("Database operation 'create_room_with_owner' failed.")
    room_repo.create_room_with_owner.side_effect = error

    with pytest.raises(RepositoryError) as raised:
        await room_service.create_room(
            CreateRoomRequest(name="Adventure Club", owner_display_name="Gerald")
        )
    assert raised.value is error


def test_generate_room_code_format():
    for _ in range(100):
        assert re.fullmatch(r"^[A-Z0-9]{4,12}$", generate_room_code())


# --- join_room --------------------------------------------------------------------------


async def test_join_room_resume_path(room_service, room_repo, member_repo, profile_repo, repos):
    room_repo.get_room_by_code.return_value = ROOM
    member_repo.get_member_by_display_name.return_value = make_member()
    profile_repo.get_guest_by_id.return_value = GUEST
    profile_repo.get_character_by_member_id.return_value = CHARACTER
    profile_repo.get_preferences_by_member_id.return_value = PREFS

    response = await room_service.join_room("ABC123", JoinRoomRequest(display_name="gerald"))

    assert response.member.id == MEMBER_ID
    assert response.member.display_name == "Gerald"  # stored name, not the input
    assert_no_create_calls(repos)


async def test_join_room_resume_with_missing_records(
    room_service, room_repo, member_repo, profile_repo, repos
):
    room_repo.get_room_by_code.return_value = ROOM
    member_repo.get_member_by_display_name.return_value = make_member()
    profile_repo.get_guest_by_id.return_value = GUEST
    profile_repo.get_character_by_member_id.return_value = None
    profile_repo.get_preferences_by_member_id.return_value = None

    response = await room_service.join_room("ABC123", JoinRoomRequest(display_name="Gerald"))

    assert response.character is None
    assert response.travel_preferences is None
    assert_no_create_calls(repos)


async def test_join_room_new_member_path(room_service, room_repo, member_repo, profile_repo, repos):
    room_repo.get_room_by_code.return_value = ROOM
    member_repo.get_member_by_display_name.return_value = None
    profile_repo.create_guest.return_value = {**GUEST, "display_name": "Priya"}
    member_repo.create_member.return_value = make_member(display_name="Priya")
    profile_repo.create_character.return_value = CHARACTER
    profile_repo.create_preferences.return_value = PREFS

    response = await room_service.join_room("ABC123", JoinRoomRequest(display_name="Priya"))

    assert_each_create_called_once(repos)
    member_repo.create_member.assert_awaited_once_with(
        room_id=ROOM_ID, guest_id=GUEST_ID, display_name="Priya", role="member"
    )
    assert response.member.role == "member"
    assert response.character is not None
    assert response.travel_preferences is not None


async def test_join_room_room_not_found(room_service, room_repo, member_repo, repos):
    room_repo.get_room_by_code.return_value = None

    with pytest.raises(RoomNotFoundError):
        await room_service.join_room("ZZZZ99", JoinRoomRequest(display_name="Gerald"))

    member_repo.get_member_by_display_name.assert_not_awaited()
    assert_no_create_calls(repos)


async def test_join_room_passes_name_as_received(
    room_service, room_repo, member_repo, profile_repo
):
    room_repo.get_room_by_code.return_value = ROOM
    member_repo.get_member_by_display_name.return_value = make_member()
    profile_repo.get_guest_by_id.return_value = GUEST
    profile_repo.get_character_by_member_id.return_value = None
    profile_repo.get_preferences_by_member_id.return_value = None

    await room_service.join_room("ABC123", JoinRoomRequest(display_name="GERald"))

    member_repo.get_member_by_display_name.assert_awaited_once_with(
        room_id=ROOM_ID, display_name="GERald"
    )


async def test_join_room_repo_failure_propagates(
    room_service, room_repo, member_repo, profile_repo
):
    room_repo.get_room_by_code.return_value = ROOM
    member_repo.get_member_by_display_name.return_value = None
    error = RepositoryError("Database operation 'insert' on 'guests' failed.")
    profile_repo.create_guest.side_effect = error

    with pytest.raises(RepositoryError) as raised:
        await room_service.join_room("ABC123", JoinRoomRequest(display_name="Priya"))
    assert raised.value is error
    member_repo.create_member.assert_not_awaited()


# --- normalization ----------------------------------------------------------------------


@pytest.mark.parametrize("name", ["Gerald", "gerald", "GERald", "  Gerald  ", "\tGerald\n"])
def test_normalize_display_name_same_person(name):
    assert normalize_display_name(name) == "gerald"


def test_normalize_display_name_collapses_inner_whitespace():
    assert normalize_display_name("Mary   Jane") == "mary jane"


# --- trip ----------------------------------------------------------------------------


async def test_create_room_returns_trip(room_service, room_repo, rpc_result):
    room_repo.get_room_by_code.return_value = None
    room_repo.create_room_with_owner.return_value = rpc_result

    response = await room_service.create_room(
        CreateRoomRequest(name="Adventure Club", owner_display_name="Gerald")
    )

    assert response.trip.id == TRIP["id"]
    assert response.trip.status == "trip_created"


def _new_member_setup(room_repo, member_repo, profile_repo, members_after_join: int):
    room_repo.get_room_by_code.return_value = ROOM
    member_repo.get_member_by_display_name.return_value = None
    profile_repo.create_guest.return_value = {**GUEST, "display_name": "Priya"}
    member_repo.create_member.return_value = make_member(display_name="Priya")
    profile_repo.create_character.return_value = CHARACTER
    profile_repo.create_preferences.return_value = PREFS
    member_repo.list_by_room.return_value = [make_member()] * members_after_join


async def test_second_member_forms_the_group(
    room_service, room_repo, member_repo, profile_repo, trip_repo
):
    _new_member_setup(room_repo, member_repo, profile_repo, members_after_join=2)
    trip_repo.update_status.return_value = {**TRIP, "status": "group_formed"}

    response = await room_service.join_room("ABC123", JoinRoomRequest(display_name="Priya"))

    trip_repo.update_status.assert_awaited_once_with(TRIP["id"], "group_formed", "setup")
    assert response.trip.status == "group_formed"


async def test_first_member_does_not_form_the_group(
    room_service, room_repo, member_repo, profile_repo, trip_repo
):
    _new_member_setup(room_repo, member_repo, profile_repo, members_after_join=1)

    response = await room_service.join_room("ABC123", JoinRoomRequest(display_name="Priya"))

    trip_repo.update_status.assert_not_awaited()
    assert response.trip.status == "trip_created"


async def test_join_room_without_trip_is_rejected(room_service, room_repo, trip_repo, repos):
    room_repo.get_room_by_code.return_value = ROOM
    trip_repo.get_by_room_id.return_value = None

    with pytest.raises(RoomNotFoundError):
        await room_service.join_room("ABC123", JoinRoomRequest(display_name="Priya"))
    assert_no_create_calls(repos)
