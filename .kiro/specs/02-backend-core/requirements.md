# Requirements Document

## Introduction

This document specifies the backend core implementation for the PixelArt Trip Planner.
It covers the Supabase client integration, layered architecture (routes → services →
repositories), Pydantic v2 schemas, room creation and join endpoints, error handling,
dependency injection, CORS middleware, OpenAPI documentation, and automated testing.

The foundation (spec 01-project-foundation) established the FastAPI scaffolding, Python
environment, and empty placeholder files. This spec fills in the first real working
backend: the two endpoints (`POST /rooms` and `POST /rooms/{room_code}/join`) that allow
a party to form and carry the guest-identity model defined in `supabase-architecture.md`
and `api-contracts.md`.

**Guest identity model (MVP):** Identity is room-scoped and case-insensitive.
`room_id + normalized display_name` → `room_member`. `"Gerald"`, `"gerald"`, `"GERald"`, and
`" Gerald "` are the same member in the same room. This is a convenience-based identity
model, not authentication — anyone who knows the room code and a member's display name (in
any casing) can resume that member identity. Do not store sensitive personal data. The
`normalized_name` generated column and the `UNIQUE(room_id, normalized_name)` database
constraint from the initial schema enforce uniqueness.

Repository boundaries follow business domains, not individual database tables.

**Architecture rule (persistent across specs):** The backend owns all business decisions, all database writes, and all validation and error translation. The frontend may read realtime state using the Supabase anon key and may subscribe to live updates; it may not perform business-logic mutations directly against Supabase. All error responses from the backend conform to the `API_Error_Response` envelope: `{"error": {"code": "...", "message": "..."}}`. This rule applies to all current and future specs in this project.

Everything out of scope — authentication, AI/LangGraph, votes, messages, itinerary,
feedback, deployment — remains excluded.

---

## Glossary

- **Backend_App**: The FastAPI application living in `backend/`, owned by Dev B.
- **Supabase_Client**: The async `supabase-py` client initialized with the service-role key
  and used exclusively by the Repository Layer.
- **Repository_Layer**: Thin data-access classes in `app/repositories/` that issue all
  Supabase calls and return raw dicts or raise domain exceptions. Repository boundaries
  follow business domains, not individual database tables.
- **RoomRepository**: The repository at `app/repositories/room_repository.py` that owns
  all `party_rooms` table operations, room code generation, and the atomic room creation
  RPC transaction.
- **MemberRepository**: The repository at `app/repositories/member_repository.py` that
  owns all `room_members` table operations, including case-insensitive display name lookup
  and join logic.
- **ProfileRepository**: The repository at `app/repositories/profile_repository.py` that
  owns the guest profile domain: `guests`, `characters`, and `travel_preferences` table
  operations.
- **Service_Layer**: Business-logic classes in `app/services/` that orchestrate repository
  calls and apply the guest-identity rules.
- **Route_Layer**: FastAPI router modules in `app/api/routes/` that parse HTTP requests,
  call services via Dependency Injection, and return serialized responses.
- **DI_Container**: FastAPI's `Depends()` mechanism used to inject the Supabase client,
  repositories, and services into one another.
- **Room_Code**: A unique, human-readable code (e.g. `ABC123`) that identifies a
  `party_rooms` record and is shared with party members so they can join.
- **Guest**: A lightweight profile record in the `guests` table holding `display_name` and
  optional `avatar_url`. Not an authenticated user.
- **Normalized_Name**: A display name with leading and trailing whitespace removed, each
  run of internal whitespace collapsed to a single space, and all letters lower-cased
  (e.g. `"  GERald  "` → `"gerald"`). Stored in the `room_members.normalized_name` generated
  column and used for identity matching. The original `display_name` is kept for display.
- **Room_Member**: A record in `room_members` joining a Guest to a Party_Room with a role
  (`owner` or `member`). Uniqueness within a room is enforced by
  `UNIQUE(room_id, normalized_name)`, so names differing only in case or surrounding
  whitespace are the same member.
- **Character**: A record in `characters` linked to a Room_Member, holding `appearance`
  (JSONB) and optional `sprite_key`.
- **Travel_Preferences**: A record in `travel_preferences` linked to a Room_Member,
  holding JSONB fields for dates, destinations, budget, interests, activities, and
  hard constraints.
- **Owner**: The Room_Member whose `role` is `"owner"` — the creator of the room.
- **Resume_Path**: The join-room branch where the `Normalized_Name` of the given
  `display_name` matches an existing Room_Member in the room; the existing member and associated records
  are returned unchanged.
- **New_Member_Path**: The join-room branch where no Room_Member with the same
  `Normalized_Name` is found in the room; a new Guest, Room_Member, Character, and Travel_Preferences are created.
- **Domain_Exception**: A typed Python exception raised by the Repository or Service Layer
  to represent a known business error (e.g. `RoomNotFoundError`).
- **Settings**: The `pydantic-settings` `Settings` class in `app/core/config.py` that
  reads environment variables and fails fast on missing required values.
- **Service_Role_Key**: The Supabase `service_role` secret that grants full database
  access. It is backend-only and must never reach the frontend or be logged.
- **RPC_Transaction**: A PostgreSQL function invoked via the Supabase RPC interface that
  executes multiple inserts inside a single database transaction, providing atomicity so
  that either all records are created or none are.
- **CORS**: Cross-Origin Resource Sharing. FastAPI middleware that controls which origins
  the browser allows to make requests to the backend API.
- **API_Error_Response**: The standardized JSON error envelope returned by all Backend_App
  error responses: `{"error": {"code": "<ERROR_CODE>", "message": "<human-readable message>"}}`.
- **Access_Boundary**: The architectural rule that all business-logic mutations to Supabase
  must pass through the FastAPI service layer; direct mutation of core business entities
  from the frontend is prohibited.

---

## Requirements

### Requirement 1: Supabase Client Dependency

**User Story:** As Dev B, I want a single async Supabase client wired into the application
so that all database access goes through one configured, service-role-authenticated
connection.

#### Acceptance Criteria

1. THE `Backend_App` SHALL include `supabase>=2.4` in `pyproject.toml` as a runtime
   dependency.
2. WHEN `Backend_App` starts, THE `Settings` class SHALL require `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` as non-empty string fields with no default values, failing
   fast with a `ConfigError` if either is absent.
3. THE `Supabase_Client` module at `app/db/supabase_client.py` SHALL expose a low-level
   factory function `create_supabase_client()` that, when called with valid
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` values, returns without raising and
   returns an async Supabase client (`AsyncClient`) instance. This module SHALL be
   responsible only for creating the client and SHALL NOT define FastAPI dependencies.
4. THE `Supabase_Client` SHALL be injectable via FastAPI's `DI_Container` through a
   `get_supabase_client()` dependency function defined in `app/api/deps.py`, which calls
   `create_supabase_client()`, so that the `Repository_Layer` receives the client through
   `Depends()` rather than importing it directly.
5. IF `SUPABASE_URL` is present but is not a valid URL (e.g. missing scheme, empty host),
   THEN THE `Backend_App` SHALL raise a `ConfigError` at startup before serving any
   requests, with an error message identifying `SUPABASE_URL` as the invalid field.
6. THE `Service_Role_Key` SHALL NOT appear in log output, HTTP response bodies, HTTP
   response headers, or error response payloads at any point during request processing.

---

### Requirement 2: Layered Architecture Enforcement

**User Story:** As Dev B, I want a strict three-layer architecture (routes → services →
repositories) so that the codebase stays maintainable and Supabase access is isolated to
one layer.

#### Acceptance Criteria

1. THE `Route_Layer` SHALL call only `Service_Layer` methods and SHALL NOT import or
   instantiate any `Repository_Layer` class directly.
2. THE `Service_Layer` SHALL call only `Repository_Layer` methods and SHALL NOT import or
   call the `Supabase_Client` directly.
3. THE `Repository_Layer` SHALL be the only layer that imports and calls `Supabase_Client`
   methods.
4. THE `DI_Container` SHALL inject the `Supabase_Client` into `Repository_Layer`
   constructors, `Repository_Layer` instances into `Service_Layer` constructors, and
   `Service_Layer` instances into `Route_Layer` route functions — each via `Depends()`.
5. THE `Backend_App` SHALL organize source files such that `Route_Layer` modules live in
   `app/api/routes/`, `Service_Layer` classes in `app/services/`, and `Repository_Layer`
   classes in `app/repositories/`.
6. IF a `Route_Layer` module imports a `Repository_Layer` class or the `Supabase_Client`
   directly, THEN THE `Backend_App` build or startup SHALL fail with an error indicating a
   layering violation.
7. IF a `Service_Layer` class imports the `Supabase_Client` directly, THEN THE
   `Backend_App` build or startup SHALL fail with an error indicating a layering violation.

---

### Requirement 3: Pydantic v2 Request and Response Schemas

**User Story:** As Dev B, I want Pydantic v2 schemas for all room-management inputs and
outputs so that the API validates data automatically and its shapes match `api-contracts.md`.

#### Acceptance Criteria

1. THE `Backend_App` SHALL define shared schemas `GuestSchema`, `PartyRoomSchema`,
   `RoomMemberSchema`, `CharacterSchema`, and `TravelPreferencesSchema` in
   `app/schemas/room.py` with fields matching the shapes in `api-contracts.md`.
2. THE `PartyRoomSchema` SHALL include fields: `id` (str/UUID), `room_code` (str), `name`
   (str, max 100 characters), `status` (Literal `"active"` | `"finalised"` |
   `"cancelled"`), `planning_stage` (Literal `"setup"` | `"discover"` | `"logistics"` |
   `"build"` | `"refine"` | `"wrap"`).
3. THE `RoomMemberSchema` SHALL include fields: `id` (str/UUID), `room_id` (str/UUID),
   `guest_id` (str/UUID), `display_name` (str, 1–50 characters), `role` (Literal
   `"owner"` or `"member"`).
4. THE `GuestSchema` SHALL include fields: `id` (str/UUID), `display_name` (str, 1–50
   characters), and optional `avatar_url` (str).
5. THE `CharacterSchema` SHALL include fields: `id` (str/UUID), `member_id` (str/UUID),
   `appearance` (dict whose keys and values may be any JSON-serializable types), and
   optional `sprite_key` (str).
6. THE `TravelPreferencesSchema` SHALL include fields: `id` (str/UUID), `member_id`
   (str/UUID), `available_dates` (list of ISO 8601 date strings), `destinations` (list),
   optional `travel_style` (str), optional `budget` (float, >= 0), `interests` (list),
   `activities` (list), `hard_constraints` (list).
7. THE `Backend_App` SHALL define `CreateRoomRequest` with fields `name` (str, 1–100
   characters, non-whitespace-only) and `owner_display_name` (str, 1–50 characters,
   non-whitespace-only).
8. THE `Backend_App` SHALL define `CreateRoomResponse` containing `room`
   (`PartyRoomSchema`), `member` (`RoomMemberSchema`), `guest` (`GuestSchema`),
   `character` (`CharacterSchema`), and `travel_preferences` (`TravelPreferencesSchema`).
9. THE `Backend_App` SHALL define `JoinRoomRequest` with field `display_name` (str, 1–50
   characters, non-whitespace-only).
10. THE `Backend_App` SHALL define `JoinRoomResponse` with the same top-level fields as
    `CreateRoomResponse`.
11. WHEN a request body fails Pydantic v2 validation, THE `Backend_App` SHALL return HTTP
    422 Unprocessable Entity with an `API_Error_Response` envelope containing
    `code='VALIDATION_ERROR'` and identifying the invalid fields.
12. IF a field value is out of its defined enum (for `status`, `planning_stage`, or
    `role`), THEN THE `Backend_App` SHALL return HTTP 422 with a structured error body
    identifying the offending field and its invalid value.
13. IF a string field contains only whitespace characters where a non-whitespace-only
    constraint applies, THEN THE `Backend_App` SHALL return HTTP 422 with a structured
    error body identifying the offending field.

---

### Requirement 4: Repository Layer — RoomRepository

**User Story:** As Dev B, I want a `RoomRepository` that owns all `party_rooms` operations
and the atomic room creation transaction so that room creation is safe and room lookup is
encapsulated behind a clean interface.

#### Acceptance Criteria

1. THE `RoomRepository` SHALL implement a `create_room_with_owner` method that accepts
   `name` (str, 1–100 characters), `room_code` matching `^[A-Z0-9]{4,12}$`, and
   `owner_display_name` (str, 1–50 characters), invokes the `create_room_with_owner`
   PostgreSQL RPC function via the `Supabase_Client`, and returns a single dict containing
   at minimum the fields for `room`, `member`, `guest`, `character`, and
   `travel_preferences` as returned by the RPC function.
2. WHEN `get_room_by_code` is called with a `room_code` string, THE `RoomRepository` SHALL
   query `party_rooms` by `room_code` and return the matching record as a dict containing
   at minimum `id`, `name`, `room_code`, `status`, `planning_stage`, and `created_at`, or
   `None` if no matching record exists.
3. WHEN `get_room_by_id` is called with a room UUID string, THE `RoomRepository` SHALL
   query `party_rooms` by `id` and return the matching record as a dict containing at
   minimum `id`, `name`, `room_code`, `status`, `planning_stage`, and `created_at`, or
   `None` if no matching record exists.
4. IF `create_room_with_owner` is called with a `name` that is empty, exceeds 100
   characters, or contains only whitespace, or a `room_code` that does not match
   `^[A-Z0-9]{4,12}$`, THEN THE `RoomRepository` SHALL raise a `ValidationError` without
   performing any database operation.
5. IF the `Supabase_Client` returns an error from the `create_room_with_owner` RPC call,
   THEN THE `RoomRepository` SHALL raise a `RepositoryError` whose message identifies the
   failed operation and SHALL NOT include Supabase-internal error fields.
6. IF the `Supabase_Client` returns an error for any `get_room_by_code` or `get_room_by_id`
   operation, THEN THE `RoomRepository` SHALL raise a `RepositoryError` whose message
   identifies the failed operation and SHALL NOT include Supabase-internal error fields.
7. THE `RoomRepository` SHALL receive the `Supabase_Client` via constructor injection and
   SHALL NOT instantiate it internally.

---

### Requirement 5: Repository Layer — MemberRepository

**User Story:** As Dev B, I want a `MemberRepository` that owns all `room_members`
operations so that case-insensitive display name identity lookup is encapsulated and
correct.

#### Acceptance Criteria

1. THE `MemberRepository` SHALL implement a `create_member` method that accepts `room_id`
   (UUID string), `guest_id` (UUID string), `display_name` (str, 1–50 characters), and
   `role` (one of `"owner"` or `"member"`), inserts a row into `room_members`, and returns
   the created record as a dict containing at minimum `id`, `room_id`, `guest_id`,
   `display_name`, `role`, and `created_at`.
2. THE `MemberRepository` SHALL implement a `get_member_by_display_name` method that
   accepts `room_id` (UUID string) and `display_name` (str, 1–50 characters), computes its
   `Normalized_Name`, queries `room_members` filtering by both `room_id` and
   `normalized_name`, and returns the matching record as a dict containing at minimum
   `id`, `room_id`, `guest_id`, `display_name`, `role`, and `created_at`, or `None` if no
   matching row exists.
3. THE `MemberRepository` SHALL implement a `get_member_by_id` method that accepts a
   member UUID string, queries `room_members` by `id`, and returns the matching record as a
   dict containing at minimum `id`, `room_id`, `guest_id`, `display_name`, `role`, and
   `created_at`, or `None` if no matching row exists.
4. THE `MemberRepository` SHALL implement a `list_members_by_room` method that accepts a
   `room_id` UUID string, queries `room_members` filtered by `room_id`, and returns a
   (possibly empty) list of matching records as dicts each containing at minimum `id`,
   `room_id`, `guest_id`, `display_name`, `role`, and `created_at`.
5. WHEN the `Supabase_Client` returns an error for any `MemberRepository` operation, THEN
   THE `MemberRepository` SHALL raise a domain exception that wraps the error cause without
   exposing Supabase-specific error types, codes, or message text to the caller.
6. THE `MemberRepository` SHALL receive the `Supabase_Client` via constructor injection and
   SHALL NOT instantiate it internally.
7. IF any argument passed to a `MemberRepository` method is not of the expected type or
   violates a defined constraint (e.g. `role` outside `"owner"` or `"member"`, `display_name`
   length outside 1–50 characters, or a malformed UUID), THEN THE `MemberRepository` SHALL
   raise a domain exception indicating invalid input before any database operation is
   attempted.

---

### Requirement 6: Repository Layer — ProfileRepository

**User Story:** As Dev B, I want a `ProfileRepository` that owns all guest, character, and
travel preference operations so that the profile domain is encapsulated behind a single
repository class.

#### Acceptance Criteria

1. THE `ProfileRepository` SHALL implement a `create_guest` method that accepts
   `display_name` (str, 1–50 characters) and optional `avatar_url` (str), inserts exactly
   one row into the `guests` table via the `Supabase_Client`, and returns the created
   record as a dict containing at minimum the fields `id`, `display_name`, and `created_at`.
2. THE `ProfileRepository` SHALL implement a `get_guest_by_id` method that accepts a guest
   UUID string, queries the `guests` table by `id`, and returns the matching record as a
   dict containing at minimum `id`, `display_name`, and `created_at`, or `None` if not
   found.
3. THE `ProfileRepository` SHALL implement a `create_character` method that accepts
   `member_id` (UUID string) and an optional `appearance` dict (defaulting to `{}`),
   inserts exactly one row into `characters`, and returns the created record as a dict
   containing at minimum `id`, `member_id`, `appearance`, and `created_at`.
4. THE `ProfileRepository` SHALL implement a `get_character_by_member_id` method that
   accepts a `member_id` UUID string, queries `characters` by `member_id`, and returns the
   matching record as a dict containing at minimum `id`, `member_id`, `appearance`, and
   `created_at`, or `None` if not found.
5. THE `ProfileRepository` SHALL implement a `create_preferences` method that accepts
   `member_id` (UUID string) and optional JSONB fields `available_dates`, `destinations`,
   `interests`, `activities`, `hard_constraints` each defaulting to `[]`, inserts exactly
   one row into `travel_preferences`, and returns the created record as a dict containing
   at minimum `id`, `member_id`, `available_dates`, `destinations`, `interests`,
   `activities`, `hard_constraints`, and `created_at`.
6. THE `ProfileRepository` SHALL implement a `get_preferences_by_member_id` method that
   accepts a `member_id` UUID string, queries `travel_preferences` by `member_id`, and
   returns the matching record as a dict containing at minimum `id`, `member_id`, and all
   JSONB preference fields, or `None` if not found.
7. WHEN the `Supabase_Client` returns an error for any `ProfileRepository` operation, THEN
   THE `ProfileRepository` SHALL raise a `RepositoryError` whose message includes the
   failed operation name and the affected table name, without including Supabase-internal
   error codes or fields.
8. THE `ProfileRepository` SHALL receive the `Supabase_Client` via constructor injection
   and SHALL NOT instantiate it internally.
9. IF `display_name` passed to `create_guest` is empty, exceeds 50 characters, or contains
   only whitespace, THEN THE `ProfileRepository` SHALL raise a `ValidationError` before
   performing any database operation.
10. IF a malformed (non-UUID-format) string is passed as `guest_id` to `get_guest_by_id`,
    or as `member_id` to any character or preferences method, THEN THE `ProfileRepository`
    SHALL raise a `ValidationError` before performing any database operation.

---

### Requirement 7: Case-Insensitive Identity in the Schema

**User Story:** As Dev B, I want the database to enforce case-insensitive member identity so
that two members of the same room can never have names that differ only in case or
whitespace.

#### Acceptance Criteria

1. THE `room_members` table SHALL have a `normalized_name` column generated by the database
   from `display_name` using the `Normalized_Name` rule, defined in
   `supabase/migrations/20260925000000_initial_schema.sql`.
2. THE database SHALL enforce `UNIQUE(room_id, normalized_name)` on `room_members`, so that
   no two rows in the same room share a `Normalized_Name`.
3. THE `Normalized_Name` computed in Python by `normalize_display_name()` SHALL produce the
   same value as the database's generated `normalized_name` column for any valid display
   name.
4. THE initial schema migration SHALL be applied before any backend core endpoint is used
   in testing or integration, so that the `UNIQUE(room_id, normalized_name)` constraint is
   active.

---

### Requirement 8: Supabase RPC Transaction for Room Creation

**User Story:** As Dev B, I want room creation to be atomic via a PostgreSQL RPC function
so that a failed step during party room setup never leaves partial records in the database.

#### Acceptance Criteria

1. THE `Backend_App` SHALL include a Supabase migration that defines a PostgreSQL function
   named `create_room_with_owner` accepting `p_room_name`, `p_room_code`,
   `p_owner_display_name`, and `p_appearance` parameters and executing inserts into
   `party_rooms`, `guests`, `room_members`, `characters`, and `travel_preferences` within
   a single database transaction.
2. WHEN the `create_room_with_owner` RPC function completes successfully, THE function
   SHALL return a single JSON object containing the fully populated records for `room`,
   `member`, `guest`, `character`, and `travel_preferences`.
3. IF any insert inside the `create_room_with_owner` RPC function fails, THEN THE entire
   transaction SHALL roll back and no partial records SHALL remain in any of the five
   affected tables.
4. THE `RoomRepository.create_room_with_owner` method SHALL invoke the
   `create_room_with_owner` RPC function and SHALL NOT perform individual table inserts
   for room creation.
5. IF the RPC function returns an error response, THEN THE `RoomRepository` SHALL raise a
   `RepositoryError` without including Supabase-internal error codes or fields in the
   exception message.

---

### Requirement 9: Room Code Generation

**User Story:** As Dev B, I want the Service_Layer to generate unique room codes so that
every new Party_Room is addressable by a short, shareable identifier that does not collide
with existing codes.

#### Acceptance Criteria

1. THE `Service_Layer` SHALL generate a `Room_Code` consisting of uppercase alphanumeric
   characters with a length between 4 and 12 characters inclusive when creating a room.
2. WHEN a generated `Room_Code` already exists in `party_rooms`, THE `Service_Layer` SHALL
   generate a different code and retry, up to a maximum of 10 attempts, before invoking
   the `create_room_with_owner` RPC call.
3. THE `Room_Code` generation logic SHALL reside in the `Service_Layer` or a dedicated
   utility function and SHALL NOT be duplicated in the `Route_Layer` or
   `Repository_Layer`.
4. THE generated `Room_Code` SHALL match the pattern `^[A-Z0-9]{4,12}$` enforced by the
   database `CHECK` constraint.
5. IF all 10 retry attempts are exhausted without finding an unused `Room_Code`, THEN THE
   `Service_Layer` SHALL raise a domain exception, the request SHALL be rejected with an
   error, and no partial room record SHALL be persisted.

---

### Requirement 10: Create Room Service Operation

**User Story:** As a party leader, I want to create a new trip room so that my group has a
shared space to plan together, identified by a unique room code.

#### Acceptance Criteria

1. WHEN `RoomService.create_room` is called with a valid `CreateRoomRequest`, THE
   `Service_Layer` SHALL invoke `RoomRepository.create_room_with_owner` via the
   `RPC_Transaction` and return a `CreateRoomResponse` built from the RPC result.
2. WHEN `RoomService.create_room` invokes the RPC transaction, THE `Service_Layer` SHALL
   pass `status` as `"active"` and `planning_stage` as `"setup"` for the `party_rooms`
   record.
3. WHEN `RoomService.create_room` invokes the RPC transaction, THE `Service_Layer` SHALL
   map `CreateRoomRequest.name` to `p_room_name` and
   `CreateRoomRequest.owner_display_name` to `p_owner_display_name`.
4. WHEN the RPC transaction creates a `room_members` record, THE resulting record SHALL
   have `role` set to `"owner"`.
5. WHEN the RPC transaction creates a `characters` record, THE resulting record SHALL have
   `appearance` set to an empty dict `{}`.
6. WHEN the RPC transaction creates a `travel_preferences` record, THE resulting record
   SHALL have `available_dates`, `destinations`, `interests`, `activities`, and
   `hard_constraints` each set to an empty list `[]`.
7. THE `CreateRoomResponse` SHALL include the fully populated `room`, `member`, `guest`,
   `character`, and `travel_preferences` objects as returned by the RPC function.
8. THE `Service_Layer` SHALL use the `Room_Code` generation algorithm from Requirement 9
   to assign the `p_room_code` passed to the RPC function.
9. IF the `RoomRepository` raises a `RepositoryError` during `create_room`, THEN THE
   `Service_Layer` SHALL propagate a domain exception and SHALL NOT return any
   `CreateRoomResponse`; the RPC transaction guarantees no partial records remain.

---

### Requirement 11: Join Room — Resume Existing Member

**User Story:** As a returning party member, I want to rejoin a room using my display name
(in any casing) so that my existing character and preferences are restored without creating duplicate
records.

**Note:** Identity matching is case-insensitive. `"Gerald"`, `"gerald"`, and `"GERald"` are
the same member. Anyone who knows the room code and a member's display name can resume that
member's identity — this is an intentional MVP convenience model, not
authentication.

#### Acceptance Criteria

1. WHEN `RoomService.join_room` is called with a `room_code` and a `display_name` whose
   `Normalized_Name` matches an existing `room_members.normalized_name` for that room,
   THE `Service_Layer` SHALL follow the `Resume_Path` and return the existing `guest`,
   `member`, `character`, and `travel_preferences` records without creating new ones.
2. THE `Service_Layer` SHALL pass the `display_name` as received to
   `MemberRepository.get_member_by_display_name`; normalization is applied inside the
   `MemberRepository` only.
3. THE `JoinRoomResponse` returned on the `Resume_Path` SHALL reflect the persisted state
   of the existing records, not the input values.
4. WHEN `display_name` values differ only in letter case or surrounding whitespace (e.g.
   `"Gerald"`, `"gerald"`, `" GERald "`), THE `Service_Layer` SHALL treat them as the same
   member and follow the `Resume_Path`, returning the member's originally stored
   `display_name`.
5. WHEN `RoomService.join_room` is called with a `room_code` that does not match any
   record in `party_rooms`, THE `Service_Layer` SHALL raise a `RoomNotFoundError` domain
   exception regardless of the `display_name` value.
6. IF an existing `room_members` row is found on the `Resume_Path` but its associated
   `character` or `travel_preferences` record is absent, THE `Service_Layer` SHALL return
   the available records without creating the missing ones.

---

### Requirement 12: Join Room — Create New Member

**User Story:** As a new party member, I want to join an existing room by entering the
room code and my display name so that I am added to the party and can start planning.

#### Acceptance Criteria

1. WHEN `RoomService.join_room` is called with a valid `room_code` and a `display_name`
   of 1–50 characters whose `Normalized_Name` does not match any existing
   `room_members.normalized_name` for that room, THE `Service_Layer` SHALL follow the `New_Member_Path` and create
   records in `guests`, `room_members`, `characters`, and `travel_preferences`.
2. THE created `room_members` record on the `New_Member_Path` SHALL have `role` set to
   `"member"`.
3. THE `JoinRoomResponse` SHALL include the fully populated `room`, `member`, `guest`,
   `character`, and `travel_preferences` objects for the newly created member, where each
   object contains all fields defined for that type in the API contract.
4. IF `display_name` is empty, exceeds 50 characters, or contains only whitespace, THEN
   THE `Service_Layer` SHALL raise an `InvalidDisplayNameError` domain exception and SHALL
   NOT create any records.
5. IF any repository operation fails during the `New_Member_Path`, THEN THE
   `Service_Layer` SHALL propagate a domain exception and SHALL NOT return a partial
   `JoinRoomResponse`.

---

### Requirement 13: Join Room — Room Not Found

**User Story:** As a party member, I want to receive a clear error when I enter an invalid
room code so that I know the room does not exist and can correct my input.

#### Acceptance Criteria

1. WHEN `RoomService.join_room` is called with a `room_code` that does not match any
   record in `party_rooms`, THE `Service_Layer` SHALL raise a `RoomNotFoundError` domain
   exception.
2. WHEN the `Route_Layer` catches a `RoomNotFoundError`, THE `Backend_App` SHALL return
   HTTP 404 Not Found with a JSON body conforming to the `API_Error_Response` envelope: `{"error": {"code": "ROOM_NOT_FOUND", "message": "<message>"}}` where `<message>` is a human-readable string between 1 and 256 characters.
3. THE HTTP 404 response body SHALL NOT include Supabase query details, stack traces, or
   internal identifiers.
4. IF `RoomService.join_room` raises an exception that is not a recognized
   `Domain_Exception`, THEN THE `Backend_App` SHALL return HTTP 500 Internal Server Error
   with a JSON body conforming to the `API_Error_Response` envelope with `code` set to `"INTERNAL_ERROR"`, and SHALL NOT propagate the raw exception
   to the caller.
5. WHEN `POST /rooms/{room_code}/join` is called with a `room_code` path parameter that is
   an empty string or exceeds 20 characters, THE `Backend_App` SHALL return HTTP 422
   Unprocessable Entity without invoking `RoomService.join_room`.

---

### Requirement 14: POST /rooms Endpoint

**User Story:** As a frontend developer, I want a `POST /rooms` endpoint so that the
frontend service layer can create a new party room and receive all required identifiers in
one response.

#### Acceptance Criteria

1. THE `Route_Layer` SHALL expose `POST /rooms` that accepts a JSON body conforming to
   `CreateRoomRequest` and returns a JSON body conforming to `CreateRoomResponse` with HTTP
   200.
2. WHEN `POST /rooms` is called with a valid `CreateRoomRequest`, THE `Route_Layer` SHALL
   delegate to `RoomService.create_room` via `DI_Container` injection and return the
   result serialized as JSON containing the `room`, `member`, `guest`, `character`, and
   `travel_preferences` fields.
3. WHEN `POST /rooms` receives a body that fails `CreateRoomRequest` validation, THE
   `Backend_App` SHALL return HTTP 422 Unprocessable Entity with a JSON body conforming to the `API_Error_Response` envelope with `code` set to `"VALIDATION_ERROR"` identifying the invalid fields.
4. THE `Backend_App` SHALL include the `rooms` router in `app/main.py` so that `POST
   /rooms` is reachable from the application root.
5. IF `RoomService.create_room` raises an unhandled exception, THE `Backend_App` SHALL
   return HTTP 500 Internal Server Error with a JSON body conforming to the `API_Error_Response` envelope with `code` set to `"INTERNAL_ERROR"`,
   without propagating the raw exception.

---

### Requirement 15: POST /rooms/{room_code}/join Endpoint

**User Story:** As a frontend developer, I want a `POST /rooms/{room_code}/join` endpoint
so that the frontend service layer can join or resume a party room in one call.

#### Acceptance Criteria

1. THE `Route_Layer` SHALL expose `POST /rooms/{room_code}/join` that accepts a path
   parameter `room_code` and a JSON body conforming to `JoinRoomRequest`, and returns a
   JSON body conforming to `JoinRoomResponse` with HTTP 200.
2. WHEN `POST /rooms/{room_code}/join` is called with valid inputs and the room exists, THE
   `Route_Layer` SHALL delegate to `RoomService.join_room` via `DI_Container` injection
   and return the result serialized as JSON.
3. WHEN `POST /rooms/{room_code}/join` is called with a `room_code` that does not exist,
   THE `Backend_App` SHALL return HTTP 404 Not Found with a JSON body conforming to the `API_Error_Response` envelope as specified in Requirement 13.
4. WHEN `POST /rooms/{room_code}/join` receives a body that fails `JoinRoomRequest`
   validation, THE `Backend_App` SHALL return HTTP 422 Unprocessable Entity.
5. WHEN two concurrent requests attempt to create a new member with the same `display_name`
   in the same room, THE `Backend_App` SHALL return HTTP 409 Conflict for the losing
   request with a JSON body conforming to the `API_Error_Response` envelope with `code` set to `"MEMBER_ALREADY_EXISTS"` and a `message` that does not include database
   constraint names or internal identifiers.
6. IF the `room_code` path parameter does not match the pattern `^[A-Z0-9]{4,12}$`, THEN
   THE `Backend_App` SHALL return HTTP 422 Unprocessable Entity without invoking
   `RoomService.join_room`.

---

### Requirement 16: CORS Middleware

**User Story:** As a frontend developer, I want the backend to accept cross-origin requests
from the frontend so that the browser does not block API calls during development and
production.

#### Acceptance Criteria

1. THE `Backend_App` SHALL configure FastAPI CORS middleware on startup.
2. THE `Settings` class SHALL include a `FRONTEND_URL` field that reads from the
   `FRONTEND_URL` environment variable and defaults to `http://localhost:3000` when the
   variable is absent.
3. WHEN `Backend_App` starts, THE CORS middleware SHALL set the allowed origin to the
   value of `Settings.FRONTEND_URL`.
4. THE `Backend_App` SHALL add `FRONTEND_URL=http://localhost:3000` to the
   `backend/.env.example` file so that developers know the variable exists and its
   expected format.
5. WHILE processing a preflight `OPTIONS` request from the configured allowed origin, THE
   `Backend_App` SHALL return a response permitting the request rather than blocking it.

---

### Requirement 17: OpenAPI Documentation

**User Story:** As a frontend developer, I want machine-readable OpenAPI documentation for
every endpoint so that I can understand the expected request and response shapes without
reading implementation code.

#### Acceptance Criteria

1. THE `Route_Layer` SHALL include a docstring on every route function describing the
   endpoint purpose in plain language.
2. THE `Route_Layer` SHALL set `summary` and `description` parameters on every route
   decorator for `POST /rooms` and `POST /rooms/{room_code}/join`.
3. THE `Backend_App` SHALL add `Field(examples=[...])` annotations or `model_config`
   example values to `CreateRoomRequest`, `JoinRoomRequest`, `CreateRoomResponse`, and
   `JoinRoomResponse` so that the OpenAPI schema includes at least one example value per
   field.
4. THE `Route_Layer` SHALL include a `responses=` parameter on each route decorator that
   documents at minimum the HTTP 200 success case and the applicable error cases (HTTP 404
   and HTTP 409 for the join endpoint; HTTP 422 for both endpoints).
5. WHEN the OpenAPI JSON is fetched from `GET /openapi.json`, THE `Backend_App` SHALL
   return a document that includes the `summary`, `description`, and example values
   defined in the route and schema decorators.

---

### Requirement 18: Error Handling and Response Safety

**User Story:** As a frontend developer, I want consistent, safe error responses so that
the UI can handle failures gracefully without leaking backend internals.

#### Acceptance Criteria

1. WHEN the `Supabase_Client` returns an unexpected error, THE `Backend_App` SHALL return HTTP 503 Service Unavailable with a JSON body conforming to the `API_Error_Response` envelope with `code` set to `"DATABASE_ERROR"` and a `message` that contains no Supabase error messages, query details, or stack traces.
2. WHEN the `Route_Layer` receives a `RoomNotFoundError`, THE `Backend_App` SHALL return HTTP 404 Not Found with a JSON body conforming to the `API_Error_Response` envelope with `code` set to `"ROOM_NOT_FOUND"`.
3. WHEN the `Repository_Layer` detects a database uniqueness constraint violation and raises a domain exception wrapping it, THE `Backend_App` SHALL return HTTP 409 Conflict with a JSON body conforming to the `API_Error_Response` envelope with `code` set to `"MEMBER_ALREADY_EXISTS"` and a `message` that does not include database constraint names or internal identifiers.
4. THE `Backend_App` SHALL handle all domain exceptions through registered exception handlers using the following mappings: `RoomNotFoundError` → HTTP 404 / `"ROOM_NOT_FOUND"`, `MemberAlreadyExistsError` → HTTP 409 / `"MEMBER_ALREADY_EXISTS"`, `InvalidDisplayNameError` → HTTP 422 / `"INVALID_DISPLAY_NAME"`, `ValidationError` → HTTP 422 / `"VALIDATION_ERROR"`, `RepositoryError` → HTTP 503 / `"DATABASE_ERROR"`, `RoomCodeExhaustedError` → HTTP 500 / `"ROOM_CODE_EXHAUSTED"`, unrecognized exceptions → HTTP 500 / `"INTERNAL_ERROR"`; no unhandled exception SHALL propagate without producing an `API_Error_Response` body.
5. WHILE a request is being processed, THE `Backend_App` SHALL NOT include `Service_Role_Key` values, raw Supabase error payloads, or Python stack traces in the `message` field of any `API_Error_Response`.

---

### Requirement 19: Unit Tests for RoomService

**User Story:** As Dev B, I want unit tests for `RoomService` with mocked repositories so
that the service logic (identity resolution, record creation, error propagation) is
verified independently of Supabase.

#### Acceptance Criteria

1. THE test suite SHALL include unit tests in `tests/test_room_service.py` for
   `RoomService.create_room` that mock all repository dependencies and assert that a
   `CreateRoomResponse` containing the five fields `room`, `member`, `guest`, `character`,
   and `travel_preferences` is returned when inputs are valid.
2. THE test suite SHALL include a unit test that verifies the `RoomRepository.create_room_with_owner`
   mock is called exactly once and that no individual table-insert repository methods are
   called during `RoomService.create_room`.
3. THE test suite SHALL include a unit test for `RoomService.join_room` that mocks
   `MemberRepository.get_member_by_display_name` to return an existing member and asserts
   the `Resume_Path` is taken — specifically that `create_guest`, `create_member`,
   `create_character`, and `create_preferences` are each called zero times.
4. THE test suite SHALL include a unit test for `RoomService.join_room` that mocks
   `MemberRepository.get_member_by_display_name` to return `None` and asserts the
   `New_Member_Path` is taken — specifically that `create_guest`, `create_member`,
   `create_character`, and `create_preferences` are each called exactly once.
5. THE test suite SHALL include a unit test for `RoomService.join_room` that mocks
   `RoomRepository.get_room_by_code` to return `None`, asserts that a `RoomNotFoundError`
   is raised, and asserts that none of `create_guest`, `create_member`,
   `create_character`, or `create_preferences` are called.
6. THE test suite SHALL use `pytest` and `pytest-mock>=3.12` (listed in
   `pyproject.toml` dev dependencies) and SHALL be runnable via the existing `pytest`
   invocation defined in `pyproject.toml`.

---

### Requirement 20: Integration Tests for Room Endpoints

**User Story:** As Dev B, I want integration tests for the two room endpoints using
FastAPI's test client so that the full request-to-response path is verified against the
real route and service wiring.

#### Acceptance Criteria

1. THE test suite SHALL include an integration test for `POST /rooms` that uses the
   `httpx` TestClient with repository-layer mocking and asserts an HTTP 200 response whose
   body contains the fields `room`, `member`, `guest`, `character`, and
   `travel_preferences` each with their required subfields as defined in Requirement 3.
2. THE test suite SHALL include an integration test for `POST /rooms/{room_code}/join`
   where the `display_name` is not present in the room (New_Member_Path), asserting an
   HTTP 200 response whose body contains `member.id`, `member.roomId`, `member.guestId`,
   `member.displayName`, and `member.role` set to `"member"`.
3. THE test suite SHALL include an integration test for `POST /rooms/{room_code}/join`
   where the same display name is submitted twice with different casing (e.g. `"Gerald"`
   then `"gerald"`) (Resume_Path), asserting that both responses return HTTP 200 and that the `member.id`
   in the second response matches the `member.id` in the first response.
4. THE test suite SHALL include an integration test for `POST /rooms/{room_code}/join`
   with a `room_code` that does not exist, asserting an HTTP 404 response whose body
   conforms to the `API_Error_Response` envelope with `error.code` set to
   `"ROOM_NOT_FOUND"`, e.g. `{"error": {"code": "ROOM_NOT_FOUND", "message": "..."}}`.
5. THE test suite SHALL use `pytest` and the `httpx` TestClient already listed in
   `pyproject.toml` dev dependencies.
6. WHERE time permits, THE test suite MAY include property-based tests using `hypothesis`
   to verify that the join endpoint handles arbitrary `display_name` values within the
   1–50 character constraint without raising unhandled exceptions; these tests are optional
   for MVP and SHALL NOT block integration work if not completed.

---

### Requirement 21: Dependency Updates

**User Story:** As Dev B, I want `pyproject.toml` updated with all new dependencies so
that any team member can recreate the environment with a single install command.

#### Acceptance Criteria

1. THE `Backend_App` SHALL add `supabase>=2.4` to the `[project] dependencies` list in
   `pyproject.toml`.
2. THE `Backend_App` SHALL add `pytest-mock>=3.12` to the `[project.optional-dependencies]
   dev` list in `pyproject.toml`.
3. THE `Backend_App` SHALL NOT introduce any dependency that conflicts with
   `fastapi>=0.110`, `uvicorn[standard]>=0.29`, `pydantic>=2.6`, or
   `pydantic-settings>=2.2`; if a conflict is detected at install time, THE `Backend_App`
   SHALL surface an error indicating which dependency versions are incompatible rather than
   silently resolving to a mismatched version.
4. WHERE a new utility or helper library is introduced, THE `Backend_App` SHALL add it to
   `pyproject.toml` with a pinned minimum version (using the `>=X.Y` specifier) rather
   than leaving it unlisted or using an unpinned specifier.

---

### Requirement 22: Standardized API Error Response Format

**User Story:** As a frontend developer, I want all API errors to follow a consistent JSON
structure so that I can write a single error-handling function that works for every
endpoint.

#### Acceptance Criteria

1. WHEN the `Backend_App` returns any error response (4xx or 5xx), THE response body SHALL
   conform to the `API_Error_Response` envelope:
   `{"error": {"code": "<ERROR_CODE>", "message": "<human-readable message>"}}` where
   `code` is a machine-readable uppercase string and `message` is a human-readable string
   safe for display.
2. THE `Backend_App` SHALL define the `API_Error_Response` shape as a Pydantic model (e.g.
   `ErrorDetail` and `ErrorResponse`) so that it is included in the OpenAPI schema.
3. THE `Backend_App` SHALL map each `Domain_Exception` type to a specific error code
   string: `RoomNotFoundError` → `"ROOM_NOT_FOUND"`, `MemberAlreadyExistsError` →
   `"MEMBER_ALREADY_EXISTS"`, `InvalidDisplayNameError` → `"INVALID_DISPLAY_NAME"`,
   `RepositoryError` → `"DATABASE_ERROR"`, `RoomCodeExhaustedError` →
   `"ROOM_CODE_EXHAUSTED"`, `ValidationError` → `"VALIDATION_ERROR"`, unrecognized
   exceptions → `"INTERNAL_ERROR"`.
4. THE centralized exception handlers registered in `app/main.py` SHALL be the only place
   that converts exceptions to HTTP responses; `Route_Layer` functions SHALL NOT manually
   construct error response dicts.
5. WHEN a Pydantic v2 request validation error occurs (HTTP 422), THE `Backend_App` SHALL
   return a response conforming to the `API_Error_Response` shape with `code` set to
   `"VALIDATION_ERROR"` and `message` describing the offending fields, rather than
   FastAPI's default `{"detail": [...]}` shape.
6. THE `Service_Role_Key` value, raw Supabase error payloads, and Python stack traces SHALL
   NOT appear in the `message` field of any `API_Error_Response`.

---

### Requirement 23: Supabase Access Boundary

**User Story:** As a team member, I want the boundary between frontend Supabase access and
backend-mediated access clearly defined and enforced so that business logic is never
bypassed.

#### Acceptance Criteria

1. THE `Backend_App` SHALL be the authoritative path for all business-logic mutations. The
   following operations MUST go through the FastAPI service layer and SHALL NOT be
   performed by direct frontend Supabase writes: create room, join room, update
   preferences, submit votes, generate itinerary, refine itinerary, and update planning
   state.
2. THE frontend MAY use direct Supabase access only for explicitly approved read-only or
   realtime operations: Supabase Realtime subscriptions (e.g. `room_members`, `messages`,
   `vote_sessions`, `votes`, `selections`, `itinerary_versions`, `feedback`,
   `party_rooms.planning_stage`, `trips.status`) and non-sensitive read queries where the
   data is already publicly readable in the room context.
3. WHERE direct frontend Supabase access is used (per AC 2), THE access pattern SHALL be
   documented in a comment in the relevant `src/services` frontend service file stating
   which table is accessed, why direct access is appropriate, and what the expected data
   shape is.
4. THE `Backend_App` repository layer SHALL own all mutations to the following core
   business tables: `party_rooms`, `guests`, `room_members`, `characters`,
   `travel_preferences`. No other layer or client SHALL write to these tables directly.
5. THE Supabase service-role key SHALL reside only in the `Backend_App` environment and
   SHALL NOT be accessible to the frontend client. The frontend SHALL use only the Supabase
   anon key for its direct read/realtime access.
6. IF a new business mutation is introduced in a future spec, THE default pattern SHALL be
   to implement it through the FastAPI service layer; direct Supabase frontend writes
   require explicit justification and documentation.
