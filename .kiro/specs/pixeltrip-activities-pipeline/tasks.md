# Implementation Plan: PixelTrip Activities Pipeline

## Overview

This plan implements the second half of the PixelTrip pipeline: ACTIVITIES → ITINERARY → FEEDBACK → NEGOTIATION → FINAL. All shared types and DB tables are already provisioned. Implementation proceeds in five waves: data API routes first, then the three AI agent routes, then presentational sub-components, then the five stage components, and finally wiring them all into StageRouter. Each wave builds on the previous and nothing is left unwired.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "name": "Data API Routes",
      "tasks": ["1.1", "1.2", "1.3", "1.4"]
    },
    {
      "wave": 2,
      "name": "Agent Routes",
      "tasks": ["2.1", "2.2", "2.3"],
      "dependsOn": ["1.1", "1.2", "1.3", "1.4"]
    },
    {
      "wave": 3,
      "name": "Sub-components",
      "tasks": ["3.1", "3.2", "3.3", "3.4"]
    },
    {
      "wave": 4,
      "name": "Stage Components",
      "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5"],
      "dependsOn": ["1.1", "1.2", "1.3", "1.4", "2.1", "2.2", "2.3", "3.1", "3.2", "3.3", "3.4"]
    },
    {
      "wave": 5,
      "name": "Wiring",
      "tasks": ["5.1"],
      "dependsOn": ["4.1", "4.2", "4.3", "4.4", "4.5"]
    }
  ]
}
```

## Tasks

- [x] 1.1 Implement `POST /api/activity-preferences` and `GET /api/activity-preferences`
  - Implements: Req 8 (activity and preference collection)
  - File: `app/api/activity-preferences/route.ts`
  - POST: validate body `{ roomId, userId, title, type, priority, notes? }`. `type` must be one of `activity | food | sight | experience | avoid`. `priority` must be `must_have | optional`. INSERT into `activity_preferences`. Return 201 with the new `ActivityPreference`.
  - GET: read `?roomId=` param. SELECT all rows WHERE `room_id = roomId`. Return `ActivityPreference[]`.
  - DELETE: read `?id=&userId=`. Validate the row's `user_id` matches the provided `userId`. DELETE. Return 204.
  - Map snake_case DB rows to camelCase `ActivityPreference` type. Follow the row-mapper pattern from `roomHelpers.ts`.
  - Return 400 for missing/invalid fields, 404 if room not found.

- [x] 1.2 Implement `GET /api/itinerary/[roomId]` and `POST /api/itinerary/[roomId]/finalise`
  - Implements: Req 14 (version history), Req 15 (finalise)
  - Files: `app/api/itinerary/[roomId]/route.ts`, `app/api/itinerary/[roomId]/finalise/route.ts`
  - GET: SELECT all `itineraries` WHERE `room_id = roomId` ORDER BY `version_number ASC`. Map rows to `Itinerary[]`. Return 200.
  - POST finalise: body `{ requestingUserId }`. Verify `requestingUserId === room.hostUserId` (403 if not). Load `trip_rooms.current_itinerary_id`. Verify current itinerary status is not already `final` (409 if it is). UPDATE `itineraries SET status='final'`. UPDATE `trip_rooms SET final_itinerary_id = current_itinerary_id`. Return updated `Itinerary`.
  - Map JSONB columns `days` and `fairness_summary` to typed `ItineraryDay[]` and `FairnessSummary`.

- [x] 1.3 Implement `POST /api/feedback`, `GET /api/feedback/[itineraryId]`
  - Implements: Req 11 (scoring), Req 12 (amendments)
  - Files: `app/api/feedback/route.ts`, `app/api/feedback/[itineraryId]/route.ts`
  - POST: validate `score` is integer in [1,10] (return 400 if not). Validate `importantRequests.length <= 3` (return 400 if not). Upsert on `(itinerary_id, user_id)` — if row exists, UPDATE; otherwise INSERT. Return 201 with `ItineraryFeedback`.
  - GET: SELECT all `itinerary_feedback WHERE itinerary_id = itineraryId`. Compute `averageScore = AVG(score)` (null if no rows). Count `submittedCount`. Load `totalMembers` from `users WHERE room_id = (SELECT room_id FROM itineraries WHERE id = itineraryId)`. Return `{ feedback: ItineraryFeedback[], averageScore, submittedCount, totalMembers }`.
  - Map JSONB array columns (`liked_items`, `disliked_items`, etc.) correctly.

- [x] 1.4 Implement `GET /api/conflicts`, `POST /api/conflicts`, `PATCH /api/conflicts/[id]`
  - Implements: Req 13 (conflict records)
  - Files: `app/api/conflicts/route.ts`, `app/api/conflicts/[id]/route.ts`
  - GET: read `?roomId=`. SELECT `conflict_resolutions WHERE room_id = roomId ORDER BY created_at ASC`. Map to `ConflictResolution[]`. Return 200.
  - POST: body `{ roomId, itineraryId, conflictSummary, affectedUsers, proposedOptions }`. Validate `proposedOptions.length >= 2`. INSERT. Return 201.
  - PATCH: body `{ selectedResolution }`. UPDATE `conflict_resolutions SET selected_resolution, status='resolved'`. Return updated `ConflictResolution`.
  - Map JSONB columns `affected_users` and `proposed_options` to typed arrays.

- [x] 2.1 Implement `POST /api/agents/itinerary` and `GET /api/agents/itinerary`
  - Implements: Req 9 (itinerary generation), Req 14 (version history)
  - File: `app/api/agents/itinerary/route.ts`
  - POST: Stage gate — verify `current_stage = 'ITINERARY'` (409 if not). Check `current_itinerary_id` — if the itinerary at that ID has `status='final'`, return 409 `{ error: "Itinerary is finalised" }`. Load: `trip_rooms` (destination, dates, flight option), `activity_preferences` for room, `character_profiles` for room (fallback to personas if absent), `room_profiles` group profile. Build system prompt (see design doc). Build user prompt JSON. Call `runAgent<unknown>`. Retry once on parse failure. Validate response: check `days` is array, each day has `morning/afternoon/evening`, each `ItineraryItem` has non-empty `personaBenefits`. Compute `version_number = MAX(version_number)+1` (or 1). INSERT `itineraries`. UPDATE `trip_rooms.current_itinerary_id`. Return 201 with `Itinerary`. On failure return `{ error, retryable }` with 500.
  - GET: `?roomId=`. SELECT `itineraries WHERE room_id = roomId ORDER BY version_number DESC LIMIT 1`. Return 200 with `Itinerary` or 404 if none.
  - Follow the `runAgent` pattern from `lib/bedrock.ts` and `destinations/route.ts`.

- [x] 2.2 Implement `POST /api/agents/feedback-analysis`
  - Implements: Req 13 (conflict identification), Demo Moment 3
  - File: `app/api/agents/feedback-analysis/route.ts`
  - Stage gate: verify `current_stage = 'FEEDBACK'` (409 if not). Load `current_itinerary_id` and the full itinerary. Load all `itinerary_feedback` for that itinerary. Load `character_profiles` for member context. Build system prompt and user prompt (itinerary + feedback array). Call `runAgent`. Retry once on parse failure. Validate: `requiresNegotiation` is boolean; if true, `conflicts.length >= 1` and each conflict has `proposedOptions.length >= 2`. If conflicts present, INSERT rows into `conflict_resolutions` with `status='open'`. Return `{ analysisText, requiresNegotiation, conflicts: ConflictResolution[] }`.

- [x] 2.3 Implement `POST /api/agents/negotiation`
  - Implements: Req 13 (resolution), Req 14 (revision loop), Demo Moment 3
  - File: `app/api/agents/negotiation/route.ts`
  - Body: `{ roomId, conflictId, selectedResolution }`. Stage gate: verify `current_stage = 'NEGOTIATION'`. Load current itinerary (full). Load conflict row (to get summary, affected users, chosen option description). Load `character_profiles`. Build system prompt and user prompt (current itinerary + conflict + chosen option). Call `runAgent`. Validate: `days` array valid, all `personaBenefits` non-empty, `diffSummary` is non-empty string. Compute new `version_number`. INSERT new `itineraries` row. UPDATE `trip_rooms.current_itinerary_id`. UPDATE `conflict_resolutions SET status='resolved', selected_resolution` for conflictId. Return `{ ...Itinerary, diffSummary }`.

- [x] 3.1 Build `ItineraryDay` sub-component
  - Implements: Req 9 display, Req 14 display
  - File: `app/components/ItineraryDay.tsx`
  - Props: `{ day: ItineraryDay; dayNumber: number }`
  - Render sections: morning, afternoon, evening, night (night only if non-empty). For each section, render `ItineraryItem` cards. Each card shows: title (bold), description, type icon/badge, `personaBenefits` as small colored chips (one color per persona name), `reason` as smaller muted text. Use pixel-art card style: `border-4 border-[#1E3A5F] bg-[#FEF3C7] shadow-[4px_4px_0px_#1E3A5F]`. Section headers use the color palette: morning=sky-blue, afternoon=orange, evening=purple, night=navy.

- [x] 3.2 Build `FairnessSummary` sub-component
  - Implements: Req 10 (fairness display)
  - File: `app/components/FairnessSummary.tsx`
  - Props: `{ summary: FairnessSummary; members: User[] }`
  - Render per-persona cards (one per entry in `perPersona`). Each card shows persona name + summary text. Warnings rendered in amber alert boxes. Recommendations rendered in sky-blue boxes. Use pixel-art style consistent with existing components.

- [x] 3.3 Build `FeedbackForm` sub-component
  - Implements: Req 11 (scoring), Req 12 (amendments)
  - File: `app/components/FeedbackForm.tsx`
  - Props: `{ itinerary: Itinerary; userId: string; existing: ItineraryFeedback | null; onSubmitted: (f: ItineraryFeedback) => void }`
  - Score: number input or slider 1–10. Visual color: ≤4 red, 5–6 amber, ≥7 green. Pre-populate from `existing` if present.
  - Liked/Disliked: multi-select chips from itinerary item titles (flatten all days) + free-text add.
  - Requested additions/removals: tag-style text inputs (add button + remove ×).
  - Important requests: same tag input but capped at 3, with counter `(2/3)`.
  - Submit calls POST `/api/feedback`. Shows loading state. Calls `onSubmitted` on success.

- [x] 3.4 Build `ExportButton` sub-component
  - Implements: Req 15 (export)
  - File: `app/components/ExportButton.tsx`
  - Props: `{ itinerary: Itinerary; format: "text" | "markdown" }`
  - On click: generate formatted string. For `text`: plain readable format with section headers. For `markdown`: use `#`, `##`, `**bold**` formatting. Copy to clipboard via `navigator.clipboard.writeText`. Show ✓ feedback for 2s then reset. On clipboard API failure: show a `<textarea>` pre-selected for manual copy.
  - Format includes: destination, dates, flight category, each day with morning/afternoon/evening/night items, and fairness summary.


- [x] 4.1 Build `ActivitiesStage` component
  - Implements: Req 8 (activity collection)
  - File: `app/components/ActivitiesStage.tsx`
  - On mount: GET `/api/activity-preferences?roomId=...`. Split into `myPreferences` (own userId) and `othersPreferences`.
  - Add form: controlled inputs for title (text), type (select: activity/food/sight/experience/avoid), priority (toggle: must_have/optional), notes (optional text). POST on submit. Clear form on success. Show inline error on failure.
  - Delete: × button on own items. DELETE `/api/activity-preferences?id=&userId=`.
  - Display own items as an editable list. Display other members' items grouped by member name as read-only chips.
  - Host sidebar: shows "X / Y members have submitted preferences" count.
  - Host advance button: always enabled (host can advance even if some members skipped). PATCH stage + broadcast `stage-change`. Follows same pattern as `DestinationsStage.handleAdvance`.
  - Non-host: waiting banner when host has not advanced.
  - Subscribe to `room:{roomId}:stage` for stage-change events.
  - Color coding: activity=sky-blue, food=orange, sight=green, experience=neon-purple, avoid=red. `must_have` shown with ★ badge.

- [x] 4.2 Build `ItineraryStage` component
  - Implements: Req 9 (itinerary display), Req 10 (fairness display), Req 14 (revision loop, version history, diff summary)
  - File: `app/components/ItineraryStage.tsx`
  - On mount: GET `/api/agents/itinerary?roomId=...`. Also GET `/api/itinerary/{roomId}` for version history.
  - Empty + host: "Generate itinerary" button → POST `/api/agents/itinerary`. 20–30s loading state with descriptive copy ("Crafting your group itinerary…").
  - Empty + member: waiting state.
  - Itinerary loaded: render header (destination, dates, flight category, version number, average satisfaction score if present), then `<FairnessSummary>`, then one `<ItineraryDay>` per day.
  - Diff summary banner: when `itinerary-updated` payload contains `diffSummary`, show an amber banner at the top with the diff text. Dismissible.
  - Version history: a `<select>` or dropdown showing all versions. On change, fetch and display that version (read-only view for past versions).
  - Subscribe to `room:{roomId}:itinerary` → on `itinerary-updated`, re-fetch latest + show diffSummary.
  - Host controls:
    - "Regenerate" button (only if not finalised): POST `/api/agents/itinerary`.
    - "Finalise & Export" button: POST `/api/itinerary/{roomId}/finalise` → then advance to FINAL stage.
    - "Collect feedback" button: advance to FEEDBACK stage.
  - Non-host: waiting message, shows itinerary once available.
  - `onGoBack` available for back navigation from ITINERARY to FLIGHT_VOTE if needed (existing pattern).

- [x] 4.3 Build `FeedbackStage` component
  - Implements: Req 11 (scoring), Req 12 (amendments), Req 13 (trigger analysis)
  - File: `app/components/FeedbackStage.tsx`
  - On mount: GET current itinerary via `room.currentItineraryId`. GET `/api/feedback/{itineraryId}` for all feedback counts. Check if own feedback already submitted.
  - Subscribe to `room:{roomId}:feedback` → on `feedback-submitted`, re-fetch allFeedback aggregate (counts, average).
  - Each user sees the current itinerary summary (destination, dates, day count) and the `<FeedbackForm>`.
  - After submission: show read-only summary of own submission; "Edit feedback" button to allow revision (re-renders form pre-populated).
  - Host dashboard panel (host only): shows per-member submission status (submitted / waiting). Shows average score with color coding. Shows warning banners: avg < 6 → "Low satisfaction — consider triggering a revision", any < 4 → "⚠️ [Name] rated this below 4".
  - Host: "Analyse feedback" button → POST `/api/agents/feedback-analysis`. Show loading state ("Analysing group feedback…").
  - After analysis:
    - If `requiresNegotiation=false`: show success message + "Advance to Final" button (advances to FINAL) + "Trigger revision anyway" button (advances to NEGOTIATION).
    - If `requiresNegotiation=true`: show conflict preview cards + "Go to Negotiation" button (advances to NEGOTIATION).
  - Non-host: waiting state after submitting ("Waiting for host to analyse feedback").

- [x] 4.4 Build `NegotiationStage` component
  - Implements: Req 13 (negotiation), Req 14 (revision loop), Demo Moment 3
  - File: `app/components/NegotiationStage.tsx`
  - On mount: GET `/api/conflicts?roomId=...`. GET current itinerary.
  - Subscribe to `room:{roomId}:negotiation` → on `conflicts-updated`, re-fetch conflicts.
  - Subscribe to `room:{roomId}:itinerary` → on `itinerary-updated`, re-fetch itinerary + show diffSummary banner.
  - For each conflict: render a card with `conflictSummary`, affected user names (resolved from members prop), and 2+ option cards. Each option shows description and tradeoffs.
  - Any user can "Select" an option → PATCH `/api/conflicts/{id}` with `{ selectedResolution: option.id }`. Mark selected option visually.
  - Host controls:
    - "Apply resolution & revise itinerary" button (per conflict, enabled when `selectedResolution` is set) → POST `/api/agents/negotiation { roomId, conflictId, selectedResolution }`. Show loading ("Revising itinerary…").
    - After revision: show diffSummary in an amber banner. Show new itinerary inline (using `<ItineraryDay>` components).
    - "Back to Itinerary" button: uses `onGoBack` to move back to ITINERARY stage.
    - "Another round of feedback" button: advances to FEEDBACK stage.
  - Non-host: show conflicts and options; can vote but cannot trigger revision.
  - Empty conflicts state: "No conflicts to resolve — host can advance back to the itinerary."

- [x] 4.5 Build `FinalStage` component
  - Implements: Req 15 (final display and export)
  - File: `app/components/FinalStage.tsx`
  - On mount: use `room.finalItineraryId` to load the final itinerary. GET `/api/itinerary/{roomId}` and find the version where `status='final'`.
  - If no final itinerary found: show error ("No final itinerary found — ask the host to finalise").
  - Render: hero header with destination name, travel dates, flight category, version number. Then `<FairnessSummary>`. Then `<ItineraryDay>` for each day.
  - Export controls: two `<ExportButton>` components — one for plain text, one for markdown. Both positioned prominently with pixel-art button style.
  - No editing controls — fully read-only.
  - All members see the same final view.
  - Congratulations message at top: friendly copy acknowledging the trip is planned.

- [x] 5.1 Wire all new stages into `StageRouter.tsx`
  - Implements: end-to-end stage routing
  - File: `app/components/StageRouter.tsx`
  - Import: `ActivitiesStage`, `ItineraryStage`, `FeedbackStage`, `NegotiationStage`, `FinalStage` from their respective files.
  - Replace `StagePlaceholder` cases for `RoomStage.ACTIVITIES`, `RoomStage.ITINERARY`, `RoomStage.FEEDBACK`, `RoomStage.NEGOTIATION`, `RoomStage.FINAL` with the new components.
  - Pass full `props` (spread pattern already used: `{...props}`) to each component.
  - `RoomStage.PERSONA` may remain as `StagePlaceholder` if not in scope for this feature.
  - Verify TypeScript compiles: run `npm run build` (or `npm run lint`) to confirm no type errors.
  - Confirm the `assertNeverStage` exhaustive check still compiles (it should since all cases are handled).


## Notes

- All AI agent calls use `runAgent` from `lib/bedrock.ts` and must follow the parse-then-retry pattern documented in the steering file `ai-agent-rules.md`.
- The `broadcastItineraryUpdated`, `broadcastFeedbackSubmitted`, and `broadcastConflictsUpdated` helpers follow the same pattern as the existing `broadcastDestinationsUpdated` and `broadcastStageChange` helpers in `DestinationsStage.tsx`.
- Stage gating on all agent routes uses the `RoomStage` enum from `lib/types.ts`. Check `current_stage !== RoomStage.X` and return 409.
- All snake_case ↔ camelCase mapping should use explicit row-mapper functions following the pattern in `roomHelpers.ts`.
- JSONB columns (`days`, `fairness_summary`, `proposed_options`, `affected_users`, `liked_items`, etc.) are returned as parsed objects by Supabase's JS client — cast to the correct TypeScript type directly.
- `npm run build` must pass without type errors after task 5.1 is complete.
