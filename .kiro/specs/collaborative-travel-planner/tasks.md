# Implementation Plan: Collaborative Travel Planner

## Overview

Convert the feature design into a series of prompts for a code-generation LLM that will implement each step with incremental progress. Make sure that each prompt builds on the previous prompts, and ends with wiring things together. There should be no hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on tasks that involve writing, modifying, or testing code.

This plan builds the Collaborative Travel Planner bottom-up: shared types and pure domain logic first, then the event-sourced Room_State reducer, then persistence, then services (Collaboration, Voting, Budget), then external integration adapters, then the specialized agents (Flight, Hotel, Transportation, Notification, Reminder), then the Travel_Planning_Agent submodules, then the Agent Orchestrator that wires everything together, then the Final Plan / Export / Archive flow, and finally the Travel_Dashboard frontend and the end-to-end scenario tests.

Property-based tests are written close to the code they validate. Each property test sub-task is marked optional with `*` and explicitly references the property number from the design and the requirements clauses it validates.

## Tasks

- [ ] 1. Set up project structure and shared foundations
  - [ ] 1.1 Initialize the monorepo and tooling
    - Create `packages/server`, `packages/client`, and `packages/shared` directories
    - Configure TypeScript (strict), ESLint, Prettier, Vitest, and fast-check at the workspace root
    - Add Fastify, Socket.IO server, Prisma, React, Vite, Tailwind, Zustand, and Socket.IO client as dependencies in the appropriate packages
    - Add npm scripts for `lint`, `test`, `test:property`, `build`, and `db:migrate`
    - _Requirements: foundational_

  - [ ] 1.2 Define shared TypeScript types and interfaces
    - In `packages/shared/src/types/`, define `GuestSession`, `PlanningRoom`, `PlanningPhase`, `RoomState`, `Member`, `AvailabilityRange`, `InterestEntry`, `TripConstraints`
    - Define `DestinationOption`, `FlightOption`, `AccommodationOption`, `Verification`, `Money`, `SupportedCurrency`
    - Define `RawPreferenceInput`, `StructuredPreferences`, `PreferenceCategorized`, `PreferenceItem`, `PreferenceConflict`
    - Define `Itinerary`, `ItineraryDay`, `ItineraryItem`, `ItineraryItemChange`, `UnsatisfiedPreference`
    - Define `Poll`, `PollOption`, `Vote`, `PollResult`, `PollContext`
    - Define `BudgetCategory`, `SpendingRecord`, `BudgetSnapshot`, `BudgetProjection`, `BudgetRiskAssessment`, `ActivityAlternative`
    - Define `TransportMode`, `TransportOption`, `DailyRoutePlan`, `RouteLeg`
    - Define `RoomEvent`, `RoomEventType`, `Notification`, `NotificationKind`, `Warning`, `FinalItinerarySummary`, `ExportFormat`
    - Export a single barrel `index.ts` consumed by both server and client
    - _Requirements: foundational; aligns with Data Models section of design_

  - [ ] 1.3 Set up Prisma schema and run initial migration
    - Define models for `Room`, `Member`, `Session`, `Event` (id, roomId, version, serverTs, actorId, type, payload JSON), `Poll`, `PollOption`, `Vote`, `Budget`, `SpendingRecord`, `Itinerary`, `ItineraryItem`, `Notification`, `Warning`, `ExternalCacheEntry`
    - Add a unique constraint on `(roomId, version)` and an index on `(roomId, version DESC)` for fast `syncSince`
    - Add a unique constraint on `(pollId, memberId)` for `Vote` (Req 5.2)
    - Run `prisma migrate dev` against a local SQLite file
    - _Requirements: foundational_

- [ ] 2. Core domain logic (pure functions)
  - [ ] 2.1 Implement input validation primitives
    - In `packages/server/src/domain/validation.ts`, implement `validateDisplayName`, `validateTripName`, `validateMaxMembers`, `validateAvailabilityRange`, `validatePollOptions`, `validateSpendingRecord`
    - Each validator returns a discriminated `Result<T, ValidationError>` where the error matches the design's `{ code, field, reason, expected }` envelope
    - _Requirements: 1.1, 1.5, 1.8, 3.7, 5.6, 8.8_

  - [ ]* 2.2 Write property test for input validation
    - **Property 2: Domain inputs outside their valid ranges are rejected**
    - For each validator, generate inputs inside and outside the declared range; assert acceptance iff inside the range and that rejected inputs return the structured error envelope without mutating any state
    - **Validates: Requirements 1.5, 1.8, 3.7, 5.6, 8.8**

  - [ ] 2.3 Implement availability overlap computation
    - In `packages/server/src/domain/availability.ts`, implement `computeGroupOverlap(memberRanges)` returning either the maximal intersection window or the closest partial overlap with the set of members whose ranges exclude it
    - Implement `unionRanges(ranges)` and `intersectRangeSets(a, b)` as supporting pure helpers
    - _Requirements: 3.4, 3.6_

  - [ ]* 2.4 Write property test for availability overlap
    - **Property 5: Availability overlap correctness**
    - Generate random per-member range lists; assert `computeGroupOverlap` equals the set-theoretic intersection of each member's union; for inputs with no full overlap, assert the returned partial overlap is maximal and the excluded-member set is exactly correct
    - **Validates: Requirements 3.4, 3.6**

  - [ ] 2.5 Implement planning phase state machine
    - In `packages/server/src/domain/phase.ts`, implement `successorPhase(current)` returning the unique next phase or `undefined` when `current = final_plan`
    - Implement `isFieldOwnedBy(field, phase)` and `markDownstreamDirty(state, target)` for revert support
    - Implement `canActorTransition(state, actorId)` that allows only the room owner
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.8_

  - [ ]* 2.6 Write property test for phase progression
    - **Property 4: Phase progression state machine**
    - Generate random `RoomState` and actor pairs; assert `successorPhase` matches the defined sequence, no successor exists for `final_plan`, transitions require owner, prior-phase fields become read-only after advance, and revert marks `itineraryVersions[latest]`, `transportPlan`, and projected budget as `requires_regeneration`
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.8**

  - [ ] 2.7 Implement external-data verification flag policy
    - In `packages/server/src/domain/verification.ts`, implement `markVerification(field, source, retrievedAt, now, ttl)` returning `confirmed` iff the source explicitly confirms AND `now - retrievedAt <= ttl`, otherwise `manual_verification`
    - Implement `assertNotGuaranteed(record)` used by Flight_Agent and Hotel_Agent to ensure outputs never claim guarantees on unverified fields
    - _Requirements: 4.4, 4.14, 6.3, 6.5, 6.8, 7.3, 7.8, 7.11_

  - [ ]* 2.8 Write property test for external-field verification correctness
    - **Property 6: External-field verification correctness**
    - Generate random `(source, retrievedAt, now, ttl, sourceConfirmed)` tuples; assert the verification flag matches the bi-conditional in the property and that `assertNotGuaranteed` rejects any output claiming guarantees on a `manual_verification` field
    - **Validates: Requirements 4.4, 4.14, 6.3, 6.5, 6.8, 7.3, 7.8, 7.11**

  - [ ] 2.9 Implement completion-percentage and presence helpers
    - In `packages/server/src/domain/helpers.ts`, implement `completionPercent(completed, total)` returning `floor(100 * completed / total)` and `100` when `total = 0`
    - Implement `isOnline(member, now)` returning `now - member.lastSeenAt <= 30000`
    - _Requirements: 11.2, 12.2_

  - [ ]* 2.10 Write property test for completion percentage and presence
    - **Property 27: Presence is determined by heartbeat freshness**
    - **Property 35: Completion percentage formula**
    - Generate random `(completed, total)` and `(lastSeenAt, now)` tuples; assert both formulas match the design
    - **Validates: Requirements 11.2, 12.2**

- [ ] 3. Event log and Room_State reducer
  - [ ] 3.1 Define RoomEvent schema and the version/serverTs assigner
    - In `packages/server/src/domain/events.ts`, define the `RoomEventType` union and a Zod schema per event payload
    - Implement `assignServerMetadata(roomId, event)` that allocates the next per-room `version` and `serverTs` atomically
    - _Requirements: 11.1, 11.4_

  - [ ] 3.2 Implement Room_State reducer and syncSince
    - In `packages/server/src/domain/reducer.ts`, implement `applyEvent(state, event)` covering every `RoomEventType` from the design
    - Apply last-write-wins by `serverTs` for non-vote fields; reject duplicate `(pollId, memberId)` vote events
    - Mark prior dependent outputs as `superseded` when an agent regenerates output
    - Implement `syncSince(events, lastVersion)` returning events with `version > lastVersion` in ascending order
    - _Requirements: 2.7, 11.3, 11.4, 11.6, 11.7_

  - [ ]* 3.3 Write property test for event-log replay, LWW, and vote immutability
    - **Property 28: Event-log replay and conflict resolution converge**
    - Generate random event logs (including duplicate votes, concurrent non-vote edits with different `serverTs`, offline-queued events, and agent regenerations); assert folding the log produces the canonical `RoomState`, `syncSince` returns exactly the tail, LWW selects the higher `serverTs`, duplicate votes are rejected, queued events converge to the same state online or offline, and prior outputs are marked `superseded` on regeneration
    - **Validates: Requirements 2.7, 11.3, 11.4, 11.6, 11.7**

- [ ] 4. Persistence layer
  - [ ] 4.1 Implement Prisma repositories
    - In `packages/server/src/persistence/`, implement `RoomRepository`, `MemberRepository`, `SessionRepository`, `EventRepository`, `PollRepository`, `VoteRepository`, `BudgetRepository`, `ItineraryRepository`, `NotificationRepository`, `WarningRepository`
    - `EventRepository.appendEvent` uses a serializable transaction to atomically allocate the next `version` per room
    - _Requirements: 2.7, 11.1_

  - [ ] 4.2 Implement the external-data TTL cache
    - In `packages/server/src/persistence/externalCache.ts`, implement a key-namespaced cache backed by `ExternalCacheEntry` with per-source TTL (Flight 6h, Hotel 12h, Activity 24h, Mapping 24h)
    - Expose `get(key)`, `set(key, value, source, retrievedAt)`, and `isFresh(entry, now)` helpers used by adapters in Section 9
    - _Requirements: 4.4, 6.3, 7.3, 9.4_

- [ ] 5. Checkpoint - foundations
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Collaboration_Service
  - [ ] 6.1 Implement createRoom and joinRoom
    - In `packages/server/src/services/CollaborationService.ts`, implement `createRoom({ tripName, ownerDisplayName, maxMembers })` returning the room, an invite link, and the owner's `GuestSession`
    - Implement `joinRoom({ inviteToken, displayName })` that validates the token, enforces capacity (Req 1.7), and returns the session
    - Reject expired/revoked invite tokens with a `validation_error` shape (Req 1.6)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [ ]* 6.2 Write property test for room creation and capacity
    - **Property 1: Room creation initializes a valid, uniquely identifiable room**
    - **Property 3: Capacity rule**
    - Generate random valid and invalid `(tripName, ownerDisplayName, maxMembers)` tuples and capacity scenarios; assert the room has exactly one owner-member, initial phase is `availability_and_destination_input`, invite tokens are pairwise unique across concurrently created rooms, and the (N+1)th join when the room is full is rejected with `room_full`
    - **Validates: Requirements 1.1, 1.2, 1.5, 1.7**

  - [ ] 6.3 Implement advancePhase, revertPhase, and read-only enforcement
    - In `CollaborationService.ts`, implement `advancePhase(roomId, actorId)` and `revertPhase(roomId, actorId, targetPhase)`
    - Enforce owner-only progression with an `authorization_error`; reject mutations to prior-phase fields with `phase_read_only`
    - On revert, mark `itineraryVersions[latest]`, `transportPlan`, and projected budget as `requires_regeneration`
    - Acquire a per-room logical lock around phase transitions
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.8_

  - [ ] 6.4 Implement applyEvent and broadcast pipeline
    - In `CollaborationService.ts`, implement `applyEvent(roomId, event)` that validates, persists via `EventRepository`, updates the in-memory reducer projection, and emits the event to the WebSocket broadcaster
    - Guarantee broadcast within 2 seconds (Req 11.1) by short-circuiting expensive work after persistence
    - _Requirements: 2.7, 11.1, 11.4, 11.7_

  - [ ] 6.5 Implement the WebSocket gateway and heartbeat tracking
    - In `packages/server/src/gateway/websocket.ts`, create a Socket.IO namespace per room with `join`, `event`, `heartbeat`, and `sync` messages
    - Track `lastSeenAt` for each session; mark a member offline after 30s without a heartbeat and emit `presence.offline`
    - Notify other connected members of presence transitions within 5 seconds (Req 11.5)
    - _Requirements: 11.1, 11.2, 11.5_

  - [ ] 6.6 Implement reconnect, queued offline submissions, and superseded marking
    - On client reconnect with `lastVersion`, replay `syncSince(roomId, lastVersion)` over the socket
    - Accept queued offline submissions on reconnect, assign fresh `serverTs`, and apply LWW; if an offline edit is overridden, send a per-client `edit_overridden` notice
    - When an agent regenerates output, mark superseded dependent outputs in the new event payload
    - _Requirements: 11.3, 11.6, 11.7_

  - [ ]* 6.7 Write property test for offline rejoin convergence
    - **Property 28: Event-log replay and conflict resolution converge (offline-queued branch)**
    - Generate random sequences of online and offline edits across multiple simulated clients; assert that replaying queued events on reconnect produces the same canonical state as if they had been applied online and that LWW is preserved
    - **Validates: Requirements 11.3, 11.4, 11.6**

- [ ] 7. Voting_Service
  - [ ] 7.1 Implement createPoll, castVote, closePoll, and tiebreaker creation
    - In `packages/server/src/services/VotingService.ts`, implement the full `VotingService` interface
    - Reject polls with `options.length < 2 || > 10`; enforce one immutable vote per `(pollId, memberId)`; auto-close on full participation or deadline; determine the winner by simple majority; auto-create a tiebreaker poll containing only tied options
    - Hide per-member choices while open; reveal them only on closure
    - When an agent-requested poll closes, emit a callback event so the Agent Orchestrator can forward the result to the Travel_Planning_Agent (Req 5.9)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [ ]* 7.2 Write property test for voting outcome correctness
    - **Property 15: Voting outcome correctness**
    - Generate random polls, voter sets, and vote sequences; assert poll creation respects the `[2, 10]` option bound, duplicate votes are rejected, the close condition is `|V| = |members| ∨ now ≥ deadline`, the winner equals `argmax(tally)` when unique, ties yield `tied[]` and an auto-created tiebreaker, and per-member choices are hidden until closure
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7**

- [ ] 8. Budget_Agent
  - [ ] 8.1 Implement spending recording, aggregation, and projection
    - In `packages/server/src/agents/BudgetAgent.ts`, implement `recordEstimate`, `recordSpending`, and `projectRemaining`
    - Reject records with missing amount, negative amount, or unsupported currency
    - Aggregate `actualByCategory[c]` as the sum of amounts for category `c`; compute `remaining = total − Σ actualByCategory` and `projectedTotal = Σ actualByCategory + Σ (dailyRateByCategory[c] · remainingDays[c])`
    - Broadcast updates via Collaboration_Service within 5 seconds (Req 8.1, 8.6)
    - _Requirements: 8.1, 8.2, 8.6, 8.7, 8.8_

  - [ ] 8.2 Implement risk evaluation and cheaper-alternative selection
    - In `BudgetAgent.ts`, implement `evaluateRisk` returning `atRisk = projectedTotal > total * 1.10`
    - Implement `suggestCheaperAlternatives` returning up to N alternatives each costing ≥20% less than the originally planned activity, or all available when fewer exist (and emit a `limited_alternatives` notification)
    - When `Σ actualByCategory > total`, emit an `over_budget` alert and flag every unpaid planned activity for review
    - _Requirements: 8.3, 8.4, 8.5_

  - [ ]* 8.3 Write property test for budget aggregation, projection, and risk
    - **Property 19: Budget aggregation and projection arithmetic**
    - **Property 20: Budget risk threshold and alternative selection**
    - Generate random `SpendingRecord` sequences, alternative pools, and elapsed-day counts; assert per-category sums, `remaining`, and `projectedTotal` match the formulas; assert `atRisk` matches the 110% threshold; assert the alternatives set respects the 20% rule and the `limited_alternatives` fallback; assert `over_budget` is emitted iff actual spending exceeds total and that every unpaid activity is flagged
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

- [ ] 9. External integration adapters
  - [ ] 9.1 Implement the shared HTTP client (timeout, retry, circuit breaker)
    - In `packages/server/src/external/httpClient.ts`, implement an 8s timeout, single retry with jitter, and a per-source circuit breaker that opens after 5 consecutive failures with a 60s cool-off
    - Map underlying errors to the design's envelope (`timeout | network_error | rate_limited | unauthorized | malformed_response | empty_result`)
    - _Requirements: cross-cutting (Section 9 of design)_

  - [ ] 9.2 Implement the Flight_Data_Source adapter
    - In `packages/server/src/external/flightDataSource.ts`, implement `searchFlights({ origin, destination, dates, passengers })` against the Amadeus Self-Service API
    - Cache results in the external cache (6h TTL keyed by `(origin, dest, dates, pax)`); map missing/uncertain fields to `verification = "manual_verification"`
    - _Requirements: 6.1, 6.3, 6.5, 6.7, 6.8_

  - [ ]* 9.3 Write Flight_Data_Source contract test against the Amadeus sandbox
    - Hit the sandbox with recorded credentials; assert request shape, pagination handling, error envelope mapping, and Manual_Verification flag propagation for missing fields
    - _Requirements: 6.1, 6.5, 6.8_

  - [ ] 9.4 Implement the Hotel_Data_Source adapter
    - In `packages/server/src/external/hotelDataSource.ts`, implement `searchAccommodations({ destination, dates, groupSize, suggestedAreas })`
    - Cache results (12h TTL); compute `distanceToSuggestedAreas` against provided cluster centroids; map missing fields to `manual_verification`
    - _Requirements: 7.1, 7.3, 7.6, 7.8, 7.10, 7.11_

  - [ ]* 9.5 Write Hotel_Data_Source contract test against the sandbox
    - Hit the sandbox; assert request shape, pagination, distance computation, and Manual_Verification propagation
    - _Requirements: 7.1, 7.8, 7.11_

  - [ ] 9.6 Implement the Activity_Data_Source adapter
    - In `packages/server/src/external/activityDataSource.ts`, implement `lookupPlace`, `lookupOpeningHours`, and `lookupSeasonality` against Google Places / Foursquare
    - Cache results (24h TTL keyed by `place_id`); return `manual_verification` when opening-hour or seasonality data is missing
    - _Requirements: 4.4, 4.12, 4.14_

  - [ ] 9.7 Implement the Mapping_Service adapter with text fallback
    - In `packages/server/src/external/mappingService.ts`, implement `route(origin, destination, mode)` against Google Maps Directions
    - On adapter failure, return a `TransportOption` populated with `textDirections` referencing origin, destination, and mode
    - _Requirements: 9.4, 9.6_

  - [ ] 9.8 Implement the LLM client with schema validation and reduced-fidelity fallback
    - In `packages/server/src/external/llmClient.ts`, implement `complete(promptTemplate, schema, abortSignal)` with 30s per-call timeout
    - Validate the response against the provided JSON Schema; on failure, retry once with a corrective prompt; on second failure, emit a reduced-fidelity artifact with `manual_verification` flags
    - _Requirements: 4.11, 4.15 (LLM error-handling section of design)_

- [ ] 10. Checkpoint - services and adapters
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Flight_Agent
  - [ ] 11.1 Implement fetchFlightOptions and weighted ranking
    - In `packages/server/src/agents/FlightAgent.ts`, implement `fetchFlightOptions` (delegating to the Flight_Data_Source adapter) and `rankFlights`
    - Implement normalizers `n_price`, `n_duration`, `n_stops`, `n_schedule` returning `[0,1]`; compute the composite score `0.4·n_price + 0.3·n_duration + 0.2·n_stops + 0.1·n_schedule`
    - Categorize into `budget`, `comfort`, `bestValue` per the design rules
    - On empty results, emit a `dataUnavailable` notification with a retry-with-adjustments hint and a manual-entry path
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 6.8_

  - [ ]* 11.2 Write property test for flight ranking
    - **Property 16: Flight ranking correctness**
    - Generate random non-empty `FlightOption[]`; assert three non-empty groups are returned, `bestValue` is sorted by descending composite score, every option carries the appropriate `verification` flag, and normalizers are in `[0,1]` with `1 = best`
    - **Validates: Requirements 6.2, 6.3, 6.4**

  - [ ]* 11.3 Write property test for empty-source manual fallback
    - **Property 18: Empty external sources emit notification and manual fallback**
    - Generate scenarios where the Flight_Data_Source returns empty; assert a `dataUnavailable` notification is published and the dashboard view model exposes a manual-entry action and a retry-with-adjusted-dates suggestion
    - **Validates: Requirements 6.7, 7.10 (flights branch)**

- [ ] 12. Hotel_Agent
  - [ ] 12.1 Implement fetchAccommodationOptions, ranking, and recommendAreas
    - In `packages/server/src/agents/HotelAgent.ts`, implement `fetchAccommodationOptions`, `rankAccommodations`, and `recommendAreas`
    - Compute `score(h) = 0.35·n_location + 0.25·n_price + 0.20·n_rating + 0.20·n_comfort`
    - When fewer than three options sit near the suggested clusters, return all available options plus the nearest viable neighborhoods
    - On empty results, emit a `dataUnavailable` notification and surface a manual-entry path
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.10, 7.11_

  - [ ]* 12.2 Write property test for hotel ranking and cluster prioritization
    - **Property 17: Hotel ranking with location convenience**
    - **Property 18 (hotel branch)**
    - Generate random `AccommodationOption[]` and cluster sets; assert three non-empty groups when ≥3 options sit near clusters, otherwise all options plus `nearest_alternative_neighborhoods`; assert `bestValue` sorting matches the composite score and that ordering prefers lower average distance to clusters (ties broken by composite score); assert empty-source fallback per Property 18
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.10**

- [ ] 13. Transportation_Agent
  - [ ] 13.1 Implement computeDailyRoutes, rankTransportOptions, and disruption handling
    - In `packages/server/src/agents/TransportationAgent.ts`, implement `computeDailyRoutes(itinerary)`, `rankTransportOptions(origin, destination)`, `handleDisruption(event, itinerary)`, and `emitCostUpdates(plan)`
    - Compute `score(t) = 0.4·n_time + 0.4·n_cost + 0.2·n_transfers`; truncate to at most 5 options per leg
    - On Mapping_Service failure, return options populated with `textDirections`; on unroutable pairs, return a nearest-reachable-alternative entry
    - Emit cost updates to Budget_Agent within 5 seconds; complete disruption recompute within 60 seconds
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [ ]* 13.2 Write property test for transport ranking and fallbacks
    - **Property 22: Transportation ranking truncation and ordering**
    - **Property 23: Transportation fallbacks**
    - Generate random candidate transport options and route requests (including Mapping_Service-down scenarios and unroutable pairs); assert at most 5 options per leg sorted by descending composite score, `textDirections` populated under mapping outage, and nearest-reachable-alternative emitted when no route exists
    - **Validates: Requirements 9.2, 9.5, 9.6**

- [ ] 14. Notification_Service
  - [ ] 14.1 Implement publish, feedFor, markRead, and the trigger-table dispatcher
    - In `packages/server/src/services/NotificationService.ts`, implement `publish(notification)`, `feedFor(memberId, roomId)` returning notifications sorted by `createdAt` descending, and `markRead(memberId, ids)` as idempotent
    - Wire the trigger table: phase transition (30s, all), vote initiated (immediate, all), 50% deadline reminder (non-voters), budget risk (30s, all), transport disruption alt-routes (30s, affected), activity flagged (30s, all), hotel option Manual_Verification (30s, all), flight option Manual_Verification (30s, all)
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10, 14.11_

  - [ ]* 14.2 Write property test for trigger table, feed order, and read state
    - **Property 33: Notification triggers match the trigger table**
    - **Property 34: Notification feed ordering and read state**
    - Generate random event streams and `markRead` calls; assert exactly one notification per qualifying event with the right audience and `kind`, no notification for non-qualifying events, `feedFor` returns descending `createdAt` order, and `markRead` is idempotent
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10**

- [ ] 15. Reminder_Service
  - [ ] 15.1 Implement prompt windows, reminder ticks, pending-task derivation, and deadline behavior
    - In `packages/server/src/services/ReminderService.ts`, implement `setPromptWindow`, `getPendingTasks(memberId, roomId)`, and `evaluateReminders(now)`
    - Tick every 30s; emit at most one 50%-threshold reminder per `(member, phase)`; on deadline, notify the owner of incomplete inputs and allow `advancePhase` with available inputs while recording missing inputs in `missing_inputs[phase]`
    - Hydrate pending tasks within 5 seconds on rejoin (Req 10.6)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [ ]* 15.2 Write property test for reminder thresholds, deadline behavior, and pending tasks
    - **Property 24: Reminder threshold is exactly-once per (member, threshold)**
    - **Property 25: Deadline passage allows owner to proceed; missing inputs recorded**
    - **Property 26: Pending-task derivation is correct**
    - Generate random `PromptWindow`s, tick sequences, and member completion states; assert at most one 50% reminder per `(member, phase)` and exactly one when conditions are met; assert deadline acceptance records `missing_inputs` and notifies the owner; assert `getPendingTasks` returns exactly the unsubmitted required inputs for the current phase
    - **Validates: Requirements 10.3, 10.4, 10.5, 10.6**

- [ ] 16. Travel_Planning_Agent
  - [ ] 16.1 Implement the destination submodule
    - In `packages/server/src/agents/travelPlanning/destination.ts`, implement `generateDestinationOverview(state)` that builds a constraint matrix (overlap windows, budget bands, interest tags, seasonality) and prompts the LLM for 3–8 candidates
    - Normalize with Activity_Data_Source signals; mark missing weather, cost, opening-hour, and feasibility fields as `manual_verification`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ] 16.2 Implement the preference submodule (categorization)
    - In `packages/server/src/agents/travelPlanning/preference.ts`, implement `structurePreferences(state)` that categorizes free-text into `attractions, food, shopping, nightlife, nature, culture, activities, accommodation_area, transportation, constraints`
    - Tag each item with `strength ∈ {must_have, nice_to_have, avoid}`; produce both per-member and global views
    - _Requirements: 4.5, 4.6_

  - [ ]* 16.3 Write property test for preference categorization
    - **Property 7: Preference categorization is total and disjoint**
    - Generate random preference inputs and LLM responses; assert each `PreferenceItem` belongs to exactly one category and carries a valid `strength`
    - **Validates: Requirements 4.6**

  - [ ] 16.4 Implement conflict detection
    - In `preference.ts`, implement `detectConflicts(prefs)` covering time, budget, location, availability, and disagreement conflicts
    - For each conflict, emit a `PreferenceConflict` with a non-empty `involvedItems` list and a `resolution` of kind `compromise` or `vote`
    - When the resolution is `vote`, request a poll via Voting_Service through the Agent Orchestrator
    - _Requirements: 4.7, 4.8_

  - [ ]* 16.5 Write property test for conflict detection shape
    - **Property 8: Preference conflict detection and resolution shape**
    - Generate random structured preference sets (including planted duplicates and contradictions); assert every detected conflict carries non-empty `involvedItems` and a `compromise|vote` resolution, and that every planted contradiction appears in at least one detected conflict
    - **Validates: Requirements 4.7, 4.8**

  - [ ] 16.6 Implement the itinerary generation submodule
    - In `packages/server/src/agents/travelPlanning/itinerary.ts`, implement `generateItinerary(state)` that honors selected flight arrival/departure times, hotel location, opening hours, and travel time between items
    - Produce exactly one `ItineraryDay` per date in the trip range with non-overlapping items, every required field populated, and `endTime > startTime`
    - Time-box first generation to 90 seconds via `AbortController`; on timeout, emit a partial itinerary with `manual_verification` flags rather than failing
    - _Requirements: 4.9, 4.10, 4.11_

  - [ ]* 16.7 Write property test for itinerary day coverage and valid items
    - **Property 9: Generated itinerary covers every trip day with valid items**
    - Generate random trip date ranges and contexts; assert exactly one `ItineraryDay` per date in order, no time overlaps within a day, and every required field populated with `endTime > startTime`
    - **Validates: Requirements 4.9, 4.10**

  - [ ] 16.8 Implement item validation, flagging, and alternatives
    - In `itinerary.ts`, implement `validateItinerary(itinerary, state)` that checks each item against Activity_Data_Source opening hours, closure days, and booking availability
    - Flag items as `closed`, `unavailable`, or `not_bookable`; suggest at least one alternative item or date when feasible; populate a non-empty `reason` when no alternative is feasible
    - Mark items as `manual_verification` when availability data is missing
    - _Requirements: 4.12, 4.13, 4.14_

  - [ ]* 16.9 Write property test for flagged items with alternatives or reasons
    - **Property 10: Flagged items carry an alternative or a reason**
    - Generate random flagged items and validator outputs; assert each flagged item produces either an alternative targeting the same preference source/date or a non-empty `reason`
    - **Validates: Requirements 4.13**

  - [ ] 16.10 Implement replan, change-log emission, and version history
    - In `itinerary.ts`, implement `replanFromEvent(event, currentItinerary, state)` that diffs the new itinerary against the prior version and emits `ItineraryItemChange` events each carrying a non-empty `reason`
    - Append the new itinerary to `itineraryVersions` (never mutating prior versions); time-box replans to 30 seconds (Req 4.15)
    - _Requirements: 4.15, 4.16, 4.17_

  - [ ]* 16.11 Write property test for change reasons and version history
    - **Property 11: Every itinerary change carries an explanation**
    - **Property 12: Itinerary version history is preserved and append-only**
    - Generate sequences of replan inputs; assert every emitted `ItineraryItemChange.reason` is non-empty, `itineraryVersions.length = N` after N generations, versions appear in generation order, and every prior version is byte-identical to its original
    - **Validates: Requirements 4.16, 4.17**

  - [ ] 16.12 Implement unsatisfied must-haves reporting
    - In `itinerary.ts`, populate `unsatisfiedMustHaves` with each unsatisfied `must_have` preference tagged with a reason in `{time, distance, budget, opening_hours, booking_unavailable, missing_data}`
    - _Requirements: 4.18_

  - [ ]* 16.13 Write property test for unsatisfied must-haves
    - **Property 13: Unsatisfied must-haves are reported with categorized reasons**
    - Generate random itineraries where some must-haves are unreachable; assert the response lists exactly those must-haves and that each carries a reason in the allowed set
    - **Validates: Requirements 4.18**

  - [ ] 16.14 Implement the equally-feasible vote-request path
    - In `itinerary.ts`, when two candidate variants have equal feasibility scores within tolerance ε, emit a `requestVote` `AgentOutput` whose poll options correspond to the tied variants
    - _Requirements: 4.19_

  - [ ]* 16.15 Write property test for equally-feasible → vote
    - **Property 14: Equally feasible itinerary alternatives trigger a vote**
    - Generate variant pairs with engineered equal feasibility; assert a `requestVote` is emitted and the created poll's options exactly match the tied variants
    - **Validates: Requirements 4.19**

- [ ] 17. Agent Orchestrator
  - [ ] 17.1 Implement the phase-changed listener and agent dispatch
    - In `packages/server/src/orchestrator/AgentOrchestrator.ts`, subscribe to Room_State events and phase transitions
    - Dispatch to the correct agent (destination → Travel_Planning_Agent, flight selection → Flight_Agent, accommodation → Hotel_Agent, itinerary planning → Travel_Planning_Agent + Transportation_Agent + Budget_Agent)
    - Forward agent `requestVote` outputs to Voting_Service and route closed-poll callbacks back to the Travel_Planning_Agent
    - _Requirements: 2.2, 3.8, 4.1, 4.5, 4.9, 5.8, 5.9_

  - [ ] 17.2 Implement applyAgentOutput broadcast and Budget integration
    - On `AgentOutput`, persist the event via Collaboration_Service and broadcast to room members
    - On `flight.selected`, `accommodation.selected`, and `transport.updated`, push prices to Budget_Agent within 5 seconds and update `Room_State.selectedFlight` / `selectedAccommodation` / `transportPlan` consistently
    - _Requirements: 6.6, 7.9, 8.7, 9.8, 11.7_

  - [ ]* 17.3 Write property test for selection events updating budget consistently
    - **Property 21: Selection events update Budget consistently**
    - Generate random selection events (flight, accommodation, transport-cost) with category prices; assert `BudgetSnapshot.estimatedByCategory[c]` equals the corresponding selection price (or the leg-cost sum for transportation) and that `Room_State` references the same prices
    - **Validates: Requirements 6.6, 7.9, 8.7, 9.8**

- [ ] 18. Checkpoint - agents and orchestration
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 19. Final Plan, Export, and Archive
  - [ ] 19.1 Implement the critical-warning gate for the Final Plan transition
    - In `packages/server/src/services/FinalPlanService.ts`, implement `canEnterFinalPlan(state)` that returns false if any unresolved critical warning exists (unavailable activity, missing selected flight, missing selected accommodation, over-budget alert)
    - Wire the gate into `CollaborationService.advancePhase` for the `review → final_plan` transition
    - _Requirements: 4.20, 13.2_

  - [ ]* 19.2 Write property test for critical warnings gating
    - **Property 29: Critical warnings gate the Final Plan transition**
    - Generate random `Room_State`s with engineered critical-warning combinations; assert `advancePhase(review → final_plan)` is rejected iff at least one critical warning is unresolved
    - **Validates: Requirements 4.20, 13.2**

  - [ ] 19.3 Implement the final itinerary summary builder
    - In `packages/server/src/services/FinalPlanService.ts`, implement `buildFinalSummary(state)` returning a `FinalItinerarySummary` populated with `tripDates`, `destination`, `flight`, `accommodation`, `dailySchedule`, `routePlan`, `budget`, `bookingLinks`, `manualVerificationNotes`, `unresolvedWarnings`, and the standard `disclaimer` string
    - _Requirements: 13.3, 13.5, 13.8_

  - [ ] 19.4 Implement export to markdown, plain text, table, and PDF
    - In `packages/server/src/services/ExportService.ts`, implement `exportSummary(summary, format)` for `markdown`, `plain_text`, `table`, and `pdf`
    - Implement `parseMarkdownSummary(markdown)` returning a `FinalItinerarySummary` for round-trip property testing
    - _Requirements: 13.4, 13.5_

  - [ ]* 19.5 Write property test for final summary schema and export round-trip
    - **Property 30: Final summary schema, warnings, and disclaimer**
    - **Property 31: Export round-trip preserves structure**
    - Generate random Final-Plan-stage `Room_State`s and exported summaries; assert every required field is present in `buildFinalSummary`, unresolved warnings and disclaimer are included, and `parseMarkdownSummary(exportSummary(s, "markdown"))` structurally equals `s` on all schema fields
    - **Validates: Requirements 13.3, 13.4, 13.5, 13.8**

  - [ ] 19.6 Implement archive mode and read-only enforcement
    - In `CollaborationService.ts`, implement `archiveRoom(roomId, actorId)` that sets `archived = true` and rejects every subsequent mutation
    - Preserve final itinerary, votes, preferences, accommodation choice, budget records, and transportation details verbatim
    - _Requirements: 13.6_

  - [ ]* 19.7 Write property test for archived room read-only
    - **Property 32: Archived room is read-only and field-preserving**
    - Generate random pre-archive states and post-archive mutation attempts; assert all mutations are rejected and `getRoomState` returns the same final itinerary, votes, preferences, accommodation, budget, and transportation as at archival time
    - **Validates: Requirements 13.6**

- [ ] 20. Travel_Dashboard frontend
  - [ ] 20.1 Implement the Room_State store and WebSocket client
    - In `packages/client/src/state/roomStore.ts`, create a Zustand store hydrated from `syncSince` and updated by incoming WebSocket events
    - In `packages/client/src/net/socket.ts`, manage connection, heartbeat (10s), reconnect-with-`lastVersion`, and queued offline submissions
    - Throttle dashboard renders to at most once every 250ms while ensuring updates reflect underlying changes within 5 seconds
    - _Requirements: 11.1, 11.3, 11.5, 11.6, 12.3_

  - [ ] 20.2 Implement PhaseHeader, AvailabilityPanel, and DestinationOverviewPanel
    - PhaseHeader displays current phase, allowed actions, and per-member completion percentages
    - AvailabilityPanel collects availability, interests, and constraints
    - DestinationOverviewPanel renders agent output with `Manual_Verification` badges and a retry / manual-entry action
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 12.1, 12.2, 12.4, 12.5_

  - [ ] 20.3 Implement VotingPanel, FlightComparisonPanel, and AccommodationPanel
    - VotingPanel embeds in phases 3, 4, 5, and 7; hides per-member choices while open; renders tiebreaker polls
    - FlightComparisonPanel renders the three category groups side-by-side with retrieval timestamps and `Manual_Verification` badges
    - AccommodationPanel renders ranked groups, suggested areas, distance to clusters, and cancellation flexibility
    - _Requirements: 5.1, 5.7, 6.2, 6.3, 7.2, 7.3, 7.5, 12.5_

  - [ ] 20.4 Implement PreferencePanel and ItineraryPanel
    - PreferencePanel collects free-text preferences and displays structured categories
    - ItineraryPanel renders day-by-day items with status colors, "Compare to previous" view, change reasons, and unsatisfied-must-haves list
    - _Requirements: 4.5, 4.10, 4.16, 4.17, 4.18, 12.5_

  - [ ] 20.5 Implement BudgetPanel and TransportationPanel
    - BudgetPanel shows total budget, spent amount, remaining amount, per-category allocation, Budget_Risk alerts, and cheaper-alternative suggestions
    - TransportationPanel shows daily route plans, ranked options, mapping links (or text directions on fallback), and disruption alerts
    - _Requirements: 8.1, 8.3, 8.6, 9.1, 9.2, 9.4, 9.6, 12.1_

  - [ ] 20.6 Implement WarningsTray, NotificationsFeed, and ExportPanel
    - WarningsTray aggregates Info / Warning / Critical warnings, including `manual_verification`, `data_temporarily_unavailable`, `over_budget`, and `unavailable_activity`
    - NotificationsFeed shows the chronological feed with read/unread distinction; calls `markRead` on view
    - ExportPanel exposes markdown / plain text / table / PDF downloads with unresolved warnings included
    - _Requirements: 12.4, 13.1, 13.4, 13.5, 13.7, 13.8, 14.9, 14.10_

  - [ ]* 20.7 Write unit and snapshot tests for panels
    - Snapshot-test each panel under empty, partial, full, `manual_verification`, and `critical_warning` `Room_State` fixtures using React Testing Library
    - _Requirements: 12.1, 12.3, 12.4, 12.5, 12.6_

  - [ ]* 20.8 Write property test for completion-% display and manual-fallback exposure
    - **Property 35: Completion percentage formula**
    - **Property 36: Manual fallback availability on data-source errors**
    - Generate random `(completed, total)` and `manual_verification` flag combinations; assert PhaseHeader renders the correct percentage and that any section with a `manual_verification` or `data_source_error` flag exposes a `retry` or `manual_entry` action in the rendered view model
    - **Validates: Requirements 12.2, 12.6**

- [ ] 21. End-to-end scenario tests
  - [ ]* 21.1 Write E2E test for the happy path
    - Drive three members through full overlap → destination pick → flight + hotel booking → itinerary generation → export
    - Assert each phase transition broadcasts within 2s, the final summary contains all required fields, and the export includes the disclaimer
    - _Requirements: 1.1, 2.1, 3.4, 4.9, 5.4, 6.4, 7.4, 8.1, 9.1, 11.1, 13.3, 13.4, 14.1_

  - [ ]* 21.2 Write E2E test for destination tie + tiebreaker
    - Configure votes so the destination poll ties; assert the Voting_Service auto-creates a tiebreaker containing only the tied options and that the second poll resolves the destination
    - _Requirements: 5.4, 5.5, 5.8, 14.2_

  - [ ]* 21.3 Write E2E test for stale data and Manual_Verification gating
    - Configure Flight_Data_Source and Activity_Data_Source to return stale data; assert `Manual_Verification` badges propagate, Review phase blocks until acknowledged, and notifications are emitted within 30s
    - _Requirements: 4.4, 4.14, 4.20, 6.5, 7.8, 13.2, 14.6, 14.7, 14.8_

  - [ ]* 21.4 Write E2E test for budget breach and cheaper alternatives
    - Record spending records that push the projection above 110%; assert Budget_Agent emits a `Budget_Risk` notification, suggests at least two alternatives each ≥20% cheaper, and the dashboard updates within 5s
    - _Requirements: 8.1, 8.3, 8.4, 8.6, 14.4_

  - [ ]* 21.5 Write E2E test for offline rejoin and LWW
    - Disconnect a client, perform queued edits (including a vote-cast attempt), reconnect, and assert `syncSince` replay, LWW resolution on non-vote fields, and vote-immutability rejection produce the canonical state
    - _Requirements: 11.3, 11.4, 11.6, 11.7_

  - [ ]* 21.6 Write E2E test for revert and downstream regeneration
    - From the AI Itinerary Planning phase, owner reverts to Preference Collection; assert the latest itinerary, transport plan, and budget projection are marked `requires_regeneration`, downstream artifacts render as draft, and the next advance regenerates them
    - _Requirements: 2.4, 2.5, 4.15, 9.7_

- [ ] 22. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP, but the property and end-to-end tests are the primary correctness guarantee for this design.
- Every property-based test sub-task carries a `// Feature: collaborative-travel-planner, Property {N}: ...` header for traceability (per the design's Testing Strategy section) and runs with at least 100 fast-check iterations.
- External adapters (Flight, Hotel, Activity, Mapping, LLM) implement the shared error envelope and circuit-breaker behavior from the design; their contract tests run against vendor sandboxes.
- Checkpoints (tasks 5, 10, 18, 22) are non-coding pauses for the implementer to confirm tests pass; they are excluded from the dependency graph below.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.3", "2.5", "2.7", "2.9", "3.1"] },
    { "id": 3, "tasks": ["2.2", "2.4", "2.6", "2.8", "2.10", "3.2"] },
    { "id": 4, "tasks": ["3.3", "4.1", "4.2"] },
    { "id": 5, "tasks": ["6.1", "7.1", "8.1", "9.1", "14.1", "15.1"] },
    { "id": 6, "tasks": ["6.3", "7.2", "8.2", "9.2", "9.4", "9.6", "9.7", "9.8", "14.2", "15.2"] },
    { "id": 7, "tasks": ["6.4", "8.3", "9.3", "9.5", "11.1", "12.1", "13.1", "16.1"] },
    { "id": 8, "tasks": ["6.5", "11.2", "12.2", "13.2", "16.2", "16.6"] },
    { "id": 9, "tasks": ["6.6", "11.3", "16.3", "16.4", "16.7", "16.8"] },
    { "id": 10, "tasks": ["6.2", "6.7", "16.5", "16.9", "16.10"] },
    { "id": 11, "tasks": ["16.11", "16.12"] },
    { "id": 12, "tasks": ["16.13", "16.14"] },
    { "id": 13, "tasks": ["16.15", "17.1"] },
    { "id": 14, "tasks": ["17.2"] },
    { "id": 15, "tasks": ["17.3", "19.1", "19.3", "19.4", "19.6"] },
    { "id": 16, "tasks": ["19.2", "19.5", "19.7", "20.1"] },
    { "id": 17, "tasks": ["20.2", "20.3", "20.4", "20.5", "20.6"] },
    { "id": 18, "tasks": ["20.7", "20.8"] },
    { "id": 19, "tasks": ["21.1", "21.2", "21.3", "21.4", "21.5", "21.6"] }
  ]
}
```
