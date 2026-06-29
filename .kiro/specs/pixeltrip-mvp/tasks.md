# Implementation Plan: PixelTrip MVP

## Overview

This plan builds PixelTrip as a Next.js 14 (App Router) + TypeScript + Tailwind app on Supabase, with AI agents running server-side via the kiro/AWS Bedrock API. It is scoped for a **1-week hackathon MVP**, so tasks are ordered to reach a working end-to-end vertical slice as early as possible, then layer polish.

The ordering deliberately front-loads the three demo moments from the product North Star:

- **Demo Moment 1 — "Why this place?"** Destination recommendations with season/weather/crowd/price/persona reasoning (Tasks under section 6).
- **Demo Moment 2 — "It reflects my character"** Persona-driven itinerary with visible per-persona benefits and fairness (Tasks under section 11).
- **Demo Moment 3 — "The AI helps us negotiate"** Feedback → conflict mediation → resolution voting → revision (Tasks under sections 13–14).

The pipeline (room → persona → availability → group profile → destinations → vote → flights → activities → itinerary → feedback → negotiation → final) is the room-stage state machine from the design. Each stage component is wired into the `StageRouter` as it is built, so there is no orphaned code.

Conventions:
- Implementation language is **TypeScript** throughout.
- Prefer lightweight persistence and mocked/seeded data (flights, weather/crowd/price are AI-estimated) to reduce demo risk.

## Tasks

- [ ] 1. Project foundation and shared types
  - [x] 1.1 Scaffold the Next.js 14 + TypeScript + Tailwind project with Supabase client
    - Initialise Next.js 14 App Router project with TypeScript and Tailwind CSS
    - Add the Supabase JS client and a server-side Supabase helper (`lib/supabase.ts`) reading env vars
    - Add a `lib/bedrock.ts` placeholder module and `.env.example` documenting Supabase + kiro/AWS Bedrock keys
    - Create the base folder structure (`app/`, `app/components/`, `app/api/`, `lib/`)
    - _Requirements: 1.1_

  - [x] 1.2 Define core TypeScript types for all data models
    - Add `lib/types.ts` with interfaces/enums for User, Persona, TripRoom, RoomStage, Availability, DestinationPreference, DestinationSuggestion, Vote, ActivityPreference, Itinerary, ItineraryDay, ItineraryItem, FairnessSummary, ItineraryFeedback, ConflictResolution, ConflictOption
    - Define the `RoomStage` enum matching the state machine (LOBBY → … → FINAL)
    - _Requirements: 2.2, 5.2, 9.1, 9.7, 10.2, 12.4, 13.4_

  - [x] 1.3 Create the Supabase schema and seed personas
    - Write SQL for tables: users, personas, trip_rooms, availability, destination_preferences, destination_suggestions, votes, activity_preferences, itineraries, itinerary_feedback, conflict_resolutions
    - Add a unique constraint on votes `(room_id, user_id, vote_type)` to block duplicate votes
    - Seed the 5 personas (Foodie Boss, Scenic Wanderer, Master Planner, Chill Explorer, Luxury Traveller) with budget, pace, interests, flexibility, decision style, avatar path, and `planningWeight`
    - _Requirements: 2.1, 2.2, 6.2_

- [ ] 2. Trip room creation, join, and realtime shell
  - [x] 2.1 Implement room and stage API routes
    - `POST /api/rooms` generates a unique 6-char uppercase room code and stores host + initial stage LOBBY
    - `GET /api/rooms/[code]` returns the room or a clear not-found/expired error
    - `PATCH /api/rooms/[id]/stage` advances the stage, rejecting requests where `requestingUserId !== hostUserId`
    - _Requirements: 1.1, 1.3, 1.4, 1.7_

  - [x] 2.2 Implement user join API and client identity helper
    - `POST /api/users` creates/updates a user (displayName, roomId) in a room
    - Add `lib/identity.ts` that generates a UUID userId and persists displayName in `localStorage`
    - _Requirements: 1.3_

  - [x] 2.3 Build landing page, room shell, and StageRouter with Supabase Realtime
    - `app/page.tsx`: create-room and join-by-code forms showing the room code and shareable invite link on creation
    - `app/room/[code]/page.tsx`: room shell that subscribes to `room:{roomId}:presence` and `room:{roomId}:stage` channels and re-renders on stage change
    - `StageRouter.tsx`: render the active stage component based on `currentStage`
    - _Requirements: 1.2, 1.5, 1.6_

  - [x] 2.4 Build LobbyStage with live member list and host stage control
    - Render all joined members with realtime connection status via Supabase Presence
    - Show the current stage to all users; render an "Advance stage" control visible only to the host
    - _Requirements: 1.5, 1.6, 1.7_

- [ ] 3. Persona selection
  - [x] 3.1 Build persona list API, PersonaCard, and lobby persona selection
    - `GET /api/personas` returns all seeded personas
    - `PersonaCard.tsx` renders avatar, name, budget, interests, pace, flexibility, decision style
    - In LobbyStage, allow selecting a persona (saved to the user's room profile), display each member's chosen persona to everyone, and allow changing it until the host advances past LOBBY
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 4. Availability and destination interest
  - [x] 4.1 Implement availability API and date-overlap utility
    - `POST /api/availability` stores one or more date ranges and one or more preferred countries/cities per user
    - Add `lib/overlap.ts` `calculateOverlap()` that returns the overlapping window across the group or null
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

  - [x] 4.2 Build AvailabilityStage UI
    - Inputs for multiple date ranges and multiple destination interests
    - When all users have submitted, show the overlapping window; when none exists, show a clear "no overlap" message and block progression
    - _Requirements: 3.1, 3.2, 3.4, 3.6_

- [ ] 5. Group travel profile agent
  - [x] 5.1 Implement the Bedrock client wrapper and JSON-safe agent helper
    - Implement `lib/bedrock.ts` to call the kiro/AWS Bedrock API server-side only
    - Add a helper that enforces JSON-only output, parses the response, retries once on parse failure, and returns `{ error, retryable }` on failure
    - _Requirements: 5.5_

  - [x] 5.2 Implement the group-profile agent route and prompt
    - `POST /api/agents/group-profile` builds context from users, personas, availabilities, destination preferences
    - Prompt returns budgetRange, dominantPace, commonInterests, travelWindow, tensionPoints, dominantPersonaTraits (under 300 words)
    - Persist the resulting group profile for the room
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 5.3 Build GroupProfileStage UI
    - Display the combined profile and identified tension points to all members before destinations are shown
    - Provide a retry button when the agent returns a retryable error
    - _Requirements: 4.3, 4.4_

- [ ] 6. Destination suggestions — DEMO MOMENT 1 ("Why this place?")
  - [x] 6.1 Implement the destination research agent route and prompt
    - `POST /api/agents/destinations` produces 3–5 `DestinationSuggestion` items sorted by fitScore descending
    - Prompt assesses seasonality, weather, crowd level, price level, top activities, downsides, and persona fit for the group's travel window; explicitly explains trade-offs and excludes/justifies poor fits rather than giving generic picks
    - Persist suggestions to `destination_suggestions`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 6.2 Build DestinationCard and DestinationsStage UI
    - `DestinationCard.tsx` surfaces fitScore, weather/seasonality reasoning, crowd + price levels, best activities, downsides, persona fit, and the recommendation reason
    - `DestinationsStage.tsx` renders ranked suggestions with retry on agent failure
    - _Requirements: 5.2, 5.3, 5.4_

- [ ] 7. Reusable voting
  - [x] 7.1 Implement votes API with tally and tie-break
    - `POST /api/votes` accepts one vote per user per round, rejecting duplicates via the DB constraint
    - `GET /api/votes/[roomId]/[voteType]` returns tallied results; selection rule picks the top option and flags ties
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 7.2 Build VotePanel and reusable VotingStage
    - `VotePanel.tsx` + `VotingStage.tsx` usable for destination, flight, and conflict-resolution votes
    - Show live results when all have voted; trigger a tie-break round between tied options; on destination win, advance to FLIGHTS
    - _Requirements: 6.3, 6.4, 6.5, 6.6_

- [ ] 8. Checkpoint — end-to-end slice through destination selection
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Flight option selection (mocked data)
  - [ ] 9.1 Add mocked flight data and flight selection storage
    - Provide three hardcoded option objects (Budget, Comfort, Best Value) with price range, duration, stops, and a short explanation per destination
    - Store the selected flight category on the room for itinerary planning
    - _Requirements: 7.1, 7.2, 7.3, 7.6_

  - [ ] 9.2 Build FlightStage UI and wire flight voting
    - Render the three categories with explanations of how each affects the itinerary experience
    - Reuse VotingStage for the flight vote; on win, store selection and advance to ACTIVITIES
    - _Requirements: 7.4, 7.5, 7.6_

- [ ] 10. Activity and preference collection
  - [ ] 10.1 Implement activity-preferences API
    - `POST /api/activity-preferences` stores activities, restaurants, sights, experiences, and avoid items against the submitting user, each marked must-have or optional
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ] 10.2 Build ActivitiesStage UI
    - Forms to add must-have/optional items and avoid items; list the current user's submissions
    - _Requirements: 8.1, 8.2, 8.3_

- [ ] 11. Persona-driven itinerary and fairness — DEMO MOMENT 2 ("It reflects my character")
  - [ ] 11.1 Implement the persona-based itinerary agent route and prompt
    - `POST /api/agents/itinerary` takes destination, dates, flight option, group profile, activity preferences, personas
    - Prompt builds day-by-day plans (morning/afternoon/evening/optional night) with activities, food, and rest; respects must-haves; weights activities by persona; balances budget/pace/food/scenery/comfort; records reasoning and `personaBenefits` per item; returns a `fairnessSummary` with per-persona coverage, warnings, and recommendations
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ] 11.2 Implement itinerary persistence with versioning
    - `GET /api/itinerary/[roomId]` returns the current draft; store each generated itinerary with an incrementing `versionNumber` and `status: 'draft'`
    - _Requirements: 9.1, 14.2_

  - [ ] 11.3 Build ItineraryDay component and ItineraryStage UI
    - `ItineraryDay.tsx` renders each day's sections, and for each item shows its reason and the persona names that benefit (making persona influence visible)
    - `ItineraryStage.tsx` renders the full plan with retry on agent failure
    - _Requirements: 9.2, 9.3, 9.6, 9.7_

  - [ ] 11.4 Build FairnessSummary component and FairnessStage
    - `FairnessSummary.tsx` shows per-persona representation, warnings (too expensive for low-budget, too packed for chill personas, unbalanced), and concrete improvement recommendations
    - _Requirements: 10.2, 10.3, 10.4, 10.5_

- [ ] 12. Checkpoint — full plan generated with visible persona fairness
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Itinerary feedback scoring and amendments
  - [ ] 13.1 Implement feedback API with score aggregation
    - `POST /api/feedback` stores per-user score (1–10), liked/disliked items, requested additions/removals, and up to 3 important requests
    - `GET /api/feedback/[itineraryId]` returns all feedback plus the group average and per-persona summaries
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4_

  - [ ] 13.2 Build FeedbackForm and FeedbackStage UI
    - Score slider, comment box, add/remove requests, and important-request marking (max 3)
    - Display group average; recommend revision when average < 6; highlight any single score < 4 as potential persona unfairness; show all amendment requests to the group
    - _Requirements: 11.1, 11.3, 11.4, 11.5, 11.6, 12.5_

  - [ ] 13.3 Implement the feedback-analysis agent route and prompt
    - `POST /api/agents/feedback-analysis` returns averageScore, unhappyPersonas, conflictingRequests, suggestedAmendments, and `requiresNegotiation`
    - Prompt summarises combined changes and detects conflicts with budget, timing, routing, or other users' preferences
    - _Requirements: 12.6, 12.7_

- [ ] 14. AI negotiation and revision loop — DEMO MOMENT 3 ("The AI helps us negotiate")
  - [ ] 14.1 Implement the negotiation agent route and prompt
    - `POST /api/agents/negotiation` explains each conflict in plain language, identifies affected users/personas, and proposes at least two concrete resolution options with trade-offs
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ] 14.2 Implement the conflicts API
    - `POST /api/conflicts` creates a conflict record (summary, affected users, proposed options, status open→voting)
    - `PATCH /api/conflicts/[id]` records the selected resolution and marks it resolved
    - _Requirements: 13.1, 13.5_

  - [ ] 14.3 Build NegotiationStage and wire resolution voting
    - Render the conflict explanation, affected personas, and options; reuse VotingStage for `conflict_resolution` votes
    - _Requirements: 13.2, 13.3, 13.4, 13.5_

  - [ ] 14.4 Implement the itinerary revision loop
    - On a winning resolution, regenerate the itinerary applying the chosen option, preserving unchanged parts where possible and incrementing the version
    - Produce a diff summary of what changed, regenerate the fairness summary, recompute the satisfaction score, and allow the host to loop FEEDBACK→NEGOTIATION again or end the loop
    - _Requirements: 13.6, 13.7, 13.8, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

- [ ] 15. Checkpoint — negotiation loop works end to end
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Final itinerary and export
  - [ ] 16.1 Implement finalise API and edit locking
    - `POST /api/itinerary/[roomId]/finalise` marks the itinerary `final`, sets `finalItineraryId`, and blocks further edits unless the host reopens planning
    - _Requirements: 15.1, 15.5_

  - [ ] 16.2 Build FinalStage and ExportButton
    - Render a clean day-by-day final view including destination, dates, flight category, daily plan, activity notes, and final fairness summary
    - `ExportButton.tsx` copies the itinerary as plain text / Markdown
    - _Requirements: 15.2, 15.3, 15.4_

## Notes

- Task order front-loads the three demo moments: destination "why" (section 6), persona-fair itinerary (section 11), and negotiation (sections 13–14). Sections 1–7 deliver the first demoable vertical slice through destination selection.
- Each stage component is wired into `StageRouter` as it is built, so nothing is left orphaned.
- MVP simplifications from the design are honoured: mocked flight data, AI-estimated weather/crowd/price, no auth (localStorage userId), and Supabase Realtime for presence + stage broadcasts.
- All AI calls run server-side in API routes; the browser never calls the Bedrock API directly.
- Checkpoints (sections 8, 12, 15) provide incremental validation points before layering the next demo moment.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2", "4.1", "5.1", "7.1", "9.1", "10.1"] },
    { "id": 3, "tasks": ["2.3", "5.2", "6.1", "11.1", "11.2", "13.1", "13.3", "14.1", "14.2"] },
    { "id": 4, "tasks": ["2.4", "3.1", "4.2", "5.3", "6.2", "7.2", "9.2", "10.2", "11.3", "11.4", "13.2", "14.3", "16.1"] },
    { "id": 5, "tasks": ["14.4", "16.2"] }
  ]
}
```
