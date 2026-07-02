# Implementation Plan: PixelTrip Chatbot-First Refactor

## Overview

Refactor the PixelTrip room experience from disconnected full-stage form screens into a single,
persistent TripAgentChat panel with a scrolling message thread. The underlying RoomStage state
machine, API routes, and Supabase schema are unchanged. Only the presentation layer changes.

Implementation order: types and utilities first → atomic leaf components → TripAgentChat and
TripContextPanel → CharacterCreator chatMode → RoomShell two-column layout → wiring.

## Tasks

- [x] 1. Add new types to `lib/types.ts` and create utility libraries
  - [x] 1.1 Add `AgentMessage`, `BudgetEstimate`, and `StageSubmissionStatus` types to `lib/types.ts`
    - Add `AgentMessage` interface with `id`, `stage`, `text`, `timestamp`, `type` fields
    - Add `BudgetEstimate` interface with `flightCost`, `dailyCost`, `totalPerPerson`, `status`, `costDriverLine`, `tripLengthDays` fields
    - Add `StageSubmissionStatus` type alias `"submitted" | "pending"`
    - All additions are additive — do not modify or remove any existing exports
    - _Requirements: 1.4_

  - [x] 1.2 Create `lib/budgetEstimate.ts` with constants and pure functions
    - Export `FLIGHT_COSTS`, `DAILY_COSTS`, `DESTINATION_MULTIPLIERS`, `BUDGET_THRESHOLDS` constants
    - Implement `computeBudgetEstimate(flightCategory, destinationPriceLevel, tripLengthDays, budgetLevel): BudgetEstimate`
    - Implement `classifyBudgetStatus(estimate, budgetLevel): "within" | "near" | "over"`
    - Implement cost-driver line logic: if `flightCost > dailyCost` identify flight as driver, else identify daily cost
    - Truncate `costDriverLine` to 80 characters
    - No side effects, no API calls — pure functions only
    - _Requirements: 10.3, 10.4, 10.5, 10.7, 10.8_

  - [x] 1.3 Create `lib/agentMessages.ts` with the stage intro message map
    - Export `STAGE_INTRO_MESSAGES: Record<RoomStage, string>` with all 13 stage entries matching the exact strings in the design document
    - Import `RoomStage` from `lib/types.ts`
    - _Requirements: 3.1, 3.6_

- [x] 2. Implement `ReadyBadge` component
  - [x] 2.1 Create `app/components/ReadyBadge.tsx`
    - Accept `submitted: boolean` and `displayName: string` props
    - "Submitted" state: grass green background (`#4ADE80`), `✔` icon, deep-navy text
    - "Not submitted" state: sunset orange background (`#FB923C`), `…` icon, deep-navy text
    - Zero border-radius, 2px solid deep-navy border, monospace font, `4px 4px 0 #1E3A5F` box-shadow
    - Include `aria-label` describing both the member name and status
    - _Requirements: 9.2, 11.1, 12.2, 12.5_

- [x] 3. Implement `BudgetStatusBadge` component
  - [x] 3.1 Create `app/components/BudgetStatusBadge.tsx`
    - Accept `status: "within" | "near" | "over"`, `estimate: number`, `costDriverLine: string` props
    - Colour mapping: `"within"` → `#4ADE80`, `"near"` → `#FB923C`, `"over"` → `#EF4444`
    - Display formatted estimate as `$N` per person
    - Render `costDriverLine` (≤ 80 chars) as a sub-line below the badge
    - Zero border-radius, blocky pixel-art border, monospace font
    - _Requirements: 10.4, 10.5, 12.2, 12.5_

- [x] 4. Implement `TripAgentMessage` component
  - [x] 4.1 Create `app/components/TripAgentMessage.tsx`
    - Accept `text: string`, `isSystem?: boolean`, `children?: React.ReactNode` props
    - Render as `<article>` with sand cream background (`#FEF3C7`), 4px deep-navy border, `4px 4px 0 #1E3A5F` box-shadow, zero border-radius, monospace font
    - Render `text` in the bubble; render `children` (InteractiveSlot) below the bubble text
    - System messages (`isSystem=true`) use deep-navy background, sand cream text
    - Component must live inside the `aria-live="polite"` region (parent responsibility, but component renders as `<article>`)
    - _Requirements: 3.1, 3.2, 12.5, 12.6_

- [x] 5. Implement `InteractiveSlot` component
  - [x] 5.1 Create `app/components/InteractiveSlot.tsx`
    - Accept `isSaving: boolean` and `children: React.ReactNode` props
    - When `isSaving` is `false`: render children normally
    - When `isSaving` is `true`: render semi-transparent sky-blue overlay (`opacity: 0.6`) over children; centre a pixel-art CSS spinner (`@keyframes` rotating 4px block) inside the overlay boundary; set `data-saving="true"` on the wrapper so descendant inputs can be disabled via CSS `[data-saving="true"] * { pointer-events: none }`; add `aria-disabled="true"` to the wrapper
    - Slot must be scrollable when embedded content exceeds visible area
    - _Requirements: 4.4, 4.5, 2.8_

- [x] 6. Implement `WaitingState` component
  - [x] 6.1 Create `app/components/WaitingState.tsx`
    - Accept `submittedSelections: React.ReactNode`, `memberStatuses: Array<{userId, displayName, submitted}>`, `onEditResponse?: () => void` props
    - Render the user's own submitted selections above the member list
    - Render a `ReadyBadge` per member using the `memberStatuses` array
    - Show "Edit my response" button only when `onEditResponse` is defined; button styled with `← ` icon prefix per Req 12.7
    - Deep navy background, sand cream text, pixel-art borders, monospace font
    - _Requirements: 4.6, 4.7, 11.1, 12.5_

- [x] 7. Implement `VoteableDestinationCard` component
  - [x] 7.1 Create `app/components/VoteableDestinationCard.tsx`
    - Accept `suggestion: DestinationSuggestion`, `currentUserId: string`, `hasVoted: boolean`, `voteCount: number`, `onVote: (destinationId: string) => Promise<void>` props
    - Display: destination name, fit score badge, "Why this fits" summary (≤ 30 words), price level badge, crowd level badge, best season/weather badge, Vote button, vote count
    - Vote button disabled and visually distinct when `hasVoted` is true; label `"🗳 Vote"`
    - Badge colours: price level green/amber/red per Req 12.2; crowd level green/amber/red; budget impact green/amber/red
    - Implement optimistic vote: increment `displayedCount` immediately on click; revert on 5xx or network error; retain on 409; set `voteError` string on failure
    - Reconcile with server: when `voteCount` prop from parent ≥ `displayedCount`, accept server value
    - "View full details" toggle (`expanded` state): collapsed by default; when expanded show `recommendationReason`, `downsides`, `bestActivities`, `personaFitSummary`
    - Call `onVote` using existing `POST /api/votes` contract without modification
    - Zero border-radius, blocky borders, `4px 4px 0 #1E3A5F` shadow, monospace font
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 12.3, 12.4, 12.5, 12.7_

- [x] 8. Implement `VoteableFlightCard` component
  - [x] 8.1 Create `app/components/VoteableFlightCard.tsx`
    - Accept `category`, `priceRange`, `estimatedDuration`, `stops`, `budgetImpact`, `itineraryComfort`, `hasVoted`, `voteCount`, `onVote` props per the design interface
    - Display: flight category name, price range badge, travel duration badge, stops badge, budget impact badge (green/amber/red), itinerary comfort badge
    - If any badge data prop is unavailable (null/undefined), do not render that badge (no placeholder)
    - Vote button: label `"🗳 Vote"`, disabled and visually distinct when `hasVoted` is true
    - Same optimistic vote + revert pattern as `VoteableDestinationCard`
    - Call `onVote` using existing `POST /api/votes` with `voteType: "flight"` without changing the contract
    - Badges rendered as discrete elements, not prose sentences
    - Zero border-radius, blocky pixel-art borders, monospace font
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 12.4, 12.5_

- [x] 9. Implement `TripContextPanel` component
  - [x] 9.1 Create `app/components/TripContextPanel.tsx`
    - Accept `room: TripRoom`, `members: User[]`, `characterProfiles: CharacterProfile[]`, `currentStage: RoomStage`, `submittedUserIds: string[]`, `budgetEstimate: BudgetEstimate | null` props
    - Display fields: stage label, room code + copy-to-clipboard button, member list (PixelAvatar + ReadyBadge per member), selected budget level, travel dates (start – end or "Not set"), travel vibes (comma-separated or "Not set"), destination shortlist or selected destination (or "Not set"), selected flight option (or "Not set")
    - Copy button: on click copy room invite URL to clipboard; show "Copied!" label for 2 seconds then revert
    - Show `BudgetStatusBadge` only when `budgetEstimate !== null`
    - Sticky position on desktop (`position: sticky; top: 0; min-height: 100vh`)
    - Background: deep navy (`#1E3A5F`); text: sand cream (`#FEF3C7`); ready state: grass green; pending: sunset orange
    - On mobile (< 1024px): rendered but visibility controlled by parent via CSS class; parent RoomShell passes `isOpen` via toggle
    - Semantic `<aside>` element
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 12.5_

- [x] 10. Add `chatMode` prop to `CharacterCreator` component
  - [x] 10.1 Add `chatMode?: boolean` prop to `CharacterCreator`; when `false` (default) render existing layout unchanged
    - Add `chatMode` prop to the component signature; default to `false`
    - Guard all new chat-mode rendering behind `if (chatMode)` branches — existing layout must be pixel-perfect unchanged when `chatMode={false}`
    - _Requirements: 5.12, 1.7_

  - [x] 10.2 Implement `chatMode=true` sequential step rendering in `CharacterCreator`
    - Step 1: render budget InteractiveSlot (3 cards); on select → update PixelAvatar preview within 200ms; reveal step 2
    - Step 2: render travel style InteractiveSlot (5 cards); on select → update PixelAvatar preview within 200ms; reveal step 3
    - Step 3: render interests InteractiveSlot (chip grid); on ≥1 select → update PixelAvatar preview within 200ms; reveal "✔ Confirm" button
    - PixelAvatar preview in `position: sticky` container at top of the step sequence, visible without scrolling throughout the flow
    - All existing `handleConfirm` logic (POST to `/api/character-profile`, error handling, `onConfirmed` callback) is unchanged
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

- [x] 11. Implement `TripAgentChat` component — core structure and message thread
  - [x] 11.1 Create `app/components/TripAgentChat.tsx` with props and internal state
    - Accept `room: TripRoom`, `identity: Identity`, `members: User[]`, `characterProfiles: CharacterProfile[]`, `onRoomUpdated: (r: TripRoom) => void`, `onGoBack?: () => Promise<void>` props
    - Internal state: `messages: AgentMessage[]` (append-only), `submittedStages: Set<RoomStage>`, `pendingSlotSave: boolean`
    - Use `prevStageRef = useRef<RoomStage | null>(null)` to detect stage transitions
    - On mount and on `room.currentStage` change: append a new `AgentMessage` using `STAGE_INTRO_MESSAGES[room.currentStage]`; update `prevStageRef.current`
    - On new message appended: call `bottomRef.current?.scrollIntoView({ behavior: 'smooth' })`; attach `bottomRef` to a zero-height `<div>` at end of thread
    - Render each `AgentMessage` as `<TripAgentMessage>` inside an `aria-live="polite"` region
    - Wrap the entire component in a `<main>` element; render thread as a vertically scrollable container
    - _Requirements: 2.3, 2.4, 3.1, 11.5, 14.3, 14.4_

  - [x] 11.2 Implement `InteractiveSlot` placement and stage-to-slot routing in `TripAgentChat`
    - Below the last `TripAgentMessage`, render one `InteractiveSlot` for the current stage's interactive content
    - LOBBY/PERSONA → `<CharacterCreator chatMode={true} />`
    - AVAILABILITY → `<AvailabilityStage />` embedded directly inside the slot
    - DESTINATIONS/DESTINATION_VOTE → `<VoteableDestinationCard />` list
    - FLIGHTS/FLIGHT_VOTE → `<VoteableFlightCard />` list
    - ACTIVITIES, ITINERARY, FEEDBACK, NEGOTIATION, FINAL → `<StageRouter {...stageProps} />`
    - Pass `isSaving={pendingSlotSave}` to `InteractiveSlot`
    - Construct `stageProps` with all required `StageProps` fields; pass unchanged to StageRouter and direct stage components
    - _Requirements: 4.1, 4.2, 14.1, 15.1, 15.2, 15.3_

  - [x] 11.3 Implement `WaitingState` integration and submission tracking in `TripAgentChat`
    - Track `submittedStages: Set<RoomStage>` — add current stage to set when the user's save succeeds
    - When current user has submitted (current stage in `submittedStages`): replace the `InteractiveSlot` with `<WaitingState>` showing the user's confirmed selections and per-member `ReadyBadge` status
    - Derive `submittedUserIds` from `characterProfiles` (for PERSONA: profileExists = submitted) and stage-specific poll data for AVAILABILITY
    - When member submission status changes (via 3-second poll or `member-joined` broadcast), append a new waiting-update `AgentMessage` rather than mutating the existing one (append-only invariant)
    - When all members have submitted, append a "everyone's ready" `AgentMessage` (isSystem=true, ≤ 40 words)
    - _Requirements: 3.3, 3.4, 3.5, 4.6, 11.1, 11.2, 14.3_

  - [x] 11.4 Implement save lifecycle with 10-second timeout in `TripAgentChat`
    - On any slot save: set `pendingSlotSave = true`; start 10-second `setTimeout` using `AbortController` signal passed to fetch
    - On server response (success/fail) before timeout: clear timeout, set `pendingSlotSave = false`
    - On timeout: abort the fetch, set `pendingSlotSave = false`, append inline error `AgentMessage`, re-enable slot
    - Visual feedback: InteractiveSlot renders loading indicator (via `isSaving` prop) during save
    - Selection visual update (chip highlight, card fill) within 100ms of user interaction — before server round-trip
    - _Requirements: 4.3, 4.4, 4.5_

  - [x] 11.5 Implement host controls inside `TripAgentChat`
    - Show `"▶ Move to next step"` button inside the chat thread only when `identity.userId === room.hostUserId`
    - Enable the advance button only when per-stage conditions are met (AVAILABILITY: all members submitted; DESTINATIONS: ≥1 suggestion generated; DESTINATION_VOTE: ≥1 vote cast; FLIGHTS: options loaded; FLIGHT_VOTE: ≥1 flight vote cast; others: no block)
    - On advance button click: PATCH `/api/rooms/[code]/stage`; on success broadcast `stage-change`; if broadcast fails, do not roll back the stage advance (3-second poll fallback handles sync)
    - Show "Regenerate destinations" button (host only) in DESTINATIONS stage; on click: show inline loading message `"Finding the best destinations for your group…"` in the thread; dismiss when POST `/api/agents/destinations` completes; on failure append inline error `AgentMessage` with a retry button (host only)
    - Retain `"← Previous"` host control in its existing location (RoomShell header) — do not move or remove it
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 11.6 Implement flight vote plurality confirmation message in `TripAgentChat`
    - After each poll cycle in FLIGHT_VOTE stage, check whether any option has a plurality of votes (most votes among 3, no tie)
    - When a plurality is confirmed from server data: append a `"confirmation"` type `AgentMessage` naming the winning flight category
    - Do not show the confirmation until vote count data from the server confirms the winning option
    - _Requirements: 8.6_

  - [x] 11.7 Implement stage-level inline error handling in `TripAgentChat`
    - POST `/api/character-profile` failure: append `type: "error"` `AgentMessage`; retain all character selections; re-enable confirm button
    - POST `/api/agents/destinations` failure: append error `AgentMessage`; show retry button to host only
    - Network timeout during slot save: abort fetch, re-enable slot, append error `AgentMessage`
    - All errors rendered as inline `AgentMessage` entries of `type: "error"` — no full-page error views
    - _Requirements: 3.7, 5.11, 7.8, 7.9_

  - [x] 11.8 Implement `AvailabilityStage` sequential section rendering inside `TripAgentChat`
    - AVAILABILITY stage embeds `<AvailabilityStage />` inside the `InteractiveSlot` directly (not via StageRouter)
    - Display intro message `"Nice. Now when are you free to travel?"` on AVAILABILITY stage entry
    - After "Save dates" with valid date range: display `"Where do you feel like going?"` message and render TravelVibeSelector
    - After ≥1 vibe selected: render DestinationSuggestionPicker chips
    - Render `CustomDestinationInput` as a collapsible "Add a custom destination" section below suggestion chips; collapsed affordance always visible
    - Validate: "Save dates" without both dates selected → inline error, block advancement
    - Validate: "Save preferences" without ≥1 destination → inline error, block submission
    - On successful save: display summary message with submitted dates, vibes, and destinations
    - Show per-member submission status row (display name + submitted/pending indicator) updated within 5 seconds
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

- [x] 12. Refactor `RoomShell` to two-column layout
  - [x] 12.1 Update `RoomShell`'s `<main>` to a `flex-row` two-column container
    - Change `<main>` from single-column `flex-1` to `flex flex-row` with responsive breakpoint at `lg` (1024px)
    - Left column: `TripAgentChat`, `min-width: 65%`, fills remaining horizontal space, vertically scrollable
    - Right column: `TripContextPanel`, occupies remaining width, sticky
    - On screens < 1024px: single column; `TripContextPanel` hidden by default
    - Add internal `isMobileContextOpen: boolean` state and `onToggleContext` handler (internal to RoomShell, no new public props)
    - Render a fixed-position toggle `<button>` at bottom-right on screens < 1024px to open/close the context panel drawer overlay
    - When `isMobileContextOpen`: render `TripContextPanel` as a full-height fixed overlay with a visible close button
    - Pass `submittedUserIds` and `budgetEstimate` (computed via `computeBudgetEstimate`) down to `TripContextPanel`
    - Preserve all existing polling, broadcast subscriptions, header, MemberStrip logic without modification
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 9.7, 11.3, 11.4_

  - [x] 12.2 Wire `TripAgentChat` and `TripContextPanel` into `RoomShell`
    - Render `<TripAgentChat>` in the left column with all required props
    - Render `<TripContextPanel>` in the right column; pass `isOpen` and computed `budgetEstimate`
    - `budgetEstimate`: call `computeBudgetEstimate` inside RoomShell when `room.selectedFlightOption !== null` and a selected `DestinationSuggestion` with `priceLevel` is available; otherwise pass `null`
    - Prop threading: `members` and `characterProfiles` flow `page.tsx → RoomShell → TripAgentChat → TripContextPanel`
    - _Requirements: 2.1, 10.2, 10.6_

- [x] 13. Apply pixel-art visual style to all new components
  - [x] 13.1 Audit and enforce visual style rules across all new components
    - Verify zero `border-radius` (no `rounded-*` Tailwind classes) on all new component surfaces
    - Verify `4px 4px 0 #1E3A5F` box-shadow on all card and bubble surfaces
    - Verify monospace font (`'Courier New', Courier, monospace`) on all text
    - Verify no white (`#ffffff`) or near-white background or `text-gray-600` on any surface; all backgrounds use palette colours only
    - Verify `image-rendering: pixelated` on all `<img>` elements in new components
    - Verify `outline: 3px solid #A855F7; outline-offset: 2px` on all interactive elements' `:focus-visible` state
    - Add icon prefixes to buttons: `"✔ Confirm"`, `"🗳 Vote"`, `"▶ Next"`, `"← Previous"` per Req 12.7
    - _Requirements: 12.5, 12.6, 12.7, 12.8_

- [x] 14. Add ARIA attributes and semantic HTML to all new components
  - [x] 14.1 Apply accessibility markup across all new components
    - `TripAgentChat`: `<main>` wrapper; `aria-live="polite"` region around the message thread; each message as `<article>`
    - `TripContextPanel`: `<aside>` element
    - All chip and option-card elements not rendered as `<button>`: add `role="button"` (or `role="checkbox"` for multi-select chips), `aria-label` describing purpose and `aria-pressed` / `aria-checked` for selected state
    - All `PixelAvatar` SVG layers: `aria-hidden="true"`
    - Verify Tab order through chip groups → cards → confirm button is top-to-bottom, left-to-right
    - Verify Enter and Space key activate all interactive elements
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_

- [x] 15. Integration wiring and backward compatibility verification
  - [x] 15.1 Verify `StageRouter` backward compatibility for later pipeline stages
    - Confirm `StageRouter` maps ACTIVITIES, ITINERARY, FEEDBACK, NEGOTIATION, FINAL to their existing stage components without modification
    - Confirm `TripAgentChat` passes the full `StageProps` interface (including `characterProfiles`) to StageRouter without modification
    - Confirm stage intro messages are appended for all 13 stages including the later pipeline stages
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [x] 15.2 Verify all preserved API contracts and hook signatures are unchanged
    - Confirm `useRoomMembers`, `useCharacterProfiles`, `usePresence` hook signatures are unchanged
    - Confirm `RoomStage` enum is unchanged
    - Confirm `PATCH /api/rooms/[code]/stage` is called without modification for stage advances
    - Confirm `POST /api/votes` is called with unchanged request shape from `VoteableDestinationCard` and `VoteableFlightCard`
    - Confirm `POST /api/character-profile` is called with unchanged request shape from `CharacterCreator`
    - Run `npm run build` to verify zero TypeScript errors across the entire project
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.8_

## Notes

- No tests — this is a hackathon build; all testing tasks have been removed
- All new TypeScript types are additive additions to `lib/types.ts` — no existing exports are modified
- `TripAgentChat` owns the `messages: AgentMessage[]` append-only state; messages are session-scoped only (not persisted to Supabase)
- Budget estimate is computed locally with no API calls; only displayed when both `room.selectedFlightOption !== null` and a destination with `priceLevel` is available
- `RoomShell` polling (3s) and `stage-change` / `member-joined` broadcast subscriptions are unchanged; `TripAgentChat` reacts to `room` prop changes driven by those signals
- The `CharacterCreator chatMode=true` path only changes presentation — the POST to `/api/character-profile` and all confirm logic are identical to the existing `chatMode=false` path
- All new components follow the pixel-art visual rules: zero border-radius, blocky borders, `4px 4px 0 #1E3A5F` shadow, monospace font, no white surfaces, palette colours only

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["3.1", "4.1", "5.1", "6.1"] },
    { "id": 4, "tasks": ["7.1", "8.1", "9.1", "10.1"] },
    { "id": 5, "tasks": ["10.2"] },
    { "id": 6, "tasks": ["11.1"] },
    { "id": 7, "tasks": ["11.2", "11.3", "11.4", "11.5"] },
    { "id": 8, "tasks": ["11.6", "11.7", "11.8"] },
    { "id": 9, "tasks": ["12.1"] },
    { "id": 10, "tasks": ["12.2"] },
    { "id": 11, "tasks": ["13.1"] },
    { "id": 12, "tasks": ["14.1"] },
    { "id": 13, "tasks": ["15.1", "15.2"] }
  ]
}
```
