# Requirements Document

## Introduction

PixelTrip currently has a working stage-driven room flow with: character creation (LobbyStage), availability and destination discovery (AvailabilityStage), group profile generation (GroupProfileStage), destination recommendations (DestinationsStage), destination voting (DestinationVoteStage), flight display (FlightStage), and flight voting (FlightVoteStage). The existing RoomShell provides a persistent header with room code, invite link, stage progress, and member strip.

This feature refactors the room experience into a **chatbot-first Trip Agent interface**. The Trip Agent is a conversational panel that replaces the current sequence of disconnected full-stage form screens with a unified, message-driven interaction layer that guides the group step by step. The underlying stage state machine (`RoomStage` enum), all existing API routes, Supabase schema, and completed functionality up to flight selection are preserved. Only the user-facing presentation layer is changed.

The chatbot UI combines short agent messages, selectable chip groups, visual option cards, avatar previews, voting buttons, budget status, and member status — all inside one persistent panel. Users feel they are talking to a travel planning agent, not filling in a long form.

## Glossary

- **Trip_Agent**: The AI-styled chatbot persona that guides users through the planning flow. Produces short messages and interactive UI elements for each stage.
- **TripAgentChat**: The primary React component that renders the Trip Agent conversation thread and the current stage's interactive content.
- **TripAgentMessage**: A single message bubble from the Trip Agent, optionally followed by interactive content (chips, cards, buttons).
- **RoomShell**: The existing persistent layout wrapper. Keeps the room header, member strip, and stage progress visible at all times. Will be extended to host the new two-column layout.
- **TripContextPanel**: The new persistent right-side panel that shows selected budget, travel dates, travel vibes, destination shortlist or selected destination, selected flight option, current stage, member avatars, and member ready/submitted status.
- **StageRouter**: The existing component that maps `currentStage` to a stage component. Remains the internal routing mechanism; its output is composed into TripAgentChat rather than rendered as a standalone full-page form.
- **CharacterProfile**: The existing type from `lib/types.ts` — a user's budget level, travel style, trip interests, avatar config, and planning weights.
- **BudgetLevel**: `"low" | "medium" | "high"` — already defined in `lib/types.ts`.
- **TravelStyle**: `"leader" | "planner" | "follower" | "chill" | "adventurer"` — already defined in `lib/types.ts`.
- **TripInterest**: One of nine interest values — already defined in `lib/types.ts`.
- **TravelVibe**: One of ten vibe values — already defined in `lib/types.ts`.
- **PixelAvatar**: The existing layered SVG pixel-art avatar component in `app/components/PixelAvatar.tsx`.
- **AgentMessage**: A short, friendly text string sent by the Trip Agent to introduce a stage or prompt a group action.
- **InteractiveSlot**: The area below an AgentMessage where the current stage's interactive content (chips, cards, vote buttons, forms) is rendered.
- **ReadyBadge**: A small status indicator shown per member indicating whether they have submitted the current stage's input.
- **BudgetStatusBadge**: A colour-coded badge showing whether the trip plan is within budget, near the limit, or likely over budget.
- **BudgetEstimate**: A simple estimate of total trip cost per person computed from: destination price level × trip length + flight category cost factor + a fixed food/activity multiplier based on budget level.
- **VoteableDestinationCard**: An enriched destination suggestion card that includes a vote/select button, vote count, fit badges, price level, crowd level, weather summary, and a short "Why this fits" line.
- **VoteableFlightCard**: An enriched flight option card that includes a vote/select button, estimated price range, trip duration, stops, budget impact badge, and itinerary comfort badge.
- **WaitingState**: A message block shown when the current user has already submitted and is waiting for other members to do the same.

---

## Requirements

### Requirement 1: Preserve Existing Working Functionality

**User Story:** As the development team, we want all existing working functionality preserved, so that the refactor does not break anything that already works.

#### Acceptance Criteria

1. THE TripAgentChat SHALL preserve the existing `RoomStage` enum and state machine logic without modification.
2. THE TripAgentChat SHALL preserve all existing API route contracts (URL paths, HTTP methods, request/response shapes) unchanged.
3. THE TripAgentChat SHALL preserve the existing Supabase schema and Realtime broadcast channel names unchanged.
4. THE TripAgentChat SHALL preserve the existing `lib/types.ts` exports; new types are additive only.
5. WHEN the host advances a stage, THE TripAgentChat SHALL use the existing `PATCH /api/rooms/[code]/stage` endpoint without modification.
6. THE TripAgentChat SHALL preserve existing vote deduplication constraints and the existing `/api/votes` contract.
7. THE TripAgentChat SHALL preserve the existing `CharacterProfile` API at `/api/character-profile` without modifying its request/response shape.
8. THE TripAgentChat SHALL preserve the existing `useRoomMembers`, `useCharacterProfiles`, and `usePresence` hooks without breaking their signatures.

---

### Requirement 2: Trip Agent Chat Layout

**User Story:** As a traveller, I want to see a persistent chatbot-style interface that guides my group step by step, so that planning feels conversational and not like filling in a form.

#### Acceptance Criteria

1. THE RoomShell SHALL render a two-column layout on screens ≥ 1024px wide: a main TripAgentChat column (left/centre, minimum 65% of total width) and a TripContextPanel sidebar (right, occupying the remaining width).
2. THE RoomShell SHALL render a single-column stacked layout on screens < 1024px wide, with TripContextPanel collapsed by default and accessible via a visible toggle control.
3. THE TripAgentChat SHALL display the Trip Agent's messages in a vertically scrolling thread, with the most recent message and its InteractiveSlot content visible at the bottom.
4. WHEN a new agent message is appended, THE TripAgentChat SHALL smooth-scroll the message into view automatically within the TripAgentChat container.
5. THE RoomShell SHALL keep the room header (room code, invite link, stage progress, host controls) visible at the top at all times.
6. THE RoomShell SHALL keep the MemberStrip visible below the header at all times.
7. THE TripAgentChat SHALL not replace or remove the existing RoomShell header or MemberStrip.
8. IF a stage renders a full-page form component (specifically AvailabilityStage or GroupProfileStage), THEN THE TripAgentChat SHALL embed that component inside the InteractiveSlot below the agent message rather than navigating to a separate page; the InteractiveSlot SHALL be scrollable if the embedded component's height exceeds the visible area.

---

### Requirement 3: Trip Agent Messages

**User Story:** As a traveller, I want the Trip Agent to speak to me with short, friendly messages, so that I always know what to do next.

#### Acceptance Criteria

1. WHEN a new stage begins, THE Trip_Agent SHALL display a short introductory message (≤ 40 words, ≤ 2 sentences) explaining what the group should do at that stage.
2. THE Trip_Agent SHALL use second-person pronouns ("you", "your") and write in plain sentences with no unexplained abbreviations; each message SHALL be ≤ 2 sentences.
3. WHEN all members have submitted the current stage's input, THE Trip_Agent SHALL display a "everyone's ready" confirmation message (≤ 40 words) before the host advances.
4. WHEN some members have not yet submitted, THE Trip_Agent SHALL display a waiting message listing each pending member's display name.
5. WHEN a member submits their input, THE TripAgentChat SHALL update the waiting message within 3 seconds without a page reload.
6. THE Trip_Agent SHALL provide a short contextual introductory message (≤ 40 words) for each of the following stages: LOBBY, PERSONA, AVAILABILITY, GROUP_PROFILE, DESTINATIONS, DESTINATION_VOTE, FLIGHTS, and FLIGHT_VOTE.
7. IF a stage-specific error occurs (e.g. no group profile, agent failure), THEN THE Trip_Agent SHALL display an inline error message within the chat thread rather than a full-page error.

---

### Requirement 4: Interactive Content Slots

**User Story:** As a traveller, I want to respond to the Trip Agent using visual cards, chips, and buttons rather than typing long text, so that the experience feels like a game and not a form.

#### Acceptance Criteria

1. THE TripAgentChat SHALL render each stage's interactive content inside an InteractiveSlot positioned immediately below the last AgentMessage in the current stage's thread.
2. THE TripAgentChat SHALL support the following InteractiveSlot content types: selectable chip groups, option cards, avatar preview, date range inputs, vote cards, trip summary panels, and waiting state blocks.
3. WHEN a user selects a chip or card inside an InteractiveSlot, THE TripAgentChat SHALL update the selected element's visual appearance (highlighted border, filled background, or checkmark indicator) within 100ms without waiting for a server round-trip.
4. WHILE a server save is in progress (from the moment a save is triggered until the server response is received or a 10-second timeout elapses), THE TripAgentChat SHALL disable all InteractiveSlot inputs and render them with a visually distinct disabled appearance.
5. WHILE a server save is in progress (same state definition as criterion 4), THE TripAgentChat SHALL show a loading indicator inside the InteractiveSlot boundary rather than blocking the whole page.
6. WHEN a user has already submitted the current stage's input, THE TripAgentChat SHALL replace the InteractiveSlot with a WaitingState block showing the user's own submitted selections and each other member's display name alongside one of two status values: "Submitted" or "Waiting".
7. WHEN the user activates "Edit my response" for a previously submitted stage (PERSONA or AVAILABILITY), THE TripAgentChat SHALL transition from the WaitingState block back to the InteractiveSlot with all prior selections pre-filled.

---

### Requirement 5: Character Creation Inside the Chat

**User Story:** As a traveller, I want to build my travel character directly inside the chat interface, so that the character creator feels like a natural conversation step rather than an isolated form.

#### Acceptance Criteria

1. WHEN the opening message for the LOBBY stage is displayed, THE Trip_Agent SHALL display the message "Let's build your travel character — your choices shape where we go and what we do."
2. THE Trip_Agent SHALL then render the budget selection as the first InteractiveSlot with three cards: Low Budget, Medium Budget, High Budget.
3. WHEN the user selects a budget, THE TripAgentChat SHALL update the PixelAvatar preview to reflect the new outfit layer within 200ms of the selection event.
4. WHEN the user selects a budget, THE Trip_Agent SHALL display a follow-up message: "What role do you usually play in a group trip?" followed by the travel style selector cards.
5. WHEN the user selects a travel style, THE TripAgentChat SHALL update the PixelAvatar preview to reflect the new headwear layer within 200ms of the selection event.
6. WHEN the user selects a travel style, THE Trip_Agent SHALL display a follow-up message: "What do you want most from this trip? Pick as many as you like." followed by the interest chip grid.
7. WHEN the user selects at least one interest, THE TripAgentChat SHALL update the PixelAvatar preview to reflect the new handheld item layer within 200ms of the selection event.
8. THE TripAgentChat SHALL show the PixelAvatar preview in a fixed position within the character creation conversation view, updating incrementally as each selection is made; the preview SHALL remain visible without scrolling for the duration of the character creation flow.
9. WHEN all three selections (budget, travel style, and at least one trip interest) are complete, THE TripAgentChat SHALL display a "Confirm Character" button.
10. WHEN the user confirms their character and the POST to `/api/character-profile` succeeds, THE TripAgentChat SHALL broadcast `member-joined` and display a confirmation message showing the generated persona name, budget level, travel style, and at least one trip interest.
11. IF the POST to `/api/character-profile` fails, THEN THE TripAgentChat SHALL display an inline error message within the chat thread and retain all character selections without resetting the form.
12. THE CharacterCreator component SHALL support a `chatMode: boolean` prop; WHEN `chatMode` is `true`, THE CharacterCreator SHALL render each selection step as a sequential in-chat message with an InteractiveSlot per step; WHEN `chatMode` is `false`, THE CharacterCreator SHALL render its existing standalone single-page layout.

---

### Requirement 6: Availability and Destination Discovery Inside the Chat

**User Story:** As a traveller, I want to submit my travel dates and destination preferences through the chat, so that the guided flow feels natural and the inputs are never disconnected from context.

#### Acceptance Criteria

1. WHEN the room is in AVAILABILITY stage, THE Trip_Agent SHALL display the message "Nice. Now when are you free to travel?" and render the date range inputs.
2. WHEN the user activates "Save dates" and both a start date and an end date have been selected, THE Trip_Agent SHALL display the message "Where do you feel like going?" and render the TravelVibeSelector cards.
3. IF the user activates "Save dates" without both a start date and an end date selected, THEN THE TripAgentChat SHALL block advancement and display an inline validation error within the date input section.
4. WHEN the user selects at least one travel vibe, THE Trip_Agent SHALL render the DestinationSuggestionPicker chips below the vibe selector.
5. THE TripAgentChat SHALL render the CustomDestinationInput as an "Add a custom destination" collapsible section below the suggestion chips; the section header SHALL be visible at all times as a collapsed affordance and SHALL not require the user to interact with suggestion chips first to see it.
6. WHEN the user activates "Save preferences" and at least one destination (suggested or custom) has been selected, THE TripAgentChat SHALL display a summary of their submitted dates, selected vibes, and selected destinations.
7. IF the user activates "Save preferences" without any destination selected, THEN THE TripAgentChat SHALL block submission and display an inline validation error within the destination selection section.
8. THE TripAgentChat SHALL show a per-member submission status row indicating, for each member by display name, one of two states: a submitted indicator or a pending indicator.
9. THE TripAgentChat SHALL update member submission statuses within 5 seconds via the existing 4-second poll and `member-joined` broadcast without a page reload.
10. THE AvailabilityStage component SHALL be implemented so that each form section (date inputs, vibe selector, suggestion picker, custom input) can be mounted and rendered individually in sequence without requiring all sections to be mounted simultaneously.

---

### Requirement 7: Destination Discovery Cards in Chat

**User Story:** As a traveller, I want to see destination recommendations as rich visual cards inside the chat, so that I can evaluate each option quickly and vote directly from the card.

#### Acceptance Criteria

1. WHEN the room is in DESTINATIONS stage, THE Trip_Agent SHALL display the message "Based on your group's characters, dates, and vibes — here are your best destination options."
2. THE TripAgentChat SHALL render destination suggestions as VoteableDestinationCard components inside the InteractiveSlot.
3. THE VoteableDestinationCard SHALL display: destination name, fit score badge, a "Why this fits" summary (≤ 30 words), price level badge, crowd level badge, best season/weather badge, and a Vote button; the Vote button SHALL be disabled and visually distinct for a user who has already voted for that destination.
4. THE VoteableDestinationCard SHALL display a "voted" indicator showing the current vote count; WHEN any member of the group votes for that destination, THE VoteableDestinationCard SHALL update the vote indicator and count.
5. WHEN the user votes, THE VoteableDestinationCard SHALL update the vote count optimistically immediately; IF the server returns a success response, THE VoteableDestinationCard SHALL retain the optimistic count; IF the server returns a 409 (duplicate vote) response, THE VoteableDestinationCard SHALL retain the displayed count; IF the server returns a 5xx response, THE VoteableDestinationCard SHALL revert to the pre-vote count and display an inline error.
6. THE VoteableDestinationCard SHALL display a "View full details" toggle button; WHEN the toggle is in an expanded state, THE VoteableDestinationCard SHALL show the full `recommendationReason`, `downsides`, `bestActivities`, and `personaFitSummary`; WHEN the toggle is in a collapsed state, those fields SHALL not be visible.
7. THE VoteableDestinationCard SHALL use the existing vote API (`POST /api/votes`) without changing its request/response contract.
8. WHEN the host triggers destination generation (POST to `/api/agents/destinations`), THE TripAgentChat SHALL show an inline loading state within the chat thread ("Finding the best destinations for your group…"); WHEN the response is received (success or error), THE TripAgentChat SHALL dismiss the loading state.
9. IF the destination agent call fails, THEN THE Trip_Agent SHALL display an inline error message within the chat thread with a retry button visible only to the host.

---

### Requirement 8: Flight Options Cards in Chat

**User Story:** As a traveller, I want to see flight options as visual comparison cards inside the chat, so that I can compare them and vote without navigating to a separate screen.

#### Acceptance Criteria

1. WHEN the room stage transitions to FLIGHTS or FLIGHT_VOTE, THE Trip_Agent SHALL display the message "Now let's pick a flight style for the group."
2. THE TripAgentChat SHALL render the three flight categories as VoteableFlightCard components inside the InteractiveSlot.
3. THE VoteableFlightCard SHALL display: flight category name (Budget/Comfort/Best Value), estimated price range badge, approx travel duration, number of stops, budget impact badge (colour-coded: green = within budget, amber = near limit, red = likely over), and itinerary comfort badge.
4. THE VoteableFlightCard SHALL show a Vote button; WHEN any member of the group has voted on that option, THE VoteableFlightCard SHALL display a visual "voted" indicator and the current vote count for that option; the Vote button SHALL be disabled and visually distinct for a user who has already cast a flight vote.
5. THE VoteableFlightCard SHALL use the existing vote API (`POST /api/votes`) with `voteType: "flight"` without changing the contract.
6. WHEN a flight option reaches a plurality of votes (most votes among the three options with no tie), THE TripAgentChat SHALL display a confirmation message naming the selected flight category; the confirmation message SHALL not be displayed until the vote count data confirming the winning option has been received from the server.

---

### Requirement 9: Persistent Trip Context Panel

**User Story:** As a traveller, I want to always see the group's key trip decisions in a sidebar, so that I never lose track of what has been decided.

#### Acceptance Criteria

1. THE TripContextPanel SHALL be rendered as a sticky right-side panel visible on screens ≥ 1024px wide, remaining in the viewport as the user scrolls the TripAgentChat column.
2. THE TripContextPanel SHALL always display the following fields, each showing the current value or the literal string "Not set" when no value exists: current planning stage label, all member avatars with their display names, each member's ready/submitted status for the current stage, selected budget level, selected travel dates (formatted as start date – end date), selected travel vibes (as a comma-separated list or chips), destination shortlist or selected destination, and selected flight option.
3. WHEN a member submits their input for the current stage, THE TripContextPanel SHALL update that member's ready status without a page reload; the update SHALL be visible within 5 seconds.
4. IF both a budget level and a destination have been selected, THEN THE TripContextPanel SHALL show a BudgetStatusBadge.
5. THE TripContextPanel SHALL show the room code prominently at the top with a copy-to-clipboard button; WHEN the button is activated, THE TripContextPanel SHALL copy the room invite link to the clipboard and show a brief visual confirmation (e.g. "Copied!" label for 2 seconds).
6. THE TripContextPanel SHALL use deep navy as the background accent colour, sand cream as the surface colour, grass green for ready/submitted states, and sunset orange for pending states.
7. IF the user's screen width is < 1024px, THEN THE TripContextPanel SHALL not be visible by default; a toggle button SHALL be present in the room layout; WHEN the toggle is activated, THE TripContextPanel SHALL expand as an overlay or drawer over the TripAgentChat column.

---

### Requirement 10: Budget Input and Budget Awareness

**User Story:** As a traveller, I want to see whether our group's plan fits within budget, so that we can catch overruns before finalising the trip.

#### Acceptance Criteria

1. WHEN the user selects their budget level in the CharacterCreator, THE TripAgentChat SHALL record the budget level as part of the `CharacterProfile` (already supported via `budgetLevel` field).
2. IF both a destination has been selected and a flight option has been voted on, THEN THE TripContextPanel SHALL display a BudgetEstimate.
3. THE BudgetEstimate SHALL compute estimated total cost per person using the formula: `flightCostEstimate + (destinationPriceMultiplier × tripLengthDays × dailyCostByBudgetLevel)`, where: `tripLengthDays` is the inclusive count of calendar days from start to end date; `dailyCostByBudgetLevel` is $80/day for "low", $150/day for "medium", $280/day for "high"; `flightCostEstimate` is $215 for "budget" flights, $335 for "best_value" flights, $520 for "comfort" flights; `destinationPriceMultiplier` is 0.8 for "budget" destinations, 1.0 for "moderate" destinations, 1.4 for "premium" destinations.
4. THE BudgetStatusBadge SHALL show "Within budget" (green) when the estimate is below 80% of the budget level's upper spending threshold; "Near limit" (amber) when the estimate is between 80% and 100% of the threshold; "Likely over budget" (red) when the estimate exceeds the threshold; where the upper spending thresholds are: "low" = $800, "medium" = $2,000, "high" = $5,000.
5. THE TripContextPanel SHALL show a cost-driver explanation of ≤ 80 characters identifying the single largest cost component (flight cost or daily accommodation cost, whichever is higher) with its estimated contribution (e.g. "Comfort flights add ~$520 to your estimate").
6. IF a budget estimate cannot be computed (missing destination or flight), THEN THE TripContextPanel SHALL not show the BudgetStatusBadge.
7. THE BudgetEstimate SHALL use only locally-computed estimates based on destination price level, trip length, flight category, and budget level — no external API calls.
8. THE destination price multipliers are: "budget" = 0.8, "moderate" = 1.0, "premium" = 1.4; these multipliers apply to all three budget levels equally.

---

### Requirement 11: Member Status and Real-Time Sync

**User Story:** As a traveller, I want to see in real time which group members have submitted their inputs for the current stage, so that I know when everyone is ready.

#### Acceptance Criteria

1. THE TripAgentChat SHALL display a ReadyBadge per member showing one of two states: "Submitted" (green) or "Not submitted" (orange), without requiring a page reload.
2. WHEN a member submits their input (character profile, availability, vote), THE ReadyBadge for that member SHALL transition from "Not submitted" to "Submitted" within 5 seconds.
3. THE TripAgentChat SHALL not use `window.location.reload()`, `router.refresh()`, or full page navigation at any point.
4. THE RoomShell SHALL own a polling interval that fires every 3 seconds and fetches the current room state; THE RoomShell SHALL also subscribe to the `stage-change` broadcast channel; both SHALL remain in place unchanged.
5. WHEN the room stage changes, THE TripAgentChat SHALL append a new agent message and render the appropriate InteractiveSlot for the new stage without a page reload; the new message SHALL be visible within 3 seconds of the stage change being detected.
6. WHEN a new member joins the room via the `member-joined` broadcast, THE TripAgentChat SHALL add that member's display name and ReadyBadge to the member status display without a page reload.

---

### Requirement 12: Visual Hierarchy and Reduced Wordiness

**User Story:** As a traveller, I want the interface to use cards, icons, badges, and short summaries instead of long paragraphs, so that I can scan and act quickly.

#### Acceptance Criteria

1. WHEN an agent message bubble is rendered, THE Trip_Agent message text SHALL contain no more than 40 words of prose; structured data such as badges, chip labels, and card titles are exempt from this word count.
2. THE TripAgentChat SHALL use colour-coded badges with the following thresholds — price level: green = budget, amber = moderate, red = premium; crowd level: green = low, amber = moderate, red = high; budget status: green = within budget, amber = near limit, red = likely over; stage readiness: green = all submitted, orange = pending submissions.
3. THE VoteableDestinationCard SHALL show the "Why this fits" summary (≤ 30 words prose) by default and move the full `recommendationReason` into a "View details" expandable section that is collapsed by default.
4. THE VoteableFlightCard SHALL display price range, number of stops, and estimated travel duration as discrete badges rather than prose sentences; IF flight data is unavailable for a badge, THEN that badge SHALL not be rendered.
5. THE TripAgentChat SHALL use the 8-bit pixel-art visual style: `image-rendering: pixelated` on raster images, 2–4px solid blocky borders, no rounded corners (`border-radius: 0`), box-shadow with integer pixel offsets (e.g. `4px 4px 0 #000`), and a monospace font for all UI text.
6. THE TripAgentChat SHALL not render any surface with a white background or `text-gray-600` text colour; all background surfaces SHALL use one of: sky blue, sunset orange, grass green, sand cream, deep navy, or neon purple.
7. THE TripAgentChat SHALL use icons alongside short text labels on the following control buttons: confirm action ("✔ Confirm"), vote action ("🗳 Vote"), advance stage ("▶ Next"), go back ("← Previous").
8. THE TripAgentChat SHALL use colour-coded badges where badge colours follow the thresholds defined in criterion 2; "green" maps to the grass green palette colour, "amber" maps to the sunset orange palette colour, and "red" maps to a red variant distinct from the other palette colours.

---

### Requirement 13: Host Controls Inside Chat

**User Story:** As the room host, I want to control stage progression from within the chat interface, so that I never need to navigate away from the conversation.

#### Acceptance Criteria

1. IF the current user is the host AND the current stage satisfies the advance conditions defined in criterion 2, THEN THE TripAgentChat SHALL show a "▶ Move to next step" button inside the chat thread.
2. THE advance button SHALL be enabled only when all per-stage conditions are met: for AVAILABILITY — all members have submitted availability; for DESTINATIONS — at least one destination suggestion has been generated; for DESTINATION_VOTE — at least one vote has been cast; for FLIGHTS — flight options have been loaded; for FLIGHT_VOTE — at least one flight vote has been cast; for all other stages — no blocking condition.
3. WHEN the host activates the advance button and the PATCH to `/api/rooms/[code]/stage` succeeds, THE TripAgentChat SHALL broadcast `stage-change`; IF the broadcast fails, THE stage advance SHALL remain committed and other clients SHALL resync via the 3-second polling fallback; no rollback of the stage advance SHALL occur.
4. THE TripAgentChat SHALL retain the host-only "← Previous" stage control in the existing RoomShell header location; it SHALL not be removed as part of this refactor.
5. WHEN the host activates the "Regenerate destinations" control and the POST to `/api/agents/destinations` is in flight, THE TripAgentChat SHALL show a loading state message ("Finding the best destinations for your group…") inside the chat thread; WHEN the POST completes (success or error), THE TripAgentChat SHALL dismiss the loading state.

---

### Requirement 14: No Separate Full-Page Stage Screens

**User Story:** As a traveller, I want all planning steps to happen inside the single room view, so that I never feel lost or confused about where I am in the process.

#### Acceptance Criteria

1. THE TripAgentChat SHALL render all stage interactions (LOBBY, PERSONA, AVAILABILITY, GROUP_PROFILE, DESTINATIONS, DESTINATION_VOTE, FLIGHTS, FLIGHT_VOTE, ACTIVITIES, ITINERARY, FEEDBACK, NEGOTIATION, FINAL) inside the room page at `/room/[code]` via StageRouter, without navigating to separate URLs.
2. THE TripAgentChat panel SHALL never occupy the full screen height and width replacing the RoomShell header, MemberStrip, and TripContextPanel; all stage content SHALL be rendered within the TripAgentChat scrollable area.
3. WHEN the stage changes, THE TripAgentChat SHALL append a new agent message at the bottom of the thread and render the new stage's InteractiveSlot below it within 500ms of the stage change being detected; prior messages SHALL remain in the thread and not be cleared.
4. THE TripAgentChat SHALL retain all agent messages sent during the current session in the thread; users SHALL be able to scroll up to view the full conversation history.
5. WHEN the user scrolls up in the chat thread to view prior messages, the current stage's InteractiveSlot SHALL remain fully visible in the viewport without requiring horizontal scrolling; IF the InteractiveSlot is below the fold, the user SHALL be able to scroll back down to reach it.

---

### Requirement 15: Backward Compatibility With Later Pipeline Stages

**User Story:** As the development team, we want the chatbot-first refactor to not block or break the ACTIVITIES → ITINERARY → FEEDBACK → NEGOTIATION → FINAL pipeline stages, so that the later pipeline remains available.

#### Acceptance Criteria

1. WHEN the room stage is ACTIVITIES, ITINERARY, FEEDBACK, NEGOTIATION, or FINAL, THE TripAgentChat SHALL call StageRouter, which SHALL render the corresponding existing stage component (ActivitiesStage, ItineraryStage, FeedbackStage, NegotiationStage, or FinalStage) inside the InteractiveSlot.
2. THE StageRouter SHALL remain the component that maps `currentStage` to a stage component; TripAgentChat SHALL call StageRouter and render its output inside the InteractiveSlot; StageRouter SHALL not be removed or have its mapping logic bypassed.
3. THE TripAgentChat SHALL pass the same `StageProps` interface (including the optional `characterProfiles` prop) to all stage components embedded via StageRouter without modification.
4. WHEN the room stage transitions to ACTIVITIES, ITINERARY, FEEDBACK, NEGOTIATION, or FINAL, THE Trip_Agent SHALL display a short introductory message (≤ 40 words) for that stage before rendering the stage component inside the InteractiveSlot.

---

### Requirement 16: Accessibility

**User Story:** As a traveller with accessibility needs, I want the chat interface to be navigable with a keyboard and readable by screen readers, so that I can participate in trip planning.

#### Acceptance Criteria

1. THE TripAgentChat SHALL maintain WCAG AA 4.5:1 minimum colour contrast ratio on all text/background colour combinations across all surfaces in the component.
2. ALL interactive elements in TripAgentChat (chips, cards, vote buttons, confirm buttons) SHALL be reachable via the Tab key in a logical top-to-bottom, left-to-right sequential order matching the visual layout, and activatable via the Enter or Space key.
3. ALL interactive elements SHALL have a visible focus indicator that distinguishes the focused element from its unfocused state in a way that is apparent without relying solely on colour change.
4. THE TripAgentChat SHALL use semantic HTML: `<main>` for the chat panel, `<aside>` for TripContextPanel, `<article>` or `<section>` per message group, `<button>` for all interactive controls.
5. THE PixelAvatar SVG layers SHALL carry `aria-hidden="true"` so screen readers skip decorative graphics.
6. WHEN a new Trip_Agent message is rendered, THE message SHALL be announced to screen readers via an `aria-live="polite"` live region.
7. ALL non-native interactive elements (chips, option cards) that are not rendered as `<button>` or `<a>` elements SHALL carry an explicit ARIA role (e.g. `role="button"` or `role="checkbox"`) and an `aria-label` or `aria-labelledby` attribute that describes the element's purpose and, where applicable, its selected state (e.g. `aria-pressed="true"` for selected chips).
