# Requirements Document

## Introduction

PixelTrip is a collaborative AI travel planning web app where small groups plan trips together through an AI-assisted pipeline. The app currently has a complete functional pipeline from LOBBY through FLIGHT_VOTE, backed by Supabase, Realtime broadcast, and AWS Bedrock agents. However, the visual design is a plain black-and-white SaaS aesthetic, persona selection is text-only and static, destination input is an unguided textarea, and the room feels like a series of disconnected full-page forms with no persistent collaborative shell.

This refactor upgrades the entire UI/UX to match PixelTrip's core identity as an 8-bit collaborative travel planning game. All existing API routes, Supabase schema (except safe additive changes), stage logic, voting logic, and Realtime sync are preserved without modification. The scope is purely the visual design layer and the three feature enhancements listed below: a persistent room shell, a visual character creator, and a guided destination discovery flow — plus the AI agent enrichment that flows from richer character data.

---

## Glossary

- **App**: The PixelTrip Next.js 14 web application.
- **Room**: A shared trip planning session identified by a six-character uppercase room code.
- **RoomShell**: The persistent wrapper component that stays visible across all stages and displays room metadata, stage progress, and member avatars.
- **Stage**: One step in the trip planning pipeline, driven by `TripRoom.currentStage` (`LOBBY`, `AVAILABILITY`, `GROUP_PROFILE`, `DESTINATIONS`, `DESTINATION_VOTE`, `FLIGHTS`, `FLIGHT_VOTE`, and future stages).
- **Host**: The user whose `userId` matches `TripRoom.hostUserId`; the only user permitted to advance or reverse the room stage.
- **Member**: Any user currently joined to the room, including the host.
- **CharacterProfile**: The custom 8-bit travel character a user builds in the character creator; stored in the `character_profiles` table.
- **PixelAvatar**: A layered SVG/CSS component that renders a user's character visually from their `CharacterProfile` attributes.
- **TravelVibe**: A high-level mood-board destination category (e.g. `asia`, `beach_escape`, `food_trip`) shown in the guided destination discovery flow.
- **DestinationChip**: A clickable suggested destination derived from a selected TravelVibe (e.g. Japan, Thailand from `asia`).
- **BudgetLevel**: One of `low`, `medium`, or `high`; influences the avatar outfit layer.
- **TravelStyle**: One of `leader`, `planner`, `follower`, `chill`, or `adventurer`; influences the avatar headwear layer.
- **TripInterest**: One or more of `food`, `scenery`, `adventure`, `shopping`, `nightlife`, `culture`, `relaxation`, `hidden_gems`, `flexible`; influences the avatar handheld item and interest badges.
- **Supabase Realtime**: The broadcast + presence layer used for stage-change, member-joined, destinations-updated, and votes-updated events.
- **EARS pattern**: Easy Approach to Requirements Syntax — each acceptance criterion uses one of: Ubiquitous (THE … SHALL), Event-driven (WHEN … THE … SHALL), State-driven (WHILE … THE … SHALL), Unwanted event (IF … THEN THE … SHALL), Optional feature (WHERE … THE … SHALL), or Complex (ordered combination).

---

## Requirements

### Requirement 1: Preserve Existing Working Flow

**User Story:** As a developer, I want the UI/UX refactor to leave all existing backend logic, API routes, Supabase schema, and Realtime sync intact, so that nothing breaks for users currently in the LOBBY-through-FLIGHT_VOTE pipeline.

#### Acceptance Criteria

1. THE App SHALL preserve all existing API routes under `/api/rooms`, `/api/users`, `/api/availability`, `/api/personas`, `/api/votes`, `/api/agents/group-profile`, `/api/agents/destinations`, `/api/agents/feedback-analysis`, `/api/agents/negotiation`, `/api/agents/itinerary`, and `/api/itinerary` without modification to their HTTP method, URL path, required request body fields, or success response body shape and status code.
2. THE App SHALL preserve the `RoomStage` state machine order (`LOBBY → PERSONA → AVAILABILITY → GROUP_PROFILE → DESTINATIONS → DESTINATION_VOTE → FLIGHTS → FLIGHT_VOTE → ACTIVITIES → ITINERARY → FEEDBACK → NEGOTIATION → FINAL`) and all stage-gate logic enforced by `/api/rooms/[code]/stage`, including forward advancement prerequisite checks, host-gated access, backward movement from any non-LOBBY stage, and the NEGOTIATION→ITINERARY loop.
3. THE App SHALL preserve all existing Supabase table schemas (`users`, `personas`, `trip_rooms`, `availability`, `destination_preferences`, `destination_suggestions`, `votes`, `activity_preferences`, `itineraries`, `itinerary_feedback`, `conflict_resolutions`) without dropping or altering any existing column.
4. THE App SHALL preserve the voting uniqueness constraint on `votes (room_id, user_id, vote_type)` so duplicate votes remain blocked at the database level.
5. THE App SHALL preserve all existing Supabase Realtime broadcast channels: `stage-change`, `member-joined`, `destinations-updated`, and `votes-updated`.
6. THE App SHALL preserve all shared types in `lib/types.ts` without removing or renaming existing exported interfaces or enum values.
7. WHEN the refactor introduces new Supabase tables or columns, THE App SHALL add them via additive `ALTER TABLE … ADD COLUMN` or `CREATE TABLE IF NOT EXISTS` statements only, never via `DROP TABLE`, `DROP COLUMN`, or `ALTER COLUMN … TYPE` statements.
8. IF a new UI component replaces a legacy component (e.g. `CharacterCreator` replaces static persona cards in `LobbyStage`), THEN THE App SHALL continue to write `budgetLevel`, `travelStyle`, `tripInterests`, and `planningWeights` in a form consumable by the group-profile agent and destination agent, either via the existing `selected_persona_id` FK or the new `character_profiles` row, so agent behaviour is not degraded.

---

### Requirement 2: Visual UI Redesign (8-bit Travel Game Aesthetic)

**User Story:** As a user, I want PixelTrip to look and feel like a playful 8-bit travel planning game, so that the experience is visually distinct from generic SaaS dashboards and reflects the app's collaborative, travel-themed identity.

#### Acceptance Criteria

1. THE App SHALL apply a travel-inspired colour palette — sky blue (`#38BDF8`), sunset orange (`#FB923C`), sand cream (`#FEF3C7`), grass green (`#4ADE80`), deep navy (`#1E3A5F`), and neon purple (`#A855F7`) — as the primary colours across all built stage components via Tailwind CSS utility classes.
2. THE App SHALL replace all `border-gray-200` card borders with pixel-style borders (2–4 px solid, using palette colours, with no `border-radius`) on every card and panel component across the landing page, `RoomShell`, `LobbyStage`, `AvailabilityStage`, `GroupProfileStage`, `DestinationsStage`, destination vote stage, flight stage, and flight vote stage.
3. THE App SHALL replace all plain `bg-black` and `bg-gray-100` button styles with retro-styled buttons that use palette colours, a 2–4 px solid contrasting border, and a box-shadow offset of exactly 4 px on both axes using a palette colour (e.g. `shadow-[4px_4px_0px_#1E3A5F]`) where the shadow colour is visually distinct from the button face colour.
4. THE App SHALL apply a two-stop gradient background — using exclusively palette colours, with neither stop being a neutral grey or white — to the landing page hero section and the `RoomShell` header.
5. THE App SHALL render all card components with a 2–4 px solid border and a 2–4 px per-axis box-shadow offset using contrasting palette colours, with no `rounded-*` Tailwind utility applied to the card's outer border, to achieve a blocky pixel-art-inspired appearance.
6. WHEN a button is in a disabled state, THE App SHALL visually distinguish it by reducing opacity to 50%, applying `cursor-not-allowed`, and retaining its palette background colour and border.
7. THE App SHALL apply `image-rendering: pixelated` to all avatar image elements so pixel-art assets render crisply at any display size.
8. THE App SHALL ensure all text elements (headings, labels, and body text) rendered on palette-coloured surfaces across all refactored stage components meet a minimum contrast ratio of 4.5:1 (WCAG AA) against their background.
9. THE App SHALL not use `bg-white` or `text-gray-600` as the primary text or card background colour in any refactored stage component; all surfaces must use colours from the defined palette.

---

### Requirement 3: Persistent Collaborative Room Shell

**User Story:** As a member of a trip room, I want a persistent room header and member strip to remain visible across every stage, so that I always know which room I am in, how far along the trip planning is, and who else is present.

#### Acceptance Criteria

1. THE App SHALL render a `RoomShell` component that wraps all stage content inside `app/room/[code]/page.tsx` and remains mounted across all stage transitions without unmounting or triggering any navigation that reloads the page (`window.location` is not changed).
2. THE `RoomShell` SHALL display the room code in a monospaced font at a minimum font-size of `text-lg` (18 px) in the header at all times while a user is inside the room.
3. THE `RoomShell` SHALL display a `StageProgress` component that shows the current stage name and a visual progress indicator (step bar or progress dots) reflecting the position in the pipeline from LOBBY to FINAL.
4. THE `RoomShell` SHALL display a `MemberStrip` component that renders one `MemberAvatar` per connected member at all times.
5. THE `MemberAvatar` SHALL display the member's display name beneath or beside the avatar, a `PixelAvatar` rendered from `CharacterProfile` when one exists for that member, a neutral placeholder silhouette when no `CharacterProfile` exists, and a visually distinct host badge (e.g. a crown icon) when `isHost` is true.
6. WHEN `TripRoom.currentStage` changes via broadcast, THE `RoomShell` SHALL re-fetch the room state via `GET /api/rooms/[code]`, update `currentStage` in React state, and re-render the `StageProgress` indicator and stage content area — all without calling `window.location.reload()` or triggering a full browser navigation.
7. WHEN a new member joins the room and a `member-joined` broadcast is received on `room:{roomId}:members`, THE `MemberStrip` SHALL add the new member's `MemberAvatar` by re-fetching the member list and updating React state, without calling `window.location.reload()`.
8. WHEN a member updates their `CharacterProfile` and a `member-joined` broadcast is received, THE `MemberStrip` SHALL re-fetch the member list and character profiles and update the corresponding `MemberAvatar` (avatar layers and display name), without calling `window.location.reload()`.
9. THE `RoomShell` SHALL display the shareable invite link (format: `{origin}/?join={roomCode}`) in the header alongside a copy-to-clipboard button that writes the link to the clipboard and shows a visible confirmation (e.g. "Copied!" text or a tooltip) for at least one second after the user clicks it.
10. WHILE the host is on any stage other than LOBBY, THE `RoomShell` SHALL display a "Previous stage" control visible only to the host; clicking it SHALL PATCH the stage backward and update `currentStage` in React state without calling `window.location.reload()`. WHILE the host is on LOBBY (the first stage), THE "Previous stage" control SHALL be hidden.
11. THE `StageProgress` component SHALL render completed stages (those before `currentStage` in STAGE_ORDER) with a grass-green (`#4ADE80`) filled indicator, the active stage (matching `currentStage`) with a sunset-orange (`#FB923C`) filled indicator, and pending stages (those after `currentStage`) with a sand-cream (`#FEF3C7`) unfilled indicator.
12. WHEN a member leaves the room (connection lost or navigates away) and a `member-left` broadcast is received on `room:{roomId}:members`, THE `MemberStrip` SHALL remove that member's `MemberAvatar` by updating React state, without calling `window.location.reload()`.

---

### Requirement 4: Visual Character Creator

**User Story:** As a user in the Lobby, I want to build a custom 8-bit travel character by choosing my budget, travel style, and trip interests, so that my character visually represents how I travel and my preferences feed into the group's AI-generated destination and itinerary suggestions.

#### Acceptance Criteria

1. THE App SHALL replace the static `PersonaCard` grid in `LobbyStage` with a `CharacterCreator` component that presents three sequential or side-by-side option groups: `BudgetSelector`, `TravelStyleSelector`, and `MultiInterestSelector`.
2. THE `BudgetSelector` SHALL render exactly three selectable cards for `low`, `medium`, and `high` budget levels, each with a distinct text label and an SVG or CSS icon representing the budget tier (backpack SVG for low, travel bag SVG for medium, suitcase SVG for high).
3. THE `TravelStyleSelector` SHALL render exactly five selectable cards for `leader`, `planner`, `follower`, `chill`, and `adventurer` travel styles, each with a distinct text label and an SVG or CSS icon representing the style's personality.
4. THE `MultiInterestSelector` SHALL render exactly nine selectable chips or cards for `food`, `scenery`, `adventure`, `shopping`, `nightlife`, `culture`, `relaxation`, `hidden_gems`, and `flexible`, and SHALL allow the user to select more than one interest simultaneously; selecting a chip toggles it without deselecting other chips.
5. THE `PixelAvatar` component SHALL render a layered pixel-style character composed of at least four visual layers stacked in z-order: base body (always visible), outfit layer (changes based on `BudgetLevel`), headwear layer (changes based on `TravelStyle`), and handheld item layer (driven by the primary `TripInterest`, defined as the first interest selected by the user in order of click/tap).
6. WHEN the user changes any option in `BudgetSelector`, `TravelStyleSelector`, or `MultiInterestSelector`, THE `PixelAvatar` preview SHALL visually reflect the updated combination within 100 ms of the user interaction, without requiring a button click or form submission.
7. IF the user has selected two or more `TripInterest` values, THEN THE `PixelAvatar` SHALL display `InterestBadge` components for all interests selected after the first (secondary interests), rendered as small icons alongside the primary handheld item layer.
8. THE `CharacterCreator` SHALL display a generated persona summary sentence beneath the avatar preview derived from the selected options without calling any API or AI agent (e.g. "Alex is a medium-budget Foodie + Nightlife Planner who likes organised routes and good meals").
9. THE `CharacterCreator` SHALL display a "Confirm Character" button that is enabled only when `BudgetLevel`, `TravelStyle`, and at least one `TripInterest` have each been selected; the button SHALL remain disabled (with `cursor-not-allowed` and 50% opacity) until all three conditions are met.
10. WHEN the user clicks the enabled "Confirm Character" button, THE App SHALL POST the character profile to `/api/character-profile`, and on a 200 response SHALL broadcast a `member-joined` event on `room:{roomId}:members` so other connected clients update the relevant `MemberAvatar` in the `MemberStrip` — the avatar and display name SHALL appear in other clients' `MemberStrip` without any client calling `window.location.reload()`.
11. THE `PixelAvatar` component SHALL be implemented using original SVG elements or CSS pixel-block compositions only; no `<img>` tags referencing external URLs, no third-party avatar libraries, and no copyrighted sprite sheets shall be used.
12. THE `CharacterCreator` SHALL be accessible via keyboard navigation: every `BudgetSelector` card, `TravelStyleSelector` card, and `MultiInterestSelector` chip SHALL be reachable via Tab key and activatable via Enter or Space key, with a visible focus ring on the focused element.
13. IF the POST to `/api/character-profile` returns a non-200 response, THEN THE `CharacterCreator` SHALL display an inline error message describing the failure and SHALL keep the form state (selected budget, style, and interests) intact so the user can retry without re-entering their choices.

---

### Requirement 5: Guided Destination Discovery

**User Story:** As a user in the Availability stage, I want to pick my destination preferences through a visual mood-board flow rather than typing comma-separated text, so that the experience feels like collaborative travel discovery and my selections are more expressive than raw freetext.

#### Acceptance Criteria

1. THE App SHALL replace the freetext destination interests `<textarea>` in `AvailabilityStage` with a `TravelVibeSelector` component that presents exactly ten visual vibe cards: `asia`, `western_cities`, `beach_escape`, `nature_scenery`, `food_trip`, `culture_trip`, `adventure_trip`, `shopping_city`, `hidden_gems`, and `anywhere`.
2. THE `TravelVibeSelector` SHALL allow the user to select multiple vibe cards simultaneously; each selected card SHALL display a filled accent-colour background (from the palette) AND a visible checkmark icon, while unselected cards use the default unfilled background and no checkmark.
3. WHEN the user selects one or more vibes, THE App SHALL display a `DestinationSuggestionPicker` component showing exactly the following destination chips per vibe — `asia`: Japan, South Korea, Taiwan, Thailand, Vietnam, Indonesia, Malaysia; `western_cities`: Italy, France, Spain, UK, Switzerland, Netherlands, Germany; `beach_escape`: Bali, Maldives, Phuket, Krabi, Cebu, Da Nang, Okinawa; `nature_scenery`: Hokkaido, New Zealand, Switzerland, Zhangjiajie, Taiwan East Coast, Northern Vietnam; `food_trip`: Osaka, Seoul, Taipei, Bangkok, Penang, Ho Chi Minh City, Hong Kong; `culture_trip`: Kyoto, Seoul, Beijing, Istanbul, Rome, Barcelona, Hanoi; `adventure_trip`: New Zealand, Nepal, Hokkaido, Northern Vietnam, Taiwan East Coast, Jeju; `shopping_city`: Tokyo, Seoul, Bangkok, Hong Kong, Taipei, Singapore, Paris; `hidden_gems`: Okinawa, Tainan, Kanazawa, Da Nang, Penang, Luang Prabang, Fukuoka; `anywhere`: no chips are shown (the `DestinationSuggestionPicker` is hidden when only `anywhere` is selected).
4. THE `DestinationSuggestionPicker` SHALL allow the user to select multiple destination chips simultaneously; selecting a chip toggles it without deselecting other chips.
5. THE App SHALL display a `CustomDestinationInput` below the chip picker as an optional fallback that allows the user to type any additional destination not listed in the chips; the input SHALL accept a maximum of 100 characters per entry and allow a maximum of 10 custom destinations.
6. WHEN the user saves their availability, THE App SHALL encode each selected vibe as a `destination_preferences` row with `country_or_city` set to `vibe:{vibe_name}` (e.g. `vibe:asia`) so the existing `/api/availability` POST route and `destination_preferences` table contract are preserved without schema changes.
7. WHEN the user saves their availability, THE App SHALL encode each selected destination chip and each non-empty custom destination string as a `destination_preferences` row with the plain destination name (e.g. `Japan`) in `country_or_city`, exactly as the existing API expects.
8. WHEN `AvailabilityStage` hydrates on mount and finds existing `destination_preferences` rows for the current user, THE App SHALL pre-select the matching vibe cards and destination chips (stripping the `vibe:` prefix for display purposes) and pre-populate the `CustomDestinationInput` with any existing rows that are neither vibe-prefixed nor in the suggested chip lists, so users see their prior selections rather than a blank form.
9. THE `TravelVibeSelector` SHALL not display the `vibe:` prefix to the user anywhere in the UI; all displayed labels SHALL use human-readable names (e.g. "Asia", "Beach Escape", "Food Trip").
10. THE guided flow SHALL not prevent users from completing the Availability stage without selecting any vibe, chip, or custom destination; when a user saves with no destination selections, THE App SHALL send an empty `destinationInterests` array to `/api/availability` and accept a 200 response as success.
11. IF the POST to `/api/availability` returns a non-200 response, THEN THE App SHALL display an inline error message and keep all form state (selected vibes, chips, custom text, and date ranges) intact so the user can retry without re-entering their choices.

---

### Requirement 6: AI Destination Agent Uses Enriched Character Data

**User Story:** As a trip member, I want the destination recommendations to reflect my custom character's budget, travel style, and trip interests, so that the AI suggestions are genuinely tailored to our group's character profiles rather than generic seeded persona labels.

#### Acceptance Criteria

1. THE `/api/agents/destinations` route SHALL read `character_profiles` rows for all members of the room before constructing the agent prompt, in addition to the existing `destination_preferences` rows.
2. WHEN a member has a `character_profiles` row for the room, THE `/api/agents/destinations` route SHALL include that member's `budget_level`, `travel_style`, `trip_interests` array, `generated_persona_name`, and `planning_weights` in the prompt context used to generate destination recommendations.
3. WHEN a member does not have a `character_profiles` row but does have a `selected_persona_id` in the `users` table, THE `/api/agents/destinations` route SHALL fall back to the seeded `personas` row data for that member, preserving backward compatibility.
4. THE `/api/agents/destinations` route SHALL read all `destination_preferences` rows for the room and, for rows where `country_or_city` begins with the prefix `vibe:`, SHALL extract the vibe name and include it in the prompt as a travel vibe signal influencing the type of destinations suggested.
5. WHEN vibe-prefixed rows are present, THE `/api/agents/destinations` route SHALL weight destination suggestions toward categories that match the stated vibes (e.g. `vibe:beach_escape` increases weight toward coastal destinations) within the AI prompt instruction.
6. THE `/api/agents/destinations` route SHALL continue to return the same `DestinationSuggestion` JSON shape (`destinationName`, `fitScore`, `weatherSummary`, `seasonalitySummary`, `crowdLevel`, `priceLevel`, `bestActivities`, `downsides`, `personaFitSummary`, `recommendationReason`) without adding or removing top-level fields, so `DestinationsStage` and `DestinationCard` require no structural changes.
7. THE `/api/agents/group-profile` route SHALL also read `character_profiles` rows and incorporate `budget_level`, `travel_style`, and `trip_interests` data into the group profile synthesis prompt when available, so the `GroupProfile` output reflects actual custom characters rather than only seeded personas.
8. IF the `character_profiles` table does not yet exist or returns an error, THEN THE `/api/agents/destinations` route SHALL log the error and fall back to the existing persona-only prompt without returning a 500 error to the client.

---

### Requirement 7: Realtime Sync Without Full Refresh

**User Story:** As a trip member, I want all stage transitions, member updates, destination updates, and vote updates to appear on my screen automatically, so that I never need to manually refresh the browser to stay in sync with the group.

#### Acceptance Criteria

1. THE App SHALL not call `window.location.reload()`, assign `window.location.href`, or call `router.replace()`/`router.push()` for the purpose of syncing room state anywhere in the stage pipeline from LOBBY through FLIGHT_VOTE; all state updates SHALL propagate via React state and re-renders.
2. WHEN a `stage-change` broadcast is received on `room:{roomId}:stage`, THE App SHALL call `GET /api/rooms/[code]`, update `TripRoom.currentStage` in React state, and re-render the `StageRouter` to the new stage component — all without any browser navigation.
3. WHEN a `member-joined` broadcast is received on `room:{roomId}:members`, THE App SHALL call `GET /api/rooms/[code]/members`, update the members array in React state, and re-render `MemberStrip` — all without any browser navigation.
4. WHEN a `destinations-updated` broadcast is received on `room:{roomId}:destinations`, THE App SHALL call `GET /api/agents/destinations?roomId=...`, update the suggestions array in React state, and re-render `DestinationsStage` — all without any browser navigation.
5. WHEN a `votes-updated` broadcast is received on `room:{roomId}:votes:{voteType}`, THE App SHALL call `GET /api/votes/{roomId}/{voteType}`, update the vote results in React state, and re-render the active voting stage component — all without any browser navigation.
6. THE App SHALL invoke `GET /api/rooms/[code]` on a repeating 3-second interval as a fallback so clients that miss a `stage-change` broadcast receive the updated stage within 3 seconds of it being set on the server.
7. THE App SHALL invoke `GET /api/availability?roomId=...` on a repeating 4-second interval within `AvailabilityStage` so all members see each other's submitted date ranges and destination preferences within 4 seconds of submission.
8. WHEN a member saves or updates their `CharacterProfile` via POST to `/api/character-profile`, THE App SHALL broadcast a `member-joined` event on `room:{roomId}:members` so all other connected clients refresh the member list and update the corresponding `MemberAvatar`, with the updated avatar layers appearing without any client calling `window.location.reload()`.
9. THE App SHALL compare each incoming room update against the current React state using field-level equality on `currentStage`, `selectedDestination`, `selectedFlightOption`, `currentItineraryId`, and `finalItineraryId`; it SHALL only call the React state setter when at least one of these fields differs, to avoid unnecessary re-renders.
10. IF a Supabase Realtime channel subscription fails to reach `SUBSCRIBED` status, THEN THE App SHALL rely on the polling fallback described in criteria 6 and 7 and SHALL NOT display an error to the user unless three or more consecutive polling requests to the same endpoint each return a non-200 response.

---

### Requirement 8: New UI Components

**User Story:** As a developer, I want a well-defined set of new reusable components created for the refactor, so that the visual system is composable, testable, and consistently applied across all stages.

#### Acceptance Criteria

1. THE App SHALL provide a `RoomShell` component at `app/components/RoomShell.tsx` that accepts `room: TripRoom`, `identity: Identity`, `members: User[]`, `characterProfiles: CharacterProfile[]`, `onRoomUpdated: (r: TripRoom) => void`, and `onGoBack?: () => Promise<void>` props and renders the persistent header, `StageProgress`, `MemberStrip`, and a `{children}` slot for stage content.
2. THE App SHALL provide a `StageProgress` component at `app/components/StageProgress.tsx` that accepts `currentStage: RoomStage` and `stages: RoomStage[]` and renders a visual indicator — each stage as a distinct dot or step — marking completed stages filled grass-green (`#4ADE80`), the active stage filled sunset-orange (`#FB923C`), and pending stages unfilled with a sand-cream (`#FEF3C7`) border.
3. THE App SHALL provide a `MemberStrip` component at `app/components/MemberStrip.tsx` that accepts `members: User[]`, `hostUserId: string`, and `characterProfiles: CharacterProfile[]` and renders a horizontal scrollable row of `MemberAvatar` components, one per member.
4. THE App SHALL provide a `MemberAvatar` component at `app/components/MemberAvatar.tsx` that accepts `user: User`, `characterProfile: CharacterProfile | null`, and `isHost: boolean`, and renders the member's `PixelAvatar` when `characterProfile` is non-null (or a neutral placeholder silhouette when null), the member's `displayName`, and a host badge icon when `isHost` is true.
5. THE App SHALL provide a `CharacterCreator` component at `app/components/CharacterCreator.tsx` that composes `BudgetSelector`, `TravelStyleSelector`, `MultiInterestSelector`, and `PixelAvatar` into a single character-creation UI, with a live avatar preview pane and a generated persona summary sentence that updates reactively as selections change.
6. THE App SHALL provide a `PixelAvatar` component at `app/components/PixelAvatar.tsx` that accepts `avatarConfig: AvatarConfig` (containing `outfit`, `headwear`, `handheldItem`, and optionally `accessory` and `baseBody` keys) and renders the layered character using original SVG elements or CSS pixel-block compositions only — no `<img>` src pointing to external files.
7. THE App SHALL provide a `BudgetSelector` component at `app/components/BudgetSelector.tsx` that accepts `value: BudgetLevel | null`, `onChange: (v: BudgetLevel) => void`, and optional `disabled?: boolean`, and renders exactly three selectable budget option cards.
8. THE App SHALL provide a `TravelStyleSelector` component at `app/components/TravelStyleSelector.tsx` that accepts `value: TravelStyle | null`, `onChange: (v: TravelStyle) => void`, and optional `disabled?: boolean`, and renders exactly five selectable travel style option cards.
9. THE App SHALL provide a `MultiInterestSelector` component at `app/components/MultiInterestSelector.tsx` that accepts `value: TripInterest[]`, `onChange: (v: TripInterest[]) => void`, and optional `disabled?: boolean`, and renders exactly nine selectable interest chips allowing multi-selection.
10. THE App SHALL provide an `InterestBadge` component at `app/components/InterestBadge.tsx` that accepts `interest: TripInterest` and renders a small pill or icon badge with a colour and label distinct per interest, suitable for embedding inside `PixelAvatar` and `MemberAvatar`.
11. THE App SHALL provide a `TravelVibeSelector` component at `app/components/TravelVibeSelector.tsx` that accepts `value: TravelVibe[]`, `onChange: (v: TravelVibe[]) => void`, and optional `disabled?: boolean`, and renders exactly ten vibe cards with human-readable labels and SVG or CSS icons, allowing multi-selection.
12. THE App SHALL provide a `DestinationSuggestionPicker` component at `app/components/DestinationSuggestionPicker.tsx` that accepts `vibes: TravelVibe[]`, `value: string[]`, `onChange: (v: string[]) => void`, and optional `disabled?: boolean`, and renders exactly the destination chips defined in Requirement 5 Criterion 3 for the given vibes as selectable toggles.
13. THE App SHALL provide a `CustomDestinationInput` component at `app/components/CustomDestinationInput.tsx` that accepts `value: string` and `onChange: (v: string) => void` and renders a single text input labelled "Add a custom destination" for optional freetext entry.
14. WHEN `disabled` is `true` on `PixelAvatar`, `BudgetSelector`, `TravelStyleSelector`, `MultiInterestSelector`, `TravelVibeSelector`, or `DestinationSuggestionPicker`, THE component SHALL apply `pointer-events-none` and `opacity-50` to the interactive elements so clicks have no effect and the disabled state is visually apparent.
15. THE App SHALL export `BudgetLevel`, `TravelStyle`, `TripInterest`, `TravelVibe`, `AvatarConfig`, `CharacterProfile`, and `Identity` as named TypeScript types or interfaces from `lib/types.ts` so all new components import from a single source of truth rather than declaring their own local type definitions.

---

### Requirement 9: Character Profile Data Model

**User Story:** As a developer, I want a clearly defined data model for character profiles that extends the existing schema additively, so that custom character data is stored durably, remains linked to the user and room, and is available to both the UI and the AI agents.

#### Acceptance Criteria

1. THE App SHALL introduce a `character_profiles` table in Supabase with the following columns: `id` (UUID primary key, `gen_random_uuid()`), `user_id` (UUID not null, references `users.id` on delete cascade), `room_id` (UUID not null, references `trip_rooms.id` on delete cascade), `budget_level` (text not null, check in `('low', 'medium', 'high')`), `travel_style` (text not null, check in `('leader', 'planner', 'follower', 'chill', 'adventurer')`), `trip_interests` (JSONB not null default `'[]'`, e.g. `["food", "scenery"]`), `avatar_config` (JSONB not null default `'{}'`, storing `baseBody`, `outfit`, `headwear`, `handheldItem`, and optionally `accessory` keys), `generated_persona_name` (text not null), `planning_weights` (JSONB not null default `'{}'`, a map of interest key to numeric weight in `[0, 1]`), and `created_at` (timestamptz not null default `now()`).
2. THE `character_profiles` table SHALL enforce a unique constraint on `(user_id, room_id)` so each user has at most one character profile per room; a second POST for the same `(user_id, room_id)` pair SHALL perform an upsert and return a 200 response without error.
3. THE App SHALL add a `CharacterProfile` TypeScript interface to `lib/types.ts` with camelCase fields: `id: string`, `userId: string`, `roomId: string`, `budgetLevel: BudgetLevel`, `travelStyle: TravelStyle`, `tripInterests: TripInterest[]`, `avatarConfig: AvatarConfig`, `generatedPersonaName: string`, `planningWeights: Record<string, number>`, and `createdAt: string`.
4. THE App SHALL add the following named exports to `lib/types.ts`: `BudgetLevel` as `type BudgetLevel = 'low' | 'medium' | 'high'`; `TravelStyle` as `type TravelStyle = 'leader' | 'planner' | 'follower' | 'chill' | 'adventurer'`; `TripInterest` as `type TripInterest = 'food' | 'scenery' | 'adventure' | 'shopping' | 'nightlife' | 'culture' | 'relaxation' | 'hidden_gems' | 'flexible'`; `TravelVibe` as `type TravelVibe = 'asia' | 'western_cities' | 'beach_escape' | 'nature_scenery' | 'food_trip' | 'culture_trip' | 'adventure_trip' | 'shopping_city' | 'hidden_gems' | 'anywhere'`; and `AvatarConfig` as `interface AvatarConfig { baseBody: string; outfit: string; headwear: string; handheldItem: string; accessory?: string }`.
5. THE App SHALL provide a `POST /api/character-profile` route that accepts `{ userId: string, roomId: string, budgetLevel: BudgetLevel, travelStyle: TravelStyle, tripInterests: TripInterest[], avatarConfig: AvatarConfig, generatedPersonaName: string, planningWeights: Record<string, number> }` with all fields required, performs an upsert on `(user_id, room_id)`, and returns the saved `CharacterProfile` row with status 200 on success or `{ error: string }` with status 400 for missing/invalid fields or status 500 for database errors.
6. THE App SHALL provide a `GET /api/character-profile?roomId={roomId}` route that returns a JSON array of all `CharacterProfile` rows for the given room, ordered by `created_at` ascending; if `roomId` is absent or empty the route SHALL return `{ error: "roomId is required" }` with status 400.
7. IF a `character_profiles` row does not exist for a given user when any stage component fetches character profiles, THEN THE App SHALL return `null` for that user's profile, render a neutral placeholder silhouette avatar for that member in `MemberAvatar`, and SHALL NOT throw an unhandled error or display an error boundary.
8. THE `character_profiles` table creation SQL SHALL be placed in a new file `supabase/schema-character-profiles.sql` using `CREATE TABLE IF NOT EXISTS` with no `DROP TABLE` or `DROP COLUMN` statements, so the migration is safe to run against a database that already has the existing tables from `schema.sql`.
