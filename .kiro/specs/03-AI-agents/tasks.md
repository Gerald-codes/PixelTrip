# Implementation Plan: LangGraph AI Agent Layer (03-AI-agents)

## Overview

This plan implements the `Agent_Layer` designed in `design.md`: eight new repositories,
the `AgentState` model and module layout under `backend/app/agents/`, two new Postgres RPC
functions, the three-layer guardrail pipeline, capped/cached external tool clients, the
`Agent_Graph` with its orchestrator and four specialist nodes, vote resolution and trip
status/stage derivation, NPC message emission, the new domain-exception hierarchy, and the
test suite (unit, property-based, and no-network enforcement) described in the design's
Testing Strategy.

Key sequencing decisions this plan is derived from:

- **New repositories and DI wiring come first**, because spec 02's repositories are
  themselves unimplemented in the current codebase (only the health route exists) and every
  node depends on the eight new repositories this spec introduces.
- **The two new RPC functions (`insert_message_turn`, `set_trip_status_and_stage`) are
  their own migration task**, sequenced before the `MessageRepository`/`TripRepository`
  methods that call them.
- **`AgentState` and the `backend/app/agents/` module skeleton land before any node**, since
  every node signature depends on it.
- **The guardrail pipeline and the four `Proposal` Pydantic models are shared dependencies**,
  sequenced once, before any specialist node, rather than duplicated per node.
- **External tool clients (flights/places/weather) are a shared dependency** sequenced before
  `Logistics_Node` and `Itinerary_Node` specifically, since `Discovery_Node` only uses the LLM
  and `Negotiation_Node` reuses `Itinerary_Node`'s persistence path rather than calling tools
  directly.
- **Nodes are ordered Discovery → Logistics → Itinerary → Negotiation**, matching stage order
  and Negotiation's dependency on Itinerary's persistence helper.
- **`AgentRunService` and `Agent_Graph` compilation are paired**, landing after repositories
  and `AgentState` but before the nodes are wired end-to-end; node unit tests with mocked
  repositories happen inside each node's own task, per the design's testing strategy.
- **Vote resolution, `Tiebreak_Flow`, and trip status/stage derivation are service-layer work**
  independent of the graph, sequenced so they land before `Logistics_Node` (needs the
  destination selection) and `Itinerary_Node` (needs both selections).
- **Property-based tests for the 18 correctness properties get one dedicated task** near the
  end, matching spec 02's Task 13 pattern; component-level unit tests stay inside each
  component's own task.

The implementation language is **Python** (the design uses concrete Python/Pydantic/LangGraph
code throughout, with no pseudocode requiring a language choice), so no language-selection
question is required.

## Tasks

- [x] 1. Dependencies, configuration, and new exception hierarchy
  - [x] 1.1 Update `backend/pyproject.toml` dependencies
    - Add `langgraph>=0.2`, `langchain-core>=0.3` to `[project] dependencies`; promote
      `httpx>=0.27` from dev-only to runtime.
    - Add `pytest-asyncio>=0.23` to `[project.optional-dependencies] dev` (alongside spec
      02's `pytest-mock`, `hypothesis`).
    - _Requirements: (supports all; no direct AC)_

  - [x] 1.2 Extend `app/core/config.py` Settings
    - Add `external_tool_timeout_seconds: int` (default 10, range 1-60),
      `iteration_cap: int` (default 3, range 1-10), `tool_call_cap: int` (default 10, range
      1-50), each read through `Settings` rather than embedded literals.
    - Add `External_Tool` credential/endpoint fields (flight search, places, weather) with
      `repr=False`-equivalent configuration so they never appear in `str(settings)` or logs.
    - _Requirements: 12.10, 19.4, 19.5_

  - [x] 1.3 Create `app/agents/errors.py` with the new domain-exception hierarchy
    - Define all 22 new exception classes from the design's Error Handling section, each
      subclassing spec 02's `BackendError` and grouped into the four mapped families (422:
      `StagePreconditionNotMetError`, `InvalidRunTypeError`, `PreferencesNotCollectedError`,
      `InvalidTripDurationError`, `RunIdentityMutationError`, `IterationCapExceededError`,
      `MessageContentTooLargeError`, `InvalidIdempotencyKeyError`; 404:
      `TripNotFoundError`, `DestinationNotSelectedError`, `FlightNotSelectedError`,
      `NoItineraryToRefineError`, `NoApprovedItineraryError`, `RoomResolutionError`; 503:
      `ExternalToolUnavailableError`, `ItineraryPersistenceError`; 409:
      `RunStatusTransitionError`, `IdempotencyKeyConflictError`, `StateBoundExceededError`,
      `ToolCallCapExceededError`, `RepeatedVersionContentionError`, `DuplicateApprovalError`).
    - No exception message includes LLM prompt text, raw tool/Supabase payloads, SQL text,
      secret values, or stack traces.
    - _Requirements: 3.6, 20.7, 20.9_

  - [x] 1.4 Register the new exception handlers in `app/main.py`
    - Add each of the 22 exception classes to the centralized handler registration using
      spec 02's `_err(code, message)` helper and the error-code mapping table in the design,
      producing the identical `{"error": {"code": ..., "message": ...}}` envelope — no second
      envelope shape.
    - _Requirements: 3.6, 14.10, 20.3, 20.4, 20.7, 20.8_

- [x] 2. Database migration for agent support functions
  - [x] 2.1 Create `supabase/migrations/20260925000003_agent_support_functions.sql`
    - Define `insert_message_turn(p_room_id, p_messages jsonb) RETURNS SETOF messages`
      inserting each element of `p_messages` in one transaction with strictly increasing
      `created_at` (1ms apart), rolling back entirely on any row's constraint or size
      violation.
    - Define `set_trip_status_and_stage(p_trip_id, p_status, p_planning_stage) RETURNS
      trips` updating `trips.status` and `party_rooms.planning_stage` in one transaction.
    - Additive only (new functions, no `ALTER TABLE`, no new column/enum/index).
    - _Requirements: 15.11, 18.10_

- [x] 3. New repositories (`TripRepository`, `MessageRepository`, `VoteSessionRepository`, `VoteRepository`)
  - [x] 3.1 Create `app/repositories/trip_repository.py`
    - Implement `TripRepository(BaseRepository)` with `get_by_id`, `get_by_room_id`,
      `get_room_id_for_trip` (resolves `room_id` from `trip_id` for message emission), and
      `update_status(trip_id, status, planning_stage)` calling the
      `set_trip_status_and_stage` RPC so no read observes one column updated without the
      other.
    - _Requirements: 15.1, 15.9, 18.10_

  - [x]* 3.2 Write unit tests for `TripRepository`
    - Mock the Supabase client; assert `update_status` calls the RPC exactly once with both
      values and that `get_room_id_for_trip` returns `None` (not an exception) when no trip
      row exists.
    - _Requirements: 15.1, 15.9, 18.10_

  - [x] 3.3 Create `app/repositories/message_repository.py`
    - Implement `MessageRepository(BaseRepository)` with `insert_turn(room_id, messages)`
      calling `insert_message_turn`, wrapping any failure into a single-transaction
      all-or-nothing outcome (no partial turn visible), and `get_latest_progress_message
      (run_id)`.
    - _Requirements: 15.11, 16.9_

  - [x]* 3.4 Write unit tests for `MessageRepository`
    - Assert a simulated mid-turn RPC failure results in zero visible rows on a subsequent
      mocked read, and that `insert_turn` rejects a call with more than 5 messages.
    - _Requirements: 15.10, 15.11_

  - [x] 3.5 Create `app/repositories/vote_session_repository.py` and `vote_repository.py`
    - Implement `VoteSessionRepository` with `create`, `get_open_by_room_and_category`
      (resolved via the linked message's `content.category`), `close`, `get_by_id`.
    - Implement `VoteRepository` with `upsert` (relying on
      `UNIQUE(vote_session_id, member_id)`), `count_by_option`, `count_distinct_voters`.
    - _Requirements: 7.7, 7.8, 8.5, 8.9, 17.1, 17.3, 17.6, 17.11, 17.12, 17.13_

  - [x]* 3.6 Write unit tests for `VoteSessionRepository`/`VoteRepository`
    - Assert `get_open_by_room_and_category` returns `None` when no open session of that
      category exists, `upsert` replaces rather than duplicates a member's prior vote, and
      `count_distinct_voters` matches the number of unique `member_id` rows.
    - _Requirements: 7.8, 8.9, 17.6, 17.11_

- [x] 4. New repositories (`SelectionRepository`, `ItineraryVersionRepository`, `FeedbackRepository`, `AgentRunRepository`)
  - [x] 4.1 Create `app/repositories/selection_repository.py`
    - Implement `SelectionRepository(BaseRepository)` with `get_by_room_and_kind` and
      `upsert(room_id, kind, data, vote_session_id)` that UPDATEs an existing
      `(room_id, kind)` row or INSERTs, consistent with `UNIQUE(room_id, kind)`.
    - _Requirements: 17.1, 17.3_

  - [x] 4.2 Create `app/repositories/itinerary_version_repository.py`
    - Implement `get_latest`, `insert_version` (raw INSERT; raises a narrow
      `UniqueVersionViolation` only for a `23505` on `(trip_id, version)`, `RepositoryError`
      for any other failure; never issues UPDATE on `itinerary`), `supersede_lower_versions`
      (sets `status='superseded'` on lower-version `proposed` rows only, never touching
      `approved`/`rejected`), and `mark_approved` (enforces
      `uq_itinerary_versions_one_approved`, raising `DuplicateApprovalError` on violation).
    - _Requirements: 5.2, 5.3, 5.9, 5.10, 5.13_

  - [x]* 4.3 Write unit tests for `ItineraryVersionRepository`
    - Assert `insert_version` raises `UniqueVersionViolation` (not generic
      `RepositoryError`) specifically for the `(trip_id, version)` constraint, and raises
      `RepositoryError` for any other simulated failure. Assert `supersede_lower_versions`
      leaves `approved`/`rejected` rows untouched.
    - _Requirements: 5.3, 5.9, 5.13_

  - [x] 4.4 Create `app/repositories/feedback_repository.py`
    - Implement `list_open_by_trip(trip_id, limit=50)` ordered by creation time ascending,
      `mark_addressed(feedback_ids)`, `create(...)`.
    - _Requirements: 10.1, 10.6_

  - [x] 4.5 Create `app/repositories/agent_run_repository.py`
    - Implement `get_by_idempotency_key`, `get_active` (`status IN ('pending','running')`),
      `create_pending` (catches `23505` on `idempotency_key`, performs exactly one re-read
      by that key, raises `IdempotencyKeyConflictError` if the re-read finds nothing),
      `mark_running` (only from `pending`; never overwrites a non-NULL `started_at`),
      `mark_completed`, `mark_failed`, `get_by_id`.
    - Enforce the status-transition state machine (`pending→running`, `running→completed`,
      `running→failed`, `pending→failed`) internally; any other transition raises
      `RunStatusTransitionError` and leaves the row untouched.
    - _Requirements: 3.2, 3.7, 3.11, 4.1, 4.2, 4.5, 4.7, 4.8, 4.9_

  - [x]* 4.6 Write unit tests for `AgentRunRepository`
    - Assert `create_pending` under a simulated `23505` performs exactly one re-read and
      returns the winner's row; assert an out-of-order `mark_completed` call on a `pending`
      row raises `RunStatusTransitionError` and leaves the row unchanged; assert
      `mark_running` does not overwrite an existing `started_at`.
    - _Requirements: 3.2, 3.7, 3.11, 4.5_

- [x] 5. DI wiring for new repositories and services
  - [x] 5.1 Extend `app/api/deps.py`
    - Add `get_trip_repo`, `get_message_repo`, `get_vote_session_repo`, `get_vote_repo`,
      `get_selection_repo`, `get_itinerary_version_repo`, `get_feedback_repo`,
      `get_agent_run_repo`, each composed via `Depends(get_supabase_client)` following spec
      02's provider pattern exactly.
    - _Requirements: 20.1_

  - [x] 5.2 Checkpoint — verify repository layer wiring
    - Run `ruff check .` and the repository unit tests from tasks 3 and 4.
    - Ensure all tests pass, ask the user if questions arise.

- [x] 6. `AgentState`, `RepositoryBundle`, `Trip_Context` re-fetch helper, and the `backend/app/agents/` module skeleton
  - [x] 6.1 Create the `backend/app/agents/` package skeleton
    - Create `__init__.py` files for `app/agents/`, `app/agents/nodes/`,
      `app/agents/guardrails/`, `app/agents/tools/`, matching the module layout in the
      design (empty modules for `graph.py`, `group_profile.py`, `messages.py`,
      `proposals.py` to be filled in later tasks).
    - _Requirements: 1.8_

  - [x] 6.2 Implement `AgentState` in `app/agents/state.py`
    - Define the Pydantic v2 model with exactly the seven run-identity fields (`run_id`,
      `trip_id`, `run_type`, `base_version`, `created_by_member_id`, `idempotency_key`,
      `iteration_count`) and exactly the eight execution-internal fields (`trip_context`,
      `group_profile`, `proposal`, `guardrail_findings`, `external_tool_responses`,
      `tool_call_count`, `pending_npc_messages`, `repair_feedback`).
    - Implement the `_validate_uuid`, `_validate_idempotency_key`, `_validate_base_version`
      field validators; the `__setattr__` override rejecting mutation of the five frozen
      fields; `with_base_version`, `with_incremented_iteration` (bounded by the
      `Iteration_Cap`), and the three bounded `append_*` methods
      (`append_guardrail_findings` at 100, `append_tool_response` at `Tool_Call_Cap`,
      `append_pending_message` at 20) each raising `StateBoundExceededError` on overflow.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.11_

  - [x] 6.3 Implement `RepositoryBundle` in `app/agents/state.py`
    - Define the frozen dataclass carrying all eight new repositories plus
      `member_repo`/`profile_repo` (reused from spec 02), the three tool clients, and
      `llm`, constructed only outside `app/agents/` and threaded into node calls via
      LangGraph's `configurable` channel.
    - _Requirements: 1.9, 1.10, 20.1_

  - [x]* 6.4 Write unit tests for `AgentState` mutation guards and bounds
    - Assert assigning to `run_id`/`trip_id`/`run_type`/`created_by_member_id`/
      `idempotency_key` after construction raises `RunIdentityMutationError` and leaves the
      state unchanged; assert `with_incremented_iteration` raises `IterationCapExceededError`
      at the cap; assert each `append_*` method raises `StateBoundExceededError` exactly at
      its bound (101st finding, `Tool_Call_Cap + 1`th tool response, 21st pending message)
      without truncating the existing list.
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 2.11_

  - [x] 6.5 Implement `load_trip_context` in `app/agents/state.py`
    - Implement the shared `Trip_Context` re-fetch helper every `Specialist_Node` calls at
      entry before reading any `Trip_Context` value: loads fresh from the
      `Repository_Layer` (never trusting a carried `AgentState.trip_context` value from an
      earlier node as the basis for a persisted write); bounds the load to 5 seconds with at
      most 2 retries, failing the run with a `Domain_Exception` (no `NPC_Message`, no
      proposal write) if all attempts fail; raises a `Domain_Exception` when no `trips` row
      is found for the `trip_id`, when the `party_rooms` row is `cancelled`/`finalised`, or
      when the trip's recorded stage is later than the run's stage — in each case with no
      write to any Supabase record for that `trip_id`.
    - Document that a run resuming after interruption discards every execution-internal
      `AgentState` field and calls `load_trip_context` again before producing output, and
      that the LangGraph checkpointer is execution bookkeeping only — no plan/decision/
      progress value is stored there unless also persisted in Supabase.
    - _Requirements: 2.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

  - [x]* 6.6 Write unit tests for `load_trip_context`
    - Assert a missing `trips` row, a `cancelled`/`finalised` room, and a
      later-than-expected stage each raise the correct `Domain_Exception` with zero writes;
      assert a load exceeding 5 seconds or failing outright retries at most 2 times before
      failing the run; assert a resumed run's execution-internal `AgentState` fields are
      discarded and `Trip_Context` is reloaded before any output.
    - _Requirements: 6.6, 6.7, 6.8, 6.9_

- [x] 7. Structural Guardrail and the four `Proposal` Pydantic models
  - [x] 7.1 Create `app/agents/proposals.py`
    - Define `_StrictModel` (`extra="forbid"`), `RecommendationItem`,
      `DestinationRecommendationProposal`, `FlightRecommendationProposal`,
      `ItineraryItemModel`, `ItineraryDayModel`, `MapPointModel`, `ItineraryProposal`
      (with `affected_scope` as agent-internal-only, stripped before persistence), and
      `RefinementProposal`, matching the design's field names/types/nullability exactly and
      applying `extra="forbid"` recursively to every nested model.
    - _Requirements: 11.1, 11.2_

  - [x] 7.2 Create `app/agents/guardrails/structural.py`
    - Implement `_ENUM_COLUMNS` and `validate_enum_column(column, value)` covering all nine
      enums (`message_kind`, `itinerary_source`, `itinerary_status`, `vote_session_status`,
      `selection_kind`, `feedback_status`, `trip_status`, `agent_run_type`,
      `agent_run_status`).
    - Implement `validate_structural(proposal_dict, kind)` running Pydantic validation
      against the model selected by `kind`, collecting every validation error in one pass
      (not stopping at the first), classifying unparseable input as a single
      "unparseable output" finding without field paths, and returning one finding per error
      naming the field path, expected type/constraint, and missing/unknown/wrongly-typed
      classification.
    - _Requirements: 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10_

  - [x]* 7.3 Write unit tests for the structural guardrail
    - Assert a `Proposal` dict with an unknown field, a missing required field, a wrong
      enum value, and unparseable input each produce the expected finding shape and that a
      single validation pass reports all errors at once rather than the first only.
    - _Requirements: 11.1, 11.2, 11.5, 11.6, 11.8, 11.9_

- [x] 8. Business Guardrail and Factual Guardrail
  - [x] 8.1 Create `app/agents/group_profile.py`
    - Implement `compute_group_profile(members, prefs)` deriving `availability_overlap`
      (date-range intersection across members with at least one range),
      `interests`/`activities` union, `travel_style` distinct-value set, `hard_constraints`
      union, and `budget_ceiling` (lowest non-NULL `budget`, unconstrained when all NULL),
      treating a member with NULL/empty values as contributing nothing for that column.
    - _Requirements: 7.2, 7.3, 12.2, 12.3, 12.14_

  - [x] 8.2 Create `app/agents/guardrails/business.py`
    - Implement `run_business_guardrail(proposal, group_profile, trip_context)` evaluating,
      in this fixed order without stopping at the first failure: total costed value vs
      `Budget_Ceiling` (treating a NULL ceiling as unconstrained), dates vs
      `Availability_Overlap` (treating an empty overlap as excluding every date), travel-time
      feasibility between consecutive same-day items using the recorded `External_Tool`
      response (treating an absent travel-time entry as exceeding the gap), the hard-
      constraints union, and required activities read from `travel_preferences.activities`
      objects. Return one finding per failing check naming the check, offending element, and
      violated bound.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.11, 12.12, 12.13, 12.14_

  - [x]* 8.3 Write unit tests for the business guardrail
    - Assert all five checks run and report independently on a `Proposal` violating multiple
      checks at once; assert a NULL `Budget_Ceiling` passes the budget check; assert a
      travel-time entry absent from the tool response is treated as a failure, not
      estimated.
    - _Requirements: 12.2, 12.3, 12.4, 12.12, 12.14_

  - [x] 8.4 Create `app/agents/guardrails/factual.py`
    - Implement the `Factual_Field` classification (flight: carrier, flight identifier,
      origin, destination, departure/arrival date-time, price; place: identifier, name,
      lat, lng, opening info; weather: date, temperature, precipitation) versus narrative
      fields, and `run_factual_guardrail(proposal, external_tool_responses)` matching items
      to tool-response entries by exact case-sensitive identifier equality only (no fuzzy
      matching), rejecting items with no identifier or no match, and — only once every item
      has a match — overwriting drifted factual fields with the tool value while leaving
      narrative fields untouched.
    - _Requirements: 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9_

  - [x]* 8.5 Write unit tests for the factual guardrail
    - Assert an item with no identifier or an unmatched identifier is rejected; assert a
      matched item with drifted factual fields is overwritten to the tool value while its
      narrative fields (e.g. description) remain unchanged; assert no overwrite occurs when
      any item in the proposal lacks a match.
    - _Requirements: 13.3, 13.4, 13.5, 13.6_

  - [x] 8.6 Implement `run_guardrail_pipeline` and `_repair_or_escalate` in
    `app/agents/guardrails/__init__.py`
    - Wire structural → business → factual in strict sequence, only advancing a `Proposal`
      that passed the prior layer, issuing zero `Repository_Layer` writes until all three
      pass, incrementing `iteration_count` by exactly 1 per failed evaluation, and routing
      to `_repair_or_escalate` (re-invoke the producing node under the `Iteration_Cap`, or
      perform `Human_Escalation` at the cap).
    - _Requirements: 2.9, 2.10, 11.3, 11.6, 12.7, 12.8, 12.11, 14.1, 14.2_

  - [x]* 8.7 Write unit tests for the guardrail pipeline orchestration
    - Assert a structural failure never reaches the business or factual guardrail; assert
      the combined pipeline issues zero repository write calls for a `Proposal` that fails
      any single layer; assert `iteration_count` increments by exactly 1 per evaluation
      regardless of how many findings that evaluation produced.
    - _Requirements: 11.3, 11.6, 12.7, 12.8, 12.11_

- [x] 9. Human Escalation and NPC message emission
  - [x] 9.1 Create `app/agents/messages.py`
    - Implement `TextMessageContent`, `RecommendationMessageContent`,
      `VoteMessageContent`, `SummaryMessageContent` Pydantic models (including
      `TextMessageContent.progress: bool | None` per Backend Change Request Entry 2).
    - Implement `emit_npc_message(repos, trip_id, kind, content)` resolving `room_id` via
      `TripRepository.get_room_id_for_trip` (raising `RoomResolutionError` if unresolved),
      validating the `message_kind` enum and content shape, enforcing the 16,384-byte size
      limit, and writing via `MessageRepository.insert_turn` with `sender_type='ai'`,
      `sender_member_id=None`.
    - Implement `emit_progress_message(repos, run_id, trip_id, stage)` short-circuiting if a
      progress message already exists for that run (at most 1 per run), swallowing
      `RepositoryError` as best-effort without retrying.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.9, 16.1, 16.2, 16.3, 16.4, 16.8, 16.9, 22.5_

  - [x] 9.2 Implement `perform_human_escalation` in `app/agents/guardrails/__init__.py`
    - Emit exactly one `kind='text'` `NPC_Message` naming the unmet constraint, containing
      exactly one question, `content.stage` set to the run's stage, and `content.options` as
      2-4 `{id, label}` entries; on success set `status='completed'`,
      `completed_at=now()`, `result_version_id=None`, `error=None`; on message-write failure
      set `status='failed'` with a display-safe `error`; never write to
      `itinerary_versions`, `selections`, or `trips.status` on either path.
    - _Requirements: 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9_

  - [x]* 9.3 Write unit tests for message emission and escalation
    - Assert `emit_npc_message` raises `RoomResolutionError` when no room resolves and
      writes nothing; assert `emit_progress_message` is a no-op on the second call for the
      same run; assert `perform_human_escalation` results in zero writes to
      `itinerary_versions`/`selections`/`trips.status` and a `status='completed'` outcome
      with `content.options` between 2 and 4 entries.
    - _Requirements: 14.4, 14.5, 14.7, 15.9, 16.9_

- [x] 10. Checkpoint — guardrail and messaging layer verification
  - Run `ruff check .` and all guardrail/messaging unit tests from tasks 7-9.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. External tool clients (flights, places, weather)
  - [x] 11.1 Create `app/agents/tools/base.py` and the three response models
    - Implement `FlightOption`, `FlightSearchResponse`, `PlaceResult`,
      `PlacesLookupResponse`, `WeatherDay`, `WeatherLookupResponse` as `_StrictModel`
      subclasses.
    - Implement `ExternalTool.invoke` with the per-tool-plus-params cache (skipping cap
      consumption on a cache hit), the `Tool_Call_Cap` check before any new call, the
      `Settings`-driven per-call timeout via `asyncio.wait_for`, exactly one retry on
      timeout/transport error only (never on validation failure), and Pydantic validation
      of every raw response before any node/guardrail/LLM reads it.
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.6, 19.7, 19.8, 19.9, 19.10_

  - [x] 11.2 Create `app/agents/tools/flights.py`, `places.py`, `weather.py`
    - Implement `FlightSearchTool`, `PlacesLookupTool`, `WeatherLookupTool` subclassing
      `ExternalTool`, each reading its endpoint/credential from `Settings` and implementing
      `_call(**params)` against the concrete external API.
    - _Requirements: 19.1, 19.4, 19.5_

  - [x]* 11.3 Write unit tests for the external tool base and caps
    - Assert a repeated identical call within a run reuses the cache without incrementing
      `tool_call_count`; assert an invocation at the `Tool_Call_Cap` raises
      `ToolCallCapExceededError` instead of calling the transport; assert a timeout retries
      exactly once and a validation failure never retries; assert credentials never appear
      in a raised exception's message.
    - _Requirements: 19.2, 19.3, 19.6, 19.8, 19.9_

- [x] 12. Vote resolution, Tiebreak_Flow, and trip status/stage derivation
  - [x] 12.1 Create `app/services/trip_status_service.py`
    - Implement `_STAGE_BY_STATUS`, `_STATUS_RANK`, and
      `advance_trip_status(repos, trip_id, new_status, current_status)` computing the
      `refinement_completed → feedback_collected` exception, no-op'ing (and reporting the
      unchanged current status) on any other same-or-lower-rank transition, and calling
      `TripRepository.update_status` as the sole writer of both `trips.status` and
      `party_rooms.planning_stage` in one call.
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10, 18.11_

  - [x]* 12.2 Write unit tests for `TripStatusService`
    - Assert a lower-rank transition that is not the refine-loop exception is a no-op
      reporting the current status; assert the refine-loop transition is permitted to
      recur; assert every one of the 10 enum values maps through `_STAGE_BY_STATUS`
      correctly.
    - _Requirements: 18.6, 18.7, 18.8_

  - [x] 12.3 Create `app/services/vote_service.py`
    - Implement `resolve_vote_session` (tally by `VoteRepository.count_by_option`
      restricted to members still in `room_members`; `Tiebreak_Flow`'s `Option_Index_Rule`
      selecting the lowest zero-based index among tied options with no LLM/graph
      invocation and no random/clock input; single-transaction `selections.upsert` +
      `vote_sessions.close`; a `kind='summary'` `NPC_Message` naming tied ids/count/winner
      when a tie occurred; a call to `advance_trip_status` for the resolved category).
    - Implement `on_vote_cast` (resolves when `count_distinct_voters` equals the room's
      member count) and `close_session` (owner-triggered resolution using only currently
      persisted votes) and rejection of a vote submitted to an already-`closed` session.
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10, 17.11, 17.12, 17.13, 22.1, 22.2, 22.3_

  - [x]* 12.4 Write unit tests for `VoteService` and `Tiebreak_Flow`
    - Assert an exact-count tie resolves deterministically to the lowest-index option
      across repeated runs over the same persisted data; assert `resolve_vote_session`
      writes `selections` and closes the session in a way that both succeed or both fail
      together (simulated partial-failure test); assert a vote on a closed session is
      rejected with no writes; assert an unresolved client-supplied `member_id` is rejected
      before any write.
    - _Requirements: 17.7, 17.9, 17.13, 22.3_

- [x] 13. Checkpoint — service layer verification
  - Run `ruff check .` and all tests from tasks 11-12.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. `AgentRunService` and `Agent_Graph` compilation
  - [x] 14.1 Create `app/agents/graph.py`
    - Implement `_ENTRY_NODE_BY_RUN_TYPE`, `_build_graph()`, and `get_agent_graph()`
      (`lru_cache`d, compiled once per process) with exactly five nodes and the conditional
      dispatch edge from `orchestrator` to the correct entry node.
    - Implement `run_agent_graph(state)` as the single public entry point the service layer
      calls.
    - _Requirements: 1.1, 1.2, 1.8_

  - [x] 14.2 Implement `orchestrator_node` in `app/agents/nodes/orchestrator.py`
    - Validate `run_type` is one of the four enum values, raising `InvalidRunTypeError`
      before any dispatch for an invalid value and performing no write to `messages`,
      `vote_sessions`, `selections`, `itinerary_versions`, `feedback`, or `trips`.
    - Check stage preconditions via `Repository_Layer` reads only (never selecting a
      different entry node from `Trip_Context`), raising `StagePreconditionNotMetError` and
      skipping dispatch when unmet.
    - Perform exactly one dispatch to the AC-2-mapped entry node otherwise.
    - _Requirements: 1.3, 1.4, 1.5, 1.6_

  - [x]* 14.3 Write unit tests for orchestrator dispatch
    - For each of the four `run_type` values, assert the mapped specialist node is invoked
      exactly once and every other specialist node zero times; assert an invalid `run_type`
      raises `InvalidRunTypeError` before any node call; assert an unmet precondition raises
      `StagePreconditionNotMetError` with no dispatch.
    - _Requirements: 1.3, 1.4, 1.5, 1.6_

  - [x] 14.4 Create `app/services/agent_run_service.py`
    - Implement `trigger_run(trip_id, run_type, member_id, idempotency_key)`: resolve the
      client-supplied `member_id` against `MemberRepository` before treating it as
      authoritative (rejecting an unresolved identity with a `Domain_Exception` and no
      write); reclaim a stale `Active_Run` (status `pending`/`running` with
      `started_at`/`created_at` older than 300s) by marking it `failed` before creating a
      new row; return an existing run unmodified when the `idempotencyKey` matches one on a
      row with the same `trip_id`/`run_type`; raise `IdempotencyKeyConflictError` when it
      matches a row with a different `trip_id`/`run_type`; raise
      `InvalidIdempotencyKeyError` for an empty/whitespace/over-200-char key; return an
      existing `Active_Run` when no idempotency key is supplied or matched; otherwise create
      the `pending` row (`base_version` = current latest `itinerary_versions.version` or 0),
      call `mark_running`, best-effort `emit_progress_message`, call `run_agent_graph`, and
      finalize with `mark_completed`/`mark_failed`.
    - On finalizing with `mark_completed`, emit one run-outcome `NPC_Message` via
      `emit_npc_message`: a `recommendation`/`vote`/`summary` message when the run persisted
      a `Proposal`, or a `kind='text'` message stating the plan is unchanged (naming a
      concurrent change or nothing left to change) when the run completed with no `Proposal`
      persisted (e.g. `Lost_Race`, or a `refinement` run with no open `feedback`). On
      finalizing with `mark_failed`, emit one `kind='text'` `NPC_Message` stating the attempt
      did not succeed and that the party may try again.
    - Serialize the returned `Agent_Run` to exactly the seven `AgentRunSchema` fields
      (`id`, `tripId`, `runType`, `status`, `baseVersion`, `resultVersionId?`, `error?`).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.8, 3.9, 3.10, 4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 4.8, 4.9, 16.5, 16.6, 16.7, 20.1, 20.4, 22.1, 22.2, 22.3, 22.4_

  - [x]* 14.5 Write unit tests for `AgentRunService`
    - Assert two calls with the same `idempotencyKey` and matching `trip_id`/`run_type`
      produce exactly one `agent_runs` insert and the same returned id; assert a stale
      active run (>300s) is marked failed before a new one is created; assert a mismatched
      `trip_id`/`run_type` on the same key raises `IdempotencyKeyConflictError` with zero
      writes; assert an unresolved `member_id` is rejected before any `agent_runs` write;
      assert the returned schema never includes `idempotency_key`, `created_by_member_id`,
      `iteration_count`, `started_at`, or `completed_at`.
    - _Requirements: 3.8, 4.2, 4.5, 4.6, 4.7, 22.3_

- [x] 15. Checkpoint — graph and service wiring verification
  - Run `ruff check .` and all tests from task 14; confirm no module under
    `backend/app/api/routes/` imports anything under `backend/app/agents/`, and no module
    under `backend/app/agents/` constructs a repository or Supabase client.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Discovery_Node (DISCOVER stage)
  - [x] 16.1 Implement `discovery_node` in `app/agents/nodes/discovery.py`
    - Call `load_trip_context` at entry (Requirement 6) before reading any `Trip_Context`
      value; re-load `room_members`, `characters`, `travel_preferences` fresh via the
      `Repository_Layer`; fail with `PreferencesNotCollectedError` (no `Group_Profile`
      computed, no writes) if zero `travel_preferences` rows exist.
    - Compute the `Group_Profile` via `compute_group_profile`; escalate
      (`Human_Escalation`, no recommendation, no vote session) when the availability overlap
      is empty.
    - Seed candidates from `travel_preferences.destinations` before model/tool-sourced
      candidates; exclude candidates violating hard constraints or exceeding the budget
      ceiling; escalate if that empties the candidate set.
    - Run `run_guardrail_pipeline`; on success close any existing open `destination`-category
      vote session, emit the `kind='recommendation'` message (3-5 items, unique ids), and
      create the paired `vote_sessions` row (`status='open'`, options matching item ids
      one-to-one, `message_id` set).
    - _Requirements: 1.7, 1.11, 6.1, 6.2, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12_

  - [x]* 16.2 Write unit tests for `discovery_node`
    - Assert zero `travel_preferences` rows raises `PreferencesNotCollectedError` with no
      `Group_Profile` computed; assert an empty availability overlap escalates without a
      recommendation or vote session; assert a candidate set emptied by constraints/budget
      escalates naming the eliminating constraint; assert a prior open destination vote
      session is closed before the new one is created; assert `Group_Profile` is never
      passed to a repository write call.
    - _Requirements: 7.4, 7.8, 7.10, 7.11, 7.12_

- [x] 17. Logistics_Node (LOGISTICS stage)
  - [x] 17.1 Implement `logistics_node` in `app/agents/nodes/logistics.py`
    - Call `load_trip_context` at entry (Requirement 6). Load the `kind='destination'`
      selection (raising `DestinationNotSelectedError` with no writes if absent) and the
      party's `travel_preferences`; derive
      `Availability_Overlap`/`Budget_Ceiling` via `compute_group_profile`.
    - Escalate without calling `FlightSearchTool` when the overlap is empty or no departure
      origin resolves (reading the interim conventioned `hard_constraints` entry per Backend
      Change Request Entry 1 — never inferring an origin from model output or the
      destination).
    - Call `FlightSearchTool`; exclude options over budget or outside the overlap (no price
      exclusion when the ceiling is unconstrained); escalate if that empties the result set;
      otherwise rank by `(price asc, duration asc, stops asc)`.
    - Run `run_guardrail_pipeline`; on success close any existing open `flight`-category
      vote session, emit the `kind='recommendation'` message (3-5 items with comparable
      `meta`), and create the paired `vote_sessions` row.
    - _Requirements: 6.1, 6.2, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11_

  - [x]* 17.2 Write unit tests for `logistics_node`
    - Assert a missing destination selection raises `DestinationNotSelectedError` with no
      flight-tool call; assert an unresolved origin or empty overlap escalates without
      calling `FlightSearchTool`; assert ranking is `(price, duration, stops)` ascending;
      assert factual fields (price, carrier, etc.) in the emitted recommendation always
      equal the tool response, never a model-generated value.
    - _Requirements: 8.2, 8.3, 8.6, 8.7, 8.8, 8.10, 8.11_

- [x] 18. Checkpoint — Discovery and Logistics node verification
  - Run `ruff check .` and all node tests from tasks 16-17.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. Itinerary persistence helper and Itinerary_Node (BUILD stage)
  - [x] 19.1 Implement `persist_itinerary_version` in `app/agents/nodes/itinerary.py`
    - Implement the optimistic-lock loop from the design's Algorithmic Pseudocode: insert
      at `base_version + 1` with `source="build"` iff `version == 1` and `"refine"`
      otherwise (satisfying `CHECK ((version = 1) = (source = 'build'))`), and always
      `status='proposed'` on the inserted row, never `approved`/`rejected`/`superseded`; on
      success call `supersede_lower_versions` and return; on a `UniqueVersionViolation`,
      re-fetch the latest version, update `state.base_version` via `with_base_version`,
      re-evaluate applicability (content differs within `Affected_Scope`, all addressed
      `feedback`, or a differing `selections` row), and either complete with no write
      (`Lost_Race`, no longer applicable) or retry; permit at most 2 `Lost_Race` cycles,
      raising `RepeatedVersionContentionError` on a third; treat any
      non-`UniqueVersionViolation` `RepositoryError` as a fatal `ItineraryPersistenceError`
      with no retry.
    - _Requirements: 2.9, 2.10, 5.1, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.11, 5.12, 5.13_

  - [x]* 19.2 Write unit tests for `persist_itinerary_version`
    - Using the in-memory `FakeItineraryVersionRepository`, assert 0, 1, and 2 simulated
      collisions each result in the correct number of re-fetches and exactly one successful
      insert; assert a 3rd collision raises `RepeatedVersionContentionError` without a
      further insert attempt; assert a non-collision `RepositoryError` never triggers a
      re-fetch or retry; assert every inserted row satisfies
      `(version == 1) == (source == "build")` and always carries `status='proposed'`.
    - _Requirements: 5.7, 5.8, 5.11, 5.12, 5.13_

  - [x] 19.3 Implement `itinerary_node` in `app/agents/nodes/itinerary.py`
    - Call `load_trip_context` at entry (Requirement 6). Load both selections and all party
      `travel_preferences` before generation; fail with
      the appropriate `Domain_Exception` (no `itinerary_versions` insert) when either
      selection or all preferences are absent.
    - Derive day count from the flight dates, falling back to the availability overlap when
      either date is absent; fail with `InvalidTripDurationError` outside 1-30 days.
    - Generate 1-10 items per day, ordered by time then generation order for untimed items;
      assign globally unique item ids across all days.
    - Call `persist_itinerary_version(..., source="build")`, guarded by the service-layer
      routing rule that this node only runs when no `itinerary_versions` row exists yet for
      the trip; on success emit a `kind='summary'` message and set
      `trips.status='itinerary_generated'` via `advance_trip_status`.
    - Ensure the persisted/emitted itinerary object and version metadata always include
      `id`/`status` on the version and `id` on every item, independent of the frontend
      type's current gap.
    - _Requirements: 6.1, 6.2, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.11, 9.12, 9.13, 9.14, 9.15, 9.16_

  - [x]* 19.4 Write unit tests for `itinerary_node`
    - Assert a missing selection or missing preferences raises the correct
      `Domain_Exception` with zero `itinerary_versions` inserts; assert a derived day count
      of 0 or 31 raises `InvalidTripDurationError`; assert item ids are unique across all
      days; assert the persisted itinerary dict includes `id`/`status` fields even though
      the (simulated) frontend type omits them.
    - _Requirements: 9.5, 9.9, 9.11, 9.12, 9.16_

- [x] 20. Negotiation_Node (REFINE stage)
  - [x] 20.1 Implement `compute_affected_scope` and `detect_conflicts` in
    `app/agents/nodes/negotiation.py`
    - Implement the union of every open `feedback` row's target day/item, every same-day
      item whose time range overlaps a changed item, and the immediately adjacent items in
      that day's ordered list.
    - Implement deterministic, non-LLM conflict detection: two or more open rows naming the
      same day/item whose requested outcomes cannot both be satisfied (removal vs retention,
      two different replacements), returning the same conflict set for the same input every
      time.
    - Implement `partition_by_target_resolution` handling both the structured
      `{day?, itemId?, section?}` target shape and the legacy flat-string shape (attempting
      an exact match against an `itemId` or day number before falling back to the
      not-found path), so a target that resolves against neither shape is excluded from the
      `Affected_Scope`, left `status='open'`, and named in an `NPC_Message` as not located.
    - _Requirements: 10.2, 10.9, 10.14, 10.15_

  - [x]* 20.2 Write unit tests for `compute_affected_scope`/`detect_conflicts`
    - Assert the same set of open `feedback` rows always yields the same conflict set
      across repeated calls; assert a legacy flat-string target that exact-matches an item
      id resolves the same as a structured target would; assert an unresolvable target
      (structured or flat-string) is excluded from `Affected_Scope` and left open.
    - _Requirements: 10.9, 10.14, 10.15_

  - [x] 20.3 Implement `negotiation_node` in `app/agents/nodes/negotiation.py`
    - Call `load_trip_context` at entry (Requirement 6). Fail with
      `NoItineraryToRefineError` (no writes, no status change) when the trip has
      no `itinerary_versions` row.
    - Complete with `status='completed'`, `result_version_id=None`, no version insert, and
      an explanatory `NPC_Message` when no open `feedback` rows exist.
    - Load up to 50 open `feedback` rows ordered by creation time; build the new itinerary
      reproducing every day/item in the `Unaffected_Scope` field-for-field identical
      (including `id`, day number, and position) to the base version; route regeneration
      only to the specialist node owning the `Affected_Scope`.
    - When passing `feedback` row text and other user-authored `messages` text to the LLM as
      reasoning input, treat that text strictly as data describing the requested change and
      SHALL NOT execute or follow any instruction phrased within it as an agent directive.
    - Call `persist_itinerary_version(..., source="refine")` with a `change_summary`
      (1-500 chars) naming every affected day/item; on success mark addressed feedback rows,
      emit a `kind='summary'` conflict message when conflicts were detected, and set
      `trips.status='refinement_completed'` via `advance_trip_status`.
    - Ensure the persisted/emitted itinerary and `change_summary`/version metadata always
      include `id`/`status` on every version and `id` on every item, independent of the
      frontend type's current gap.
    - _Requirements: 6.1, 6.2, 10.1, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.10, 10.11, 10.12, 10.13, 10.16, 15.8_

  - [x]* 20.4 Write unit tests for `negotiation_node`
    - Assert a trip with no itinerary version raises `NoItineraryToRefineError` with no
      writes; assert no open feedback completes the run with no version insert and
      `trips.status` unchanged; assert every `Unaffected_Scope` item is byte-identical
      field-by-field between base and refined versions; assert a row whose requested change
      is not reflected stays `status='open'` and is named in the emitted message.
    - _Requirements: 10.3, 10.7, 10.12, 10.13_

- [x] 21. Checkpoint — all specialist nodes verification
  - Run `ruff check .` and all node tests from tasks 19-20; confirm the full `Agent_Graph`
    dispatches correctly end-to-end for each `run_type` against mocked repositories.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 22. SETUP/WRAP stage handling and secret-safety/layering enforcement
  - [x] 22.1 Implement SETUP guidance and WRAP summary helpers
    - Implement plain service-layer/helper code (not graph nodes) that emits SETUP guidance
      `NPC_Message` rows without creating an `agent_runs` row, and a WRAP summary helper that
      reads the single `status='approved'` `itinerary_versions` row and fails with
      `NoApprovedItineraryError` (no summary emitted) when none exists.
    - _Requirements: 1.11, 1.12, 1.13_

  - [x] 22.2 Add logging redaction enforcement in `app/agents/` modules
    - Ensure every log call across `app/agents/` excludes `Service_Role_Key` values, LLM API
      keys, `External_Tool` credentials, raw Supabase payloads, SQL text, LLM prompt/
      completion text, and stack traces at every log level, matching spec 02's
      `RepositoryError` handler discipline of authored, safe messages.
    - _Requirements: 20.5, 20.6_

  - [x]* 22.3 Write unit tests for SETUP/WRAP and layering
    - Assert SETUP guidance creates zero `agent_runs` rows; assert WRAP with no approved
      version raises `NoApprovedItineraryError` with no summary message emitted; assert a
      static-analysis-style test (e.g. `ast`-based import scan) confirms no module under
      `backend/app/api/routes/` imports `app.agents` and no module under `backend/app/agents/`
      imports the Supabase client factory directly.
    - _Requirements: 1.11, 1.13, 20.1, 20.2_

- [x] 23. Property-based tests for design correctness properties
  - [x]* 23.1 Add version-lifecycle property tests
    - **Property 1: Version monotonicity, no gaps, no overwrites** — using the fake
      repository, assert any interleaving of concurrent inserts yields a contiguous
      version sequence starting at 1 with no overwrite, tagged
      `Feature: 03-AI-agents, Property 1`.
    - **Property 2: Build-source invariant** — assert insert proceeds iff
      `(version == 1) == (source == "build")`, tagged `Feature: 03-AI-agents, Property 2`.
    - **Property 3: At most one approved version** — assert `mark_approved` never leaves
      more than one `approved` row per trip, tagged `Feature: 03-AI-agents, Property 3`.
    - **Property 13: Bounded contention** — assert exactly `min(k, 2)` `Lost_Race` cycles
      for `k` simulated collisions and `status='failed'` at `k >= 3`, tagged
      `Feature: 03-AI-agents, Property 13`.
    - **Property 14: Supersede safety** — assert `approved`/`rejected` rows are
      byte-identical before/after `supersede_lower_versions`, tagged
      `Feature: 03-AI-agents, Property 14`.
    - **Property 15: Item id stability across versions** — assert carried-forward items
      retain their `id` and new items get ids unused by any prior version, tagged
      `Feature: 03-AI-agents, Property 15`.
    - _Requirements: 5.1, 5.2, 5.3, 5.9, 5.10, 5.11, 5.12, 9.9, 9.10_

  - [x]* 23.2 Add guardrail and escalation property tests
    - **Property 4: Guardrail soundness** — assert zero repository write calls for any
      malformed/rejected `Proposal`, tagged `Feature: 03-AI-agents, Property 4`.
    - **Property 8: Iteration and tool-call cap bound** — assert
      `iteration_count`/`external_tool_responses` count never exceed their configured caps
      across randomly generated failure sequences, tagged
      `Feature: 03-AI-agents, Property 8`.
    - **Property 10: Factual provenance and completeness** — assert every persisted
      factual field equals its matched tool-response entry and unmatched items are
      rejected, tagged `Feature: 03-AI-agents, Property 10`.
    - **Property 12: Secret non-disclosure** — assert no configured secret marker string
      appears in `agent_runs.error`, emitted `messages.content`, or
      `API_Error_Response.message`, tagged `Feature: 03-AI-agents, Property 12`.
    - _Requirements: 3.6, 11.6, 12.11, 12.8, 12.9, 13.1, 13.3, 13.4, 13.5, 13.6, 13.9, 14.10, 19.2, 20.5, 20.8_

  - [x]* 23.3 Add run-lifecycle and idempotency property tests
    - **Property 6: Idempotency replay** — assert 2-10 concurrent
      `create_pending` calls with the same key produce exactly one row and one shared id,
      tagged `Feature: 03-AI-agents, Property 6`.
    - **Property 7: Run terminality** — assert every run execution path ends with
      `status` in `{completed, failed}` and a non-NULL `completed_at`, tagged
      `Feature: 03-AI-agents, Property 7`.
    - _Requirements: 3.3, 3.5, 4.1, 4.2, 4.5, 14.5, 14.6_

  - [x]* 23.4 Add negotiation, messaging, and status property tests
    - **Property 5: Unaffected-scope preservation** — assert every day/item outside
      `compute_affected_scope` is field-by-field identical between base and refined
      versions, tagged `Feature: 03-AI-agents, Property 5`.
    - **Property 9: Message envelope validity** — assert every emitted `NPC_Message` has
      `sender_type='ai'`, `sender_member_id=None`, a valid `kind`, and contract-shaped
      `content`, tagged `Feature: 03-AI-agents, Property 9`.
    - **Property 11: Status monotonicity with one exception** — assert `trips.status`
      rank never decreases except for the permitted refine-loop transition, tagged
      `Feature: 03-AI-agents, Property 11`.
    - **Property 16: Stage/status coherence** — assert `_STAGE_BY_STATUS` matches the
      fixed table for all 10 enum values and every persisted write's read-back is
      consistent, tagged `Feature: 03-AI-agents, Property 16`.
    - **Property 17: Turn atomicity** — assert a turn's messages are either all visible or
      none are under any injected failure point, tagged `Feature: 03-AI-agents, Property
      17`.
    - **Property 18: Progress-message singularity** — assert at most one
      `content.progress=true` message per run across any number of repair iterations,
      tagged `Feature: 03-AI-agents, Property 18`.
    - _Requirements: 10.2, 10.3, 15.1, 15.2, 15.3, 15.10, 15.11, 16.1, 16.9, 18.1, 18.6, 18.7, 18.8, 18.10_

- [x] 24. No-network enforcement and integration-style tests
  - [x] 24.1 Add the autouse `block_network` fixture in `tests/agents/conftest.py`
    - Monkeypatch `socket.socket` to raise `AssertionError` on any real network attempt,
      applied to every test under `tests/agents/`.
    - Add the shared `mocker.AsyncMock(spec=...)` fixtures for all eight new repositories
      plus `mock_llm`, `mock_flight_tool`, etc., following spec 02's fixture pattern.
    - _Requirements: 21.7, 21.8, 21.10, 21.11_

  - [x]* 24.2 Write end-to-end node-dispatch integration tests with mocked repositories
    - For each `run_type`, drive `run_agent_graph` with fully mocked `RepositoryBundle` and
      test-double `llm`/tool clients returning fixed, pre-declared responses, and assert the
      expected repository write call counts and `agent_runs` status outcome for a
      representative happy path and one guardrail-rejection path per node.
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7, 21.8, 21.9, 21.12, 21.13_

- [x] 25. Final checkpoint — full verification
  - Run the full `pytest` suite (including the property-based tests with the fixed seed
    and ≥50 examples each), confirm zero failures/errors with no network interface
    available and no Supabase credentials present in the environment, and confirm
    `ruff check .` is clean.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (test-focused) and may be skipped for a faster MVP;
  core implementation tasks are never optional.
- **Repositories before nodes:** all eight new repositories and their DI wiring land before
  any specialist node, since spec 02's own repositories are themselves unimplemented in the
  current codebase.
- **Shared guardrail/tool infrastructure, not per-node duplication:** the structural/
  business/factual guardrail pipeline and the four `Proposal` models (task 7-8) and the
  external tool clients (task 11) are each implemented once and consumed by all four
  specialist nodes.
- **Node order Discovery → Logistics → Itinerary → Negotiation** matches stage order and
  Negotiation's reuse of Itinerary's `persist_itinerary_version` helper.
- **Interim departure-origin behavior** (Backend Change Request Entry 1) is implemented in
  `logistics_node` exactly as documented in requirements.md: read from a conventioned
  `hard_constraints` entry, escalate on absence, never guess.
- **`content.progress` field** (Backend Change Request Entry 2) is implemented in
  `TextMessageContent` as an optional boolean per the design; this remains a pending
  `api-contracts.md` addition the frontend needs, not something this plan changes on the
  frontend side.
- **No schema changes:** the only new SQL is the two additive RPC functions in task 2; no
  `ALTER TABLE`, new column, new enum value, or publication change is introduced anywhere
  in this plan.
- Each non-checkpoint task references the requirement numbering in `requirements.md` for
  traceability; property-based test tasks additionally cite the design's Correctness
  Properties section by number.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.1"] },
    { "id": 1, "tasks": ["1.4", "3.1", "3.3", "3.5", "4.1", "4.2", "4.4", "4.5"] },
    { "id": 2, "tasks": ["3.2", "3.4", "3.6", "4.3", "4.6", "5.1"] },
    { "id": 3, "tasks": ["6.1"] },
    { "id": 4, "tasks": ["6.2"] },
    { "id": 5, "tasks": ["6.3", "6.5"] },
    { "id": 6, "tasks": ["6.4", "6.6", "7.1"] },
    { "id": 7, "tasks": ["7.2"] },
    { "id": 8, "tasks": ["7.3", "8.1"] },
    { "id": 9, "tasks": ["8.2", "8.4"] },
    { "id": 10, "tasks": ["8.3", "8.5", "8.6"] },
    { "id": 11, "tasks": ["8.7", "9.1"] },
    { "id": 12, "tasks": ["9.2"] },
    { "id": 13, "tasks": ["9.3"] },
    { "id": 14, "tasks": ["11.1"] },
    { "id": 15, "tasks": ["11.2", "12.1"] },
    { "id": 16, "tasks": ["11.3", "12.3"] },
    { "id": 17, "tasks": ["12.2", "12.4"] },
    { "id": 18, "tasks": ["14.1"] },
    { "id": 19, "tasks": ["14.2"] },
    { "id": 20, "tasks": ["14.3", "14.4"] },
    { "id": 21, "tasks": ["14.5"] },
    { "id": 22, "tasks": ["16.1", "17.1"] },
    { "id": 23, "tasks": ["16.2", "17.2", "19.1"] },
    { "id": 24, "tasks": ["19.2"] },
    { "id": 25, "tasks": ["19.3"] },
    { "id": 26, "tasks": ["19.4", "20.1"] },
    { "id": 27, "tasks": ["20.2", "20.3"] },
    { "id": 28, "tasks": ["20.4"] },
    { "id": 29, "tasks": ["22.1", "22.2"] },
    { "id": 30, "tasks": ["22.3", "24.1"] },
    { "id": 31, "tasks": ["23.1", "23.2", "23.3", "23.4", "24.2"] }
  ]
}
```
