"""Property-based tests (optional for MVP; design.md "Correctness Properties")."""

import re

import hypothesis.strategies as st
import pytest
from app.repositories.member_repository import normalize_display_name
from app.schemas.room import CreateRoomRequest, JoinRoomRequest
from app.services.room_service import generate_room_code
from hypothesis import given, settings
from pydantic import ValidationError as PydanticValidationError

# Unicode space separators plus ASCII whitespace control characters.
whitespace = st.text(
    alphabet=st.one_of(st.characters(whitelist_categories=("Zs",)), st.sampled_from("\t\n\r")),
    min_size=1,
    max_size=50,
)
display_names = st.text(min_size=1, max_size=50).filter(lambda s: s.strip())


# Feature: 02-backend-core, Property 3: Generated room codes always match required format
@settings(max_examples=200)
@given(length=st.integers(min_value=4, max_value=12))
def test_room_code_format_property(length):
    code = generate_room_code(length)
    assert re.fullmatch(r"^[A-Z0-9]{4,12}$", code)
    assert len(code) == length


# Feature: 02-backend-core, Property 5: Whitespace-only strings rejected
@settings(max_examples=200)
@given(blank=whitespace)
def test_whitespace_only_strings_rejected(blank):
    with pytest.raises(PydanticValidationError):
        CreateRoomRequest(name=blank, owner_display_name="Gerald")
    with pytest.raises(PydanticValidationError):
        CreateRoomRequest(name="Adventure Club", owner_display_name=blank)
    with pytest.raises(PydanticValidationError):
        JoinRoomRequest(display_name=blank)


# Feature: 02-backend-core, Property 1: Normalization matches the identity rule
@settings(max_examples=200)
@given(name=display_names)
def test_normalization_identity_rule(name):
    normalized = normalize_display_name(name)
    assert normalize_display_name(normalized) == normalized
    assert normalize_display_name(f"  {name}  ") == normalized
    assert normalize_display_name(name.upper()) == normalize_display_name(normalized.upper())
    assert normalized == normalized.strip()
    assert "  " not in normalized
