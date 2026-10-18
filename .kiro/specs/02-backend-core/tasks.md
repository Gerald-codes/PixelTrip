# Implementation Plan: Backend Core (02-backend-core)

## Overview

This plan implements the two room-management endpoints (`POST /rooms` and
`POST /rooms/{room_code}/join`) using a strict three-layer architecture
(routes → services → repositories) with all dependencies wired through FastAPI's
`Depends()` mechanism.

Key design pillars this plan is derived from:

- **3 domain repositories, not 5 table repos.** `RoomRepository` (room lookup + atomic
  creation), `MemberRepository` (member CRUD + case-insensitive identity lookup), and
  `ProfileRepository` (guest/character/travel-preferences accessed as one unit). There is
  no `GuestRepository`/`CharacterRepository`/`PreferencesRepository`.
- **Atomic room creation via a PostgreSQL RPC.** `RoomService.create_room` calls
  `RoomRepository.create_room_with_owner`, which invokes the `create_room_with_owner` RPC —
  a single transaction inserting all five records or none. There is no sequential 5-insert
  chain for create.
- **Case-insensitive guest identity.** `room_id + normalized display_name` → `room_member`.
  `"Gerald"`, `"gerald"`, and `"GERald"` are the same member. The database's generated
  `normalized_name` column (trim, collapse whitespace, lower-case) with
  `UNIQUE(room_id, normalized_name)` enforces it; `MemberRepository` applies the same rule
  in Python via `normalize_display_name()`. The service passes `display_name` as received.
- **Standardized error envelope.** All errors use
  `{"error": {"code": "<CODE>", "message": "<msg>"}}` via `app/schemas/errors.py`
  (`ErrorDetail`, `ErrorResponse`) and a shared `_err(code, message)` helper in
  `app/main.py`. No `{"detail": ...}` shape anywhere, including for Pydantic validation.
- **Supabase client split.** `app/db/supabase_client.py` owns the low-level
  `create_supabase_client() -> AsyncClient` factory (creation only, no FastAPI deps);
  `app/api/deps.py` owns `get_supabase_client()` plus the repository and service providers.

The implementation language is **Python** (confirmed by the design's concrete Python code),
so no language-selection question is required.

## Tasks

- [x] 1. Dependencies and environment configuration
  - [x] 1.1 Update `backend/pyproject.toml` dependencies
    - Add `supabase>=2.4` to `[project] dependencies` (runtime).
    - Add `pytest-mock>=3.12` and `hypothesis>=6.100` to `[project.optional-dependencies] dev`.
    - Keep pinned minimum-version (`>=X.Y`) specifiers; do not conflict with
      `fastapi>=0.110`, `uvicorn[standard]>=0.29`, `pydantic>=2.6`, `pydantic-settings>=2.2`.
    - _Requirements: 21.1, 21.2, 21.3, 21.4_

  - [x] 1.2 Update `backend/.env.example`
    - Add placeholders for `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
      `FRONTEND_URL=http://localhost:3000`; remove the old `CORS_ALLOW_ORIGINS` line so
      only one setting controls CORS.
    - _Requirements: 1.2, 16.4_

- [x] 2. Configuration, domain exceptions, and error schema
  - [x] 2.1 Extend `app/core/config.py` Settings
    - Add required `supabase_url` (with a `field_validator` that rejects a value missing a
      scheme or host, raising a `ConfigError`-style error identifying `SUPABASE_URL`).
    - Add required `supabase_service_role_key` declared with `repr=False` so it is omitted
      from `str(settings)` and logs.
    - Add `frontend_url: str = Field(default="http://localhost:3000")`.
    - _Requirements: 1.2, 1.5, 1.6, 16.2_

  - [x] 2.2 Create `app/exceptions.py`
    - Define `BackendError` base plus `RoomNotFoundError`, `MemberAlreadyExistsError`,
      `InvalidDisplayNameError`, `RepositoryError`, `RoomCodeExhaustedError`, and
      `ValidationError`.
    - Pydantic also has a `ValidationError`. Wherever both are needed (e.g. `app/main.py`,
      tests), import Pydantic's as `from pydantic import ValidationError as
      PydanticValidationError` so handlers and assertions never confuse the two.
    - Add a module docstring stating the persistent architecture rule (backend owns all
      mutations and error translation; all errors conform to the `API_Error_Response`
      envelope).
    - _Requirements: 2.2, 13.1, 18.4, 22.4_

  - [x] 2.3 Create `app/schemas/errors.py`
    - Define `ErrorDetail(code: str, message: str)` and `ErrorResponse(error: ErrorDetail)`
      as Pydantic models so the shape appears in the OpenAPI schema.
    - _Requirements: 22.1, 22.2_

- [x] 3. Database schema migrations
  - [x] 3.1 Case-insensitive identity in `supabase/migrations/20260925000000_initial_schema.sql`
    - `room_members.normalized_name` is generated as
      `lower(btrim(regexp_replace(display_name, '\s+', ' ', 'g')))` with
      `UNIQUE(room_id, normalized_name)`. No separate identity migration is needed.
    - _Requirements: 7.1, 7.2, 7.4_

  - [x] 3.2 Create `supabase/migrations/20260925000002_create_room_rpc.sql`
    - Define the `create_room_with_owner(p_room_name, p_room_code, p_owner_display_name,
      p_appearance)` plpgsql function inserting into `party_rooms`, `guests`,
      `room_members`, `characters`, `travel_preferences` in one transaction.
    - Return `jsonb_build_object(...)` with `room`, `guest`, `member`, `character`,
      `travel_preferences`; roll back on any insert failure.
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 4. Supabase client factory and dependency-injection providers
  - [x] 4.1 Create `app/db/supabase_client.py`
    - Implement `create_supabase_client() -> AsyncClient` using `acreate_client` with
      `settings.supabase_url` and `settings.supabase_service_role_key`.
    - Creation only — this module defines no FastAPI dependencies.
    - _Requirements: 1.3_

  - [x] 4.2 Create `app/api/deps.py` (build after task 7 — it imports `RoomService`)
    - Implement `get_supabase_client()` (calls the factory), and `get_room_repo`,
      `get_member_repo`, `get_profile_repo`, `get_room_service` — each composed via
      `Depends()`.
    - This is the single override point for tests.
    - _Requirements: 1.4, 2.4_

- [x] 5. Base repository, domain repositories, and Pydantic schemas
  - [x] 5.1 Create `app/repositories/base.py`
    - Implement `BaseRepository(client)` storing the injected `AsyncClient` and a
      `_handle_error(exc, operation, table)` helper that always raises `RepositoryError`
      with a safe message naming the operation and table (no Supabase-internal fields).
    - _Requirements: 2.3, 6.7, 18.1_

  - [x] 5.2 Create `app/repositories/room_repository.py`
    - Implement `RoomRepository(BaseRepository)` with `create_room_with_owner` (validate
      `name` 1–100 and non-whitespace + `room_code` against `^[A-Z0-9]{4,12}$` before any
      DB call, invoke the RPC, parse the result dict, raise `RepositoryError` on RPC error),
      `get_room_by_code`, and `get_room_by_id`.
    - Perform no individual table inserts for room creation.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 8.4, 8.5_

  - [x] 5.3 Create `app/repositories/member_repository.py`
    - Implement `MemberRepository(BaseRepository)` with `create_member` (validate args,
      detect Postgres `23505` → `MemberAlreadyExistsError`), `get_member_by_display_name`
      (normalizes the name and matches `room_id` + `normalized_name`),
      `get_member_by_id`, and `list_members_by_room`.
    - Add module-level `normalize_display_name(name) -> str` returning
      `" ".join(name.split()).lower()`, matching the database's generated column.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 7.3_

  - [x] 5.4 Create `app/repositories/profile_repository.py`
    - Implement `ProfileRepository(BaseRepository)` with `create_guest`, `get_guest_by_id`,
      `create_character`, `get_character_by_member_id`, `create_preferences`, and
      `get_preferences_by_member_id`.
    - Add input guards raising `ValidationError` for empty/whitespace/oversized
      `display_name` and for malformed (non-UUID) id arguments before any DB call.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10_

  - [x] 5.5 Create `app/schemas/room.py`
    - Define `_Base` with `model_config` (`alias_generator=to_camel`,
      `populate_by_name=True`, `from_attributes=True`) and the `_non_empty_str`
      whitespace-rejecting validator.
    - Define the five response schemas (`GuestSchema`, `PartyRoomSchema`,
      `RoomMemberSchema`, `CharacterSchema`, `TravelPreferencesSchema`),
      `CreateRoomRequest`/`JoinRoomRequest` with `Field(examples=[...])`, and the
      `_RoomPayload` base yielding `CreateRoomResponse`/`JoinRoomResponse`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 17.3_

- [x] 6. Room code generation utility
  - [x] 6.1 Add module-level `generate_room_code(length=6)` to `app/services/room_service.py`
    - Use `secrets.choice` over `string.ascii_uppercase + string.digits`; result matches
      `^[A-Z0-9]{4,12}$`.
    - Name normalization is not done here; it lives in `MemberRepository` (task 5.3).
    - _Requirements: 9.1, 9.3, 9.4_

- [x] 7. RoomService operations
  - [x] 7.1 Implement `RoomService.__init__` and `create_room`
    - `__init__(room_repo, member_repo, profile_repo)`.
    - `create_room`: retry `generate_room_code` up to 10× checking `get_room_by_code`;
      raise `RoomCodeExhaustedError` if exhausted. Call `create_room_with_owner` (single
      atomic RPC — not individual inserts) passing `appearance={}`; build
      `CreateRoomResponse` from the RPC result; propagate domain exceptions.
    - _Requirements: 9.2, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9_

  - [x] 7.2 Implement `RoomService.join_room`
    - `get_room_by_code` → raise `RoomNotFoundError` if `None`. Call
      `get_member_by_display_name(room_id, display_name)` passing `display_name` as received
      (the repository normalizes it).
    - Resume path: fetch guest/character/prefs, make no create calls. New-member path:
      create guest → member (`role="member"`) → character → preferences. Propagate domain
      exceptions.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 12.1, 12.2, 12.3, 12.4, 12.5, 13.1_

- [x] 8. Routes and application wiring
  - [x] 8.1 Create `app/api/routes/rooms.py`
    - `APIRouter(prefix="/rooms", tags=["rooms"])`; `POST ""` (create_room) and
      `POST "/{room_code}/join"` with
      `room_code: Annotated[str, Path(pattern=r"^[A-Z0-9]{4,12}$")]`.
    - Each route has a docstring, `summary=`, `description=`, and `responses=` documenting
      the 200 case and applicable error cases; delegate to the service only (no manual error
      dicts).
    - _Requirements: 2.1, 14.1, 14.2, 14.3, 14.4, 15.1, 15.2, 15.4, 15.6, 17.1, 17.2, 17.4, 17.5_

  - [x] 8.2 Update `app/main.py`
    - Add `CORSMiddleware` with `allow_origins=[settings.frontend_url]`; include the rooms
      router.
    - Define the `_err(code, message)` helper using `ErrorResponse`/`ErrorDetail`; register
      exception handlers for all domain exceptions per the code map; override
      `RequestValidationError` to emit the `VALIDATION_ERROR` envelope (not
      `{"detail": [...]}`); add a catch-all `Exception` handler → 500 `INTERNAL_ERROR` via
      `_err`.
    - Ensure the service-role key and raw Supabase payloads never appear in responses (the
      `RepositoryError` handler returns a fixed safe message).
    - _Requirements: 13.2, 13.4, 14.5, 15.3, 15.5, 16.1, 16.3, 16.5, 18.1, 18.2, 18.3, 18.4, 18.5, 22.1, 22.3, 22.4, 22.5, 22.6_

- [x] 9. Checkpoint — verify wiring
  - Run the existing health test, `ruff check .`, and confirm the app boots with
    `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` present.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Unit tests for RoomService (`tests/test_room_service.py`)
  - [x]* 10.1 Create fixtures and create-room tests
    - Fixtures: `mocker.AsyncMock(spec=RoomRepository/MemberRepository/ProfileRepository)`
      and a real `RoomService`.
    - `test_create_room_happy_path` (all five response fields populated) and
      `test_create_room_uses_rpc` (`create_room_with_owner` called exactly once; no
      individual insert methods called).
    - _Requirements: 19.1, 19.2, 19.6_

  - [x]* 10.2 Add join-room and failure-propagation tests
    - `test_join_room_resume_path` (no `create_*` calls), `test_join_room_new_member_path`
      (each `create_*` called once), `test_join_room_room_not_found`
      (`RoomNotFoundError`, no `create_*` calls), `test_join_room_passes_name_as_received`
      (`"GERald"` reaches `get_member_by_display_name` unchanged),
      `test_normalize_display_name` (`"Gerald"`, `"gerald"`, `"GERald"`, `"  Gerald  "` →
      `"gerald"`; `"Mary   Jane"` → `"mary jane"`), and `test_create_room_repo_failure`
      (`RepositoryError` propagates).
    - _Requirements: 19.3, 19.4, 19.5, 19.6_

- [x] 11. Integration tests for endpoints (`tests/test_rooms_api.py`)
  - [x]* 11.1 Create the test client fixture and create-room tests
    - `test_client` fixture overriding `get_room_service` with
      `mocker.AsyncMock(spec=RoomService)`; teardown clears `app.dependency_overrides`.
    - `test_post_rooms_200` and `test_post_rooms_422_empty_name`.
    - _Requirements: 20.1, 20.5_

  - [x]* 11.2 Add join-room integration tests
    - `test_post_rooms_join_new_member_200` (`member.role == "member"`),
      `test_post_rooms_join_resume_200` (`"Gerald"` then `"gerald"` → same `member.id`),
      `test_post_rooms_join_404`
      (`{"error":{"code":"ROOM_NOT_FOUND",...}}`), `test_post_rooms_join_422_bad_code`,
      `test_post_rooms_join_409_conflict`
      (`{"error":{"code":"MEMBER_ALREADY_EXISTS",...}}`, no constraint names),
      `test_post_rooms_503_on_repo_error`
      (`{"error":{"code":"DATABASE_ERROR",...}}`, no service-role key).
    - _Requirements: 20.2, 20.3, 20.4, 20.5_

- [x] 12. Error-envelope conformance and access-boundary documentation
  - [x]* 12.1 Add error-envelope conformance tests
    - `test_error_response_shape_404`, `_409`, `_422`, `_503` — each asserts the exact
      `{"error": {"code": ..., "message": <non-empty>}}` shape and that a top-level
      `"detail"` key is NOT present.
    - _Requirements: 22.1, 22.3, 22.4_

  - [x] 12.2 Add `docs/SUPABASE_ACCESS_BOUNDARY.md`
    - Document operations that MUST go through FastAPI (create room, join room, update
      preferences, submit votes, generate itinerary, refine itinerary, update planning
      state); approved direct frontend Supabase access (realtime subscriptions,
      non-sensitive reads) plus the requirement to comment them in `src/services/*.ts`;
      and that the service-role key is backend-only while the frontend uses only the anon
      key.
    - _Requirements: 23.1, 23.2, 23.3, 23.5_

- [x] 13. Property-based tests (optional for MVP)
  - [x]* 13.1 Add `generate_room_code` format property test
    - **Property 3: Generated room codes always match the required format**
    - Assert every generated code matches `^[A-Z0-9]{4,12}$` across ≥100 iterations,
      tagged `Feature: 02-backend-core, Property 3`.
    - _Requirements: 9.1, 9.4_

  - [x]* 13.2 Add whitespace-only rejection property test
    - **Property 5: Whitespace-only strings are rejected by the non-empty validator**
    - Assert whitespace-only `name`/`owner_display_name`/`display_name` raises a Pydantic
      `ValidationError`, tagged `Feature: 02-backend-core, Property 5`.
    - _Requirements: 3.13, 12.4_

  - [x]* 13.3 Add display-name normalization property test
    - **Property 1: Normalization matches the identity rule**
    - For generated valid names, assert `normalize_display_name` is idempotent and gives the
      same result for upper-case, lower-case, and space-padded variants, tagged
      `Feature: 02-backend-core, Property 1`.
    - _Requirements: 7.3, 11.4_

- [x] 14. Final checkpoint — full verification
  - Run the full `pytest` suite, verify the app boots with `SUPABASE_URL` and
    `SUPABASE_SERVICE_ROLE_KEY` present, and confirm `ruff check .` is clean.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (test-focused) and may be skipped for a faster MVP;
  core implementation tasks are never optional.
- **3-repo domain structure:** repositories follow business domains, not tables —
  `RoomRepository`, `MemberRepository`, `ProfileRepository`. There are no separate
  `GuestRepository`/`CharacterRepository`/`PreferencesRepository` classes.
- **RPC atomicity for create_room:** room creation is a single atomic
  `create_room_with_owner` RPC transaction (all five records or none) — never a sequential
  5-insert chain.
- **join_room new-member path is NOT transactional:** the sequential `create_guest` →
  `create_member` → `create_character` → `create_preferences` chain can leave partial
  records on failure. This is an accepted MVP limitation; a future RPC/cleanup strategy may
  strengthen it.
- **Case-insensitive identity:** `"Gerald"`, `"gerald"`, and `"GERald"` are the same
  member. `MemberRepository.normalize_display_name()` must stay identical to the database's
  generated `normalized_name` column.
- **Service-role key safety:** the service-role key, raw Supabase payloads, and stack
  traces never appear in any response body.
- **Migration ordering:** apply `20260925000000_initial_schema.sql` then
  `20260925000002_create_room_rpc.sql` before testing against a real database, so the
  `UNIQUE(room_id, normalized_name)` constraint and the RPC are both active.
- **Build order:** `app/api/deps.py` (task 4.2) imports `RoomService`, so build it after
  task 7.
- Each non-checkpoint task references the current 23-requirement numbering for traceability.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.2", "2.3"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["4.1"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "5.5"] },
    { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["7.1", "7.2"] },
    { "id": 7, "tasks": ["4.2"] },
    { "id": 8, "tasks": ["8.1"] },
    { "id": 9, "tasks": ["8.2", "12.2"] },
    { "id": 10, "tasks": ["10.1", "10.2", "13.1", "13.2", "13.3"] },
    { "id": 11, "tasks": ["11.1", "11.2", "12.1"] }
  ]
}
```
