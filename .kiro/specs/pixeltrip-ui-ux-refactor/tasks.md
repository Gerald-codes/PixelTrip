# Implementation Plan: PixelTrip UI/UX Refactor

## Overview

This plan converts PixelTrip from a plain black-and-white SaaS aesthetic to an 8-bit collaborative travel planning game. Implementation proceeds in layers: shared types and data models first, then core visual components (PixelAvatar, CharacterCreator), followed by the persistent RoomShell, the guided destination discovery flow, AI agent enrichment, and finally the visual 8-bit restyling across all existing stage components. Each step builds on the previous one, and nothing is left unwired.

## Tasks

- [x] 1. Define shared types, constants, and data model
  - [x] 1.1 Add new type exports to `lib/types.ts`
    - Add `BudgetLevel`, `TravelStyle`, `TripInterest`, `TravelVibe`, `AvatarConfig`, `CharacterProfile`, and `Identity` types/interfaces
    - Export the `STAGE_ORDER` array type if not already present
    - Do not modify or remove any existing exports
    - _Requirements: 8.15, 9.3, 9.4, 1.6_

  - [x] 1.2 Create `lib/stageOrder.ts` with the `STAGE_ORDER` constant
    - Export `STAGE_ORDER: RoomStage[]` containing the full pipeline order from LOBBY to FINAL
    - Used by `StageProgress` and `StageRouter`
    - _Requirements: 3.3, 1.2_

  - [x] 1.3 Create `lib/vibeChips.ts` with the `VIBE_CHIPS` mapping constant
    - Export `VIBE_CHIPS: Record<Exclude<TravelVibe, 'anywhere'>, string[]>` with all nine vibe-to-destination arrays as defined in the design
    - _Requirements: 5.3_

  - [x] 1.4 Create `lib/avatarConfig.ts` with avatar config derivation utilities
    - Export `deriveAvatarConfig(budget: BudgetLevel, style: TravelStyle, primaryInterest: TripInterest): AvatarConfig`
    - Implement the budget→outfit, style→headwear, interest→handheldItem mappings from the design
    - Export `generatePersonaSummary(budget: BudgetLevel, style: TravelStyle, interests: TripInterest[], displayName: string): string` — pure function, no API call
    - _Requirements: 4.5, 4.8_

  - [x] 1.5 Create `lib/roomUtils.ts` with the `roomChanged` comparator
    - Export `roomChanged(a: TripRoom, b: TripRoom): boolean` that compares `currentStage`, `selectedDestination`, `selectedFlightOption`, `currentItineraryId`, `finalItineraryId`
    - Returns `true` only when at least one field differs
    - _Requirements: 7.9_

  - [x] 1.6 Create `supabase/schema-character-profiles.sql` migration
    - Use `CREATE TABLE IF NOT EXISTS character_profiles (...)` with all columns, constraints, and index as specified in the design
    - No `DROP TABLE`, `DROP COLUMN`, or `ALTER COLUMN TYPE` statements
    - Include `UNIQUE (user_id, room_id)` constraint and the room_id index
    - _Requirements: 9.1, 9.2, 9.8, 1.3, 1.7_

- [x] 2. Implement Character Profile API route
  - [x] 2.1 Create `app/api/character-profile/route.ts` with POST and GET handlers
    - POST: validate all required fields and enum values, upsert into `character_profiles` using `ON CONFLICT (user_id, room_id) DO UPDATE SET ...`, return 200/201 with the `CharacterProfile` row, 400 for validation errors, 500 for DB errors
    - GET: accept `?roomId=...` query param, return `CharacterProfile[]` ordered by `created_at` asc, return 400 if roomId missing
    - _Requirements: 9.5, 9.6, 9.7_

  - [ ]* 2.2 Write unit tests for character-profile route validation
    - Test missing field returns 400
    - Test invalid enum value returns 400
    - Test missing roomId on GET returns 400
    - _Requirements: 9.5, 9.6_

- [x] 3. Implement PixelAvatar and InterestBadge components
  - [x] 3.1 Create `app/components/PixelAvatar.tsx`
    - Implement layered SVG rendering with four z-indexed layers: base body, outfit, headwear, handheld item
    - Accept `avatarConfig: AvatarConfig` and `size?: 'sm' | 'md' | 'lg'` props
    - Apply `image-rendering: pixelated` and `image-rendering: crisp-edges`
    - Render unknown config keys as the default layer variant (log warning, don't crash)
    - Use only original inline SVG elements or CSS pixel-block compositions — no external images or third-party libraries
    - Add `aria-hidden="true"` to SVG layers
    - _Requirements: 4.5, 4.11, 2.7, 8.6_

  - [x] 3.2 Create `app/components/InterestBadge.tsx`
    - Accept `interest: TripInterest` prop
    - Render a small pill (16px) with distinct colour per interest (neon-purple or palette colour) and a one-character icon
    - Include tooltip with interest label
    - _Requirements: 4.7, 8.10_

  - [ ]* 3.3 Write property test for PixelAvatar layer rendering
    - **Property 5: PixelAvatar renders all four required layers**
    - For any valid `AvatarConfig`, the rendered output contains exactly four stacked layer elements in correct z-order
    - **Validates: Requirements 4.5**

  - [ ]* 3.4 Write property test for secondary interest badge count
    - **Property 6: Secondary interest badges match selection count**
    - For any selection of N interests where N ≥ 2, exactly N - 1 `InterestBadge` components are rendered
    - **Validates: Requirements 4.7**

  - [ ]* 3.5 Write property test for InterestBadge labels
    - **Property 19: InterestBadge renders a non-empty label for every valid interest**
    - For any value in `TripInterest`, the rendered badge has a visible non-empty label
    - **Validates: Requirements 8.10**

- [x] 4. Implement CharacterCreator and selector sub-components
  - [x] 4.1 Create `app/components/BudgetSelector.tsx`
    - Accept `value: BudgetLevel | null`, `onChange: (v: BudgetLevel) => void`, `disabled?: boolean`
    - Render exactly three selectable cards (low/medium/high) with SVG icons and labels
    - Apply 8-bit styling: 2-4px border, box-shadow offset, no border-radius
    - Keyboard accessible: Tab + Enter/Space, visible focus ring
    - _Requirements: 4.2, 8.7, 4.12, 2.2, 2.3_

  - [x] 4.2 Create `app/components/TravelStyleSelector.tsx`
    - Accept `value: TravelStyle | null`, `onChange: (v: TravelStyle) => void`, `disabled?: boolean`
    - Render exactly five selectable cards (leader/planner/follower/chill/adventurer) with SVG icons
    - Same styling and keyboard accessibility as BudgetSelector
    - _Requirements: 4.3, 8.8, 4.12, 2.2, 2.3_

  - [x] 4.3 Create `app/components/MultiInterestSelector.tsx`
    - Accept `value: TripInterest[]`, `onChange: (v: TripInterest[]) => void`, `disabled?: boolean`
    - Render exactly nine selectable chips in flex-wrap grid; toggling adds/removes from array without affecting others
    - Selected chips: grass-green background + deep-navy text; keyboard accessible
    - _Requirements: 4.4, 8.9, 4.12, 2.2, 2.3_

  - [x] 4.4 Create `app/components/CharacterCreator.tsx`
    - Compose BudgetSelector, TravelStyleSelector, MultiInterestSelector, PixelAvatar into a two-column layout (desktop) / stacked (mobile)
    - Live PixelAvatar preview updates within 100ms of any selection change
    - Display generated persona summary sentence (pure local function, no API call)
    - "Confirm Character" button: disabled until all three selections are made (cursor-not-allowed + 50% opacity)
    - On confirm: POST to `/api/character-profile`, broadcast `member-joined`, call `onConfirmed`
    - On POST failure: display inline error, retain form state
    - _Requirements: 4.1, 4.5, 4.6, 4.8, 4.9, 4.10, 4.13, 8.5_

  - [ ]* 4.5 Write property test for interest chip multi-selection independence
    - **Property 4: Interest chip multi-selection is independent**
    - Toggling chip I produces exactly S ∪ {I} or S \ {I} with all other chips unaffected
    - **Validates: Requirements 4.4**

  - [ ]* 4.6 Write property test for Confirm Character button enabled state
    - **Property 8: Confirm Character button enabled iff all selections present**
    - Button enabled ↔ budget !== null && travelStyle !== null && interests.length > 0
    - **Validates: Requirements 4.9**

  - [ ]* 4.7 Write property test for persona summary
    - **Property 7: Persona summary is always non-empty and content-bearing**
    - For any valid combination, `generatePersonaSummary` returns a non-empty string containing budget, style, and interest info
    - **Validates: Requirements 4.8**

  - [ ]* 4.8 Write property test for CharacterCreator form state retention on error
    - **Property 9: CharacterCreator retains form state on POST failure**
    - On non-200 response, selected values remain unchanged and error message is visible
    - **Validates: Requirements 4.13**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement TravelVibeSelector and DestinationSuggestionPicker
  - [x] 6.1 Create `app/components/TravelVibeSelector.tsx`
    - Accept `value: TravelVibe[]`, `onChange: (v: TravelVibe[]) => void`, `disabled?: boolean`
    - Render exactly ten vibe cards with human-readable labels (never show `vibe:` prefix), SVG icons, taglines
    - Multi-selection with filled sky-blue background + checkmark on selected cards
    - Keyboard accessible
    - _Requirements: 5.1, 5.2, 5.9, 8.11_

  - [x] 6.2 Create `app/components/DestinationSuggestionPicker.tsx`
    - Accept `selectedVibes: TravelVibe[]`, `value: string[]`, `onChange: (v: string[]) => void`, `disabled?: boolean`
    - Derive visible chips as deduplicated union of VIBE_CHIPS for selected non-`anywhere` vibes
    - Hidden when only `anywhere` is selected or no vibes selected
    - Each chip toggles independently
    - _Requirements: 5.3, 5.4, 8.12_

  - [x] 6.3 Create `app/components/CustomDestinationInput.tsx`
    - Accept `value: string[]`, `onChange: (v: string[]) => void`
    - Render existing custom entries as removable tags + text input for new entries
    - Enforce maxLength=100 per entry, max 10 custom destinations
    - _Requirements: 5.5, 8.13_

  - [ ]* 6.4 Write property test for vibe card multi-selection independence
    - **Property 10: Vibe card multi-selection is independent**
    - Toggling vibe C produces exactly V ∪ {C} or V \ {C} with all other vibes unaffected
    - **Validates: Requirements 5.2**

  - [ ]* 6.5 Write property test for destination chip set matching selected vibes
    - **Property 11: Destination chip set matches selected vibes**
    - For any non-empty subset of vibes (excluding `anywhere`), rendered chips === deduplicated union of VIBE_CHIPS
    - **Validates: Requirements 5.3**

  - [ ]* 6.6 Write property test for vibe prefix never displayed
    - **Property 14: Vibe: prefix is never displayed to the user**
    - No visible text element contains the substring `"vibe:"`
    - **Validates: Requirements 5.9**

- [x] 7. Implement vibe encoding and hydration in AvailabilityStage
  - [x] 7.1 Create `lib/destinationEncoding.ts` with encode and hydrate helpers
    - Export `buildDestinationInterests(vibes: TravelVibe[], chips: string[], customs: string[]): string[]` — encodes vibes with `vibe:` prefix, includes chips and custom destinations as plain strings
    - Export `hydrateFromPreferences(rows: { countryOrCity: string }[]): { vibes: TravelVibe[], chips: string[], customs: string[] }` — parses saved rows back into state
    - _Requirements: 5.6, 5.7, 5.8_

  - [x] 7.2 Integrate TravelVibeSelector, DestinationSuggestionPicker, and CustomDestinationInput into `AvailabilityStage`
    - Replace the freetext destination textarea with the guided discovery flow
    - On save: encode using `buildDestinationInterests` and pass to existing `/api/availability` POST
    - On mount: hydrate from existing `destination_preferences` rows using `hydrateFromPreferences`
    - Empty selections allowed (sends empty `destinationInterests` array)
    - On POST failure: display inline error, retain all form state
    - _Requirements: 5.1, 5.6, 5.7, 5.8, 5.10, 5.11_

  - [ ]* 7.3 Write property test for save encoding
    - **Property 12: Save encodes vibes with vibe: prefix and chips as plain strings**
    - `buildDestinationInterests` produces exactly `{ "vibe:" + v | v ∈ V } ∪ C ∪ D`
    - **Validates: Requirements 5.6, 5.7**

  - [ ]* 7.4 Write property test for hydration round-trip
    - **Property 13: Hydration round-trip reconstructs prior selections**
    - Hydrating previously-saved rows reconstructs the same vibes, chips, and customs
    - **Validates: Requirements 5.8**

- [x] 8. Implement persistent RoomShell and realtime hooks
  - [x] 8.1 Create `app/hooks/useCharacterProfiles.ts`
    - Fetch `GET /api/character-profile?roomId=...` on mount
    - Poll every 3 seconds; refresh immediately on `member-joined` broadcast
    - Return `CharacterProfile[]` (empty array when roomId is null)
    - _Requirements: 3.8, 7.3, 7.8_

  - [x] 8.2 Create `app/components/MemberAvatar.tsx`
    - Accept `user: User`, `characterProfile: CharacterProfile | null`, `isHost: boolean`
    - Render PixelAvatar when profile exists, neutral placeholder silhouette when null
    - Display `displayName` (truncated to 10 chars + ellipsis)
    - Show crown SVG host badge when `isHost`
    - Add `aria-label="{displayName}'s avatar"` on container
    - _Requirements: 3.5, 8.4_

  - [x] 8.3 Create `app/components/MemberStrip.tsx`
    - Accept `members: User[]`, `hostUserId: string`, `characterProfiles: CharacterProfile[]`
    - Render horizontal scrollable row of MemberAvatar components
    - Look up matching CharacterProfile by userId
    - _Requirements: 3.4, 8.3_

  - [x] 8.4 Create `app/components/StageProgress.tsx`
    - Accept `currentStage: RoomStage`, `stages: RoomStage[]`
    - Render horizontal dots: completed = grass-green (#4ADE80), active = sunset-orange (#FB923C) with pulse animation, pending = sand-cream (#FEF3C7) border
    - Pulse respects `prefers-reduced-motion`
    - Add `aria-label` per dot (e.g. "LOBBY - completed")
    - _Requirements: 3.3, 3.11, 8.2_

  - [x] 8.5 Create `app/components/RoomShell.tsx`
    - Accept props: `room`, `identity`, `members`, `characterProfiles`, `onRoomUpdated`, `onGoBack?`, `children`
    - Render persistent header: room code (monospaced, text-lg min), invite link + copy button (confirmation "Copied!" for 1.5s), StageProgress, host controls
    - Render MemberStrip below header
    - Render `{children}` slot for stage content
    - Own the Supabase `stage-change` broadcast subscription
    - Own the 3-second polling interval for `GET /api/rooms/[code]` (using `roomChanged` comparator to avoid unnecessary re-renders)
    - Host-only "Previous stage" control: visible on all stages except LOBBY; patches stage backward without page reload
    - Two-stop gradient background on header using palette colours
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8, 3.9, 3.10, 3.12, 7.1, 7.2, 7.6, 7.9, 7.10, 8.1, 2.4_

  - [x] 8.6 Refactor `app/room/[code]/page.tsx` to use RoomShell
    - Keep identity derivation and initial room fetch in page.tsx
    - Render `<RoomShell>` wrapping `<StageRouter>` instead of the current bare layout
    - Move persistent subscriptions and polling into RoomShell
    - Pass `characterProfiles` down to StageRouter via extended `StageProps`
    - Ensure no `window.location.reload()` or full navigation on state updates
    - _Requirements: 3.1, 3.6, 7.1, 7.2_

  - [ ]* 8.7 Write property test for StageProgress rendering
    - **Property 3: StageProgress renders all states correctly**
    - For any valid `RoomStage`, stages before = completed, matching = active, after = pending
    - **Validates: Requirements 3.3, 3.11**

  - [ ]* 8.8 Write property test for roomChanged comparator
    - **Property 18: roomChanged is a correct field-level comparator**
    - Returns `true` iff at least one of the five fields differs
    - **Validates: Requirements 7.9**

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Enrich AI agents with CharacterProfile data
  - [x] 10.1 Modify `app/api/agents/destinations/route.ts` to use CharacterProfile data
    - Query `character_profiles` for all room members before building context
    - When CharacterProfile exists: use `budgetLevel`, `travelStyle`, `tripInterests`, `generatedPersonaName`, `planningWeights` in prompt
    - When CharacterProfile absent: fall back to existing persona data (backward compatible)
    - Parse vibe-prefixed `destination_preferences` rows: extract vibe name, add to prompt as travel vibe signal
    - Add vibe-weighting instructions to system prompt
    - On `character_profiles` query failure: log error, fall back to persona-only — never return 500
    - Response shape (`DestinationSuggestion[]`) unchanged
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.8_

  - [x] 10.2 Modify `app/api/agents/group-profile/route.ts` to use CharacterProfile data
    - Query `character_profiles` in parallel with existing queries
    - Prefer CharacterProfile over Persona when both exist
    - Pass `budgetLevel`, `travelStyle`, `tripInterests` into per-member context
    - Same error fallback pattern as destinations route
    - Response shape (`GroupProfile`) unchanged
    - _Requirements: 6.7, 6.8_

  - [ ]* 10.3 Write property test for agent prompt including CharacterProfile
    - **Property 15: Agent prompt includes CharacterProfile when available**
    - `buildContext` produces a prompt containing member's budgetLevel, travelStyle, and at least one tripInterest
    - **Validates: Requirements 6.2, 6.7**

  - [ ]* 10.4 Write property test for agent prompt persona fallback
    - **Property 16: Agent prompt falls back to persona when CharacterProfile absent**
    - When CharacterProfile is null but persona exists, prompt includes persona data
    - **Validates: Requirements 6.3**

  - [ ]* 10.5 Write property test for vibe signals in agent prompt
    - **Property 17: Vibe signals appear in agent prompt when vibe-prefixed preferences exist**
    - When vibe-prefixed rows exist, prompt contains extracted vibe names as signals
    - **Validates: Requirements 6.4**

- [x] 11. Apply 8-bit visual restyling across all stage components
  - [x] 11.1 Restyle the landing page (`app/page.tsx`)
    - Apply two-stop gradient hero section using palette colours
    - Replace all button styles with retro 8-bit buttons (palette colours, 2-4px border, 4px box-shadow offset)
    - Replace card borders with pixel-style borders (no border-radius)
    - Remove `bg-white`/`text-gray-600` — use palette surfaces
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.9_

  - [x] 11.2 Restyle `LobbyStage` with CharacterCreator integration
    - Replace the static `PersonaCard` grid with the new `CharacterCreator` component
    - Apply 8-bit card styling, palette colours, pixel borders
    - Ensure CharacterCreator writes data consumable by group-profile and destination agents
    - _Requirements: 1.8, 2.1, 2.2, 2.3, 2.5, 4.1_

  - [x] 11.3 Restyle `AvailabilityStage` with guided discovery integration
    - Ensure TravelVibeSelector and DestinationSuggestionPicker are properly integrated
    - Apply 8-bit visual styling to all cards and buttons
    - Remove any remaining `bg-white`/`text-gray-600`
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.9, 5.1_

  - [x] 11.4 Restyle remaining stage components (`GroupProfileStage`, `DestinationsStage`, vote stages, `FlightStage`)
    - Apply palette colours, pixel borders, retro buttons, box-shadows across all stage components
    - Replace `border-gray-200` with palette-coloured 2-4px borders
    - Disabled buttons: 50% opacity + cursor-not-allowed + retain palette colours
    - Ensure WCAG AA 4.5:1 contrast on all text/background combinations (use deep-navy text on orange/green surfaces)
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.8, 2.9_

- [x] 12. Implement realtime sync refinements
  - [x] 12.1 Integrate `destinations-updated` and `votes-updated` broadcast handlers
    - On `destinations-updated` broadcast: call `GET /api/agents/destinations?roomId=...`, update React state
    - On `votes-updated` broadcast: call `GET /api/votes/{roomId}/{voteType}`, update React state
    - Add 4-second polling interval in AvailabilityStage for availability sync
    - All without `window.location.reload()` or full navigation
    - _Requirements: 7.4, 7.5, 7.7_

  - [x] 12.2 Implement polling fallback and error handling
    - If Supabase channel fails to subscribe: rely on polling fallback, no user-facing error
    - If three+ consecutive polling failures: show dismissible "Having trouble syncing" banner
    - _Requirements: 7.10_

  - [ ]* 12.3 Write property test for stage machine transition
    - **Property 1: Stage machine transition is deterministic**
    - PATCH from host always yields documented successor; PATCH from non-host always rejected
    - **Validates: Requirements 1.2**

  - [ ]* 12.4 Write property test for vote uniqueness
    - **Property 2: Vote uniqueness is enforced**
    - Two votes for same `(roomId, userId, voteType)` result in exactly one record
    - **Validates: Requirements 1.4**

- [x] 13. Final wiring and integration
  - [x] 13.1 Wire CharacterCreator `onConfirmed` callback to update RoomShell state
    - After character confirmed: broadcast `member-joined`, refresh `useCharacterProfiles`, update MemberStrip
    - Ensure MemberAvatar in other clients updates without page reload
    - _Requirements: 4.10, 3.7, 3.8, 7.8_

  - [x] 13.2 Wire `member-left` broadcast handler in MemberStrip
    - On `member-left` broadcast: remove member's MemberAvatar from state without page reload
    - _Requirements: 3.12_

  - [x] 13.3 Ensure all existing API routes remain unmodified
    - Verify no changes to HTTP method, URL path, request body fields, or response shape for all existing routes
    - Verify all existing Realtime broadcast channels preserved
    - Verify no `DROP TABLE`/`DROP COLUMN`/`ALTER COLUMN TYPE` in any SQL file
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.7_

  - [x] 13.4 Verify shared types preservation
    - Confirm no existing exported interfaces or enum values removed from `lib/types.ts`
    - New additions only
    - _Requirements: 1.6, 8.15_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (19 total)
- Unit tests validate specific examples and edge cases
- The implementation language is TypeScript (Next.js 14, React, Tailwind CSS) as specified in the design
- All SVG avatar layers are original compositions — no external images or third-party avatar libraries
- Existing API routes, Supabase schema, and Realtime channels are preserved throughout

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6"] },
    { "id": 1, "tasks": ["2.1", "3.1", "3.2"] },
    { "id": 2, "tasks": ["2.2", "3.3", "3.4", "3.5", "4.1", "4.2", "4.3"] },
    { "id": 3, "tasks": ["4.4", "4.5", "4.6", "4.7"] },
    { "id": 4, "tasks": ["4.8", "6.1", "6.2", "6.3", "7.1"] },
    { "id": 5, "tasks": ["6.4", "6.5", "6.6", "7.2", "8.1", "8.2"] },
    { "id": 6, "tasks": ["7.3", "7.4", "8.3", "8.4"] },
    { "id": 7, "tasks": ["8.5"] },
    { "id": 8, "tasks": ["8.6", "8.7", "8.8"] },
    { "id": 9, "tasks": ["10.1", "10.2"] },
    { "id": 10, "tasks": ["10.3", "10.4", "10.5", "11.1"] },
    { "id": 11, "tasks": ["11.2", "11.3", "11.4"] },
    { "id": 12, "tasks": ["12.1", "12.2"] },
    { "id": 13, "tasks": ["12.3", "12.4", "13.1", "13.2"] },
    { "id": 14, "tasks": ["13.3", "13.4"] }
  ]
}
```
