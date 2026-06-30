# Design Document: PixelTrip UI/UX Refactor

## Overview

This document covers the technical design for the full UI/UX refactor of PixelTrip.

The refactor upgrades PixelTrip from a plain black-and-white SaaS aesthetic to an 8-bit collaborative travel game experience. Three functional enhancements are bundled with the visual redesign: a persistent `RoomShell`, a visual `CharacterCreator`, and a guided `TravelVibeSelector` + `DestinationSuggestionPicker` — plus enrichment of the AI destination and group-profile agents with the richer character data these produce.

All existing API routes, Supabase table schemas, stage-gate logic, voting constraints, and Realtime broadcast channels are preserved without modification. New database objects are additive only.

### Design Goals

1. Replace plain black-and-white SaaS aesthetic with an 8-bit travel game visual language.
2. Implement a persistent `RoomShell` that wraps all stages with no full-page reloads.
3. Build a visual `CharacterCreator` with a live `PixelAvatar` preview using layered SVG/CSS.
4. Replace the freetext destination textarea with a guided `TravelVibeSelector` + `DestinationSuggestionPicker`.
5. Enrich AI agents with `CharacterProfile` data while maintaining full backward compatibility.
6. All realtime sync happens through React state and Supabase broadcast — never `window.location.reload()`.

### Colour Palette

| Token | Hex | Usage |
|---|---|---|
| Sky blue | `#38BDF8` | Primary actions, links, active highlights |
| Sunset orange | `#FB923C` | Active stage indicator, CTA buttons, warm accents |
| Sand cream | `#FEF3C7` | Card backgrounds, pending stage indicators |
| Grass green | `#4ADE80` | Completed stages, success states, confirmed selections |
| Deep navy | `#1E3A5F` | Text on light surfaces, header backgrounds, button shadows |
| Neon purple | `#A855F7` | Accent highlights, interest badges, secondary CTAs |

---

## Architecture

### Component Hierarchy

The central architectural change is introducing `RoomShell` as a persistent wrapper that replaces the current `<main>` element in `app/room/[code]/page.tsx`. All state management that was previously in `page.tsx` migrates into or is threaded through `RoomShell`.

```
app/room/[code]/page.tsx
└── RoomShell (persistent across all stage transitions)
    ├── Header
    │   ├── Room code (monospaced, text-lg minimum)
    │   ├── Invite link + copy button
    │   ├── StageProgress (pipeline dots)
    │   └── Host controls (Previous stage, dev badge)
    ├── MemberStrip (horizontal scrollable)
    │   └── MemberAvatar × N (PixelAvatar or placeholder + name + host badge)
    └── <children> (stage content slot)
        └── StageRouter → active *Stage component
```

### Realtime Subscription Architecture

All Supabase Realtime subscriptions are owned at the `RoomShell` level (or inside dedicated hooks). Stage components never create their own stage-change subscriptions; they receive the current `room` object as a prop and call `onRoomUpdated` for local mutations.

```
RoomShell
├── useRoomMembers(code, roomId)          ← existing hook, unchanged
├── useCharacterProfiles(roomId)          ← new hook
├── channel room:{id}:stage               ← stage-change broadcast
├── interval 3s → GET /api/rooms/[code]  ← polling fallback
└── interval 3s → useRoomMembers poll    ← already in hook
```

### Data Flow: CharacterProfile

```
CharacterCreator (LobbyStage)
  → POST /api/character-profile
  → Supabase: INSERT INTO character_profiles
  → broadcastMemberJoined(roomId)
  → useCharacterProfiles refetches
  → RoomShell passes characterProfiles[] down to MemberStrip + StageRouter
  → MemberAvatar renders updated PixelAvatar
  → /api/agents/destinations reads character_profiles (with persona fallback)
```

### Migration Strategy: page.tsx → RoomShell

`app/room/[code]/page.tsx` currently owns: identity derivation, room fetch, members hook, stage-change broadcast subscription, polling interval, go-back handler, sync button, and invite link. After the refactor:

- Identity derivation stays in `page.tsx` (it runs before the room loads).
- `page.tsx` becomes a thin loader: it resolves identity, fetches the initial room, then renders `<RoomShell>` passing the room, identity, and callbacks.
- All persistent UI (header, progress, member strip) and all ongoing subscriptions move into `RoomShell`.
- `StageRouter` is unchanged and receives the same `StageProps` it does today.
- The `roomChanged()` helper stays in `page.tsx` or moves to a shared `lib/roomUtils.ts`.

This is a non-breaking refactor: no existing stage component's props change. `StageProps` is extended with an optional `characterProfiles` field but all current stages ignore it safely.

---

## Components and Interfaces

### RoomShell

**File:** `app/components/RoomShell.tsx`

```typescript
interface RoomShellProps {
  room: TripRoom;
  identity: Identity;
  members: User[];
  characterProfiles: CharacterProfile[];
  onRoomUpdated: (r: TripRoom) => void;
  onGoBack?: () => Promise<void>;
  children: React.ReactNode;
}
```

Responsibilities:
- Renders the persistent header (room code, invite link, copy button, stage progress, host controls).
- Renders `MemberStrip`.
- Renders the `{children}` slot (stage content).
- Owns the Supabase broadcast subscription for `stage-change` events (migrated from `page.tsx`).
- Owns the 3-second polling interval for room state (migrated from `page.tsx`).
- Passes `characterProfiles` down to `MemberStrip` and into `StageRouter` via extended props.

Internal state: `copied: boolean` for the clipboard confirmation (resets after 1.5 s via `setTimeout`).

### StageProgress

**File:** `app/components/StageProgress.tsx`

```typescript
interface StageProgressProps {
  currentStage: RoomStage;
  stages: RoomStage[]; // STAGE_ORDER constant exported from lib/stageOrder.ts
}
```

Renders a horizontal row of dots/pills, one per stage in `stages`. Visual states:
- **Completed** (index < currentIndex): filled grass-green `#4ADE80`, solid 2px border.
- **Active** (index === currentIndex): filled sunset-orange `#FB923C`, 2px border, pulse animation.
- **Pending** (index > currentIndex): sand-cream `#FEF3C7` background, 2px solid deep-navy border.

A `STAGE_ORDER` constant (array of `RoomStage` enum values in pipeline order) is exported from `lib/stageOrder.ts` so both `StageProgress` and `StageRouter` can reference it without duplicating the ordering.

### MemberStrip

**File:** `app/components/MemberStrip.tsx`

```typescript
interface MemberStripProps {
  members: User[];
  hostUserId: string;
  characterProfiles: CharacterProfile[];
}
```

Renders a horizontally scrollable `<ul>` of `MemberAvatar` components. Looks up the matching `CharacterProfile` for each member by `userId`. The strip uses `overflow-x-auto` with a max height so it doesn't push stage content down on narrow viewports.

### MemberAvatar

**File:** `app/components/MemberAvatar.tsx`

```typescript
interface MemberAvatarProps {
  user: User;
  characterProfile: CharacterProfile | null;
  isHost: boolean;
}
```

Renders:
- `PixelAvatar` when `characterProfile` is non-null, otherwise a neutral placeholder silhouette (a simple grey CSS pixel-block figure).
- `user.displayName` (truncated to 10 chars + ellipsis if longer).
- A crown SVG badge positioned top-right of the avatar frame when `isHost` is true.
- A subtle "online" indicator dot (grass-green).

### PixelAvatar

**File:** `app/components/PixelAvatar.tsx`

```typescript
interface PixelAvatarProps {
  avatarConfig: AvatarConfig;
  size?: 'sm' | 'md' | 'lg'; // defaults to 'md' (64px × 96px)
}
```

Renders a `position: relative` container with four absolutely-positioned SVG layers stacked in z-order:

| Layer | z-index | Driven by |
|---|---|---|
| Base body | 1 | `baseBody` key (always "default") |
| Outfit | 2 | `outfit` key (mapped from `BudgetLevel`) |
| Headwear | 3 | `headwear` key (mapped from `TravelStyle`) |
| Handheld item | 4 | `handheldItem` key (mapped from primary `TripInterest`) |

Secondary interests (all interests after the first selected) render as `InterestBadge` components in a small horizontal row beneath the avatar frame.

All SVG elements are inline, using only palette colours and simple geometric shapes (rectangles, circles, lines). The container has `image-rendering: pixelated` and `image-rendering: crisp-edges` applied via an inline style.

**Avatar Config Mapping:**

Budget → Outfit key:
- `low` → `"backpacker"` (simple shirt + small backpack silhouette)
- `medium` → `"casual"` (jacket/hoodie + travel bag)
- `high` → `"luxury"` (stylish jacket + suitcase)

TravelStyle → Headwear key:
- `leader` → `"captain_hat"` (explorer/captain hat)
- `planner` → `"cap_glasses"` (cap + clipboard)
- `follower` → `"villager_hat"` (simple hat)
- `chill` → `"beanie"` (beanie/headphones)
- `adventurer` → `"explorer_hat"` (wide-brim explorer hat)

TripInterest → Handheld item key (primary interest only):
- `food` → `"bubble_tea"` (cup with straw)
- `scenery` → `"camera"` (simple camera shape)
- `adventure` → `"hiking_stick"` (walking stick)
- `shopping` → `"shopping_bag"` (bag with handles)
- `nightlife` → `"neon_cup"` (glowing cup)
- `culture` → `"guidebook"` (book)
- `relaxation` → `"headphones"` (over-ear headphone arc)
- `hidden_gems` → `"compass"` (compass circle)
- `flexible` → `"map"` (folded map)

### InterestBadge

**File:** `app/components/InterestBadge.tsx`

```typescript
interface InterestBadgeProps {
  interest: TripInterest;
}
```

Renders a small pill (16px × 16px) with a distinct neon-purple or palette-coloured background, a one-character emoji-style icon, and a tooltip with the interest label. Each `TripInterest` has a fixed colour and icon mapping so badges are visually distinguishable.

### CharacterCreator

**File:** `app/components/CharacterCreator.tsx`

```typescript
interface CharacterCreatorProps {
  identity: Identity;
  roomId: string;
  onConfirmed: (profile: CharacterProfile) => void;
}
```

Layout: two-column on desktop (avatar preview pane left, selector pane right), single-column stacked on mobile.

Internal state:
- `budget: BudgetLevel | null`
- `travelStyle: TravelStyle | null`
- `interests: TripInterest[]`
- `saving: boolean`
- `saveError: string | null`

On every state change, derives `AvatarConfig` from current selections and passes it to the live `PixelAvatar` preview. Derives `personaSummary` from a pure local function `generatePersonaSummary(budget, travelStyle, interests, displayName)` — no API call.

The "Confirm Character" button is `disabled` when `budget === null || travelStyle === null || interests.length === 0`.

On confirm: POSTs to `/api/character-profile`, calls `broadcastMemberJoined(roomId)`, then calls `onConfirmed(profile)`.

### BudgetSelector

**File:** `app/components/BudgetSelector.tsx`

```typescript
interface BudgetSelectorProps {
  value: BudgetLevel | null;
  onChange: (v: BudgetLevel) => void;
  disabled?: boolean;
}
```

Three cards: Low (backpack SVG, label "Budget Traveller"), Medium (travel bag SVG, label "Mid-Range Explorer"), High (suitcase SVG, label "Luxury Seeker"). Selected card has a 2px sunset-orange border + `shadow-[4px_4px_0px_#1E3A5F]`.

### TravelStyleSelector

**File:** `app/components/TravelStyleSelector.tsx`

```typescript
interface TravelStyleSelectorProps {
  value: TravelStyle | null;
  onChange: (v: TravelStyle) => void;
  disabled?: boolean;
}
```

Five cards: Leader, Planner, Follower, Chill, Adventurer. Each has an inline SVG icon and a one-line description. Same selection styling as `BudgetSelector`.

### MultiInterestSelector

**File:** `app/components/MultiInterestSelector.tsx`

```typescript
interface MultiInterestSelectorProps {
  value: TripInterest[];
  onChange: (v: TripInterest[]) => void;
  disabled?: boolean;
}
```

Nine chips in a flex-wrap grid. Toggling a chip calls `onChange` with the updated array (add if absent, remove if present). All other chips are unaffected. Selected chips have a grass-green background + deep-navy text.

### TravelVibeSelector

**File:** `app/components/TravelVibeSelector.tsx`

```typescript
type TravelVibe =
  | 'asia' | 'western_cities' | 'beach_escape' | 'nature_scenery'
  | 'food_trip' | 'culture_trip' | 'adventure_trip' | 'shopping_city'
  | 'hidden_gems' | 'anywhere';

interface TravelVibeSelectorProps {
  value: TravelVibe[];
  onChange: (v: TravelVibe[]) => void;
}
```

Ten vibe cards in a 2×5 or 5×2 grid. Each card has a large icon (inline SVG), a human-readable label (never shows `vibe:` prefix), and a short tagline. Multi-selection: toggling adds/removes from the array. Selected cards show a filled sky-blue background + checkmark icon. The `anywhere` card, when the only selected vibe, hides the `DestinationSuggestionPicker`.

**Vibe → destination chip mapping** (constant object, lives in `lib/vibeChips.ts`):

```typescript
export const VIBE_CHIPS: Record<Exclude<TravelVibe, 'anywhere'>, string[]> = {
  asia: ['Japan', 'South Korea', 'Taiwan', 'Thailand', 'Vietnam', 'Indonesia', 'Malaysia'],
  western_cities: ['Italy', 'France', 'Spain', 'UK', 'Switzerland', 'Netherlands', 'Germany'],
  beach_escape: ['Bali', 'Maldives', 'Phuket', 'Krabi', 'Cebu', 'Da Nang', 'Okinawa'],
  nature_scenery: ['Hokkaido', 'New Zealand', 'Switzerland', 'Zhangjiajie', 'Taiwan East Coast', 'Northern Vietnam'],
  food_trip: ['Osaka', 'Seoul', 'Taipei', 'Bangkok', 'Penang', 'Ho Chi Minh City', 'Hong Kong'],
  culture_trip: ['Kyoto', 'Seoul', 'Beijing', 'Istanbul', 'Rome', 'Barcelona', 'Hanoi'],
  adventure_trip: ['New Zealand', 'Nepal', 'Hokkaido', 'Northern Vietnam', 'Taiwan East Coast', 'Jeju'],
  shopping_city: ['Tokyo', 'Seoul', 'Bangkok', 'Hong Kong', 'Taipei', 'Singapore', 'Paris'],
  hidden_gems: ['Okinawa', 'Tainan', 'Kanazawa', 'Da Nang', 'Penang', 'Luang Prabang', 'Fukuoka'],
};
```

### DestinationSuggestionPicker

**File:** `app/components/DestinationSuggestionPicker.tsx`

```typescript
interface DestinationSuggestionPickerProps {
  selectedVibes: TravelVibe[];
  value: string[];          // selected destination chip names
  onChange: (v: string[]) => void;
}
```

Derives the visible chip set as the union of `VIBE_CHIPS[vibe]` for all non-`anywhere` selected vibes (deduplicated by exact string match). Hidden entirely when only `anywhere` is in `selectedVibes` or no vibes are selected. Each chip toggles independently.

### CustomDestinationInput

**File:** `app/components/CustomDestinationInput.tsx`

```typescript
interface CustomDestinationInputProps {
  value: string[];          // list of custom destination strings
  onChange: (v: string[]) => void;
}
```

Renders existing custom entries as removable tags and a text input for new entries. The input enforces `maxLength={100}`. The add button is disabled once `value.length >= 10`.

### useCharacterProfiles Hook

**File:** `app/hooks/useCharacterProfiles.ts`

```typescript
export function useCharacterProfiles(roomId: string | null): CharacterProfile[]
```

Fetches `GET /api/character-profile?roomId=...` on mount, polls every 3 seconds, and refreshes immediately on `member-joined` broadcast (same pattern as `useRoomMembers`). Returns an array of `CharacterProfile` objects for all members of the room. Returns `[]` when `roomId` is null.

---

## Data Models

### New Types Added to `lib/types.ts` (additive only)

```typescript
export type BudgetLevel = 'low' | 'medium' | 'high';

export type TravelStyle = 'leader' | 'planner' | 'follower' | 'chill' | 'adventurer';

export type TripInterest =
  | 'food' | 'scenery' | 'adventure' | 'shopping' | 'nightlife'
  | 'culture' | 'relaxation' | 'hidden_gems' | 'flexible';

export interface AvatarConfig {
  baseBody: string;       // always "default" for MVP
  outfit: string;         // e.g. "backpacker", "casual", "luxury"
  headwear: string;       // e.g. "captain_hat", "beanie"
  handheldItem: string;   // e.g. "bubble_tea", "camera"
  accessory?: string;     // optional future layer
}

export interface CharacterProfile {
  id: string;
  userId: string;
  roomId: string;
  displayName: string;
  budgetLevel: BudgetLevel;
  travelStyle: TravelStyle;
  tripInterests: TripInterest[];
  avatarConfig: AvatarConfig;
  generatedPersonaName: string;
  planningWeights: Record<string, number>; // e.g. { food: 0.8, scenery: 0.2 }
  createdAt: string;
  updatedAt: string;
}
```

No existing exported names in `lib/types.ts` are modified, renamed, or removed.

### Supabase Schema Addition

```sql
CREATE TABLE IF NOT EXISTS character_profiles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text        NOT NULL,
  room_id          uuid        NOT NULL REFERENCES trip_rooms(id) ON DELETE CASCADE,
  display_name     text        NOT NULL,
  budget_level     text        NOT NULL CHECK (budget_level IN ('low', 'medium', 'high')),
  travel_style     text        NOT NULL CHECK (travel_style IN ('leader', 'planner', 'follower', 'chill', 'adventurer')),
  trip_interests   text[]      NOT NULL DEFAULT '{}',
  avatar_config    jsonb       NOT NULL DEFAULT '{}',
  generated_persona_name text  NOT NULL DEFAULT '',
  planning_weights jsonb       NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, room_id)
);

CREATE INDEX IF NOT EXISTS character_profiles_room_id_idx ON character_profiles (room_id);
```

The `UNIQUE (user_id, room_id)` constraint enables upsert on conflict. The route uses `ON CONFLICT (user_id, room_id) DO UPDATE SET ...` so re-confirming character replaces the existing row.

---

## API Changes

### New Route: POST /api/character-profile

**File:** `app/api/character-profile/route.ts`

**POST** — Save or update a `CharacterProfile` for a user in a room.

Request body:
```typescript
{
  userId: string;
  roomId: string;
  displayName: string;
  budgetLevel: BudgetLevel;
  travelStyle: TravelStyle;
  tripInterests: TripInterest[];
  avatarConfig: AvatarConfig;
  generatedPersonaName: string;
  planningWeights: Record<string, number>;
}
```

Response: `CharacterProfile` (201 on create, 200 on update).

Errors: 400 for missing/invalid fields, 404 if room not found, 500 for DB failure.

Implementation:
1. Validate all required fields and enum values.
2. Upsert into `character_profiles` using `ON CONFLICT (user_id, room_id) DO UPDATE SET ...`.
3. Return the upserted row mapped to `CharacterProfile`.
4. The caller (client) is responsible for broadcasting `member-joined` after a 200/201 response.

**GET** — Retrieve all `CharacterProfile` rows for a room.

Query: `?roomId=...`

Response: `CharacterProfile[]`

Used by `useCharacterProfiles` hook to populate `MemberStrip` and enrich agent routes.

### Modified Route: POST /api/agents/destinations

Changes to `buildContext()`:

1. Before building the context, query `character_profiles` for all users in the room.
2. For each member: if a `CharacterProfile` exists, use its `budgetLevel`, `travelStyle`, `tripInterests`, `generatedPersonaName`, and `planningWeights`. If not, fall back to the existing `personas` JOIN (backward compatible).
3. Scan `destination_preferences` rows. For rows where `country_or_city` starts with `vibe:`, extract the vibe name and add a `travelVibes` array to the prompt context.
4. Add vibe-weighting instructions to the system prompt: e.g. when `beach_escape` is present, weight toward coastal/island destinations; when `adventure_trip` is present, weight toward outdoor activity destinations.
5. If querying `character_profiles` fails (table missing = Postgres code `42P01` or any error), log the error and fall back to persona-only context — never return 500 due to this fallback path.

The response shape (`DestinationSuggestion[]`) is unchanged.

### Modified Route: POST /api/agents/group-profile

Changes to `buildAgentContext()`:

1. Query `character_profiles` for all users in the room (in parallel with the existing queries).
2. Prefer `CharacterProfile` data over `Persona` data when both exist for a member.
3. Pass `budgetLevel`, `travelStyle`, `tripInterests` from `CharacterProfile` into the per-member agent context object.
4. Same error fallback as the destinations route: on `character_profiles` query failure, use persona-only data.

The response shape (`GroupProfile`) is unchanged.

---

## State Management Approach in RoomShell

`RoomShell` is a client component (`"use client"`) that holds all persistent room-level state. It does not use any global state library — all state is `useState` hooks at this component level, threaded down as props.

| State | Hook | Owner | How it updates |
|---|---|---|---|
| `room: TripRoom` | `useState` | `page.tsx` → prop | Broadcast + 3s poll |
| `members: User[]` | `useRoomMembers` | `RoomShell` (hook) | Broadcast + 3s poll |
| `characterProfiles: CharacterProfile[]` | `useCharacterProfiles` | `RoomShell` (hook) | `member-joined` broadcast + 3s poll |
| `syncing: boolean` | `useState` | `RoomShell` | Manual sync button |
| `copied: boolean` | `useState` | `RoomShell` | Clipboard copy button |

`page.tsx` retains:
- `userId` / `userDisplayName` derivation (from `localStorage` on first render).
- `loadState: 'loading' | 'ready' | 'error'` and `errorMessage` (pre-RoomShell loading screen).
- Initial room fetch.
- `handleGoBack()` — passed as `onGoBack` prop to `RoomShell`.

`RoomShell` retains (migrated from `page.tsx`):
- Stage-change broadcast subscription on `room:{id}:stage`.
- 3-second polling interval for `GET /api/rooms/[code]`.
- `applyUpdate(updated: TripRoom)` — calls `onRoomUpdated` from props only when `roomChanged()` returns true.
- Sync button state and handler.
- Host-only "Previous stage" display logic.
- Invite link construction and copy-to-clipboard.

### Vibe Encoding in AvailabilityStage

`AvailabilityStage` maintains two new state fields alongside the existing `draftRanges`:
- `selectedVibes: TravelVibe[]`
- `selectedChips: string[]`
- `customDestinations: string[]`

On save, the `destinationInterests` array sent to `POST /api/availability` is constructed as:
```typescript
const destinationInterests = [
  ...selectedVibes.map(v => `vibe:${v}`),
  ...selectedChips,
  ...customDestinations.filter(d => d.trim().length > 0),
];
```

On hydration, existing `destination_preferences` rows are parsed:
- Rows where `countryOrCity.startsWith('vibe:')` → strip prefix → add to `selectedVibes`.
- Rows where the value matches any key in `VIBE_CHIPS` flat union → add to `selectedChips`.
- All other rows → add to `customDestinations`.

This is fully backward-compatible: the existing `POST /api/availability` and `destination_preferences` schema require no changes.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Stage machine transition is deterministic

*For any* valid `TripRoom` at stage S (not FINAL) and a PATCH request from the host user, the resulting stage should always be the documented successor of S in `STAGE_ORDER`, and a request from any non-host user should always be rejected regardless of stage.

**Validates: Requirements 1.2**

---

### Property 2: Vote uniqueness is enforced

*For any* `(roomId, userId, voteType)` triple, submitting two votes with that triple should result in exactly one vote record in the database — the second submission replaces the first rather than creating a duplicate.

**Validates: Requirements 1.4**

---

### Property 3: StageProgress renders all states correctly

*For any* valid `RoomStage` value in `STAGE_ORDER`, rendering `StageProgress` with that value should mark every stage at a lower index as completed (grass-green), the matching stage as active (sunset-orange), and every stage at a higher index as pending (sand-cream) — with no stage appearing in more than one state simultaneously.

**Validates: Requirements 3.3, 3.11**

---

### Property 4: Interest chip multi-selection is independent

*For any* current set of selected `TripInterest` values S and any interest chip I, toggling chip I should produce exactly `S ∪ {I}` when `I ∉ S`, or `S \ {I}` when `I ∈ S` — all other chips in S remain unaffected.

**Validates: Requirements 4.4**

---

### Property 5: PixelAvatar renders all four required layers

*For any* valid `AvatarConfig` (constructed from any combination of `BudgetLevel`, `TravelStyle`, and primary `TripInterest`), the rendered `PixelAvatar` should contain exactly four stacked layer elements (base body, outfit, headwear, handheld item) in the correct z-order.

**Validates: Requirements 4.5**

---

### Property 6: Secondary interest badges match selection count

*For any* selection of N `TripInterest` values where N ≥ 2, the rendered `PixelAvatar` should display exactly N - 1 `InterestBadge` components (one for each interest after the first).

**Validates: Requirements 4.7**

---

### Property 7: Persona summary is always non-empty and content-bearing

*For any* valid combination of `BudgetLevel`, `TravelStyle`, and non-empty `TripInterest[]`, the `generatePersonaSummary` function should return a non-empty string that contains a representation of the budget level, travel style, and at least one interest — without making any API call.

**Validates: Requirements 4.8**

---

### Property 8: Confirm Character button enabled iff all selections present

*For any* combination of `(budget: BudgetLevel | null, travelStyle: TravelStyle | null, interests: TripInterest[])`, the "Confirm Character" button should be enabled (not disabled) if and only if `budget !== null && travelStyle !== null && interests.length > 0`.

**Validates: Requirements 4.9**

---

### Property 9: CharacterCreator retains form state on POST failure

*For any* valid CharacterCreator form state (budget, travelStyle, interests), if `POST /api/character-profile` returns any non-200 status, the component's selected budget, travel style, and interests array should remain identical to their pre-submission values and an inline error message should be visible.

**Validates: Requirements 4.13**

---

### Property 10: Vibe card multi-selection is independent

*For any* current set of selected vibes V and any vibe card C, toggling C should produce exactly `V ∪ {C}` when `C ∉ V`, or `V \ {C}` when `C ∈ V` — all other vibes remain unaffected.

**Validates: Requirements 5.2**

---

### Property 11: Destination chip set matches selected vibes

*For any* non-empty subset of `TravelVibe` values (excluding `anywhere`), the chips rendered by `DestinationSuggestionPicker` should be exactly the deduplicated union of the chip lists defined in `VIBE_CHIPS` for each selected vibe — no extra chips, no missing chips.

**Validates: Requirements 5.3**

---

### Property 12: Save encodes vibes with vibe: prefix and chips as plain strings

*For any* combination of selected vibes V, selected chips C, and custom destinations D, the `destinationInterests` array constructed on save should contain exactly `{ "vibe:" + v | v ∈ V } ∪ C ∪ D` with no other entries and no duplicates introduced by the encoding step.

**Validates: Requirements 5.6, 5.7**

---

### Property 13: Hydration round-trip reconstructs prior selections

*For any* set of `destination_preferences` rows that were previously saved (containing vibe-prefixed rows and plain destination rows), hydrating `AvailabilityStage` should reconstruct the same set of selected vibes, selected chips, and custom destinations as were saved — no prior selection is lost or incorrectly classified.

**Validates: Requirements 5.8**

---

### Property 14: Vibe: prefix is never displayed to the user

*For any* set of selected vibes rendered in `TravelVibeSelector` or `DestinationSuggestionPicker`, no visible text element in the rendered output should contain the substring `"vibe:"`.

**Validates: Requirements 5.9**

---

### Property 15: Agent prompt includes CharacterProfile when available

*For any* valid `CharacterProfile`, the `buildContext` function in `/api/agents/destinations` should produce a prompt string that contains that member's `budgetLevel`, `travelStyle`, and at least one value from `tripInterests` — ensuring character data influences the recommendation.

**Validates: Requirements 6.2, 6.7**

---

### Property 16: Agent prompt falls back to persona when CharacterProfile absent

*For any* member where `character_profiles` returns null but `selected_persona_id` is non-null, the `buildContext` function should produce a prompt that includes the persona's `budgetLevel`, `travelPace`, and `interests` — maintaining backward compatibility.

**Validates: Requirements 6.3**

---

### Property 17: Vibe signals appear in agent prompt when vibe-prefixed preferences exist

*For any* set of `destination_preferences` rows where at least one row has a `vibe:` prefix, the `buildContext` function should produce a prompt string that contains the extracted vibe name(s) as travel vibe signals — not the raw `vibe:` prefixed strings.

**Validates: Requirements 6.4**

---

### Property 18: roomChanged is a correct field-level comparator

*For any* two `TripRoom` objects A and B, `roomChanged(A, B)` should return `true` if and only if at least one of `currentStage`, `selectedDestination`, `selectedFlightOption`, `currentItineraryId`, or `finalItineraryId` differs between A and B — and `false` when all five fields are equal.

**Validates: Requirements 7.9**

---

### Property 19: InterestBadge renders a non-empty label for every valid interest

*For any* value in `TripInterest`, rendering `InterestBadge` should produce a visible, non-empty label string that does not contain the substring `"vibe:"` and is distinct from the label of at least one other `TripInterest` value.

**Validates: Requirements 8.10**

---

## Error Handling

### CharacterCreator Save Errors

- On `POST /api/character-profile` non-200: display inline error below "Confirm Character" button. Retain all form state (budget, style, interests). User can retry without re-entering choices.
- On network timeout: treat as non-200 with message "Connection timed out — please try again."

### AvailabilityStage Save Errors

- On `POST /api/availability` non-200: display inline error. Retain all form state — date ranges, selected vibes, selected chips, custom destinations. Same pattern as the existing `saveError` state.

### Character Profile API Route Errors

- 400: missing required fields or invalid enum value → return `{ error: string }` describing the specific field.
- 404: `roomId` not found → `{ error: "Room not found" }`.
- 409: client sends conflicting data (e.g. roomId mismatch with userId's existing profile in a different room) — not applicable since upsert handles re-confirmation.
- 500: DB failure → `{ error: "Failed to save character profile" }` (do not expose raw Postgres error messages).

### Agent Route Fallbacks

- `/api/agents/destinations` and `/api/agents/group-profile`: if `character_profiles` query fails with any error (including `42P01` table-not-found), log the error with `console.log`, set `characterProfiles = []`, and continue with persona-only context. Never return 500 due to the character profiles fallback path alone.

### Realtime Subscription Failures

- If a Supabase channel fails to reach `SUBSCRIBED` status, the 3-second polling interval serves as the fallback. No error is displayed to the user.
- If three or more consecutive polling requests to the same endpoint return non-200, display a dismissible "Having trouble syncing — check your connection" banner.

### PixelAvatar Unknown Config Keys

- If an `AvatarConfig` key does not map to a known SVG layer variant (e.g. a future value added before the renderer is updated), render the default base layer for that slot rather than crashing. Log a warning to the console.

---

## Accessibility Considerations

### Keyboard Navigation

- All `BudgetSelector`, `TravelStyleSelector`, `MultiInterestSelector`, `TravelVibeSelector`, and `DestinationSuggestionPicker` interactive elements must be reachable via Tab and activatable via Enter or Space.
- Each selectable card/chip uses `role="button"` or `<button type="button">` (not `<div onClick>`), ensuring it appears in the natural tab order.
- Selected state is communicated via `aria-pressed="true"` on toggle buttons.
- Confirm Character button uses `aria-disabled="true"` when disabled (in addition to the `disabled` HTML attribute) so screen readers announce the disabled state.

### Focus Rings

- All interactive elements have a visible focus ring. Use `focus:ring-2 focus:ring-offset-2 focus:ring-sky-400` consistently. Do not use `outline: none` without a replacement.

### Colour Contrast

- All text rendered on palette-coloured surfaces must meet WCAG AA (4.5:1 minimum). Specific decisions:
  - Deep-navy `#1E3A5F` text on sand-cream `#FEF3C7` background: contrast ratio ~9.1:1 ✓
  - Deep-navy text on sky-blue `#38BDF8` background: ~4.6:1 ✓
  - White text on sunset-orange `#FB923C` buttons: ~3.1:1 ✗ — use deep-navy text on orange instead.
  - White text on grass-green `#4ADE80`: ~2.0:1 ✗ — use deep-navy text on green instead.

### Screen Reader Labels

- `PixelAvatar` SVG layers must include `aria-hidden="true"` since they are decorative. The parent `MemberAvatar` container should have an `aria-label` like `"{displayName}'s avatar"`.
- `StageProgress` dots should have `aria-label` per dot: e.g. `"LOBBY - completed"`, `"AVAILABILITY - current stage"`, `"GROUP_PROFILE - upcoming"`.

### Reduced Motion

- The active stage pulse animation in `StageProgress` should respect `prefers-reduced-motion`: use `@media (prefers-reduced-motion: reduce)` to disable the pulse animation.

---

## Testing Strategy

### Unit Tests (Vitest)

Target pure functions and presentational logic:

- `generatePersonaSummary(budget, style, interests, name)` — for all valid combinations, returns expected string shape.
- `roomChanged(a, b)` — field-level comparator correctness (Property 18).
- `VIBE_CHIPS` mapping — the union of all chip arrays covers the expected total count and has no duplicates within a single vibe.
- `buildDestinationInterests(vibes, chips, customs)` — encoding function produces correct `vibe:`-prefixed and plain entries.
- `hydrateFromPreferences(rows)` — decomposes saved rows back into vibes/chips/customs correctly.
- `deriveAvatarConfig(budget, style, primaryInterest)` — every combination maps to a known config key.

### Property-Based Tests (fast-check, minimum 100 iterations per property)

All 19 correctness properties described above are implemented as property-based tests. Each test is tagged with:
```
// Feature: pixeltrip-ui-ux-refactor, Property N: <property_text>
```

Key generators:
- `fc.constantFrom(...Object.values(BudgetLevel))` for budget.
- `fc.constantFrom(...Object.values(TravelStyle))` for travel style.
- `fc.array(fc.constantFrom(...Object.values(TripInterest)), { minLength: 1, maxLength: 9 })` for interests.
- `fc.subarray(STAGE_ORDER)` for stage subsets.
- `fc.record({ currentStage: ..., selectedDestination: ..., ... })` for TripRoom objects.

### Integration Tests

- `POST /api/character-profile` — happy path, duplicate upsert, missing field validation.
- `POST /api/agents/destinations` — with character profiles present, with character profiles absent (persona fallback), with vibe-prefixed preferences.
- `POST /api/agents/group-profile` — with character profiles present, with character profiles absent.
- Broadcast `member-joined` after character profile save.
- `AvailabilityStage` hydration from saved `destination_preferences`.

### Smoke Tests

- TypeScript strict compilation succeeds with no new type errors (`npm run build`).
- No `window.location.reload()` calls in stage component files (grep check).
- No `DROP TABLE` / `DROP COLUMN` / `ALTER COLUMN TYPE` in migration SQL files.
- All existing API routes respond with the expected status codes on happy-path requests.
- `character_profiles` table is created by the migration SQL and accepts valid inserts.

### Visual Testing

- Snapshot tests for `PixelAvatar` with all 3 × 5 × 9 = 135 valid primary avatar combinations to catch unintended layer regressions.
- Manual review of colour contrast on all refactored stage components before release.
