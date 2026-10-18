# Requirements Document

## Introduction

This document specifies the **LangGraph AI agent layer** (Dev C's scope) for the PixelArt
Trip Planner. The agent layer is the in-world NPC travel guide: it reasons over the party's
combined characters and travel preferences, produces destination and flight proposals,
generates the itinerary, negotiates compromises from party feedback, and emits the NPC
dialogue that drives the party through the six planning stages
(SETUP → DISCOVER → LOGISTICS → BUILD → REFINE ⭯ → WRAP).

Spec 01 (`01-project-foundation`) established the FastAPI scaffolding and the Supabase
schema. Spec 02 (`02-backend-core`) specifies the Supabase client, the three-layer
architecture (routes → services → repositories), the Pydantic schema conventions, the
`API_Error_Response` envelope, and the first two endpoints (`POST /rooms`,
`POST /rooms/{room_code}/join`). This spec adds the AI reasoning layer that runs behind the
backend's trigger endpoints.

### Governing constraint

**The backend core is fixed. The agent layer conforms to the backend, never the reverse.**

The live database schema (`supabase/migrations/`), the contracts in
`.kiro/steering/api-contracts.md`, and the frontend's actual TypeScript contract types
(`frontend/src/types/*.ts`, `frontend/src/services/*.contract.ts`) are treated as immutable
inputs to this spec. This document introduces no new tables, no new columns, no new enum
values, and no changes to the API contracts. Where a capability described in earlier
handover material cannot be
represented in the live schema, this spec adapts the capability to the schema that exists
rather than proposing a schema change, and rather than inventing an agent-layer workaround
that fights the schema (for example: encoding structured state inside free-text fields, or
holding authoritative state only in the LangGraph checkpointer where Supabase never sees
it). Any residual genuinely-unrepresentable need is recorded in the
**Backend Change Requests** section. That section starts empty and gains an entry only after a
documented attempt to fit the existing schema has failed. It currently holds two entries: a
departure origin for flight search, and a `progress` field on the `text` message content
shape.

### Verified schema facts this spec is built on

These facts were verified against the live migrations and override any conflicting earlier
handover wording. Requirements below are written in these terms.

1. **No `trips.current_version` column.** The concurrency control for itinerary generation
   is `itinerary_versions UNIQUE(trip_id, version)` combined with
   `agent_runs.base_version INTEGER` (`0` = no version yet). A run records its
   `base_version`, generates, then inserts `version = base_version + 1`. A concurrent loser
   receives a uniqueness violation and must reload the latest state and re-evaluate rather
   than force the write.
2. **`itinerary_status` enum is `proposed | approved | rejected | superseded`.** There is no
   `draft` status; agent-produced versions are written directly as `proposed`.
3. **`agent_run_type` enum is `discovery | logistics | itinerary | refinement`.** Group
   profile reasoning is therefore an internal node inside the `discovery` run and is not its
   own `agent_runs` row.
4. **No `itinerary_versions.parent_version` column.** Negotiation and conflict history is
   reconstructed from version ordering (`UNIQUE(trip_id, version)`),
   `itinerary_versions.change_summary`, and `feedback` rows (`target` jsonb plus
   `status open | addressed`).
5. **`CHECK ((version = 1) = (source = 'build'))`.** BUILD may only ever produce version 1;
   every subsequent version must have `source = 'refine'`.
6. **Partial unique index `uq_itinerary_versions_one_approved`** — at most one `approved`
   version per trip.
7. **`agent_runs` is not in the `supabase_realtime` publication.** Run progress cannot be
   observed by clients through run-row subscriptions, so NPC progress state surfaces through
   `messages` rows, which are published.
8. **`agent_runs` columns:** `id, trip_id, created_by_member_id, run_type, base_version,
   status(pending|running|completed|failed), idempotency_key (UNIQUE), result_version_id,
   iteration_count, error, started_at, completed_at`. `iteration_count` is the counter for
   the bounded guardrail repair loop; `idempotency_key UNIQUE` is the native dedupe
   mechanism.
9. **`travel_preferences` has typed columns**, not a generic category/priority table:
   `available_dates jsonb, destinations jsonb, travel_style text, budget numeric(12,2),
   interests jsonb, activities jsonb, hard_constraints jsonb`. Must-have versus optional
   activity priority is encoded as objects inside the `activities` jsonb array. Persona data
   lives in `characters.appearance jsonb` plus these columns.
10. **`messages`:** `sender_type(user|ai)`, `sender_member_id` (must be NULL when
    `sender_type = 'ai'`, enforced by CHECK), `kind(text|recommendation|vote|summary)`,
    `content jsonb`.
11. **`trip_status` enum** drives the ten application states: `trip_created, group_formed,
    preferences_collected, destination_selected, flight_selected, itinerary_generated,
    feedback_collected, refinement_completed, trip_approved, trip_exported`.
12. **`selections UNIQUE(room_id, kind)`** with `kind` in `destination | flight` — one locked
    selection of each kind per room. AI outputs are proposals; the party's vote determines
    the locked selection.
13. **`vote_sessions.status` is `open | closed` only.** There is no tie representation in
    the schema or the contracts (see Assumptions).

### Verified frontend contract facts this spec is built on

The frontend's actual TypeScript service/type layer (`frontend/src/types/*.ts`,
`frontend/src/services/*.contract.ts`) is now also treated as fixed input, on the same
footing as the live DB schema — not the aspirational prose in `api-contracts.md` alone.
These facts were verified directly against that source and, where they conflict with
`api-contracts.md` or the live schema, are noted as gaps rather than treated as
authoritative.

1. **`ItineraryVersion` (`frontend/src/types/itinerary.ts`) has no `id` field and no
   `status` field.** It uses `isCurrent: boolean` instead of the
   `proposed | approved | rejected | superseded` status enum that both
   `api-contracts.md`'s "Itinerary Versioning" section and the live `itinerary_status` enum
   define.
2. **`ItineraryItem` (same file) has no `id` field.** `api-contracts.md` states the item
   `id` is stable across versions so feedback can target a specific activity; without an
   `id` in the frontend type, feedback cannot address one item over another today.
3. **`FeedbackInput`/`Feedback` (`frontend/src/types/feedback.ts`) has `target: string`.**
   This is a flat string, not the structured `{ day?, itemId?, section? }` object
   `api-contracts.md` and this spec's Requirement 10 assume.
4. **`Guest` (`frontend/src/types/guest.ts`) documents `id` as client-generated.** This
   contradicts `supabase-architecture.md` and `api-contracts.md`'s Guest Identity Flow
   section, both of which state the client never creates identity UUIDs.
5. **`RoomMember` (`frontend/src/types/room.ts`) has no `displayName` field.**
   `characterId` also does not correspond to any live DB column on `room_members` in the
   direction the frontend type implies.
6. **`PartyRoom.status` (same file) is typed as bare `string`, not the `room_status`
   enum** (`active | finalised | cancelled`).
7. **`VoteSession` (`frontend/src/types/vote.ts`) has no `messageId` field, and
   `CastVoteInput` (`frontend/src/services/vote.contract.ts`) uses `guestId`, not
   `memberId`.** Both `api-contracts.md` and the DB's `votes.member_id` say member, not
   guest.
8. **All four real service implementations are unimplemented placeholders.**
   `chat.api.ts`, `vote.api.ts`, `itinerary.api.ts`, and `room.api.ts` each throw
   `NotImplementedError` from every method. Zero real frontend-backend integration exists
   yet, mirroring the backend-side state spec 02's task list already showed.

Where the frontend type, `api-contracts.md`, and the DB schema disagree, this spec writes
agent output to satisfy the DB schema and note the frontend gap, never to satisfy a
frontend type that has drifted from both.

### Inherited architecture rules

Carried forward from spec 02 and the steering files, and binding on this spec:

- Three-layer architecture: routes → services → repositories. Dependencies are wired with
  FastAPI `Depends()`.
- All Supabase access is isolated to the repository layer. The agent layer reaches Supabase
  only through repositories, never directly.
- All error responses conform to `{"error": {"code": "...", "message": "..."}}`. No raw
  Supabase payloads, SQL, service-role key values, LLM prompts, or Python stack traces
  appear in any response body.
- LangGraph is never the source of truth for trip data. It loads current trip context from
  Supabase and returns proposals to be persisted.

---

## Glossary

- **Agent_Layer**: The LangGraph-based AI orchestration code owned by Dev C, living under
  `backend/app/agents/`, invoked by the `Service_Layer`.
- **Agent_Graph**: The compiled LangGraph `StateGraph` containing the `Orchestrator_Node`
  and the specialist nodes.
- **Orchestrator_Node**: The routing node that reads the current trip state and dispatches
  to exactly one specialist node per run.
- **Specialist_Node**: One of `Discovery_Node`, `Logistics_Node`, `Itinerary_Node`, or
  `Negotiation_Node`.
- **Discovery_Node**: The specialist node for the DISCOVER stage. Performs group profile
  reasoning internally and proposes destination options.
- **Group_Profile**: The derived, in-memory aggregate of the party's `characters.appearance`
  and `travel_preferences` rows (combined dates, budget ceiling, shared interests, union of
  hard constraints). It is a computed value inside a `discovery` run, not a persisted entity
  and not its own `agent_runs` row.
- **Availability_Overlap**: The date-range intersection of `travel_preferences.available_dates`
  across the members who supplied at least one range. It is empty when those members share no
  common dates.
- **Budget_Ceiling**: The lowest non-NULL `travel_preferences.budget` value among the party's
  rows. It is treated as unconstrained when every one of those rows has a NULL `budget`.
- **Logistics_Node**: The specialist node for the LOGISTICS stage. Proposes ranked flight /
  travel options.
- **Itinerary_Node**: The specialist node for the BUILD stage. Produces itinerary version 1
  with `source = 'build'`.
- **Negotiation_Node**: The specialist node for the REFINE stage. Analyses `feedback` rows,
  identifies conflicts, proposes compromises, and routes regeneration to the affected
  specialist node.
- **Agent_State**: The typed LangGraph state object passed between nodes during a single run.
- **Agent_Run**: A row in `agent_runs` representing one agent execution.
- **Run_Type**: The `agent_run_type` enum value of an `Agent_Run`: `discovery`, `logistics`,
  `itinerary`, or `refinement`.
- **Base_Version**: `agent_runs.base_version` — the itinerary version number the run started
  from (`0` when no itinerary version exists yet).
- **Version_Lock**: The optimistic concurrency mechanism formed by
  `itinerary_versions UNIQUE(trip_id, version)` and `Base_Version`: a run inserts
  `version = base_version + 1` and treats a uniqueness violation as a lost race.
- **Lost_Race**: The outcome where an `itinerary_versions` insert fails the
  `UNIQUE(trip_id, version)` constraint because another run committed that version first.
- **Idempotency_Key**: `agent_runs.idempotency_key` — a caller-supplied unique string used to
  deduplicate repeated trigger requests.
- **Active_Run**: An `agent_runs` row whose `status` is `pending` or `running`.
- **Proposal**: The structured output of a `Specialist_Node` before persistence — a
  recommendation set, a vote session payload, or an itinerary object.
- **Structural_Guardrail**: Guardrail layer 1 — Pydantic v2 validation of a `Proposal`'s
  shape and types.
- **Business_Guardrail**: Guardrail layer 2 — deterministic, non-LLM Python checks (budget
  ceiling, date bounds, travel-time feasibility, mandatory hard constraints, iteration cap,
  tool-call cap).
- **Factual_Guardrail**: Guardrail layer 3 — validation of factual claims against external
  tool responses, which are authoritative over model output.
- **Factual_Field**: A `Proposal` field whose value must come from an `External_Tool` response
  rather than the model, enumerated in Requirement 13 AC 2. Its complement is a narrative
  field, to which no factual check applies.
- **Repair_Loop**: The bounded retry cycle in which a guardrail failure is fed back to the
  producing node for correction, counted in `agent_runs.iteration_count`.
- **Iteration_Cap**: The maximum number of `Repair_Loop` iterations permitted for a single
  `Agent_Run`.
- **Tool_Call_Cap**: The maximum number of external tool invocations permitted for a single
  `Agent_Run`.
- **Human_Escalation**: The outcome where guardrails cannot be satisfied within the
  `Iteration_Cap` and the `Agent_Layer` emits an NPC `messages` row asking the party for a
  decision or relaxed constraint instead of persisting a `Proposal`.
- **External_Tool**: A non-LLM data source invoked by the `Agent_Layer` — flight search,
  places/attractions lookup, or weather lookup.
- **NPC_Message**: A row in `messages` with `sender_type = 'ai'` and
  `sender_member_id = NULL`.
- **Progress_Message**: An `NPC_Message` with `kind = 'text'` used to communicate that the
  agent is working, because `agent_runs` is not realtime-published.
- **Progress_Flag**: The `content.progress = true` marker on a `Progress_Message`. It exists
  because `message_kind` has no `progress` value, so a progress message is distinguished
  inside `content` rather than by `kind`.
- **Affected_Scope**: The set of itinerary days and item ids that an accepted refinement
  resolution changes. A `Proposal` carries its own `Affected_Scope`, which is the set of days
  and item ids that `Proposal` would change relative to the base version it was generated
  from; that set is what a `Lost_Race` re-evaluation compares against a re-fetched version.
- **Unaffected_Scope**: The complement of `Affected_Scope` within an itinerary — content that
  must carry into the new version unchanged.
- **Tiebreak_Flow**: The deterministic, non-LLM code path that resolves an exact tie in vote
  counts.
- **Option_Index_Rule**: The deterministic tiebreak rule — when two or more options tie on the
  highest vote count, the winner is the tied option at the lowest zero-based index in the
  persisted `vote_sessions.options` array. Chosen because it is recomputable from persisted
  data alone, with no random or clock-dependent input.
- **Status_Rank**: The ordinal position of a `trip_status` value in the ten-value progression,
  used for the forward-only comparison in Requirement 18: 1 `trip_created` through
  10 `trip_exported`.
- **Refine_Loop_Transition**: The single permitted lower-rank `trips.status` move —
  `refinement_completed` → `feedback_collected` while `party_rooms.planning_stage` is
  `refine`. It may recur.
- **Trip_Context**: The set of Supabase records an agent run reads for a trip: the
  `party_rooms` row, `room_members`, `characters`, `travel_preferences`, `selections`,
  `trips`, the latest `itinerary_versions` row, and open `feedback` rows.
- **Service_Layer**, **Repository_Layer**, **Route_Layer**, **DI_Container**,
  **API_Error_Response**, **Domain_Exception**, **Service_Role_Key**: as defined in
  `.kiro/specs/02-backend-core/requirements.md`.

---

## Requirements

### Requirement 1: Agent Graph Topology

**User Story:** As Dev C, I want a single LangGraph graph with an orchestrator and four
specialist nodes mapped to the planning stages, so that every AI operation follows one
auditable execution path.

#### Acceptance Criteria

1. THE `Agent_Layer` SHALL define exactly one compiled `Agent_Graph`, compiled once per
   process at import or startup and reused for every `Agent_Run`, containing exactly five
   nodes: the `Orchestrator_Node`, `Discovery_Node`, `Logistics_Node`, `Itinerary_Node`, and
   `Negotiation_Node`.
2. THE `Agent_Graph` SHALL define a total mapping over the four `agent_run_type` enum values,
   each to exactly one entry `Specialist_Node`: `discovery` → `Discovery_Node`, `logistics` →
   `Logistics_Node`, `itinerary` → `Itinerary_Node`, `refinement` → `Negotiation_Node`, with
   no `Run_Type` mapped to more than one entry node and no additional `Run_Type` values
   recognised.
3. WHEN the `Agent_Graph` is invoked for an `Agent_Run`, THE `Orchestrator_Node` SHALL execute
   first, before any `Specialist_Node` executes, and SHALL perform exactly one dispatch to
   the entry `Specialist_Node` given by the AC 2 mapping for the run's `Run_Type`.
4. WHEN the `Orchestrator_Node` dispatches, THE `Orchestrator_Node` SHALL use the run's
   `Run_Type` as the sole determinant of the entry `Specialist_Node` and SHALL use the
   `Trip_Context` only to verify that the run's stage preconditions hold, never to select a
   different entry node.
5. IF the `Run_Type` of an `Agent_Run` is not one of `discovery`, `logistics`, `itinerary`, or
   `refinement`, THEN THE `Agent_Layer` SHALL raise a `Domain_Exception` before any
   `Specialist_Node` executes and SHALL NOT write to `messages`, `vote_sessions`,
   `selections`, `itinerary_versions`, `feedback`, or `trips` for that operation.
6. IF the `Trip_Context` shows the stage precondition for the run's `Run_Type` is unmet, THEN
   THE `Orchestrator_Node` SHALL fail the run with a `Domain_Exception` whose message
   indicates the missing prerequisite and SHALL NOT dispatch to any `Specialist_Node`.
7. THE `Discovery_Node` SHALL compute the `Group_Profile` as an internal step within the
   `discovery` run and SHALL NOT create a separate `agent_runs` row for group profile
   reasoning.
8. THE `Agent_Layer` SHALL place the `Agent_Graph`, its nodes, and its state definition under
   `backend/app/agents/` and SHALL expose the graph to the `Service_Layer` through exactly one
   public callable entry point that accepts the run identity and returns the run outcome.
9. THE `Agent_Layer` SHALL be invoked only by the `Service_Layer` and SHALL NOT be imported
   by the `Route_Layer` or the `Repository_Layer`.
10. THE `Agent_Layer` SHALL read and write Supabase data only through `Repository_Layer`
    methods and SHALL NOT import or call the Supabase client directly.
11. WHILE the SETUP stage is active, THE `Agent_Layer` SHALL emit guidance `NPC_Message` rows
    without creating an `agent_runs` row, because SETUP performs no generation covered by the
    `agent_run_type` enum.
12. WHILE the WRAP stage is active, THE `Agent_Layer` SHALL produce the final summary from the
    single `itinerary_versions` row whose `status` is `approved` and SHALL NOT insert a new
    `itinerary_versions` row.
13. WHILE the WRAP stage is active, IF no `itinerary_versions` row for the trip has
    `status = 'approved'`, THEN THE `Agent_Layer` SHALL fail with a `Domain_Exception`
    indicating that no approved itinerary version exists and SHALL NOT emit a final summary
    `NPC_Message`.

---

### Requirement 2: Agent State Definition

**User Story:** As Dev C, I want an explicitly typed `Agent_State` that separates
run-identity fields fixed by the `agent_runs` row from fields internal to graph execution,
so that persisted state and transient state are never confused.

#### Acceptance Criteria

1. THE `Agent_Layer` SHALL define `Agent_State` as a single Pydantic v2 model whose declared
   fields are partitioned into a run-identity group and an execution-internal group, with
   every declared field assigned to exactly one of the two groups and no field assigned to
   both or to neither.
2. THE run-identity group of `Agent_State` SHALL contain exactly the seven fields `run_id`,
   `trip_id`, `run_type`, `base_version`, `created_by_member_id`, `idempotency_key`, and
   `iteration_count`, each corresponding to a column of the run's `agent_runs` row, and SHALL
   contain no other field.
3. THE execution-internal group of `Agent_State` SHALL contain exactly the eight fields
   holding the loaded `Trip_Context`, the `Group_Profile`, the current `Proposal`,
   accumulated guardrail findings, external tool responses, the tool-call count, the pending
   `NPC_Message` payloads, and the current `Repair_Loop` feedback, and SHALL contain no other
   field.
4. WHILE an `Agent_Run` is executing, THE `Agent_Layer` SHALL reject any write that changes
   the value of `run_id`, `trip_id`, `run_type`, `created_by_member_id`, or
   `idempotency_key` in `Agent_State` after the state is constructed, and SHALL permit a
   change to `base_version` only through the `Lost_Race` re-evaluation path and to
   `iteration_count` only through the `Repair_Loop` increment path.
5. IF a node attempts to write a value to `run_id`, `trip_id`, `run_type`,
   `created_by_member_id`, or `idempotency_key` in `Agent_State` that differs from the value
   set at construction, THEN THE `Agent_Layer` SHALL raise a `Domain_Exception` indicating an
   attempted mutation of a run-identity field, SHALL leave every `Agent_State` field
   unchanged, and SHALL NOT perform any `Repository_Layer` write for that node execution.
6. THE `Agent_Layer` SHALL accumulate the guardrail-findings, external-tool-response, and
   pending-`NPC_Message` fields of the execution-internal group by appending each node's
   output to the existing list in node execution order, SHALL replace every other
   execution-internal field with the writing node's value, and SHALL bound the accumulating
   lists at 100 guardrail findings, external tool responses equal in count to the
   `Tool_Call_Cap`, and 20 pending `NPC_Message` payloads.
7. IF an append to an accumulating execution-internal field would exceed the bound stated in
   criterion 6, THEN THE `Agent_Layer` SHALL fail the run with a `Domain_Exception`
   indicating the exceeded state bound and SHALL NOT discard, truncate, or overwrite the
   already-accumulated entries.
8. THE `Agent_Layer` SHALL treat every field in the execution-internal group as
   non-authoritative, meaning that for each such field the value written to Supabase SHALL be
   derived from a `Repository_Layer` read or an `External_Tool` response obtained within the
   writing node execution, and SHALL NOT be taken from the carried `Agent_State` value alone.
9. WHEN a node writes a value to `Agent_State` that also exists as an `agent_runs` column,
   THE `Agent_Layer` SHALL persist that value to the `agent_runs` row through the
   `Repository_Layer` before that node returns control to the `Agent_Graph`.
10. IF a node's `agent_runs` persistence under criterion 9 fails, THEN THE `Agent_Layer`
    SHALL fail the run with a `Domain_Exception` indicating that run state could not be
    persisted and SHALL NOT dispatch to a further node with the unpersisted `Agent_State`
    value.
11. IF `Agent_State` construction receives a `run_id`, `trip_id`, or `created_by_member_id`
    that is not a valid UUID string, a `run_type` outside the `agent_run_type` enum, a
    `base_version` below 0, an `iteration_count` below 0 or above the `Iteration_Cap`, or a
    non-NULL `idempotency_key` that is empty, whitespace-only, or longer than 200 characters,
    THEN THE `Agent_Layer` SHALL raise a `Domain_Exception` naming the invalid field before
    invoking any node.

---

### Requirement 3: Agent Run Lifecycle

**User Story:** As Dev C, I want every agent-triggered write to be bracketed by an
`agent_runs` row with recorded status and timestamps, so that every AI operation is
observable and attributable after the fact.

#### Acceptance Criteria

1. WHEN the `Service_Layer` receives a trigger for an agent operation, THE `Service_Layer`
   SHALL create an `agent_runs` row with `status = 'pending'`, the resolved `trip_id`, the
   `run_type`, `created_by_member_id` set to the `room_members.id` of the triggering member,
   `base_version` set to the current latest `itinerary_versions.version` for the trip or `0`
   when the trip has no itinerary version, `iteration_count = 0`, and `result_version_id`,
   `started_at`, `completed_at`, and `error` all NULL, before invoking the `Agent_Graph`.
2. WHEN the `Agent_Graph` begins executing for an `Agent_Run` whose current `status` is
   `'pending'`, THE `Agent_Layer` SHALL update that run's `status` to `'running'` and set
   `started_at` to the current timestamp in a single update, and SHALL NOT overwrite an
   already non-NULL `started_at`.
3. WHEN an `Agent_Run` completes and its `Proposal` has been persisted, THE `Agent_Layer`
   SHALL update that run's `status` to `'completed'`, set `completed_at` to the current
   timestamp, and leave `error` NULL.
4. WHERE the `Run_Type` is `discovery` or `logistics`, THE `Agent_Layer` SHALL leave
   `result_version_id` as NULL, because those runs produce no itinerary version.
5. IF an `Agent_Run` fails at any `Specialist_Node`, at any `Repository_Layer` write, or by
   exceeding its `Iteration_Cap`, THEN THE `Agent_Layer` SHALL update that run's `status` to
   `'failed'`, set `completed_at` to the current timestamp, leave `started_at` unchanged, and
   write a non-empty display-safe summary string to `agent_runs.error` that names the stage or
   operation that failed.
6. THE value written to `agent_runs.error` SHALL be a non-empty string of at most 500
   characters and SHALL exclude `Service_Role_Key` values, raw Supabase error payloads, SQL
   text, LLM prompt text, and Python stack traces.
7. THE `Agent_Layer` SHALL restrict `agent_runs.status` transitions to `pending → running`,
   `running → completed`, `running → failed`, and `pending → failed`, and SHALL NOT write a
   `status` value equal to the row's current `status`.
8. IF a trigger arrives for a `trip_id` and `run_type` whose most recent `Agent_Run` has
   `status` of `pending` or `running` and whose `started_at` — or `created_at` when
   `started_at` is NULL — is more than 300 seconds before the current timestamp, THEN THE
   `Service_Layer` SHALL update that run's `status` to `'failed'`, set `completed_at` to the
   current timestamp, and write an `error` summary indicating the run was interrupted, before
   creating a new `agent_runs` row.
9. THE `Agent_Layer` SHALL confirm that the `agent_runs` row is persisted before performing
   any write to `messages`, `vote_sessions`, `selections`, `itinerary_versions`, `feedback`,
   or `trips` for that operation.
10. WHEN an `Agent_Run` of type `itinerary` or `refinement` has successfully inserted an
    `itinerary_versions` row, THE `Agent_Layer` SHALL set that run's `result_version_id` to
    the `id` of the inserted `itinerary_versions` row in the same update that sets
    `status = 'completed'`.
11. IF a `status` update is attempted for an `Agent_Run` whose current `status` is not the
    allowed predecessor of the target `status` under criterion 7, THEN THE `Agent_Layer` SHALL
    reject the update, SHALL leave every column of that `agent_runs` row unchanged, and SHALL
    surface an error to the caller indicating an invalid run status transition.

---

### Requirement 4: Idempotent Run Triggering

**User Story:** As Dev C, I want repeated trigger requests to return the existing run rather
than starting a duplicate, so that a retried request or a double-clicked action does not
produce two competing generations.

#### Acceptance Criteria

1. WHEN a trigger request carries an `idempotencyKey` of 1 to 200 characters that matches no
   existing `agent_runs.idempotency_key` value, THE `Service_Layer` SHALL write that exact
   value to `agent_runs.idempotency_key` on the created run row before invoking the
   `Agent_Graph`.
2. WHEN a trigger request carries an `idempotencyKey` that already exists in
   `agent_runs.idempotency_key` on a row whose `trip_id` and `run_type` both equal those
   resolved for the request, THE `Service_Layer` SHALL return that existing `Agent_Run`
   unmodified whatever its `status` is (`pending`, `running`, `completed`, or `failed`), and
   SHALL NOT create a second run row or invoke the `Agent_Graph`.
3. THE `Service_Layer` SHALL rely on the `agent_runs.idempotency_key` UNIQUE constraint as
   the deduplication mechanism and SHALL NOT maintain a separate agent-layer deduplication
   store.
4. WHEN a trigger request either carries no `idempotencyKey` or carries one matching no
   existing `agent_runs.idempotency_key` value, and the resolved `trip_id` and `run_type`
   already have an `Active_Run`, THE `Service_Layer` SHALL return that `Active_Run` and SHALL
   NOT create a new run row or invoke the `Agent_Graph`.
5. IF an insert of a new `agent_runs` row violates the `agent_runs.idempotency_key` UNIQUE
   constraint, THEN THE `Service_Layer` SHALL perform exactly one re-read of the row matching
   that `idempotency_key` and return that `Agent_Run` when the re-read finds a row, and SHALL
   raise a `Domain_Exception` producing an `API_Error_Response` indicating that the trigger
   could not be resolved when the re-read finds no row, in both cases without surfacing the
   raw database error.
6. THE `Agent_Run` representation returned to the caller SHALL contain exactly the fields
   `id`, `tripId`, `runType`, `status`, `baseVersion`, optional `resultVersionId`, and
   optional `error`, matching the "AI Runs" shape in `api-contracts.md`, and SHALL NOT expose
   `idempotency_key`, `created_by_member_id`, `iteration_count`, `started_at`, or
   `completed_at`.
7. IF a trigger request carries an `idempotencyKey` that exists on an `agent_runs` row whose
   `trip_id` or `run_type` differs from the values resolved for the request, THEN THE
   `Service_Layer` SHALL raise a `Domain_Exception` producing an `API_Error_Response`
   indicating an idempotency key conflict, SHALL NOT create a run row, SHALL NOT invoke the
   `Agent_Graph`, and SHALL NOT return the other row's `Agent_Run`.
8. IF a trigger request carries an `idempotencyKey` that is empty, whitespace-only, or longer
   than 200 characters, THEN THE `Service_Layer` SHALL raise a `Domain_Exception` producing an
   `API_Error_Response` indicating an invalid idempotency key and SHALL NOT create an
   `agent_runs` row.
9. WHEN a trigger request carries no `idempotencyKey`, THE `Service_Layer` SHALL leave
   `agent_runs.idempotency_key` NULL on the created run row.

---

### Requirement 5: Itinerary Version Optimistic Lock

**User Story:** As Dev C, I want itinerary writes protected by version uniqueness so that two
concurrent runs can never overwrite each other's work or leave a gap in version history.

#### Acceptance Criteria

1. WHEN an `Agent_Run` of type `itinerary` or `refinement` persists a `Proposal`, THE
   `Agent_Layer` SHALL insert a new `itinerary_versions` row whose `version` equals the value
   of that run's `agent_runs.base_version` at insert time plus 1, so that a run with
   `base_version = 0` inserts `version = 1` and a run with `base_version = n` inserts
   `version = n + 1`.
2. THE `Agent_Layer` SHALL insert new `itinerary_versions` rows and SHALL NOT issue an
   UPDATE to the `itinerary` column of an existing `itinerary_versions` row.
3. IF the `itinerary_versions` insert fails the `UNIQUE(trip_id, version)` constraint, THEN
   THE `Agent_Layer` SHALL treat the outcome as a `Lost_Race`, SHALL NOT re-attempt an insert
   using the same `version` value, and SHALL NOT issue any UPDATE or DELETE against the row
   that already holds that `(trip_id, version)` pair.
4. WHEN a `Lost_Race` occurs, THE `Agent_Layer` SHALL re-fetch the trip's
   `itinerary_versions` row with the highest `version` and SHALL classify the `Proposal` as no
   longer applicable when any of the following holds, and as still applicable otherwise: the
   re-fetched version's content differs from the base version within the `Proposal`'s
   `Affected_Scope`; every `feedback` row the `Proposal` addresses now has
   `status = 'addressed'`; or the `selections` row for `kind = 'destination'` or
   `kind = 'flight'` differs from the values the `Proposal` was generated against.
5. WHEN a `Lost_Race` occurs, THE `Agent_Layer` SHALL update `agent_runs.base_version` to the
   `version` of the re-fetched highest `itinerary_versions` row before attempting any further
   insert for that run.
6. IF a `Lost_Race` re-evaluation classifies the `Proposal` as no longer applicable, THEN THE
   `Agent_Layer` SHALL complete the run with `status = 'completed'`, SHALL leave
   `result_version_id` NULL, SHALL leave every existing `itinerary_versions` row unchanged,
   and SHALL emit exactly one `NPC_Message` with `kind = 'text'` stating that the party's plan
   already moved on.
7. THE `Agent_Layer` SHALL write `source = 'build'` on an inserted `itinerary_versions` row if
   and only if that row's `version` equals 1, and SHALL write `source = 'refine'` on every
   inserted row whose `version` is greater than 1, satisfying
   `CHECK ((version = 1) = (source = 'build'))`.
8. THE `Agent_Layer` SHALL write `status = 'proposed'` on every newly inserted
   `itinerary_versions` row and SHALL NOT write `approved`, `rejected`, or `superseded` as the
   `status` value of an inserted row.
9. WHEN an `itinerary_versions` insert succeeds for a trip that has one or more other rows
   with `status = 'proposed'` and a lower `version`, THE `Agent_Layer` SHALL set each of those
   lower-`version` `proposed` rows to `status = 'superseded'` after the insert commits, and
   SHALL NOT change the `status` of any row whose `status` is `approved` or `rejected`.
10. IF a status write by the `Agent_Layer` would leave more than one `itinerary_versions` row
    per trip with `status = 'approved'`, violating `uq_itinerary_versions_one_approved`, THEN
    THE `Agent_Layer` SHALL abandon that write, leave all `itinerary_versions` rows unchanged,
    and fail the run with a `Domain_Exception`.
11. WHILE a single `Agent_Run` is executing, THE `Agent_Layer` SHALL permit at most 2
    `Lost_Race` re-evaluation cycles for that run.
12. IF a third `Lost_Race` occurs within the same `Agent_Run`, THEN THE `Agent_Layer` SHALL
    stop attempting inserts, set that run's `status` to `'failed'`, leave `result_version_id`
    NULL, and write a display-safe summary to `agent_runs.error` indicating repeated version
    contention.
13. IF the `itinerary_versions` insert fails for a reason other than the
    `UNIQUE(trip_id, version)` constraint, THEN THE `Agent_Layer` SHALL NOT treat the outcome
    as a `Lost_Race`, SHALL NOT re-attempt the insert, and SHALL fail the run with
    `status = 'failed'`, `result_version_id` NULL, and a display-safe summary in
    `agent_runs.error`.

---

### Requirement 6: State Re-Fetch Discipline

**User Story:** As Dev C, I want nodes to re-read trip state from Supabase at entry rather
than trusting carried graph state, so that a long-running or resumed run never reasons over
stale data.

#### Acceptance Criteria

1. WHEN a `Specialist_Node` begins execution, THE node SHALL load the `Trip_Context` records
   it needs for the supplied `trip_id` from Supabase through the `Repository_Layer` before
   reading any `Trip_Context` value, and SHALL complete that load within 5 seconds.
2. THE `Agent_Layer` SHALL NOT use a `Trip_Context` value carried in `Agent_State` from an
   earlier node as the basis for a persisted write unless that value was re-loaded from
   Supabase inside the writing node during the same node execution.
3. WHEN a `Repair_Loop` iteration re-enters a node, THE node SHALL re-load the `Trip_Context`
   for that iteration before validating or re-generating output, for each of up to 3 repair
   iterations.
4. WHEN a run resumes after an interruption, THE resuming node SHALL discard every
   execution-internal field of `Agent_State` and re-load the `Trip_Context` from Supabase
   before producing any output.
5. THE `Agent_Layer` SHALL treat the LangGraph checkpointer as execution bookkeeping only, and
   SHALL NOT store in the checkpointer any value forming part of the trip's plan, decisions,
   or progress unless that same value is also persisted in Supabase.
6. IF the `Trip_Context` load finds no `trips` row for the supplied `trip_id`, THEN THE
   `Agent_Layer` SHALL fail the run with a `Domain_Exception` indicating the trip was not
   found, SHALL NOT emit any `NPC_Message`, SHALL NOT write any proposal, and SHALL leave all
   Supabase records for that `trip_id` unchanged.
7. IF a re-loaded `Trip_Context` shows the `party_rooms` row `status` as `cancelled` or
   `finalised`, THEN THE `Agent_Layer` SHALL abort the run with a `Domain_Exception`
   indicating the room is closed to further planning, SHALL NOT write any proposal, and SHALL
   leave all Supabase records for that `trip_id` unchanged.
8. IF a re-loaded `Trip_Context` shows the trip's recorded stage to be later than the stage
   the current run was started for, THEN THE `Agent_Layer` SHALL abort the run with a
   `Domain_Exception` indicating the trip has advanced past the run's stage, and SHALL NOT
   write any proposal.
9. IF the `Trip_Context` load fails or exceeds 5 seconds, THEN THE `Agent_Layer` SHALL retry
   the load at most 2 times and, if all attempts fail, SHALL fail the run with a
   `Domain_Exception` indicating the trip state could not be read, SHALL NOT emit any
   `NPC_Message`, and SHALL leave all Supabase records for that `trip_id` unchanged.

---

### Requirement 7: Discovery Node and Group Profile Reasoning

**User Story:** As a party member, I want the NPC to propose destinations that reflect our
combined preferences, so that the options we vote on are ones the whole party can live with.

#### Acceptance Criteria

1. WHEN the `Discovery_Node` executes, THE node SHALL load through the `Repository_Layer`
   every `room_members` row for the trip's room together with each of those members'
   `characters` and `travel_preferences` rows, and SHALL compute the `Group_Profile` from
   exactly those rows before producing any destination option.
2. THE `Group_Profile` computation SHALL derive the party's overlapping availability as the
   date-range intersection of `travel_preferences.available_dates` across every member whose
   `available_dates` contains at least one range, the combined interests as the union of all
   members' `travel_preferences.interests` and `travel_preferences.activities` entries, the
   travel styles as the set of distinct non-NULL `travel_preferences.travel_style` values, and
   the hard constraints as the union of all members' `travel_preferences.hard_constraints`
   entries, treating a member with a NULL or empty value for a given column as contributing
   nothing for that column.
3. THE `Group_Profile` computation SHALL derive the group budget ceiling as the lowest
   non-NULL `travel_preferences.budget` value among the party's rows, and SHALL treat the
   budget ceiling as unconstrained when every loaded row's `budget` is NULL.
4. THE `Group_Profile` SHALL be held only in the execution-internal group of `Agent_State`
   and SHALL NOT be written to any Supabase table.
5. WHEN the `Discovery_Node` assembles its candidate destination set, THE node SHALL seed that
   set with every distinct entry of `travel_preferences.destinations` across the party before
   adding any model-generated or `External_Tool`-sourced candidate.
6. WHEN the `Discovery_Node` produces destination options, THE node SHALL emit exactly one
   `NPC_Message` with `kind = 'recommendation'` whose `content` conforms to the recommendation
   shape in `api-contracts.md` with `category = 'destination'` and carries between 3 and 5
   destination items inclusive, each with an item id unique within that message.
7. WHEN the destination recommendation is emitted, THE `Agent_Layer` SHALL create exactly one
   `vote_sessions` row for the room with `status = 'open'`, a non-empty `question` of at most
   200 characters, an `options` array whose entry ids match the emitted recommendation item
   ids one-to-one, and `message_id` referencing the emitted recommendation message.
8. IF a `vote_sessions` row for the room already has `status = 'open'` and its `message_id`
   references a `category = 'destination'` recommendation message when a new destination
   recommendation is emitted, THEN THE `Agent_Layer` SHALL set that existing row's `status` to
   `'closed'` before inserting the new `vote_sessions` row, so that at most one open
   destination vote session exists per room.
9. THE `Discovery_Node` SHALL exclude from its proposed options every candidate destination
   that violates any entry in the `Group_Profile` hard constraints union or whose estimated
   per-member cost exceeds the `Group_Profile` budget ceiling.
10. IF no candidate destination remains after applying the hard constraints union and the
    budget ceiling, THEN THE `Discovery_Node` SHALL perform `Human_Escalation` by emitting one
    `NPC_Message` with `kind = 'text'` naming the constraint or budget ceiling that eliminated
    all candidates and asking the party to relax it, SHALL NOT emit any
    `kind = 'recommendation'` message, and SHALL NOT create a `vote_sessions` row.
11. IF the overlapping availability derived in the `Group_Profile` is empty, THEN THE
    `Discovery_Node` SHALL perform `Human_Escalation` by emitting one `NPC_Message` with
    `kind = 'text'` indicating that no shared dates exist and asking the party to widen their
    available dates, and SHALL NOT emit a destination recommendation or create a
    `vote_sessions` row for that run.
12. IF zero `travel_preferences` rows exist for the members of the trip's room, THEN THE
    `Discovery_Node` SHALL fail the run with a `Domain_Exception` indicating that preferences
    are not yet collected, SHALL leave `messages`, `vote_sessions`, and `selections` unchanged
    for that trip, and SHALL NOT compute a `Group_Profile`.

---

### Requirement 8: Logistics Node

**User Story:** As a party member, I want the NPC to propose flight options ranked against
our budget and dates, so that we can compare real, bookable choices.

#### Acceptance Criteria

1. WHEN the `Logistics_Node` executes, THE node SHALL load the trip's `selections` row with
   `kind = 'destination'` and the party's `travel_preferences` rows before producing any
   option.
2. IF no `selections` row with `kind = 'destination'` exists for the room, THEN THE
   `Logistics_Node` SHALL fail the run with a `Domain_Exception` indicating that no
   destination is locked, SHALL leave `messages`, `vote_sessions`, and `selections` unchanged
   for that trip, and SHALL NOT propose flight options.
3. WHEN the `Logistics_Node` produces flight options, THE node SHALL obtain the flight
   factual data from an `External_Tool` and SHALL NOT use model-generated values for price,
   airline, duration, stop count, or departure and return times.
4. WHEN the `Logistics_Node` emits its options, THE node SHALL emit exactly one `NPC_Message`
   with `kind = 'recommendation'`, `category = 'flight'`, between 3 and 5 flight items
   inclusive, each with an item id unique within that message, and per-item `meta` carrying
   the comparable fields defined in `api-contracts.md`.
5. WHEN the flight recommendation is emitted, THE `Agent_Layer` SHALL create exactly one
   `vote_sessions` row for the room with `status = 'open'`, a non-empty `question` of at most
   200 characters, an `options` array whose entry ids match the emitted recommendation item
   ids one-to-one, and `message_id` referencing the emitted recommendation message.
6. THE `Logistics_Node` SHALL exclude from its proposed options every flight option whose
   per-member price exceeds the `Budget_Ceiling`, and every flight option whose departure or
   return date falls outside the `Availability_Overlap`, applying no price exclusion when the
   `Budget_Ceiling` is unconstrained.
7. IF every flight option returned by the `External_Tool` is excluded by the checks in AC 6,
   THEN THE `Logistics_Node` SHALL perform `Human_Escalation` by emitting one `NPC_Message`
   with `kind = 'text'` naming the `Budget_Ceiling` or the `Availability_Overlap` as the
   constraint that eliminated all options and asking the party to relax it, SHALL NOT emit any
   `kind = 'recommendation'` message, and SHALL NOT create a `vote_sessions` row.
8. WHEN the `Logistics_Node` orders the items of its flight recommendation, THE node SHALL
   rank them by total per-member price ascending as the primary key, by total travel duration
   ascending as the first tie-breaker, and by stop count ascending as the second tie-breaker,
   and SHALL place the highest-ranked option first.
9. IF a `vote_sessions` row for the room already has `status = 'open'` and its `message_id`
   references a `category = 'flight'` recommendation message when a new flight recommendation
   is emitted, THEN THE `Agent_Layer` SHALL set that existing row's `status` to `'closed'`
   before inserting the new `vote_sessions` row, so that at most one open flight vote session
   exists per room.
10. IF the `Availability_Overlap` for the party is empty, THEN THE `Logistics_Node` SHALL
    perform `Human_Escalation` by emitting one `NPC_Message` with `kind = 'text'` indicating
    that no shared travel dates exist and asking the party to widen their available dates,
    SHALL NOT invoke the `External_Tool`, and SHALL NOT create a `vote_sessions` row for that
    run.
11. IF no departure origin can be resolved for the party, THEN THE `Logistics_Node` SHALL
    perform `Human_Escalation` asking the party where the journey begins, SHALL NOT invoke the
    flight `External_Tool`, and SHALL NOT infer an origin from model output or from the
    destination.

---

### Requirement 9: Itinerary Node (BUILD)

**User Story:** As a party member, I want the NPC to draft our first quest log from the
decisions we have locked in, so that we have a concrete plan to react to.

#### Acceptance Criteria

1. WHEN the `Itinerary_Node` executes, THE node SHALL load, before invoking generation, the
   room's `selections` row with `kind = 'destination'`, the room's `selections` row with
   `kind = 'flight'`, all `travel_preferences` rows for the room's party members, and the
   trip's `party_rooms` row.
2. THE `Itinerary_Node` SHALL produce an itinerary object conforming to the itinerary shape in
   `api-contracts.md`, containing `tripId`, `roomId`, `title`, `summary`, `destination`, and a
   non-empty `days` array in which every day carries a `day` number starting at 1 and
   incrementing by 1 with no gaps.
3. THE `Itinerary_Node` SHALL derive the number of entries in `days` as the inclusive count of
   calendar days between the outbound date and the return date recorded in the
   `kind = 'flight'` selection, and SHALL generate between 1 and 10 `items` for each day.
4. IF the `kind = 'flight'` selection carries no outbound date or no return date, THEN THE
   `Itinerary_Node` SHALL derive the number of entries in `days` as the inclusive calendar-day
   count of the party's availability overlap computed from the loaded `travel_preferences`
   rows.
5. IF the derived day count is less than 1 or greater than 30, THEN THE `Itinerary_Node` SHALL
   fail the run with a `Domain_Exception` indicating an out-of-range trip duration, SHALL set
   the `agent_runs` row `status` to `'failed'` with the failure recorded in `error`, and SHALL
   NOT insert an `itinerary_versions` row.
6. THE `Itinerary_Node` SHALL order the `items` of each day ascending by `time`, and SHALL
   place every item without a `time` after all timed items of that day in generation order.
7. THE `Itinerary_Node` SHALL insert the generated itinerary as exactly one
   `itinerary_versions` row with `version = 1`, `source = 'build'`, `status = 'proposed'`, and
   no `changeSummary`.
8. IF an `itinerary_versions` row already exists for the trip, THEN THE `Itinerary_Node` SHALL
   NOT run as a `build` generation, and THE `Service_Layer` SHALL route the request as a
   `refinement` run producing a `source = 'refine'` version with `version` equal to the
   highest existing `version` for the trip plus 1.
9. THE item `id` values produced by the `Itinerary_Node` SHALL be unique across all days of
   the itinerary object, so that a `feedback.target.itemId` resolves to exactly one item.
10. WHILE later `source = 'refine'` versions are generated for the same trip, THE
    `Agent_Layer` SHALL preserve the version 1 item `id` of every item that is carried forward
    unchanged or edited in place, and SHALL assign a new `id`, unused by any prior version of
    that trip, to every newly added item.
11. IF the `kind = 'destination'` selection row or the `kind = 'flight'` selection row is
    absent, THEN THE `Itinerary_Node` SHALL fail the run with a `Domain_Exception` naming the
    missing selection kind, SHALL set the `agent_runs` row `status` to `'failed'` with the
    failure recorded in `error`, and SHALL NOT insert an `itinerary_versions` row.
12. IF no `travel_preferences` row exists for any party member of the room, THEN THE
    `Itinerary_Node` SHALL fail the run with a `Domain_Exception` indicating absent party
    preferences and SHALL NOT insert an `itinerary_versions` row.
13. IF generation does not return an itinerary object conforming to the itinerary shape in
    `api-contracts.md` within 60 seconds, or fails validation on 2 consecutive attempts, THEN
    THE `Itinerary_Node` SHALL set the `agent_runs` row `status` to `'failed'` with the failure
    recorded in `error`, SHALL leave `trips.status` unchanged, and SHALL NOT insert an
    `itinerary_versions` row.
14. WHEN the `version = 1` row is persisted, THE `Agent_Layer` SHALL emit one `NPC_Message`
    with `kind = 'summary'` presenting the quest log and referencing the persisted itinerary
    version id.
15. WHEN the `version = 1` row is persisted, THE `Agent_Layer` SHALL set `trips.status` to
    `'itinerary_generated'`.
16. THE itinerary object and its version metadata that the `Itinerary_Node` persists and
    emits SHALL include `id` and `status` on the itinerary version and `id` on every
    itinerary item, per `api-contracts.md` and the DB schema, regardless of whether the
    frontend type it will eventually be deserialized into currently declares those fields —
    the `Agent_Layer`'s output contract is not narrowed by an out-of-sync consumer type.

---

### Requirement 10: Negotiation Node (REFINE)

**User Story:** As a party member, I want the NPC to analyse our feedback, propose a
compromise, and change only the parts of the plan the compromise touches, so that agreed
sections of the itinerary are not silently rewritten.

#### Acceptance Criteria

1. WHEN the `Negotiation_Node` executes, THE node SHALL load the trip's `itinerary_versions`
   row holding the highest `version` value for that trip as the base version, and SHALL load
   the trip's `feedback` rows with `status = 'open'` ordered by creation time ascending, up to
   a maximum of 50 rows in one run.
2. THE `Negotiation_Node` SHALL compute the `Affected_Scope` as the union of: every day number
   and item id named in the `target` of a loaded open `feedback` row; every item on those days
   whose scheduled time range overlaps the changed item's resulting time range; and the item
   immediately before and the item immediately after each changed item within the same day's
   ordered item list.
3. WHEN the `Negotiation_Node` builds the new itinerary object, THE node SHALL reproduce every
   day and item in the `Unaffected_Scope` with field values identical to the base version,
   including each item's `id`, its day number, and its position within that day's ordered item
   list, such that a field-by-field comparison of the `Unaffected_Scope` between the base
   version and the new version yields zero differences.
4. THE `Negotiation_Node` SHALL route regeneration only to the `Specialist_Node` that owns the
   `Affected_Scope` — `Itinerary_Node` where the `Affected_Scope` contains only itinerary days
   and items, `Logistics_Node` where it includes the locked flight or travel arrangement, and
   `Discovery_Node` where it includes the locked destination — and SHALL NOT invoke a
   `Specialist_Node` whose output lies entirely within the `Unaffected_Scope`.
5. WHEN the refined itinerary is persisted, THE `Agent_Layer` SHALL insert an
   `itinerary_versions` row with `version = base_version + 1`, `source = 'refine'`,
   `status = 'proposed'`, and a `change_summary` of 1 to 500 characters that names every day
   number and item id in the `Affected_Scope` and what changed for each relative to the base
   version.
6. WHEN a refined version is persisted, THE `Agent_Layer` SHALL set `status` to `'addressed'`
   for each loaded `feedback` row whose requested change is reflected in that version's
   `Affected_Scope`.
7. WHERE a loaded open `feedback` row's requested change is not reflected in the new version,
   THE `Agent_Layer` SHALL leave that row's `status` as `'open'` and SHALL state in the emitted
   `NPC_Message` the count of still-open rows and the `target` each one refers to.
8. WHEN two or more loaded open `feedback` rows name the same day number or item id in their
   `target` values and their requested outcomes cannot both be satisfied in one itinerary —
   including removal versus retention of the same item, and two different replacements for the
   same item — THE `Negotiation_Node` SHALL emit an `NPC_Message` with `kind = 'summary'`
   naming each conflicting `target` and the proposed compromise before inserting the new
   `itinerary_versions` row.
9. THE `Negotiation_Node` SHALL detect the conflicts defined in AC 8 with deterministic,
   non-LLM comparison of `feedback.target` values and requested outcomes, so that the same set
   of open `feedback` rows always yields the same conflict set.
10. THE `Agent_Layer` SHALL reconstruct refinement history from `itinerary_versions.version`
    ordering, `itinerary_versions.change_summary`, and `feedback` rows, and SHALL NOT depend
    on a parent-version reference.
11. WHEN the refined `itinerary_versions` insert succeeds, THE `Agent_Layer` SHALL set
    `trips.status` to `'refinement_completed'`.
12. IF the trip has no `itinerary_versions` row, THEN THE `Negotiation_Node` SHALL fail the run
    with a `Domain_Exception` indicating that no itinerary version exists to refine, SHALL NOT
    insert an `itinerary_versions` row, and SHALL leave every `feedback` row's `status` and
    `trips.status` unchanged.
13. IF no `feedback` row with `status = 'open'` exists for the trip, THEN THE
    `Negotiation_Node` SHALL complete the run with `agent_runs.status = 'completed'`,
    `result_version_id` NULL, SHALL NOT insert an `itinerary_versions` row, SHALL leave
    `trips.status` unchanged, and SHALL emit an `NPC_Message` stating that there is no
    outstanding feedback to negotiate.
14. IF a loaded open `feedback` row's `target` names a day number or item id absent from the
    base version, THEN THE `Negotiation_Node` SHALL exclude that row from the
    `Affected_Scope`, SHALL leave its `status` as `'open'`, SHALL state in the emitted
    `NPC_Message` that the referenced part of the plan could not be located, and SHALL continue
    processing the remaining open rows.
15. WHERE a `feedback` row's `target` was submitted by a client using a flat-string target
    shape rather than the structured shape, THE `Negotiation_Node` SHALL attempt to interpret
    the string as a single `itemId` or day-number reference by exact match against the base
    version, and IF no such match is found, THEN THE `Negotiation_Node` SHALL exclude that
    row from the `Affected_Scope` and leave its `status` as `'open'`, following the same
    not-found handling defined in criterion 14 for an unresolvable structured target.
16. THE itinerary object and its `change_summary`/version metadata that the
    `Negotiation_Node` persists and emits SHALL include `id` and `status` on every itinerary
    version and `id` on every itinerary item, per `api-contracts.md` and the DB schema,
    regardless of whether the frontend type it will eventually be deserialized into currently
    declares those fields — the `Agent_Layer`'s output contract is not narrowed by an
    out-of-sync consumer type.

---

### Requirement 11: Structural Guardrail (Layer 1)

**User Story:** As Dev C, I want every agent output validated against a Pydantic model before
anything is persisted, so that a malformed generation cannot reach the database.

#### Acceptance Criteria

1. THE `Agent_Layer` SHALL define exactly one Pydantic v2 model for each of the four
   `Proposal` kinds — destination recommendation set, flight recommendation set, itinerary
   object, and refinement result — with field names, types, and nullability matching
   `api-contracts.md`, and SHALL configure each model and every nested model it contains to
   reject unknown fields, so that a `Proposal` carrying any field absent from
   `api-contracts.md` fails validation.
2. THE `Agent_Layer` SHALL treat every field that `api-contracts.md` does not mark as nullable
   or optional as required in the corresponding Pydantic model, so that a `Proposal` omitting
   such a field or supplying NULL for it fails validation.
3. WHEN a `Specialist_Node` produces a `Proposal`, THE `Agent_Layer` SHALL run
   `Structural_Guardrail` validation on that `Proposal` first, SHALL run `Business_Guardrail`
   only on a `Proposal` that passed `Structural_Guardrail`, SHALL run `Factual_Guardrail` only
   on a `Proposal` that passed `Business_Guardrail`, and SHALL issue no `Repository_Layer`
   write for that `Proposal` until all three layers have passed.
4. THE `Structural_Guardrail` SHALL be implemented with no LLM invocation and no
   `External_Tool` call, such that the same `Proposal` validated against the same model
   produces an identical set of validation findings on every evaluation.
5. THE `Structural_Guardrail` SHALL report every validation error found in a single validation
   pass rather than stopping at the first error.
6. IF `Structural_Guardrail` validation fails, THEN THE `Agent_Layer` SHALL enter the
   `Repair_Loop`, SHALL increment `agent_runs.iteration_count` by exactly 1 for that
   validation pass irrespective of how many field-level errors it reported, and SHALL issue no
   `Repository_Layer` write for that `Proposal` to any Supabase table under any circumstance.
7. WHEN `Structural_Guardrail` validation fails, THE `Agent_Layer` SHALL supply to the
   producing node one finding per validation error, each naming the field path from the model
   root to the offending field, the expected type or constraint, and whether the field was
   missing, unknown, or wrongly typed.
8. THE `Structural_Guardrail` SHALL reject any `Proposal` whose value destined for a Supabase
   enum-typed column is not a member of that column's enum, covering `message_kind` (`text`,
   `recommendation`, `vote`, `summary`), `itinerary_source` (`build`, `refine`),
   `itinerary_status` (`proposed`, `approved`, `rejected`, `superseded`),
   `vote_session_status` (`open`, `closed`), `selection_kind` (`destination`, `flight`),
   `feedback_status` (`open`, `addressed`), `trip_status`, `agent_run_type`, and
   `agent_run_status`, before the write is attempted.
9. IF the LLM output for a `Proposal` cannot be parsed into the target Pydantic model at all
   because the output is not well-formed structured data, THEN THE `Agent_Layer` SHALL treat
   the failure as a `Structural_Guardrail` failure, SHALL enter the `Repair_Loop` with a
   finding identifying the failure as unparseable output rather than as field-level validation
   errors, and SHALL NOT report field paths for that failure.
10. THE `Repository_Layer` SHALL accept a `Proposal` for persistence only as an instance of the
    Pydantic model defined in criterion 1 for that `Proposal` kind, and SHALL reject any
    `Proposal` supplied as unvalidated data, so that the models are the single definition of
    `Proposal` shape shared by the producing node and the write path.

---

### Requirement 12: Business Rule Guardrail (Layer 2)

**User Story:** As Dev C, I want deterministic code, not the model, to enforce budget, dates,
feasibility, and hard constraints, so that compliance does not depend on the LLM behaving.

#### Acceptance Criteria

1. THE `Business_Guardrail` SHALL be implemented as deterministic Python functions with no
   LLM invocation, such that the same `Proposal` evaluated against the same `Trip_Context`
   produces an identical set of rejection findings on every evaluation.
2. THE `Business_Guardrail` SHALL reject any `Proposal` whose total costed value — the sum of
   the per-item costed values the `Proposal` carries, with an item that carries no costed
   value contributing 0 — exceeds the `Budget_Ceiling` derived from
   `travel_preferences.budget`.
3. THE `Business_Guardrail` SHALL reject any `Proposal` containing a date outside the
   `Availability_Overlap` derived from `travel_preferences.available_dates`, and SHALL treat
   every date in the `Proposal` as outside that overlap when the `Availability_Overlap` is
   empty.
4. THE `Business_Guardrail` SHALL reject any itinerary `Proposal` in which the travel time
   between consecutive items on the same day, taken from the `External_Tool` response recorded
   in `Agent_State` for that run, exceeds the gap between those items' scheduled times, and
   SHALL treat a consecutive pair whose travel time is absent from that response as exceeding
   the gap rather than estimating it from model output.
5. THE `Business_Guardrail` SHALL reject any `Proposal` that violates an entry in the union of
   all party members' `travel_preferences.hard_constraints`.
6. THE `Business_Guardrail` SHALL read activity priority from objects inside the
   `travel_preferences.activities` jsonb array and SHALL reject any itinerary `Proposal` that
   omits an activity marked as required there.
7. WHEN a `Business_Guardrail` evaluation rejects a `Proposal`, THE `Agent_Layer` SHALL enter
   the `Repair_Loop` and SHALL increment `agent_runs.iteration_count` by exactly 1 for that
   evaluation, irrespective of how many individual checks failed within it.
8. THE `Agent_Layer` SHALL enforce an `Iteration_Cap` on the `Repair_Loop` and SHALL stop
   looping when `agent_runs.iteration_count` equals the `Iteration_Cap`, leaving
   `agent_runs.iteration_count` at or below the `Iteration_Cap` at all times.
9. THE `Agent_Layer` SHALL enforce a `Tool_Call_Cap` per `Agent_Run` and SHALL stop invoking
   `External_Tool` calls for that run once the count of invocations in that run equals the
   `Tool_Call_Cap`.
10. THE `Iteration_Cap` and `Tool_Call_Cap` SHALL be configuration values read through
    `Settings` rather than literals embedded in node code, with an `Iteration_Cap` default of
    3 constrained to the integer range 1 to 10 inclusive and a `Tool_Call_Cap` default of 10
    constrained to the integer range 1 to 50 inclusive.
11. IF a `Proposal` fails any `Business_Guardrail` check, THEN THE `Agent_Layer` SHALL NOT
    persist that `Proposal` to any Supabase table under any circumstance.
12. THE `Business_Guardrail` SHALL evaluate the checks in criteria 2 through 6 in that fixed
    order for every `Proposal` without stopping at the first failing check, and SHALL return
    the findings of all failing checks from that single evaluation.
13. WHEN the `Business_Guardrail` rejects a `Proposal`, THE `Agent_Layer` SHALL supply to the
    producing node one rejection finding per failing check, each naming the check that failed,
    the identifier or field path of the offending `Proposal` element, and the bound or
    constraint value that was violated.
14. IF the `Budget_Ceiling` is unconstrained because every party `travel_preferences` row has
    a NULL `budget`, THEN THE `Business_Guardrail` SHALL record the criterion 2 check as
    passed and SHALL NOT emit a budget rejection finding.

---

### Requirement 13: Factual Guardrail (Layer 3)

**User Story:** As a party member, I want the flights, places, and weather in our plan to be
real, so that the itinerary is something we can actually book and follow.

#### Acceptance Criteria

1. THE `Agent_Layer` SHALL treat the `External_Tool` responses recorded in `Agent_State` for a
   run as authoritative over LLM output for every `Proposal` field classified as factual in
   criterion 2, such that any difference between an LLM-produced value and the corresponding
   `External_Tool` value is resolved to the `External_Tool` value.
2. THE `Factual_Guardrail` SHALL classify as factual exactly the following `Proposal` fields —
   for a flight option: carrier, flight identifier, origin, destination, departure date-time,
   arrival date-time, and price; for a place: identifier, name, latitude, longitude, and
   opening information; for a weather value: the date it applies to, temperature, and
   precipitation condition — and SHALL classify every other `Proposal` field, including NPC
   narrative text, flavour text, descriptions, titles, and reasoning text, as narrative and
   SHALL apply no factual check to a narrative field.
3. THE `Factual_Guardrail` SHALL determine whether a `Proposal` item corresponds to an
   `External_Tool` response entry only by exact, case-sensitive equality between the item's
   identifier field and the identifier carried by that entry in the `External_Tool` response
   recorded in `Agent_State` for that run, and SHALL NOT use name similarity, fuzzy matching,
   normalisation, or any other partial match.
4. THE `Factual_Guardrail` SHALL reject any `Proposal` containing a flight option that
   corresponds, under criterion 3, to no entry of the flight `External_Tool` response recorded
   in `Agent_State` for that run, and SHALL treat a flight option carrying no identifier or an
   empty identifier as corresponding to no entry.
5. THE `Factual_Guardrail` SHALL reject any itinerary `Proposal` containing a location that
   corresponds, under criterion 3, to no entry of the places `External_Tool` response recorded
   in `Agent_State` for that run, and SHALL treat a location carrying no identifier or an empty
   identifier as corresponding to no entry.
6. WHEN every item of a `Proposal` corresponds under criterion 3 to an `External_Tool` response
   entry and at least one factual field of an item differs from that entry's value, THE
   `Factual_Guardrail` SHALL overwrite each differing factual field with the `External_Tool`
   value before the `Proposal` is persisted, SHALL leave every narrative field unchanged, and
   SHALL record no rejection finding for that difference — the correspondence checks in
   criteria 4 and 5 being evaluated for all items first, so that no overwrite is performed for
   a `Proposal` that carries at least one rejection finding.
7. IF an `External_Tool` invocation returns an error or returns no response within the
   `Settings` per-call timeout defined in Requirement 19, THEN THE `Agent_Layer` SHALL fail the
   run with a `Domain_Exception` naming the `External_Tool` that could not be reached, SHALL
   NOT substitute any model-generated value for a factual field, and SHALL NOT persist the
   `Proposal` to any Supabase table.
8. IF an `External_Tool` invocation succeeds but returns zero entries, THEN THE `Agent_Layer`
   SHALL perform `Human_Escalation` naming the missing factual data and asking the party to
   relax or restate the constraint, SHALL NOT substitute any model-generated value for a
   factual field, and SHALL NOT persist the `Proposal` to any Supabase table.
9. THE `Agent_Layer` SHALL hold, in the external-tool-response field of the
   execution-internal group of `Agent_State` for the duration of the run only, the identity of
   the `External_Tool` response entry that each persisted factual value was taken from, SHALL
   reject any `Proposal` carrying a factual field for which no such source entry is held, and
   SHALL write no such provenance record to any Supabase table.

---

### Requirement 14: Guardrail Failure Escalation

**User Story:** As a party member, I want the NPC to ask us for a decision when it cannot
satisfy our constraints, so that we are never handed a silently broken plan.

#### Acceptance Criteria

1. WHEN a guardrail rejection occurs and `agent_runs.iteration_count` is strictly below the
   `Iteration_Cap`, THE `Agent_Layer` SHALL run exactly one `Repair_Loop` iteration that
   supplies the producing node the rejection reasons for that evaluation as a list of at most
   100 entries, each naming the failing check or field path, and SHALL NOT persist the rejected
   `Proposal`.
2. WHEN `agent_runs.iteration_count` equals the `Iteration_Cap` and the `Proposal` still fails
   a guardrail, THE `Agent_Layer` SHALL perform exactly one `Human_Escalation` for that run,
   SHALL NOT re-invoke the producing node again, SHALL leave `agent_runs.iteration_count` at
   the `Iteration_Cap`, and SHALL NOT persist the rejected `Proposal`.
3. WHEN performing `Human_Escalation`, THE `Agent_Layer` SHALL emit exactly one `NPC_Message`
   with `sender_type = 'ai'`, `sender_member_id = NULL`, and `kind = 'text'`, whose `content`
   names the constraint that could not be satisfied, contains exactly one question, and carries
   `content.stage` set to the run's current stage.
4. WHEN performing `Human_Escalation`, THE `Agent_Layer` SHALL set `content.options` on the
   emitted `NPC_Message` to an array of 2 to 4 `{ id, label }` entries inclusive, each `id`
   unique within that message and each `label` at most 80 characters naming one distinct way to
   relax the constraint, and SHALL NOT emit a `kind = 'recommendation'`, `kind = 'vote'`, or
   `kind = 'summary'` message and SHALL NOT create a `vote_sessions` row for that run.
5. WHEN the `Human_Escalation` `NPC_Message` write succeeds, THE `Agent_Layer` SHALL set the run
   `status` to `'completed'`, set `completed_at` to the current timestamp, leave `started_at`
   unchanged, leave `result_version_id` NULL, and leave `agent_runs.error` NULL — because the
   escalation is a delivered NPC request for a party decision rather than a technical failure,
   and the `status` enum offers no `'escalated'` value.
6. IF `Human_Escalation` cannot be completed, for example the `messages` write fails, THEN THE
   `Agent_Layer` SHALL set the run `status` to `'failed'`, set `completed_at` to the current
   timestamp, leave `started_at` unchanged, and write to `agent_runs.error` a non-empty
   display-safe string of at most 500 characters that names the stage or operation that failed
   and excludes `Service_Role_Key` values, raw Supabase error payloads, SQL text, LLM prompt
   text, and Python stack traces.
7. THE `Agent_Layer` SHALL perform no write to `itinerary_versions`, `selections`, or
   `trips.status` for any run that ends in `Human_Escalation` or in failure, leaving the values
   those columns held at run start unchanged.
8. WHEN a party member replies to an escalation message by selecting one of its
   `content.options` ids or by sending a typed message in that room, THE `Agent_Layer` SHALL
   treat that reply as a new trigger that creates a new `agent_runs` row with
   `iteration_count` at 0, and SHALL NOT resume or mutate the escalated run.
9. WHEN a trigger request carries an `idempotencyKey` equal to the
   `agent_runs.idempotency_key` of a run that ended in `Human_Escalation`, THE `Service_Layer`
   SHALL return that existing run unmodified and SHALL NOT create a second run row or invoke
   the `Agent_Graph`, so a retry after escalation requires either a different `idempotencyKey`
   or none.
10. WHEN the `Service_Layer` surfaces a failed run to an HTTP caller, THE `Backend_App` SHALL
    return an `API_Error_Response` envelope of the form
    `{"error": {"code": "...", "message": "..."}}` whose `message` is at most 500 characters
    and excludes LLM prompt text, raw `External_Tool` payloads, raw Supabase error payloads,
    SQL text, `Service_Role_Key` values, and stack traces.

---

### Requirement 15: NPC Message Emission

**User Story:** As a party member, I want the NPC to speak in character and ask one question
at a time, so that planning feels like a guided adventure rather than a form.

#### Acceptance Criteria

1. WHEN the `Agent_Layer` emits an `NPC_Message` for a run, THE `Agent_Layer` SHALL resolve the
   target `room_id` from the run's `trip_id` via the `Repository_Layer` and write the row with
   that `room_id`, `sender_type = 'ai'`, and `sender_member_id = NULL`, satisfying the
   `messages` CHECK constraint.
2. THE `Agent_Layer` SHALL set `messages.kind` to `'text'` for NPC dialogue,
   `'recommendation'` for comparable option sets, `'vote'` for vote session presentation, and
   `'summary'` for resolved decisions and plan summaries.
3. THE `content` jsonb of each `NPC_Message` SHALL conform to the shape defined for its `kind`
   in `api-contracts.md` and SHALL NOT exceed 16,384 bytes when serialized.
4. WHERE an `NPC_Message` with `kind = 'text'` asks the party a question, THE question text in
   `content` SHALL contain exactly one `?`-terminated sentence of at most 280 characters.
5. WHERE an `NPC_Message` with `kind = 'text'` offers quick replies, THE `content.options`
   SHALL be an array of 2 to 6 `{ id, label }` entries with unique `id` values and each `label`
   at most 40 characters.
6. THE `Agent_Layer` SHALL set `content.stage` on `kind = 'text'` messages to exactly one of
   the six stage identifiers (SETUP, DISCOVER, LOGISTICS, BUILD, REFINE, WRAP) so the frontend
   can drive the progress UI.
7. THE `Agent_Layer` SHALL write all `NPC_Message` rows through the `Repository_Layer` using
   the backend's service-role credentials.
8. THE `Agent_Layer` SHALL treat the text of any user-authored `messages` row as data to
   reason over and SHALL NOT execute instructions contained in that text as agent
   directives.
9. IF the `Agent_Layer` cannot resolve exactly one `room_id` for the run's `trip_id`, THEN THE
   `Agent_Layer` SHALL write no `messages` row for that turn and SHALL return an error
   indicating the room could not be resolved, leaving the run's stage unchanged.
10. WHEN a single agent turn emits more than one `NPC_Message`, THE `Agent_Layer` SHALL write at
    most 5 messages for that turn, in intended presentation order, each with a `created_at`
    value strictly greater than the previous message's by at least 1 millisecond.
11. IF a message in a turn fails the shape or size validation of criterion 3, or its write
    through the `Repository_Layer` fails, THEN THE `Agent_Layer` SHALL write the turn's messages
    in a single transaction that commits all of them or none, SHALL leave no partial turn
    visible to any reader, and SHALL return an error indicating the turn failed, leaving the
    run's stage unchanged.

---

### Requirement 16: Agent Progress Visibility Through Messages

**User Story:** As a party member, I want to see that the NPC is thinking while a long
generation runs, so that the room never looks frozen.

#### Acceptance Criteria

1. WHEN an `Agent_Run` status write of `'running'` has been persisted through the
   `Repository_Layer`, THE `Agent_Layer` SHALL emit exactly one `Progress_Message` for that
   run within 2 seconds of that persisted write and before dispatching to the run's first
   `Specialist_Node`.
2. THE `Agent_Layer` SHALL surface agent progress through `messages` rows and SHALL NOT rely
   on client subscriptions to `agent_runs`, which is not in the `supabase_realtime`
   publication.
3. THE `Agent_Layer` SHALL mark every `Progress_Message` as progress by setting
   `content.progress` to `true`, SHALL set `content.stage` to the current stage indicator, and
   SHALL omit `content.options` and any question from that `content`, so the frontend can
   distinguish it from ordinary `kind = 'text'` NPC dialogue.
4. IF the `Progress_Message` write for an `Agent_Run` fails, THEN THE `Agent_Layer` SHALL
   continue that run's execution unchanged, SHALL leave the run's `status` at `'running'`, and
   SHALL NOT retry the `Progress_Message` write for that run.
5. WHEN an `Agent_Run` reaches `status = 'completed'` having produced a persisted `Proposal`,
   THE `Agent_Layer` SHALL emit one `NPC_Message` carrying that run's outcome with
   `messages.kind` set to `'recommendation'`, `'vote'`, or `'summary'` according to
   Requirement 15 criterion 2.
6. WHEN an `Agent_Run` reaches `status = 'completed'` having persisted no `Proposal`, including
   a `Lost_Race` outcome and a `refinement` run with no outstanding `feedback`, THE
   `Agent_Layer` SHALL emit one `NPC_Message` with `kind = 'text'` stating in-world that the
   plan is unchanged and naming the reason as either another party action having already
   applied a change or there having been nothing left to change.
7. WHEN an `Agent_Run` reaches `status = 'failed'`, THE `Agent_Layer` SHALL emit one
   `NPC_Message` with `kind = 'text'` stating in-world that the attempt did not succeed and
   that the party may try again.
8. THE `Progress_Message` `content` SHALL contain at most 200 characters of display text and
   SHALL exclude `Service_Role_Key` values, LLM prompt text, raw `External_Tool` payloads, raw
   Supabase error payloads, SQL text, and stack traces.
9. THE `Agent_Layer` SHALL emit at most one `Progress_Message` per `Agent_Run` across all of
   that run's node dispatches and `Repair_Loop` iterations, so that the room transcript is not
   flooded.

---

### Requirement 17: Vote Resolution, Selections, and Tiebreak

**User Story:** As a party member, I want our vote to be what locks a decision in, so that
the NPC's proposals stay proposals until we choose.

#### Acceptance Criteria

1. WHEN a `vote_sessions` row resolves, THE `Service_Layer` SHALL, in one transaction that
   either commits both writes or neither, write the winning `option_id` and its option payload
   to `selections` with the `kind` matching the resolved session's category (`destination` for
   a session whose `message_id` references a destination recommendation, `flight` for a flight
   recommendation), `selections.vote_session_id` set to the resolved session's `id`, and set
   that `vote_sessions.status` to `'closed'`.
2. THE `Agent_Layer` SHALL treat `selections` rows as the authoritative locked decision and
   SHALL NOT override a `selections` row with a model preference.
3. WHERE a `selections` row already exists for a room and `kind`, THE `Service_Layer` SHALL
   update that row's `data` and `vote_session_id` rather than inserting a second one,
   consistent with `UNIQUE(room_id, kind)`.
4. WHEN a `selections` row with `kind = 'destination'` is written, THE `Service_Layer` SHALL
   set `trips.status` to `'destination_selected'`.
5. WHEN a `selections` row with `kind = 'flight'` is written, THE `Service_Layer` SHALL set
   `trips.status` to `'flight_selected'`.
6. WHEN a `vote_sessions` row resolves, THE `Service_Layer` SHALL compute each option's count
   as the number of `votes` rows for that `vote_session_id` whose `option_id` equals that
   option's id and whose `member_id` references a `room_members` row still present in the
   session's room, and SHALL treat the single option holding the strictly highest count as the
   winner.
7. IF two or more options hold an equal highest count when a `vote_sessions` row resolves,
   THEN THE `Tiebreak_Flow` SHALL select as winner the tied option appearing at the lowest
   zero-based index in the persisted `vote_sessions.options` array, in plain code, without
   invoking the `Agent_Graph` or an LLM, and without any random or clock-dependent input, so
   that re-running the rule over the same persisted `votes` and `options` rows yields the same
   winner every time.
8. THE `Tiebreak_Flow` SHALL trigger only on exact equality of the highest option counts as
   computed in criterion 6 and SHALL NOT trigger on mere overlap of party preferences.
9. WHEN the `Tiebreak_Flow` resolves a tie, THE `Agent_Layer` SHALL emit exactly one
   `NPC_Message` with `kind = 'summary'` naming the tied option ids, the tied count, the
   winning `option_id`, and the lowest-index rule that produced it.
10. THE `Agent_Layer` SHALL represent tie state only in the emitted `NPC_Message` content and
    SHALL NOT introduce a tie value into `vote_sessions.status`, which is limited to `open`
    and `closed`.
11. WHEN every `room_members` row of a room has a `votes` row for an `open` `vote_sessions`
    row of that room — a count comparison made exact by `UNIQUE(vote_session_id, member_id)`
    — THE `Service_Layer` SHALL resolve that session.
12. WHEN the `room_members` row with `role = 'owner'` for the room requests closure of an
    `open` `vote_sessions` row that already has at least one `votes` row, THE `Service_Layer`
    SHALL resolve that session using only the votes persisted at that moment.
13. IF a vote submission targets a `vote_sessions` row whose `status` is already `'closed'`,
    THEN THE `Service_Layer` SHALL reject the submission with an `API_Error_Response`
    indicating that voting on that session is closed, and SHALL leave `votes`, `selections`,
    and `trips.status` unchanged.

---

### Requirement 18: Trip Status Progression

**User Story:** As a party member, I want the progress indicator to reflect where we actually
are, so that the party knows what happens next.

#### Acceptance Criteria

1. THE `Agent_Layer` SHALL set `trips.status` only to values in the `trip_status` enum, whose
   ranks for all progression comparisons in this requirement are exactly: 1 `trip_created`,
   2 `group_formed`, 3 `preferences_collected`, 4 `destination_selected`, 5 `flight_selected`,
   6 `itinerary_generated`, 7 `feedback_collected`, 8 `refinement_completed`,
   9 `trip_approved`, 10 `trip_exported`.
2. WHEN a `travel_preferences` row is persisted such that the count of `room_members` rows for
   the room with at least one `travel_preferences` row equals the total count of `room_members`
   rows for that room, and that total count is at least 1, THE `Service_Layer` SHALL set
   `trips.status` to `'preferences_collected'` as part of the same persisted write.
3. WHEN a `feedback` row is persisted for the `itinerary_versions` row of the trip holding the
   highest `version`, and `trips.status` is `'itinerary_generated'`, THE `Service_Layer` SHALL
   set `trips.status` to `'feedback_collected'`.
4. WHEN a party approval decision marks an `itinerary_versions` row `status = 'approved'`,
   THE `Service_Layer` SHALL set `trips.status` to `'trip_approved'`.
5. WHEN the WRAP export payload is produced, THE `Service_Layer` SHALL set `trips.status` to
   `'trip_exported'`.
6. THE `Agent_Layer` SHALL advance `trips.status` only as a consequence of a persisted write
   and SHALL NOT advance it based on `Agent_State` alone.
7. IF a `trips.status` write would set a value whose rank (criterion 1) is lower than or equal
   to the rank of the trip's current `trips.status`, and that write is not the REFINE-loop
   transition defined in criterion 8, THEN THE `Service_Layer` SHALL leave `trips.status`
   unchanged and SHALL return a success response reporting the unchanged current
   `trips.status`.
8. WHILE `party_rooms.planning_stage` is `'refine'`, WHEN a `feedback` row is persisted for the
   trip's highest-`version` `itinerary_versions` row and `trips.status` is
   `'refinement_completed'`, THE `Service_Layer` SHALL set `trips.status` to
   `'feedback_collected'` as the single permitted lower-rank transition, and SHALL permit this
   transition to recur every time the condition holds.
9. WHEN an `itinerary_versions` row with `version` greater than 1 is persisted for the trip,
   THE `Service_Layer` SHALL set `trips.status` to `'refinement_completed'`.
10. THE `Service_Layer` SHALL be the sole writer of both `trips.status` and
    `party_rooms.planning_stage`, SHALL derive `party_rooms.planning_stage` from `trips.status`
    using exactly the mapping `trip_created`/`group_formed` → `'setup'`,
    `preferences_collected` → `'discover'`, `destination_selected` → `'logistics'`,
    `flight_selected` → `'build'`,
    `itinerary_generated`/`feedback_collected`/`refinement_completed` → `'refine'`,
    `trip_approved`/`trip_exported` → `'wrap'`, and SHALL write both fields in the same
    persisted write so no read observes one updated without the other.
11. WHEN a `room_members` row is persisted that brings the room's `room_members` count to 2,
    THE `Service_Layer` SHALL set `trips.status` to `'group_formed'`.

---

### Requirement 19: External Tool Integration

**User Story:** As Dev C, I want external data sources wrapped behind capped, typed tool
interfaces, so that agent runs cannot fan out into unbounded external calls.

#### Acceptance Criteria

1. THE `Agent_Layer` SHALL expose each `External_Tool` (flight search, places lookup, weather
   lookup) through a typed interface with a Pydantic-validated response model, and SHALL
   validate every response against that model before any node, guardrail, or LLM prompt reads
   it.
2. THE `Agent_Layer` SHALL count every `External_Tool` invocation attempt for a run against
   that run's `Tool_Call_Cap`, including attempts that raise a transport error, exceed the
   per-call timeout, fail Pydantic validation, or are retries of an earlier attempt, and SHALL
   never decrement that count during the run.
3. IF an `External_Tool` invocation would raise the run's counted invocation attempts above the
   `Tool_Call_Cap`, THEN THE `Agent_Layer` SHALL skip the invocation, SHALL perform exactly one
   `Human_Escalation` for that run naming the exhausted tool budget, and SHALL NOT substitute
   model-generated data for the skipped response.
4. THE `Agent_Layer` SHALL read every `External_Tool` credential, endpoint, and per-call
   timeout from `Settings` and SHALL NOT embed any of those values as literals in source files.
5. THE `Agent_Layer` SHALL exclude `External_Tool` credentials from `agent_runs.error`,
   `messages.content`, log output, and `API_Error_Response` bodies.
6. IF an `External_Tool` response fails its Pydantic validation, THEN THE `Agent_Layer` SHALL
   treat the call as failed, SHALL NOT retry that invocation, and SHALL NOT pass the
   unvalidated payload to the LLM or into a `Proposal`.
7. THE `Agent_Layer` SHALL apply the `Settings` per-call timeout — an integer number of seconds
   defaulting to 10 and constrained to the range 1 to 60 inclusive — to every `External_Tool`
   invocation, and SHALL treat an invocation that does not return a complete response within
   that timeout as a failed call.
8. IF an `External_Tool` invocation fails with a timeout or transport error, THEN THE
   `Agent_Layer` SHALL retry that invocation at most 1 time with identical parameters, and IF
   the retry also fails, THEN THE `Agent_Layer` SHALL treat the tool result as unavailable for
   that run rather than issuing further attempts.
9. WHEN a node requests an `External_Tool` invocation whose tool identity and parameter values
   are identical to an invocation already recorded in `Agent_State` for that run, THE
   `Agent_Layer` SHALL reuse the recorded validated response, SHALL NOT issue a new external
   call, and SHALL NOT increase the run's counted invocation attempts.
10. IF a required `External_Tool` result is unavailable for a run after the retry allowance in
    criterion 8 is exhausted, THEN THE `Agent_Layer` SHALL perform exactly one
    `Human_Escalation` for that run identifying the unavailable data source, and SHALL NOT
    persist a `Proposal` containing model-generated values in place of that data.

---

### Requirement 20: Layering, Error Envelope, and Secret Safety

**User Story:** As a team member, I want the agent layer to obey the same architectural and
safety rules as the rest of the backend, so that adding AI does not open a new leak path.

#### Acceptance Criteria

1. THE `Agent_Layer` SHALL receive every `Repository_Layer` instance it uses as an argument
   supplied by the calling `Service_Layer`, which itself obtains those instances from the
   `DI_Container` via `Depends()`, and no module under `backend/app/agents/` SHALL construct a
   repository instance or create a Supabase client.
2. THE `Route_Layer` SHALL trigger agent operations only by calling `Service_Layer` methods,
   and no module under `backend/app/api/routes/` SHALL import any module under
   `backend/app/agents/`, the `Agent_Graph`, or any node.
3. WHEN an agent operation raises a `Domain_Exception`, THE `Backend_App` SHALL return the
   `API_Error_Response` envelope `{"error": {"code": "...", "message": "..."}}` produced by the
   centralized exception handler registered in `app/main.py` for that exception type, using the
   exception-to-status-and-code mapping defined in
   `.kiro/specs/02-backend-core/requirements.md`.
4. THE `Agent_Layer` SHALL raise `Domain_Exception` values for the `Service_Layer` and the
   centralized exception handlers to translate, and SHALL NOT construct HTTP response bodies,
   response status values, or `API_Error_Response` envelopes itself.
5. THE `Agent_Layer` SHALL exclude `Service_Role_Key` values, LLM API keys, `External_Tool`
   credentials, raw Supabase payloads, SQL text, LLM prompt text, LLM completion text, and
   Python stack traces from every log record it emits at every log level, including debug.
6. THE `Agent_Layer` SHALL treat `.kiro/steering/api-contracts.md` as the single source of
   truth for every shape it emits, and IF producing a `messages.kind` value, a `content` field,
   or an `Agent_Run` field that is absent from that document would be required to complete an
   operation, THEN THE `Agent_Layer` SHALL raise a `Domain_Exception` naming the unsupported
   field and SHALL perform zero `Repository_Layer` write calls for that operation.
7. THE `Agent_Layer` SHALL raise only `Domain_Exception` types that subclass the backend
   exception base class defined in `.kiro/specs/02-backend-core/requirements.md` and that
   already have a registered handler in `app/main.py`, and SHALL NOT define a separate
   agent-only exception hierarchy or error envelope.
8. IF an agent operation raises an exception that is not a `Domain_Exception`, THEN THE
   `Backend_App` SHALL return the `API_Error_Response` envelope produced by the catch-all
   handler registered in `app/main.py` with its fixed internal-error code and authored message
   of at most 500 characters, and SHALL NOT include raw exception text, stack traces, LLM
   prompt text, raw `External_Tool` payloads, raw Supabase payloads, or any configured secret
   value in the response body.
9. THE `Agent_Layer` SHALL express every agent-specific failure through a `Domain_Exception`
   subclass of the spec-02 base class that maps to an existing handler and error code, with the
   intended mappings being: precondition and state-consistency failures → the spec-02
   validation mapping (HTTP 422); a missing trip, room, or approved version → the spec-02
   not-found mapping (HTTP 404); repository and `External_Tool` unavailability → the spec-02
   repository mapping (HTTP 503); and an invalid run status transition or an exceeded internal
   bound → the spec-02 conflict mapping (HTTP 409).

---

### Requirement 21: Agent Layer Test Coverage

**User Story:** As Dev C, I want the agent layer's invariants covered by automated tests with
Supabase and the LLM mocked, so that correctness does not depend on live services.

#### Acceptance Criteria

1. THE test suite SHALL include unit tests for the `Orchestrator_Node` that, for every defined
   `Run_Type` value, assert the mapped `Specialist_Node` is invoked exactly once and every
   other `Specialist_Node` is invoked zero times.
2. WHEN a `Proposal` fails a `Structural_Guardrail` or a `Business_Guardrail` check, THE test
   suite SHALL assert that the count of write calls recorded on the mocked `Repository_Layer` is
   zero and that the returned outcome carries a rejection indication naming the violated
   guardrail category.
3. WHEN a mocked `Repository_Layer` write raises a simulated `UNIQUE(trip_id, version)`
   violation, THE test suite SHALL assert that the agent performs at least one re-fetch of the
   current `version`, re-evaluates, and never issues a second write using the previously
   attempted `version` value.
4. WHEN the same `idempotencyKey` is submitted twice, THE test suite SHALL assert that the
   second call returns the `Agent_Run` identifier created by the first call and that the number
   of additional `agent_runs` insert calls is zero.
5. WHEN a refined itinerary version is produced from a base version, THE test suite SHALL assert
   that every item in the `Unaffected_Scope` is equal, field by field, to its counterpart in the
   base version, and that the count of items in the `Unaffected_Scope` is unchanged.
6. WHEN a run ends in `Human_Escalation`, THE test suite SHALL assert zero write calls to
   `itinerary_versions`, zero to `selections`, and zero to `trips.status`.
7. THE test suite SHALL substitute every `External_Tool` and LLM invocation with a test double
   that returns fixed, pre-declared responses, so that repeated runs of the suite on unchanged
   code produce identical pass/fail results.
8. THE test suite SHALL exercise the `Repository_Layer` through doubles bound to the declared
   repository interface, such that a call to a method absent from that interface, or a call
   whose arguments do not match the interface signature, fails the test.
9. WHERE a test covers `UNIQUE(trip_id, version)` violation handling or two concurrent runs on
   the same `trip_id`, THE test suite SHALL use an in-memory fake repository that enforces
   uniqueness of the (`trip_id`, `version`) pair and records call order.
10. THE test suite SHALL use `pytest` with only the dev dependencies declared in
    `backend/pyproject.toml`, SHALL be collected by the existing `pytest` test-discovery
    configuration, and SHALL pass with zero failures and zero errors when invoked with no
    network interface available and no Supabase credentials present in the environment.
11. IF a test in the suite attempts an outbound network connection or reads a live Supabase
    credential, THEN THE test suite SHALL fail that test with an error indicating that external
    access is not permitted, and SHALL NOT report it as skipped or passed.
12. WHILE asserting on any failure, rejection, or `Human_Escalation` outcome, THE test suite
    SHALL assert that the returned error or escalation payload contains none of the configured
    credential or secret values supplied to the test environment.
13. WHERE property-based tests are added, THE test suite SHALL use `hypothesis` with a fixed,
    declared seed and a minimum of 50 generated examples per property, and SHALL cover the
    `Unaffected_Scope` preservation property of criterion 5 and the `idempotencyKey`
    single-insert property of criterion 4.

---

### Requirement 22: Guest/Member Identity Provenance in Agent-Authored Records

**User Story:** As Dev C, I want the agent layer to treat member and sender identity as
server-verified rather than client-asserted, so that a drifted or spoofable client-generated
id can never masquerade as an authoritative party member in agent output.

#### Acceptance Criteria

1. THE `Agent_Layer` and `Service_Layer` SHALL treat every `created_by_member_id`,
   `sender_member_id`, and `member_id` value they write or read as a server/database-generated
   identity per the guest-identity model in `supabase-architecture.md`.
2. THE `Agent_Layer` and `Service_Layer` SHALL NOT persist a client-supplied identity value as
   authoritative without first resolving it against an existing `room_members` or `guests`
   row through the `Repository_Layer`.
3. IF a client-supplied identity value does not resolve to an existing `room_members` or
   `guests` row, THEN THE `Service_Layer` SHALL reject the operation with a `Domain_Exception`
   indicating an unresolved identity and SHALL NOT write that value to
   `created_by_member_id`, `sender_member_id`, or `member_id` on any row.
4. THE frontend's `Guest.id`-is-client-generated documentation SHALL be treated as a
   frontend-side gap tracked in Assumptions, and SHALL NOT be treated as a license for the
   `Agent_Layer` or `Service_Layer` to accept a client-asserted identity value as ground
   truth.
5. THE `Agent_Layer` SHALL set `sender_member_id` to NULL on every `NPC_Message` it writes,
   independent of any identity value present in the triggering request, satisfying the
   `messages` CHECK constraint regardless of client-supplied input.

---

## Correctness Properties

Candidates suitable for property-based testing with mocked repositories and mocked LLM /
`External_Tool` responses.

1. **Version monotonicity, no gaps, no overwrites.** For any interleaving of concurrent
   `itinerary` / `refinement` runs on one trip, the persisted set of
   `itinerary_versions.version` values for that trip is a contiguous sequence starting at 1,
   each version is inserted exactly once, and no existing version's `itinerary` value is
   modified.
2. **Build-source invariant.** For every persisted `itinerary_versions` row,
   `version = 1` if and only if `source = 'build'`.
3. **At most one approved version.** For any sequence of agent operations and approval
   decisions on a trip, the count of `itinerary_versions` rows with `status = 'approved'` is
   never greater than 1.
4. **Guardrail soundness.** For any generated `Proposal` that fails a `Structural_Guardrail`,
   `Business_Guardrail`, or `Factual_Guardrail` check, no write to `itinerary_versions`,
   `selections`, `vote_sessions`, or `trips` occurs for that `Proposal`.
5. **Unaffected-scope preservation.** For any base itinerary and any set of open `feedback`
   rows, every day and item outside the computed `Affected_Scope` is byte-identical between
   the base version's `itinerary` and the refined version's `itinerary`.
6. **Idempotency replay.** For any `idempotencyKey` and any number of repeated trigger
   requests carrying it, exactly one `agent_runs` row exists with that key and every request
   returns that same run id.
7. **Run terminality.** For any run execution path, the run's final `status` is exactly one of
   `completed` or `failed`, and `completed_at` is set in both cases.
8. **Iteration cap bound.** For any guardrail failure sequence, `agent_runs.iteration_count`
   never exceeds the configured `Iteration_Cap`, and the number of `External_Tool` calls never
   exceeds the configured `Tool_Call_Cap`.
9. **Message envelope validity.** For every `NPC_Message` the agent layer emits,
   `sender_type = 'ai'`, `sender_member_id` is NULL, `kind` is a member of the `message_kind`
   enum, and `content` validates against the shape defined for that `kind`.
10. **Factual provenance.** For every factual field in a persisted `Proposal`, the value
    equals the corresponding value in an `External_Tool` response recorded for that run.
11. **Status monotonicity.** For any sequence of agent operations, `trips.status` never moves
    backwards through the `trip_status` progression.
12. **Secret non-disclosure.** For any run outcome, `agent_runs.error`, emitted
    `messages.content`, and any produced `API_Error_Response.message` contain none of the
    configured secret values.
13. **Bounded contention.** For any run, the number of `Lost_Race` re-evaluation cycles
    performed never exceeds 2, and a third contention within the same run ends that run with
    `status = 'failed'` rather than a further insert attempt.
14. **Supersede safety.** For any sequence of status writes the agent layer performs, no write
    changes the `status` of an `itinerary_versions` row whose `status` is `approved` or
    `rejected`.
15. **Item id stability across versions.** For any base itinerary version and any
    `source = 'refine'` version generated from it, every item carried forward from the base
    version retains its `id`, and every item present in the refine version but absent from the
    base version carries an `id` that appears in no prior version of that trip.
16. **Forward-only status with one exception.** For any sequence of operations, every
    `trips.status` change either increases `Status_Rank` or is the `Refine_Loop_Transition`.
17. **Stage/status coherence.** For every observable read, `party_rooms.planning_stage` equals
    the value the Requirement 18 AC 10 mapping derives from the same row's `trips.status`.
18. **Factual-field provenance completeness.** Every factual field in a persisted `Proposal` has
    a recorded `External_Tool` source entry for that run, and its value equals that entry's
    value.
19. **Turn atomicity.** For any agent turn, either every `NPC_Message` of that turn is visible
    to readers or none is; no partial turn is ever observable.
20. **Progress-message singularity.** For any `Agent_Run`, the count of emitted `messages` rows
    whose `content.progress` is `true` is at most 1, regardless of repair iterations or node
    dispatches.

---

## Assumptions and Dependencies

These are stated explicitly because they are outside this spec's scope and, in several cases,
not yet implemented.

1. **Trigger endpoints are Dev B's prerequisites.** The backend currently exposes only the
   health check; spec 02's tasks are unimplemented and cover only `POST /rooms` and
   `POST /rooms/{room_code}/join`. There are no endpoints yet for preferences, votes,
   selections, trips, feedback, or agent triggers. The `Agent_Layer` is built against the
   agreed "AI Runs" shape in `api-contracts.md`
   (`{ id, tripId, runType, status, baseVersion, resultVersionId?, error? }` plus
   `idempotencyKey` on triggering requests). The route and service wiring that calls the
   agent layer is owned by Dev B.
2. **Repository methods for the agent-relevant tables are prerequisites.** Spec 02 defines
   `RoomRepository`, `MemberRepository`, and `ProfileRepository` only. Repositories covering
   `messages`, `vote_sessions`, `votes`, `selections`, `trips`, `itinerary_versions`,
   `feedback`, and `agent_runs` must exist before the agent layer can write anything; their
   ownership sits with the backend core.
3. **Migration `20260925000001_case_sensitive_identity.sql` is authored but unapplied.** The
   agent layer does not depend on display-name matching semantics, so either identity model
   is acceptable to it.
4. **Live table names win over handover names.** `room_members`, `travel_preferences`, and
   `party_rooms` are used throughout; `TRIPS` / `TRIP_MEMBERS` / `PREFERENCES` from
   `design1.md` are stale.
5. **No tie representation exists in the schema or contracts.** `vote_sessions.status` is
   `open | closed` only. This spec keeps ties in `Tiebreak_Flow` code plus an explanatory
   `NPC_Message`. Open boundary question for the team: should a resolved tie be recorded
   durably, and if so, does it belong in `selections.data`, in the `summary` message content,
   or nowhere? This spec does not invent a mechanism.
6. **The `Group_Profile` is not persisted.** Because `agent_run_type` has no `group_profile`
   value and no table models a derived group profile, it is recomputed per `discovery` run.
7. **Activity priority lives in `travel_preferences.activities`.** Must-have versus optional
   is an attribute of objects inside that jsonb array; no dedicated preference/priority table
   exists or is proposed.
8. **`agent_runs` is invisible to realtime clients.** Any future need for richer client-side
   run observability is a backend/contract discussion, not something the agent layer
   simulates.
9. **The group budget ceiling is the lowest per-member budget.** `Budget_Ceiling` is computed
   as the minimum non-NULL `travel_preferences.budget` across the party, so the most
   constrained member governs what the party can be offered. This is an MVP interpretation the
   team may revisit: `product.md` describes budget as a per-character travel preference without
   settling whether a party budget is a per-person ceiling, a shared pooled total, or a
   per-person average, and the initial migration records group-versus-per-person budget
   semantics as an open TODO.
10. **Vote resolution has exactly two triggers.** All room members have voted, or the owner
    closes the session. `vote_sessions` carries no deadline or closed-at column, so
    timeout-based resolution is out of scope and is not simulated in the agent layer.
11. **A resolved tie is recomputable but not recorded.** It is recomputable from the persisted
    `votes` rows plus `vote_sessions.options` ordering, but is not separately recorded as
    durable tie state — `vote_sessions.status` admits only `open | closed` and neither `votes`
    nor `selections` carries a tie field. Open team decision, not resolved here: whether a
    resolved tie should be recorded in `selections.data`.
12. **Option counts and flight ranking are MVP interpretations.** Flight-option ranking, the
    3–5 option count, and the destination option count are MVP interpretations chosen for a
    comparable UI, not values fixed by `api-contracts.md`.
13. **`trips.status` drives `party_rooms.planning_stage`.** `trips.status` is the single driver
    of `party_rooms.planning_stage` via a fixed derivation, so the two cannot disagree. Both
    are written by the service layer in one write; the agent layer never writes either
    directly.
14. **`group_formed` is set when a room reaches 2 members.** A solo planner therefore stays at
    `trip_created` until preferences are collected. This is an MVP interpretation, not fixed by
    the contracts.
15. **Escalation terminates a run as `completed`, not `failed`.** A run that ends in
    `Human_Escalation` terminates as `completed` because the `agent_run_status` enum has no
    `escalated` value and the escalation is a successfully delivered NPC request rather than a
    technical fault. A retry after escalation requires a different `idempotencyKey` or none.
16. **Factual provenance is not persisted.** `External_Tool` responses are only ever held in
    `Agent_State` for the life of a run. Factual provenance is deliberately not persisted,
    because no column in the fixed schema models it and inventing one would contradict the
    governing constraint. The consequence is that provenance cannot be audited after a run
    completes — an accepted MVP limitation, not a gap to work around.
17. **Tool responses are cached per run.** Responses are cached by tool identity plus
    parameters, so repeated identical queries within a run do not consume additional
    `Tool_Call_Cap` budget.
18. **Progress is distinguished by `content.progress`, not by `kind`.** A `content.progress`
    boolean carries the marker rather than a `messages.kind` value, because the `message_kind`
    enum is fixed at `text | recommendation | vote | summary`. This requires the frontend to
    read `content.progress`; it is an addition to the `text` content shape and must be agreed
    in `api-contracts.md` before the frontend can render it.
19. **A failed `Progress_Message` write never fails the run.** Progress visibility is
    best-effort; correctness of the plan does not depend on it.
20. **The `ItineraryVersion`/`ItineraryItem` frontend types lack `id`/`status` fields the
    agent layer's output relies on.** This is tracked as a frontend reconciliation need (see
    "Frontend Reconciliation Needed"), not fixed here.
21. **`Feedback.target` is a flat string in the frontend type versus a structured jsonb
    object in the DB and `api-contracts.md`.** Requirement 10 AC 15 covers the interim
    compatibility behaviour.
22. **`Guest.id` client-generation in the frontend type contradicts the guest-identity
    model.** Requirement 22 firewalls the agent layer from trusting it.
23. **`RoomMember` lacks a `displayName` field.** NPC messages that need to address a member
    by name must resolve it via `guests.display_name` through the `Repository_Layer`, not
    assume the frontend already has it in hand.
24. **`VoteSession` lacks a `messageId` link and vote casting uses `guestId` instead of
    `memberId` in the frontend contract.** The `Agent_Layer` still writes and reads
    `votes.member_id` per the DB; this is a frontend contract gap, not an agent-layer one.
25. **All four real frontend service implementations are unimplemented placeholders**
    (Foundation-phase stubs that throw `NotImplementedError`). Zero real integration exists
    on the frontend side today, mirroring the backend-side state already noted.

---

## Non-Goals

1. No schema changes: no new tables, columns, enum values, indexes, constraints, or
   publication membership changes.
2. No API contract changes: the shapes in `api-contracts.md` are consumed as-is.
3. No frontend work: no components, hooks, service-layer TypeScript, or mock fixtures.
4. No changes to the host/member direct-response-versus-broadcast sync pattern. That is a
   frontend and API concern. If agent output timing interacts badly with it, the agent layer
   reports the symptom rather than compensating with waits, retries, artificial delays, or
   duplicate events.
5. No authentication or authorization work; the guest trust model is unchanged.
6. No LangGraph checkpointer as a source of truth for trip data.
7. No deployment, infrastructure, or observability platform work.
8. No re-specification of spec 02's endpoints, repositories, or error handling.

---

## Backend Change Requests

### Entry 1 — a departure origin for flight search

- **What's needed:** the `Logistics_Node` must pass a departure origin to the flight
  `External_Tool`. Without one, no real flight query can be formed, so Requirement 8 cannot be
  implemented as specified.
- **What was tried:** (a) `travel_preferences` was checked column by column —
  `available_dates`, `destinations`, `travel_style`, `budget`, `interests`, `activities`,
  `hard_constraints` — and none carries a departure location; `destinations` holds desired
  destinations, not origins. (b) `characters.appearance` jsonb was considered and rejected: it
  is avatar presentation data, and putting routing input there fights the schema's intent.
  (c) Encoding "departs from X" as an entry inside `travel_preferences.hard_constraints` jsonb
  was considered as the closest no-change fit; it is workable because a departure airport
  genuinely is a hard constraint, but it makes a value every flight query requires
  structurally optional and untyped, discoverable only by string convention, which the
  deterministic `Business_Guardrail` would then have to parse out of free-form text.
  (d) Deriving origin from an IP or locale was rejected: the guest model stores no such data
  and it would be a silent guess.
- **Why the existing schema does not cover it:** a required input to the LOGISTICS stage has no
  typed home in the fixed schema or in the preferences shape in `api-contracts.md`.
- **Smallest proposed change:** add one nullable text column `origin` to `travel_preferences`
  (IATA code or city string) and the matching optional field to the preferences shape in
  `api-contracts.md`. No new table, no enum change, no constraint change.
- **Interim behaviour pending Dev B's decision:** the agent layer reads a departure origin from
  a conventioned `travel_preferences.hard_constraints` entry, treats an absent origin as an
  escalation rather than a guess, and does not invent a value. This is recorded here as a
  deviation, per the development-rules requirement to document deviations.

### Entry 2 — a `progress` field on the `text` message content shape

- **What's needed:** clients cannot observe run progress, because `agent_runs` is absent from
  the `supabase_realtime` publication while `messages` is present. Progress must therefore ride
  on a `messages` row, and the frontend needs a way to tell a progress message apart from
  ordinary NPC dialogue so it can render a transient "NPC thinking" state rather than a
  permanent transcript line.
- **What was tried:** (a) adding a `progress` value to the `message_kind` enum — rejected, that
  is a schema change and the enum is fixed. (b) Subscribing clients to `agent_runs` — not
  possible without a publication change, which is also fixed. (c) Inferring progress from
  message text — rejected as fragile string matching. (d) Carrying the marker inside the
  existing `content` jsonb as `content.progress = true` — this is the approach the spec adopts,
  because `content` is jsonb and requires no schema change.
- **Why this is still a change request:** no schema change is needed, but `api-contracts.md` is
  the agreed frontend/backend contract and does not currently define a `progress` field on the
  `text` content shape. Without adding it there, the frontend has no contractual basis to read
  it.
- **Smallest proposed change:** add an optional boolean `progress` to the `text` message
  content shape in `api-contracts.md`. No database change of any kind.

This section is populated only when a genuine agent-layer need cannot be represented in the
backend as it stands. Any entry must state: what was needed, which existing schema and
contract options were attempted, why each fails, and the minimal change proposed. Entries are
not added speculatively, and a schema-fighting workaround inside the agent layer is not an
acceptable alternative to filing one.

## Frontend Reconciliation Needed

Frontend type drift is not a backend schema problem, so it does not belong in "Backend
Change Requests" above. This section applies the same discipline to the frontend side: what
was found, why it matters to this spec, and the smallest proposed frontend-side change —
framed as a proposal to Dev A rather than to Dev B.

### Entry 1 — `ItineraryVersion`/`ItineraryItem` missing `id`/`status`

- **What was found:** `ItineraryVersion` in `frontend/src/types/itinerary.ts` has no `id`
  field and no `status` field, using `isCurrent: boolean` instead of the
  `proposed | approved | rejected | superseded` enum. `ItineraryItem` in the same file has no
  `id` field.
- **Smallest proposed change:** add `id: string` and
  `status: "proposed" | "approved" | "rejected" | "superseded"` to `ItineraryVersion`, and
  add `id: string` to `ItineraryItem`, matching `api-contracts.md`'s "Itinerary Versioning"
  section and the DB's `itinerary_versions`/item-id contract.
  `frontend/src/types/contract-shape.assertions.ts` needs its `ItineraryVersion`/
  `ItineraryItem` assertions updated in the same change so the compile-time guard pins the
  corrected shape rather than the drifted one.
- This spec's agent layer already writes the DB-correct shape regardless of the frontend
  gap, so fixing the frontend does not require any agent-layer behaviour change — only the
  frontend type/assertion files change.

### Entry 2 — `Feedback.target`/`FeedbackInput.target` is a flat string

- **What was found:** `frontend/src/types/feedback.ts` types `target` as `string`, not the
  structured shape the DB's jsonb `target` column and `api-contracts.md` define.
- **Smallest proposed change:** change `Feedback.target`/`FeedbackInput.target` from `string`
  to `{ day?: number; itemId?: string; section?: string }` in
  `frontend/src/types/feedback.ts`, matching `api-contracts.md` and the DB's jsonb `target`
  column. The corresponding `contract-shape.assertions.ts` `Feedback`/`FeedbackInput`
  assertions need updating in the same change.
- This spec's agent layer already writes and reads the DB-correct shape regardless of the
  frontend gap, so fixing the frontend does not require any agent-layer behaviour change —
  only the frontend type/assertion files change.

### Entry 3 — `Guest.id` documented and produced as client-generated

- **What was found:** `frontend/src/types/guest.ts`'s doc comment states `id` is a
  client-generated UUID string, contradicting `supabase-architecture.md`'s guest-identity
  model, in which the client never creates identity UUIDs.
- **Smallest proposed change:** correct the `Guest` type doc comment and construction path in
  `frontend/src/types/guest.ts` so `id` is documented and produced as server-generated
  (returned from the room create/join response), not client-generated, matching
  `supabase-architecture.md`.
- This spec's agent layer already treats member/guest identity as server-generated
  regardless of the frontend gap (Requirement 22), so fixing the frontend does not require
  any agent-layer behaviour change — only the frontend type/construction-path files change.

### Entry 4 — `RoomMember` missing `displayName`, `characterId` direction unclear

- **What was found:** `RoomMember` in `frontend/src/types/room.ts` is
  `{ id, roomId, guestId, characterId?, role }` — no `displayName` field, and `characterId`
  does not correspond to any live DB column on `room_members` in the direction the frontend
  type implies.
- **Smallest proposed change:** add `displayName: string` to `RoomMember` in
  `frontend/src/types/room.ts`, and reconcile `characterId` against the DB's actual
  `characters.member_id` direction (or drop it if unused), matching `api-contracts.md`'s Room
  Member shape `{ id, roomId, guestId, displayName, role }`.
- This spec's agent layer already resolves display names via `guests.display_name` through
  the `Repository_Layer` regardless of the frontend gap, so fixing the frontend does not
  require any agent-layer behaviour change — only the frontend type file changes.

### Entry 5 — `VoteSession` missing `messageId`, `CastVoteInput` uses `guestId`

- **What was found:** `VoteSession` in `frontend/src/types/vote.ts` has no `messageId`/
  `message_id` field, and `CastVoteInput` in `frontend/src/services/vote.contract.ts` uses
  `guestId`, not `memberId`.
- **Smallest proposed change:** add `messageId?: string` to `VoteSession` in
  `frontend/src/types/vote.ts`, and rename `guestId` to `memberId` in `CastVoteInput`
  (`frontend/src/services/vote.contract.ts`), matching `api-contracts.md`'s Voting Structure
  section and the DB's `votes.member_id`.
- This spec's agent layer already writes and reads `votes.member_id` per the DB regardless of
  the frontend gap, so fixing the frontend does not require any agent-layer behaviour
  change — only the frontend type/contract files change.
