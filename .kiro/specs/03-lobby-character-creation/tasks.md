# Implementation Plan: Lobby Character Creation

## Overview

Incremental plan to build the frontend-only, session-only Lobby / Character
Creation screen inside `src/features/party-lobby` (TypeScript, Next.js + React, Tailwind
theme tokens only). Order: feature-local types → pure logic (layer map, budget, mocks) →
extend `CharacterSprite` with layers → `CharacterPreview` → option-group primitives → draft
hook → `CharacterCreator` with save-to-session → adventure sidebar panels → progress stepper
→ responsive drawer + accessibility → compose into the SETUP stage → final verification.

**Scope guardrails (apply to every task):** no persistence (no Supabase / `localStorage` /
`sessionStorage` / cookies / IndexedDB), no backend / endpoints / new service, no change to
`api-contracts.md` or shared contract types, and no later-stage (DISCOVER → WRAP), voting,
feedback, export, or AI/chat work. Style with named theme tokens only; UI imports no concrete
`*.mock.ts`/`*.api.ts`.

## Tasks

- [x] 1. Feature-local types and layer map foundation
  - [x] 1.1 Add feature-local types in `src/features/party-lobby/types.ts`
    - Define `SpriteLayerSlot`, `SpriteLayer`, `LayerMapEntry`, `LayerMap`, `ActivityDraft`
      (`{ name, priority: "must_have" | "optional" }`), `DateRange` (`{ start, end }`),
      `CharacterDraft` (archetype/outfit/accessory/palette, travelStyle, destinations[],
      interests[], activities[], hardConstraints[], origin, budgetText, availableDates[]),
      `SessionCharacterAppearance`, `SessionCharacter` (payload-shaped: availableDates,
      destinations, travelStyle, budget, interests, activities, hardConstraints, origin,
      `character: { appearance, spriteKey }`), `PartyMemberView`, `BudgetView`, `AdventureView`
      (TypeScript strict, no `any`); do not modify shared `src/types`.
    - _Requirements: 2.1, 11.2, 15.1, 19.5, 8.6, 10.4, 20.4, 21.2, 22.4, 23.4_
  - [x] 1.2 Create the data-driven `LayerMap` in `src/features/party-lobby/lib/characterLayers.ts`
    - Map each slot (base/archetype/outfit/accessory) selection id → `{ slot, order, assetKey }`,
      reusing ids from existing `lib/characterOptions.ts`; include the always-present base entry
      and `order` values so base < archetype < outfit < accessory.
    - _Requirements: 2.1, 2.4, 2.7_
  - [x] 1.3 Implement `resolveLayers(draft, map)` in `lib/characterLayers.ts`
    - Always include base; add a layer per set archetype/outfit/accessory selection; ignore
      unknown ids; return sorted ascending by `order`.
    - _Requirements: 2.1, 2.3, 2.5, 2.6, 2.7_

- [x] 2. Budget and sidebar mock data (pure)
  - [x] 2.1 Implement `deriveBudgetView(limit, estimated)` in `lib/budget.ts`
    - Compute `remaining`, `isOverBudget`, `overageAmount`.
    - _Requirements: 15.1, 15.3, 15.4_
  - [x] 2.2 Create feature-local mock fixtures in `lib/adventureMocks.ts`
    - Export an `AdventureView` fixture: trip name "JAPAN ADVENTURE", date label "12 Dec → 20
      Dec", party members (e.g. Explorer Keith, Ranger Alice, Scholar Bob), `capacity`, and a
      budget built via `deriveBudgetView(1500, 0)`; no imports from `src/mocks` or services.
    - _Requirements: 12.1, 12.2, 12.3, 13.1, 15.2_

- [x] 3. Extend the shared CharacterSprite primitive (layers)
  - [x] 3.1 Add optional `layers?: readonly SpriteLayer[]` to `src/components/CharacterSprite.tsx`
    - When `layers` provided, stack absolutely-positioned pixelated, integer-scaled layers;
      when omitted, render exactly as today (single box keyed by `spriteKey`) to keep existing
      call sites unchanged; preserve `decorative`/`aria-hidden` and `role="img"` behavior; token
      styling only.
    - _Requirements: 2.1, 2.2, 19.1, 19.2_

- [x] 4. Character preview
  - [x] 4.1 Implement `CharacterPreview` in `src/features/party-lobby/components/CharacterPreview.tsx`
    - Presentational: takes `layers` + `label`, renders large (`size="lg"`) via the extended
      `CharacterSprite`; decorative to assistive tech; token styling only.
    - _Requirements: 2.1, 2.2, 18.6_

- [x] 5. Option group primitives
  - [x] 5.1 Implement `OptionCardGroup` (single-select) in `components/OptionCardGroup.tsx`
    - `fieldset`/`legend` + one `PixelButton` (`variant="option"`) per option; `ariaPressed`
      on the active id; raises `onSelect(id)`; no data fetching. Reused for Archetype, Outfit,
      Accessory, Palette, and Travel Style.
    - _Requirements: 3.1, 3.4, 4.1, 4.4, 5.1, 5.4, 6.1, 6.3, 23.1, 23.2, 23.3, 19.2, 19.3_
  - [x] 5.2 Implement `OptionTagGroup` (multi-select) in `components/OptionTagGroup.tsx`
    - Same structure; `ariaPressed` reflects membership; raises `onToggle(id)`. Reused for
      Interests and Destinations.
    - _Requirements: 7.1, 7.4, 8.1, 8.4, 19.2, 19.3_
  - [x] 5.3 Implement `ActivityPriorityGroup` (multi-select + priority) in `components/ActivityPriorityGroup.tsx`
    - Toggle each activity on/off; when selected, expose a `must_have`/`optional` two-state
      `PixelButton` pair with `ariaPressed`; raises `onToggle(name)` and `onPriorityChange(name,
      priority)`; produces `ActivityDraft` objects. No data fetching.
    - _Requirements: 8.1, 8.4, 8.5, 8.6, 19.2, 19.3_

- [x] 6. Preference fields
  - [x] 6.1 Implement `PreferenceFields` in `components/PreferenceFields.tsx`
    - Numeric budget input (label "ADVENTURE FUNDS", placeholder "1500", `min=0`); an "ORIGIN"
      text input (placeholder "SIN"); a repeatable "HARD CONSTRAINTS" list (add/remove
      free-text lines); and one or more availability ranges, each a "Available From"/"Available
      Until" `type="date"` pair with add/remove-range controls. Every control has a programmatic
      `<label htmlFor>`; props in / callbacks out (`onBudgetChange`, `onOriginChange`,
      `onAddConstraint`/`onRemoveConstraint`, `onDateRangeChange`/`onAddDateRange`/
      `onRemoveDateRange`).
    - _Requirements: 9.1, 9.2, 9.3, 10.1, 10.2, 10.3, 10.4, 10.5, 21.1, 21.2, 21.3, 22.1, 22.2, 22.3, 22.4, 20.1, 20.2, 20.3, 18.4_

- [x] 7. Character draft hook and save-to-session
  - [x] 7.1 Implement `useCharacterDraft` in `hooks/useCharacterDraft.ts`
    - `useReducer` draft with actions: `select` (single-select last-write-wins, incl. palette),
      `toggle` (multi-select interests/destinations), `toggleActivity` + `setActivityPriority`,
      `setBudgetText`, `setOrigin`, `addConstraint`/`removeConstraint`,
      `setDateRange`/`addDateRange`/`removeDateRange`; expose `canSave` and in-memory
      `sessionCharacter`; `save()` projects draft → payload-shaped `sessionCharacter` in state
      ONLY (no storage, no service, no fetch).
    - _Requirements: 3.2, 4.2, 5.2, 6.2, 7.2, 7.3, 8.2, 8.3, 11.2, 11.4, 11.6_
  - [x] 7.2 Implement `canSave`, `deriveSpriteKey`, and `toSessionCharacter` in `lib/draft.ts`
    - `canSave` true iff archetype+outfit+accessory set; `deriveSpriteKey(appearance)` returns a
      deterministic key (e.g. `explorer-01`); `toSessionCharacter` projects the draft into the
      payload shape (parses budget text to number|null; copies availableDates, destinations,
      interests, activities, hardConstraints, origin, travelStyle; builds
      `character.appearance` = accessory/outfit/palette + derived `spriteKey`); returns null
      when not saveable.
    - _Requirements: 9.4, 9.5, 11.2, 11.6, 23.4_

- [x] 8. CharacterCreator left panel (wiring)
  - [x] 8.1 Implement `CharacterCreator` in `components/CharacterCreator.tsx`
    - Heading "CREATE YOUR CHARACTER", subtitle "Build your traveller for the adventure.";
      compose `CharacterPreview` (fed `resolveLayers(draft, map)`), five `OptionCardGroup`s
      (archetype/outfit/accessory/palette/travel style), `OptionTagGroup`s (interests,
      destinations), `ActivityPriorityGroup` (activities), `PreferenceFields` (budget, origin,
      hard constraints, date ranges), and the primary "SAVE CHARACTER" `PixelButton`; wire to
      `useCharacterDraft`.
    - _Requirements: 1.2, 1.3, 2.3, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 11.1, 20.1, 21.1, 22.1, 23.1_
  - [x] 8.2 Implement save confirmation and disabled state
    - Disable save while `!canSave` with an explanatory line; on save show a polite live-region
      status that the character is saved for this session only and not persisted.
    - _Requirements: 11.3, 11.5, 11.6_

- [x] 9. Adventure sidebar panels
  - [x] 9.1 Implement `SidebarTripHeader` in `components/SidebarTripHeader.tsx`
    - Takes `tripName` + `dateRangeLabel`; readable date text; token styling.
    - _Requirements: 12.1, 12.2_
  - [x] 9.2 Implement `SidebarPartyPanel` in `components/SidebarPartyPanel.tsx`
    - Member small `CharacterSprite` (decorative) + name; render `capacity - members.length`
      empty slots; "INVITE MEMBERS" `PixelButton` surfacing `roomCode` or a placeholder;
      `onInvite` performs no network call.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_
  - [x] 9.3 Implement `SidebarPlaceholderPanel` in `components/SidebarPlaceholderPanel.tsx`
    - Display-only "Not selected" panel; reuse for Destination and Flight; non-interactive.
    - _Requirements: 14.1, 14.2, 14.3_
  - [x] 9.4 Implement `BudgetPanel` in `components/BudgetPanel.tsx`
    - Show limit/estimated/remaining from a `BudgetView`; within-budget vs over-budget using a
      `danger` token plus an "OVER BUDGET" text label and overage (color never alone).
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

- [x] 10. Adventure progress stepper
  - [x] 10.1 Implement `AdventureProgress` in `components/AdventureProgress.tsx`
    - Render six stages via `buildStageSteps(planningStage)` from existing `lib/stages.ts`;
      SETUP active, rest upcoming; active distinguished by text/structure plus a theme color.
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

- [x] 11. Sidebar container, responsive drawer, and composition
  - [x] 11.1 Implement `useAdventureDrawer` in `hooks/useAdventureDrawer.ts`
    - Local `isOpen` + `toggle`; default collapsed on mobile.
    - _Requirements: 17.2, 17.4_
  - [x] 11.2 Implement `AdventureSidebar` in `components/AdventureSidebar.tsx`
    - Compose header, party panel, two placeholder panels, budget panel, progress; desktop
      fixed column, mobile collapsible drawer with a toggle exposing `aria-expanded`; take an
      optional already-resolved `roomSession` prop for the room code (no service import).
    - _Requirements: 1.4, 14.1, 14.2, 17.2, 17.4, 17.5, 19.4_
  - [x] 11.3 Compose left + right into `SetupStageContent`
    - Render `CharacterCreator` (left) and `AdventureSidebar` (right) as a two-column desktop
      layout within the existing party-lobby SETUP content; mobile keeps preview prominent,
      options in a single scrollable column, sidebar as drawer; do not alter later-stage views.
    - _Requirements: 1.1, 1.5, 17.1, 17.3_

- [x] 12. Accessibility and token-compliance pass
  - [x] 12.1 Audit focus order, visible focus, keyboard operability, and decorative sprites
    - Logical focus order; visible focus ring on all controls; selections and save keyboard
      operable; budget/date inputs labelled; preview and decorative sidebar sprites
      `aria-hidden`; respect `prefers-reduced-motion` for any stepped animation.
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

- [x] 13. Update feature README
  - [x] 13.1 Document the new pieces in `src/features/party-lobby/README.md`
    - Describe the character creator + adventure sidebar, the layered character model and
      `LayerMap`, the session-only (no-persistence) save seam, and that `CharacterSprite` was
      extended (not forked) for layers.
    - _Requirements: 1.5, 11.4_

## Notes

- Each task references specific requirement sub-clauses for traceability.
- No task touches persistence, a backend/endpoint, a new service, `api-contracts.md`, shared
  contract types, or any later stage (DISCOVER → WRAP) / voting / feedback / export / AI-chat.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2"] },
    { "id": 2, "tasks": ["1.3", "3.1"] },
    { "id": 3, "tasks": ["4.1", "5.1", "5.2", "5.3", "6.1", "7.2", "9.1", "9.3", "9.4", "10.1"] },
    { "id": 4, "tasks": ["7.1", "9.2", "11.1"] },
    { "id": 5, "tasks": ["8.1", "11.2"] },
    { "id": 6, "tasks": ["8.2", "11.3"] },
    { "id": 7, "tasks": ["12.1", "13.1"] }
  ]
}
```
