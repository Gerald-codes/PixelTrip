# party-lobby

The entry + live waiting room for a party, built on the real backend room
contract (`RoomService` from `@/services`).

## What it does

- **Entry (`PartyLobby`)** — one adventurer-name field plus a room-name + Create
  Party action and a room-code + Join Party action, framed in-world by the NPC
  `DialogueBox`.
- **Pipeline shell (`PartyRoomShell`)** — once in a room, wraps the experience
  in the honest six-stage stepper (`StageStepper`) derived from
  `room.planningStage`. The SETUP stage renders the real content
  (`SetupStageContent`: room code share + live `RosterPanel`); every later stage
  (discover/logistics/build/refine/wrap) renders an honest `StagePlaceholder`
  with no fake data and no service calls, because those backends do not exist.
- **Waiting room (`PartyWaitingRoom`)** — standalone page chrome (title + leave)
  around `SetupStageContent`; kept for reuse/tests. The shell renders the same
  setup content inside the pipeline.
- **`LobbyApp`** — the only stateful piece; runs `usePartyLobby` and renders
  entry vs the in-room pipeline shell.

## Key pieces

- `hooks/usePartyLobby.ts` — view state, session, live roster via
  `room.subscribeMembers` while waiting (unsubscribed on cleanup/leave/unmount),
  copy-code, leave, and create/join with safe error mapping. All data access via
  `getServices()`.
- `lib/stages.ts` — the six-stage model: ordered stages, in-world titles/blurbs,
  and `buildStageSteps(planningStage)` to derive complete/current/upcoming.
  `isStageStubbed` marks every stage except SETUP as backend-less.
- `lib/lobbyValidation.ts` — client-side bounds (room name 1–100, display name
  1–50, code non-blank) so invalid input makes no service call.
- `lib/lobbyErrors.ts` — maps `ApiError.code` to safe, player-facing messages.
  UI branches on `code`, never raw messages.

## Conventions / notes

- Shared primitives are imported directly from their files in `@/components`
  (`PixelButton`, `PixelCard`, `DialogueBox`, `CharacterSprite`) rather than a
  copy. The roster and the stage stepper are composed from `PixelCard` because no
  dedicated `PartyRoster`/`ProgressIndicator` primitive file currently exists in
  the shared set.
- Live roster uses `room.subscribeMembers` behind the `RoomService` boundary:
  the mock simulates it with an interval, the real service uses a Supabase
  Realtime channel on `room_members`. The UI never imports the Supabase client
  directly — all Supabase access stays in `src/services/*.api.ts`.
- Stages 2–6 are honest placeholders: their backends (the AI Travel Guide) do
  not exist yet, so they render `StagePlaceholder` with no fake data and make no
  chat/vote/itinerary service calls (those real services throw `notImplemented`).

## Lobby Character Creation (SETUP stage)

The SETUP stage is a two-column, session-only character-creation experience
composed in `SetupStageContent`: the **CharacterCreator** on the left and the
**AdventureSidebar** on the right. It is frontend-only — nothing it collects is
persisted or sent anywhere.

### Left column — CharacterCreator

`components/CharacterCreator.tsx` hosts the feature's single stateful hook
(`useCharacterDraft`) and composes presentational pieces, feeding each one props
and raising events through hook callbacks:

- `CharacterPreview` — large layered avatar, fed `resolveLayers(draft, LAYER_MAP)`.
- `OptionCardGroup` (single-select) — reused for **archetype, outfit, accessory,
  palette, travel style**; raises `onSelect(id)`.
- `OptionTagGroup` (multi-select) — reused for **interests** and **destinations**;
  raises `onToggle(id)`.
- `ActivityPriorityGroup` — multi-select **activities**, each selected activity
  carrying a `must_have` / `optional` priority (`ActivityDraft`).
- `PreferenceFields` — budget (numeric), origin, a repeatable hard-constraints
  list, and one or more availability date ranges.
- A primary "SAVE CHARACTER" `PixelButton`, disabled while `!canSave` with an
  explanatory line, and a polite `role="status"` region after a save noting the
  character is kept for this session only.

### Right column — AdventureSidebar

`components/AdventureSidebar.tsx` is presentational (view model via `adventure`,
optional live room code via `roomSession`) and composes, in order:
`SidebarTripHeader`, `SidebarPartyPanel`, two `SidebarPlaceholderPanel`s
(Destination + Flight "Not selected" empty states), `BudgetPanel`, and
`AdventureProgress`. On desktop it is a fixed column; on mobile it collapses into
a drawer driven by `hooks/useAdventureDrawer.ts` (a toggle exposing
`aria-expanded`). It imports no service and makes no network call — the party panel's
invite buttons only copy the invite link or room code to the clipboard.

### Layered character model and LayerMap

The avatar is a data-driven, ordered sprite stack. `lib/characterLayers.ts`
defines `LAYER_MAP` keyed by `SpriteLayerSlot` (`base`, `archetype`, `outfit`,
`accessory`), mapping each selection id (reused from `lib/characterOptions.ts`) to
`{ slot, order, assetKey }`. `resolveLayers(draft, LAYER_MAP)` always includes the
always-present base layer, adds one layer per set `archetype` / `outfit` /
`accessory` selection, ignores unknown ids, and returns the stack sorted ascending
by `order` (base → archetype → outfit → accessory).

- **Extensible:** adding a new archetype/outfit/accessory asset is a one-line
  `LayerMap` entry — the resolver and preview need no changes.
- **Palette is not a sprite layer slot.** It is a saved appearance field only, so
  the `PALETTE` catalog is intentionally absent from `LAYER_MAP`.

### Session-only save seam (no persistence)

`useCharacterDraft.save()` is the single projection seam. It projects the in-memory
`CharacterDraft` through the pure `toSessionCharacter` (`lib/draft.ts`) into a
`SessionCharacter` and stores it in in-memory React state **only**. Nothing is
persisted — no `localStorage`, `sessionStorage`, cookies, or IndexedDB — and
nothing is sent to any backend or endpoint; the hook imports no service.

`SessionCharacter` mirrors the backend request payload 1:1 (available dates,
destinations, travel style, budget, interests, activities, hard constraints,
origin, and `character.{appearance, spriteKey}`), so a future real service can pass
the saved object straight through without reshaping.

### CharacterSprite extended, not forked

The shared `src/components/CharacterSprite.tsx` primitive was **extended** with an
optional `layers?: readonly SpriteLayer[]` prop rather than copied into the
feature. When `layers` is provided and non-empty it renders the layered stack;
when omitted it renders exactly as before (single box keyed by `spriteKey`), so
every existing no-`layers` call site (e.g. the roster sprites) is unchanged.
