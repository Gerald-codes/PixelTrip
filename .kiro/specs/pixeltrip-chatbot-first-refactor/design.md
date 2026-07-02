# Design Document — PixelTrip Chatbot-First Refactor

## Overview

This refactor replaces the current sequence of disconnected full-stage form screens with a single, persistent **TripAgentChat** panel that renders all stage interactions as a scrolling message thread. The underlying stage state machine (`RoomStage` enum), all API routes, and the Supabase schema are preserved without modification. Only the user-facing presentation layer changes.

The user's mental model shifts from "filling in a form for each step" to "talking to a travel agent who guides the group through planning". Each stage produces one or more agent message bubbles, followed by an `InteractiveSlot` containing the stage's interactive content (chip groups, cards, vote buttons, date inputs). All prior messages remain in the thread so users can scroll up and see the full conversation history.

### Key Design Decisions

- **RoomShell is extended, not replaced.** The existing persistent header, MemberStrip, and 3-second polling loop stay intact. RoomShell's `<main>` slot is refactored from a single-column layout to a two-column layout hosting `TripAgentChat` (left) and `TripContextPanel` (right).
- **StageRouter is not bypassed.** `TripAgentChat` calls `StageRouter` and renders its output inside the current `InteractiveSlot`. StageRouter's mapping logic is unchanged.
- **CharacterCreator gets a `chatMode` prop.** When `chatMode={true}`, the existing selectors (BudgetSelector, TravelStyleSelector, MultiInterestSelector) are rendered as sequential chat steps with one InteractiveSlot each, rather than all at once on a single page.
- **All realtime sync paths are preserved.** The 3-second polling interval and `stage-change` / `member-joined` broadcasts continue to drive state updates with no page reload.
- **Budget estimation is pure and local.** A small `computeBudgetEstimate` utility function takes destination price level, trip length, flight category, and budget level as inputs and returns the estimate using only arithmetic — no API calls.

---

## Architecture

### High-Level Layout

```
app/room/[code]/page.tsx
└── RoomShell (existing, extended)
    ├── <header>          ← persistent, unchanged
    ├── MemberStrip       ← persistent, unchanged
    └── <main>            ← refactored: two-column flex container
        ├── TripAgentChat (65% width, left col, scrollable)
        │   ├── aria-live region (polite) for new messages
        │   ├── Message thread (append-only)
        │   │   ├── TripAgentMessage × N (past messages)
        │   │   └── TripAgentMessage (current stage intro)
        │   │       └── InteractiveSlot (current stage content)
        │   │           └── StageRouter output OR specialised component
        │   └── WaitingState block (when user already submitted)
        └── TripContextPanel (35% width, right col, sticky)
            ├── Room code + copy button
            ├── Stage label
            ├── Member list (PixelAvatar + ReadyBadge)
            ├── BudgetStatusBadge + cost-driver line
            └── Trip decisions summary (dates, vibes, destination, flight)
```

**Responsive behaviour:**
- ≥ 1024px: side-by-side flex row. TripAgentChat `min-width: 65%`, TripContextPanel fills the rest.
- < 1024px: single column. TripContextPanel is `display: none` by default. A toggle button (fixed position, bottom-right) expands TripContextPanel as a full-height overlay/drawer with a close affordance.

### Component Dependency Graph

```
RoomShell
  ├── TripAgentChat
  │   ├── TripAgentMessage
  │   ├── InteractiveSlot
  │   │   ├── CharacterCreator (chatMode=true) [LOBBY/PERSONA stages]
  │   │   ├── AvailabilityStage (section-by-section) [AVAILABILITY]
  │   │   ├── VoteableDestinationCard (list) [DESTINATIONS/DESTINATION_VOTE]
  │   │   ├── VoteableFlightCard (list) [FLIGHTS/FLIGHT_VOTE]
  │   │   └── StageRouter output [all other stages]
  │   ├── WaitingState
  │   └── ReadyBadge (per member, inside waiting state / thread)
  └── TripContextPanel
      ├── ReadyBadge (per member)
      ├── BudgetStatusBadge
      └── PixelAvatar (per member, aria-hidden)
```

---

## Components and Interfaces

### New Components

#### `TripAgentChat`

The primary chat panel. Owns the `AgentMessage[]` thread state and the `submittedStages` map.

```typescript
interface TripAgentChatProps {
  room: TripRoom;
  identity: Identity;
  members: User[];
  characterProfiles: CharacterProfile[];
  onRoomUpdated: (r: TripRoom) => void;
  onGoBack?: () => Promise<void>;
}
```

Internal state:
- `messages: AgentMessage[]` — append-only list, never cleared during a session.
- `submittedStages: Set<RoomStage>` — tracks which stages the current user has submitted so the WaitingState can be shown.
- `pendingSlotSave: boolean` — true while a server save is in flight; disables all InteractiveSlot inputs.

On mount, `TripAgentChat` appends the intro message for the current stage. When `room.currentStage` changes (detected via `useEffect` comparing previous vs current stage), a new intro message is appended and the slot switches to the new stage's content.

---

#### `TripAgentMessage`

A single message bubble in the thread.

```typescript
interface TripAgentMessageProps {
  text: string;                  // ≤40 words, ≤2 sentences
  isSystem?: boolean;            // true for "everyone's ready" / error messages
  children?: React.ReactNode;    // InteractiveSlot rendered below the bubble
}
```

Rendered as `<article>`. Always inside the `aria-live="polite"` region so new messages are announced to screen readers. Pixel-art style: sand cream background, 4px deep-navy border, `4px 4px 0 #1E3A5F` box-shadow, zero border-radius, monospace font.

---

#### `InteractiveSlot`

Wrapper around the current stage's interactive content. Applies the disabled overlay when `pendingSlotSave` is true.

```typescript
interface InteractiveSlotProps {
  isSaving: boolean;
  children: React.ReactNode;
}
```

When `isSaving` is true: renders a semi-transparent overlay with a pixel-art spinner centred inside the slot boundary. All interactive descendants receive `pointer-events: none` and `aria-disabled="true"` via a CSS `data-saving` attribute selector to avoid prop-drilling.

---

#### `TripContextPanel`

Sticky right-hand sidebar.

```typescript
interface TripContextPanelProps {
  room: TripRoom;
  members: User[];
  characterProfiles: CharacterProfile[];
  currentStage: RoomStage;
  submittedUserIds: string[];    // users who submitted in current stage
  budgetEstimate: BudgetEstimate | null;
}
```

Always renders: stage label, room code + copy button, member list with PixelAvatar + ReadyBadge, and trip decision fields. Shows `BudgetStatusBadge` only when `budgetEstimate !== null`. On mobile (< 1024px): starts as `display: none`, expands to a fixed-position overlay via a CSS class toggled by `isOpen` state in RoomShell.

---

#### `VoteableDestinationCard`

```typescript
interface VoteableDestinationCardProps {
  suggestion: DestinationSuggestion;
  currentUserId: string;
  hasVoted: boolean;            // true if current user has already voted for this
  voteCount: number;
  onVote: (destinationId: string) => Promise<void>;
}
```

Internal state:
- `optimisticCount: number` — initialised from `voteCount`, updated optimistically on vote click.
- `voteError: string | null` — shown inline if server returns 5xx.
- `expanded: boolean` — controls "View full details" toggle.

Vote logic:
1. Set `optimisticCount = optimisticCount + 1` immediately.
2. Call `onVote(destinationId)`.
3. On success (2xx): retain optimistic count.
4. On 409: retain optimistic count (duplicate — vote already counted).
5. On 5xx: revert `optimisticCount` to original, set `voteError`.

---

#### `VoteableFlightCard`

```typescript
interface VoteableFlightCardProps {
  category: "budget" | "best_value" | "comfort";
  priceRange: string;            // e.g. "$180–$250"
  estimatedDuration: string;     // e.g. "~8 hrs"
  stops: number;
  budgetImpact: "within" | "near" | "over";
  itineraryComfort: string;      // e.g. "Comfortable"
  hasVoted: boolean;
  voteCount: number;
  onVote: (category: string) => Promise<void>;
}
```

Same optimistic-vote + revert pattern as `VoteableDestinationCard`. If any badge data prop is unavailable, that specific badge is not rendered (per Req 12.4).

---

#### `WaitingState`

```typescript
interface WaitingStateProps {
  submittedSelections: React.ReactNode;   // user's own confirmed choices
  memberStatuses: Array<{
    userId: string;
    displayName: string;
    submitted: boolean;
  }>;
  onEditResponse?: () => void;            // only shown for editable stages
}
```

---

#### `ReadyBadge`

```typescript
interface ReadyBadgeProp {
  submitted: boolean;
  displayName: string;
}
```

"Submitted" state: grass green background (`#4ADE80`), `✔` icon, deep-navy text.
"Not submitted" state: sunset orange background (`#FB923C`), `…` icon, deep-navy text.

---

#### `BudgetStatusBadge`

```typescript
interface BudgetStatusBadgeProps {
  status: "within" | "near" | "over";
  estimate: number;          // total per-person estimate in USD
  costDriverLine: string;    // ≤80 chars, e.g. "Comfort flights add ~$520 to your estimate"
}
```

Colour mapping: `"within"` → grass green, `"near"` → sunset orange, `"over"` → `#EF4444` (red, distinct from the palette).

---

### Modified Components

#### `RoomShell` (extended)

Changes:
- `<main>` changes from `flex-1` single column to a `flex flex-row` container with responsive breakpoint.
- Accepts an additional optional `isMobileContextOpen: boolean` + `onToggleContext: () => void` internally to manage the mobile context-panel drawer.
- On screens < 1024px, renders a fixed `<button>` toggle (bottom-right) for the context panel.
- All existing polling, broadcast subscription, and header/MemberStrip logic is unchanged.

No props are added to the public `RoomShellProps` interface. The drawer state is internal.

---

#### `CharacterCreator` (chatMode prop added)

New prop:
```typescript
chatMode?: boolean;  // default: false
```

When `chatMode={false}` (default): existing two-column layout with all selectors visible simultaneously — no change.

When `chatMode={true}`: renders the selection sequence as a series of message-like steps. Each step is revealed only after the previous step is completed:
1. Budget InteractiveSlot (3 cards). On select → avatar updates + next step revealed.
2. Travel style InteractiveSlot (5 cards). On select → avatar updates + next step revealed.
3. Interests InteractiveSlot (chip grid). On ≥1 select → avatar updates + "Confirm Character" button revealed.

The `PixelAvatar` preview is rendered in a `position: sticky` container at the top of the chat step sequence so it stays visible without scrolling. All existing `handleConfirm` logic (POST, error handling, `onConfirmed` callback) is unchanged.

---

### Preserved Unchanged

- `StageRouter` — mapping logic and `StageProps` interface are not modified.
- `LobbyStage`, `AvailabilityStage`, `GroupProfileStage`, `DestinationsStage`, `DestinationVoteStage`, `FlightStage`, `FlightVoteStage`, `ActivitiesStage`, `ItineraryStage`, `FeedbackStage`, `NegotiationStage`, `FinalStage` — rendered by StageRouter inside `InteractiveSlot`, no changes.
- `useRoomMembers`, `useCharacterProfiles`, `usePresence` — hook signatures unchanged, called identically from `page.tsx` and threaded into `TripAgentChat` / `TripContextPanel` via props.
- `MemberStrip`, `StageProgress`, `PixelAvatar`, `BudgetSelector`, `TravelStyleSelector`, `MultiInterestSelector`, `TravelVibeSelector` — all preserved, composed into new components.

---

## Data Models

### New Types (additive — `lib/types.ts`)

```typescript
/** A single message in the Trip Agent conversation thread. */
export interface AgentMessage {
  id: string;                    // nanoid or crypto.randomUUID()
  stage: RoomStage;              // stage that produced this message
  text: string;                  // ≤40 words, ≤2 sentences
  timestamp: number;             // Date.now() when appended
  type: "intro" | "confirmation" | "waiting" | "error" | "system";
}

/** Computed budget estimate (local only — no API calls). */
export interface BudgetEstimate {
  flightCost: number;            // flat lookup by flight category
  dailyCost: number;             // dailyCostByBudgetLevel × tripLengthDays × destinationPriceMultiplier
  totalPerPerson: number;        // flightCost + dailyCost
  status: "within" | "near" | "over";
  costDriverLine: string;        // ≤80 chars
  tripLengthDays: number;
}

/** Stage submission tracking for a single user in the current stage. */
export type StageSubmissionStatus = "submitted" | "pending";
```

### Budget Estimate Constants (new `lib/budgetEstimate.ts`)

```typescript
export const FLIGHT_COSTS: Record<"budget" | "best_value" | "comfort", number> = {
  budget: 215,
  best_value: 335,
  comfort: 520,
};

export const DAILY_COSTS: Record<BudgetLevel, number> = {
  low: 80,
  medium: 150,
  high: 280,
};

export const DESTINATION_MULTIPLIERS: Record<"budget" | "moderate" | "premium", number> = {
  budget: 0.8,
  moderate: 1.0,
  premium: 1.4,
};

export const BUDGET_THRESHOLDS: Record<BudgetLevel, number> = {
  low: 800,
  medium: 2000,
  high: 5000,
};

/**
 * Pure function — no side effects, no API calls.
 * tripLengthDays is inclusive (endDate − startDate + 1 calendar days).
 */
export function computeBudgetEstimate(
  flightCategory: "budget" | "best_value" | "comfort",
  destinationPriceLevel: "budget" | "moderate" | "premium",
  tripLengthDays: number,
  budgetLevel: BudgetLevel,
): BudgetEstimate { ... }

export function classifyBudgetStatus(
  estimate: number,
  budgetLevel: BudgetLevel,
): "within" | "near" | "over" { ... }
```

### Agent Message Content Map (new `lib/agentMessages.ts`)

```typescript
export const STAGE_INTRO_MESSAGES: Record<RoomStage, string> = {
  [RoomStage.LOBBY]:            "Let's build your travel character — your choices shape where we go and what we do.",
  [RoomStage.PERSONA]:          "Time to choose your travel persona. Pick the character that fits you best.",
  [RoomStage.AVAILABILITY]:     "Nice. Now when are you free to travel?",
  [RoomStage.GROUP_PROFILE]:    "Putting your group's preferences together now — this takes just a moment.",
  [RoomStage.DESTINATIONS]:     "Based on your group's characters, dates, and vibes — here are your best destination options.",
  [RoomStage.DESTINATION_VOTE]: "Time to vote. Which destination works best for your group?",
  [RoomStage.FLIGHTS]:          "Now let's pick a flight style for the group.",
  [RoomStage.FLIGHT_VOTE]:      "Now let's pick a flight style for the group.",
  [RoomStage.ACTIVITIES]:       "Great choice! Now let's add your must-have activities and experiences.",
  [RoomStage.ITINERARY]:        "Your itinerary is ready. Check how well it fits everyone in the group.",
  [RoomStage.FEEDBACK]:         "How does the plan look? Score it and flag anything you'd like to change.",
  [RoomStage.NEGOTIATION]:      "The agent found some trade-offs to resolve. Vote on the best compromise.",
  [RoomStage.FINAL]:            "Your trip is locked in. Here's the final plan — export or share it below.",
};
```

---

## StageRouter Composition Into TripAgentChat

### How Stage Output is Embedded

`TripAgentChat` does not replace `StageRouter` — it wraps its output. The flow is:

1. `room.currentStage` changes (detected by `useEffect` comparing `prevStageRef.current` to `room.currentStage`).
2. `TripAgentChat` appends a new `AgentMessage` with `STAGE_INTRO_MESSAGES[room.currentStage]` to the `messages` state.
3. `TripAgentChat` renders the `InteractiveSlot` below the last `TripAgentMessage`, which contains:
   - **LOBBY / PERSONA**: `<CharacterCreator chatMode={true} />` directly (not via StageRouter, because the chat-mode sequential steps are new presentation only).
   - **AVAILABILITY**: `<AvailabilityStage />` embedded directly (each form section mounts sequentially within the slot — see Realtime sync section).
   - **DESTINATIONS / DESTINATION_VOTE**: `<VoteableDestinationCard />` list (new components), plus host-only "Regenerate" and "▶ Move to next step" controls.
   - **FLIGHTS / FLIGHT_VOTE**: `<VoteableFlightCard />` list (new components).
   - **All other stages** (ACTIVITIES, ITINERARY, FEEDBACK, NEGOTIATION, FINAL): `<StageRouter {...stageProps} />` rendered directly inside the slot.

**Why not route everything through StageRouter?** The chatbot-first stages (LOBBY through FLIGHT_VOTE) require new presentation components (`CharacterCreator chatMode`, `VoteableDestinationCard`, `VoteableFlightCard`) that do not map to the existing stage component interface. StageRouter is preserved as the router for the later pipeline stages which already have working full-featured components. This keeps backward compatibility intact (Req 15).

### StageProps threading

`TripAgentChat` receives all `StageProps`-compatible props from `page.tsx` and passes them through unchanged to `StageRouter` and to the stage components it embeds directly:

```typescript
const stageProps: StageProps = {
  room,
  identity,
  members,
  onRoomUpdated,
  onGoBack,
  characterProfiles,
};
```

---

## Realtime Sync Strategy

### Three Signal Sources (all preserved)

| Signal | Mechanism | What it triggers |
|---|---|---|
| Polling | `setInterval(3000)` in RoomShell | `fetchRoom()` → `onRoomUpdated()` → re-render |
| Stage change | Supabase broadcast `stage-change` on `room:{id}:stage` | `fetchRoom()` → `onRoomUpdated()` |
| Member joined | Supabase broadcast `member-joined` on `room:{id}:members` | `useRoomMembers` refetch + `useCharacterProfiles` refetch |

These three signals are owned by RoomShell and the existing hooks — nothing in this refactor moves or duplicates them.

### Stage Transition → New Message

When `room.currentStage` changes (via any of the three signal sources above):

```
room prop changes in TripAgentChat
  → useEffect fires (prevStageRef.current !== room.currentStage)
  → append AgentMessage for new stage to messages[]
  → prevStageRef.current = room.currentStage
  → after state update, useEffect (messages dependency) triggers scrollToBottom()
```

`scrollToBottom()` calls `bottomRef.current?.scrollIntoView({ behavior: 'smooth' })` where `bottomRef` is attached to a zero-height `<div>` at the end of the thread. This satisfies the "smooth scroll into view within the TripAgentChat container" requirement (Req 2.4).

### Member Submission Status

Member submission status (ReadyBadge state) is derived from the existing 3-second polling loop. Each `GET /api/rooms/[code]` response does not directly include per-member submission status, so `TripAgentChat` derives this from `characterProfiles` (presence of a profile = submitted PERSONA stage) and stage-specific API responses polled separately via `useRoomMembers`.

For stages where submission status matters (AVAILABILITY, PERSONA), the `TripAgentChat` polls `GET /api/availability?roomId=` or checks `characterProfiles.length === members.length` to derive `submittedUserIds[]`. This derived state is passed to `WaitingState` and `TripContextPanel` as a prop.

---

## Budget Estimate Computation

The estimate is a pure function. No external API calls are made.

```
totalPerPerson = flightCostEstimate + (destinationPriceMultiplier × tripLengthDays × dailyCostByBudgetLevel)
```

**Input sources:**
- `flightCategory` — from `room.selectedFlightOption` (`TripRoom.selectedFlightOption`).
- `destinationPriceLevel` — from the selected `DestinationSuggestion.priceLevel`.
- `tripLengthDays` — computed as `daysBetween(startDate, endDate) + 1` (inclusive), using the overlapping dates from `useRoomMembers`-derived availability.
- `budgetLevel` — from the current user's `CharacterProfile.budgetLevel`.

**Status classification:**
- `estimate < 0.80 × BUDGET_THRESHOLDS[budgetLevel]` → `"within"`
- `estimate >= 0.80 × threshold AND estimate <= threshold` → `"near"`
- `estimate > threshold` → `"over"`

**Cost-driver line:**
- If `flightCost > dailyCost`: `"[Category] flights add ~$[flightCost] to your estimate"` (truncated to 80 chars).
- If `dailyCost >= flightCost`: `"Daily costs for [N] days add ~$[dailyCost] to your estimate"` (truncated to 80 chars).

**When to show:** `TripContextPanel` calls `computeBudgetEstimate()` only when `room.selectedFlightOption !== null` and a selected `DestinationSuggestion` with `priceLevel` is available. Otherwise `budgetEstimate` prop is `null` and the badge/line are not rendered.

---

## Optimistic Voting With Conflict Handling

### Vote Flow

```
User clicks Vote button on VoteableDestinationCard or VoteableFlightCard
  1. Set optimisticCount = displayedCount + 1  (immediate, <100ms visual update)
  2. Disable Vote button (hasVoted = true optimistically)
  3. POST /api/votes  { roomId, userId, voteType, selectedOption }
  4a. Response 2xx: retain optimistic count, retain hasVoted=true
  4b. Response 409 (duplicate): retain optimistic count (vote already counted in DB),
      retain hasVoted=true, no error shown
  4c. Response 5xx: revert optimisticCount to original pre-vote value,
      set hasVoted=false, set voteError = "Vote failed — please try again"
  4d. Network timeout / fetch error: treated as 5xx revert
```

### State Management in Card Components

```typescript
// Inside VoteableDestinationCard / VoteableFlightCard
const [displayedCount, setDisplayedCount] = useState(voteCount);
const [localHasVoted, setLocalHasVoted] = useState(hasVoted);
const [voteError, setVoteError] = useState<string | null>(null);

async function handleVoteClick() {
  const previousCount = displayedCount;
  setDisplayedCount(prev => prev + 1);  // optimistic
  setLocalHasVoted(true);               // optimistic
  setVoteError(null);
  try {
    const res = await fetch("/api/votes", { method: "POST", ... });
    if (res.status === 409) return;     // retain optimistic — already voted
    if (!res.ok) throw new Error(`${res.status}`);
    // 2xx: optimistic state retained
  } catch {
    setDisplayedCount(previousCount);   // revert
    setLocalHasVoted(false);            // revert
    setVoteError("Vote failed — please try again");
  }
}
```

The `voteCount` and `hasVoted` props from the parent (`TripAgentChat`) are the server-authoritative values that arrive via the 3-second polling loop. When a fresh poll arrives, the card reconciles: if `voteCount` from server is ≥ `displayedCount`, it accepts the server value. This prevents a double-increment if the optimistic update and the next poll overlap.

---

## Message Thread State Management

### `messages` State (append-only)

```typescript
// TripAgentChat internal
const [messages, setMessages] = useState<AgentMessage[]>([]);
const prevStageRef = useRef<RoomStage | null>(null);

useEffect(() => {
  if (prevStageRef.current === room.currentStage) return;
  prevStageRef.current = room.currentStage;

  const newMessage: AgentMessage = {
    id: crypto.randomUUID(),
    stage: room.currentStage,
    text: STAGE_INTRO_MESSAGES[room.currentStage],
    timestamp: Date.now(),
    type: "intro",
  };
  setMessages(prev => [...prev, newMessage]);   // always append, never replace
}, [room.currentStage]);
```

Rules enforced by the append-only pattern:
- `messages` length is monotonically non-decreasing over the session lifetime.
- No `messages.splice()`, `messages.filter()`, or full replacement (`setMessages([])`).
- Secondary messages (waiting updates, "everyone's ready", errors) are also appended — never modify an existing message in place.
- Messages are session-scoped only: they live in React state, not persisted to Supabase. A page refresh resets the thread to a single intro message for the current stage.

### Waiting Message Updates

When member submission status changes (via polling or `member-joined` broadcast), `TripAgentChat` checks whether a waiting message already exists for the current stage:
- If one exists: append a new "update" message with the revised pending list (rather than mutating the old message object).
- The old waiting message remains visible in history.

This keeps the append-only invariant while giving users an accurate current status.

---

## Hook Integration With New Layout

The three existing hooks (`useRoomMembers`, `useCharacterProfiles`, `usePresence`) continue to be called from `page.tsx` exactly as they are today. Their return values are threaded down as props through `RoomShell → TripAgentChat → TripContextPanel` and into stage components via `stageProps`.

```
page.tsx
  useRoomMembers(code, room?.id)       → members: User[]
  useCharacterProfiles(room?.id)       → characterProfiles: CharacterProfile[]

page.tsx → RoomShell props
  members, characterProfiles

RoomShell → TripAgentChat props
  members, characterProfiles

TripAgentChat → TripContextPanel props
  members, characterProfiles (for avatars + ready badges)

TripAgentChat → StageRouter props (via stageProps)
  members, characterProfiles (unchanged — existing contract)
```

`usePresence` continues to be available for online-indicator data but is not a primary source of submission status; submission status is derived from DB-backed `useCharacterProfiles` (profile exists = submitted PERSONA) and stage-specific API poll results.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Agent Message Format

*For any* stage in the `RoomStage` enum, the intro message text returned by `STAGE_INTRO_MESSAGES[stage]` SHALL contain no more than 40 words and no more than 2 sentences (where a sentence ends with `.`, `!`, or `?`).

**Validates: Requirements 3.1, 3.2, 12.1**

---

### Property 2: Waiting Message Completeness

*For any* set of room members and any subset of those members who have not yet submitted, the waiting message text produced by the waiting-message generator SHALL contain the display name of every pending member, and SHALL NOT contain the display name of any member who has already submitted.

**Validates: Requirements 3.4, 11.1**

---

### Property 3: Budget Estimate Formula Correctness

*For any* valid combination of `flightCategory ∈ {"budget","best_value","comfort"}`, `destinationPriceLevel ∈ {"budget","moderate","premium"}`, `tripLengthDays ∈ ℤ≥1`, and `budgetLevel ∈ {"low","medium","high"}`, the value returned by `computeBudgetEstimate()` SHALL equal:

```
FLIGHT_COSTS[flightCategory]
  + (DESTINATION_MULTIPLIERS[destinationPriceLevel] × tripLengthDays × DAILY_COSTS[budgetLevel])
```

**Validates: Requirements 10.3, 10.8**

---

### Property 4: Budget Status Badge Classification

*For any* `estimate ∈ ℝ≥0` and `budgetLevel ∈ {"low","medium","high"}`, the status returned by `classifyBudgetStatus(estimate, budgetLevel)` SHALL be:
- `"within"` when `estimate < 0.80 × BUDGET_THRESHOLDS[budgetLevel]`
- `"near"` when `estimate >= 0.80 × BUDGET_THRESHOLDS[budgetLevel]` AND `estimate <= BUDGET_THRESHOLDS[budgetLevel]`
- `"over"` when `estimate > BUDGET_THRESHOLDS[budgetLevel]`

These three cases are exhaustive and mutually exclusive: no estimate value may produce two different statuses for the same budget level.

**Validates: Requirements 10.4**

---

### Property 5: Cost-Driver Explanation Completeness

*For any* valid `BudgetEstimate` (with `flightCost > 0` and `dailyCost > 0`), the `costDriverLine` string SHALL be at most 80 characters in length AND SHALL identify the single component with the larger absolute value (flight cost or daily cost), and SHALL NOT identify the smaller component as the driver.

**Validates: Requirements 10.5**

---

### Property 6: Vote Optimistic Count and Conflict Handling

*For any* initial displayed vote count `n` and any server response code `r`:
- If `r ∈ {200, 201}`: the displayed count after the vote SHALL be `n + 1`.
- If `r = 409`: the displayed count after the vote SHALL remain `n + 1` (the optimistic increment is retained, since the vote was already registered).
- If `r ∈ {500, 502, 503, 504}` or a network error: the displayed count after the error handler runs SHALL equal `n` (reverted to pre-vote value) and `voteError` SHALL be a non-empty string.

**Validates: Requirements 7.5, 8.5**

---

### Property 7: Message Thread Append-Only Ordering Invariant

*For any* sequence of `k` stage transitions during a session, the `messages` array in `TripAgentChat` SHALL satisfy:
1. The length of `messages` is non-decreasing over time — messages are never removed.
2. The `timestamp` values are non-decreasing — newer messages always appear at a higher index than older messages.
3. Each message at index `i` produced by stage `S` appears before all messages at index `j > i` produced by any later stage `S'`, where "later" means `STAGE_ORDER.indexOf(S') > STAGE_ORDER.indexOf(S)`.

**Validates: Requirements 14.3, 14.4**

---

## Error Handling

### Stage-Level Errors

All errors are displayed as inline `AgentMessage` entries of `type: "error"` appended to the message thread. No full-page error views are used.

| Scenario | Inline error content | Recovery action |
|---|---|---|
| `POST /api/character-profile` fails | "Couldn't save your character — your selections are kept. Try again." | Retain all form state, re-enable Confirm button |
| `POST /api/agents/destinations` fails | "Couldn't find destinations right now. [Retry button — host only]" | Host can retry; non-host members see the error message but no button |
| `POST /api/votes` returns 5xx | Inline below the card: "Vote failed — please try again" + reverted count | Card re-enables Vote button |
| `POST /api/votes` returns 409 | Silent — optimistic count retained, no error shown | No action needed |
| `PATCH /api/rooms/[code]/stage` fails | Existing `goBackError` display in RoomShell header (unchanged) | User may retry |
| Network timeout during slot save | Treated as 5xx; slot re-enabled, inline error shown | User may retry |

### Save Timeout

`TripAgentChat` starts a 10-second `setTimeout` when any slot save begins. If the timeout fires before the fetch resolves:
- The pending save is treated as failed.
- `pendingSlotSave` is set to `false` (slot inputs re-enabled).
- An inline error message is appended.
- The underlying `fetch` is abandoned (AbortController signal passed to the fetch).

---

## Testing Strategy

### Property-Based Testing

The feature has three pure utility functions that are strong PBT candidates:
1. `computeBudgetEstimate()` in `lib/budgetEstimate.ts`
2. `classifyBudgetStatus()` in `lib/budgetEstimate.ts`
3. The `STAGE_INTRO_MESSAGES` content (word count + sentence count invariant)
4. The waiting message generator
5. Vote count state machine logic (optimistic → server response → final state)
6. The `messages` append-only invariant (given a sequence of stage transitions, verify ordering properties)

**Library**: [fast-check](https://github.com/dubzzz/fast-check) (TypeScript-native, actively maintained, integrates with Vitest).

**Configuration**: Each property test runs minimum **100 iterations** (`numRuns: 100`). Budget and vote tests run **500 iterations** to exercise the full numeric input space.

**Test tagging** (comment above each test):
```typescript
// Feature: pixeltrip-chatbot-first-refactor, Property 3: Budget estimate formula correctness
```

### Property Test Specifications

**Property 1 — Agent message format:**
```typescript
fc.assert(fc.property(
  fc.constantFrom(...Object.values(RoomStage)),
  (stage) => {
    const text = STAGE_INTRO_MESSAGES[stage];
    const wordCount = text.trim().split(/\s+/).length;
    const sentenceCount = (text.match(/[.!?]/g) ?? []).length;
    return wordCount <= 40 && sentenceCount <= 2;
  }
), { numRuns: 100 });
```

**Property 3 — Budget estimate formula:**
```typescript
fc.assert(fc.property(
  fc.constantFrom<FlightCategory>("budget", "best_value", "comfort"),
  fc.constantFrom<DestPriceLevel>("budget", "moderate", "premium"),
  fc.integer({ min: 1, max: 30 }),    // tripLengthDays
  fc.constantFrom<BudgetLevel>("low", "medium", "high"),
  (flightCat, priceLevel, days, budgetLevel) => {
    const result = computeBudgetEstimate(flightCat, priceLevel, days, budgetLevel);
    const expected = FLIGHT_COSTS[flightCat]
      + DESTINATION_MULTIPLIERS[priceLevel] * days * DAILY_COSTS[budgetLevel];
    return Math.abs(result.totalPerPerson - expected) < 0.001;
  }
), { numRuns: 500 });
```

**Property 4 — Badge classification exhaustive:**
```typescript
fc.assert(fc.property(
  fc.float({ min: 0, max: 10000, noNaN: true }),
  fc.constantFrom<BudgetLevel>("low", "medium", "high"),
  (estimate, budgetLevel) => {
    const status = classifyBudgetStatus(estimate, budgetLevel);
    const threshold = BUDGET_THRESHOLDS[budgetLevel];
    if (estimate < 0.8 * threshold) return status === "within";
    if (estimate <= threshold)      return status === "near";
    return status === "over";
  }
), { numRuns: 500 });
```

**Property 7 — Append-only message ordering:**
```typescript
fc.assert(fc.property(
  fc.array(fc.constantFrom(...Object.values(RoomStage)), { minLength: 1, maxLength: 13 }),
  (stageSequence) => {
    const messages = simulateStageTransitions(stageSequence);
    // Length only grows
    for (let i = 1; i < messages.length; i++) {
      if (messages[i].timestamp < messages[i-1].timestamp) return false;
    }
    // No messages removed
    return messages.length === new Set(messages.map(m => m.id)).size;
  }
), { numRuns: 100 });
```

### Unit Tests

- `computeBudgetEstimate` with all 18 exact combinations (3 flight × 3 price × 2 representative trip lengths) — verify boundary values precisely.
- `classifyBudgetStatus` at the exact threshold boundaries (0.80× and 1.00× for each budget level) — 6 boundary tests.
- `WaitingState`: specific example where 3 members are pending, verify all 3 names appear in output.
- `VoteableDestinationCard`: snapshot test for rendered HTML structure.
- `CharacterCreator chatMode=true`: example test that step 2 is not visible before step 1 is selected.

### Integration Tests

- `POST /api/votes` with a duplicate userId+voteType returns 409 (1 example, verifies DB constraint).
- `PATCH /api/rooms/[code]/stage` rejects when `requestingUserId !== hostUserId` (1 example).
- Stage-change broadcast received by a second client causes that client to fetch new room state (1 example, using two Supabase channels in a single test process).

### Accessibility Tests

- Contrast ratio validation for all new badge colour combinations using `jest-axe` or equivalent.
- `aria-live` region test: verify new messages are rendered inside the `[aria-live="polite"]` container.
- Keyboard navigation test: Tab order through chip group → card → confirm button follows visual order (Playwright or Testing Library).

---

## Visual Style Reference

All new components follow the existing PixelTrip pixel-art aesthetic:

| Rule | Value |
|---|---|
| Font | `'Courier New', Courier, monospace` |
| Border | `2–4px solid #1E3A5F` (deep navy) |
| Border radius | `0` (no rounded corners) |
| Box shadow | `4px 4px 0 #1E3A5F` |
| Image rendering | `image-rendering: pixelated` on all raster images |
| Backgrounds | Sky blue `#38BDF8`, Sunset orange `#FB923C`, Grass green `#4ADE80`, Sand cream `#FEF3C7`, Deep navy `#1E3A5F`, Neon purple `#A855F7` |
| No white surfaces | No `background: white` or `text-gray-600` anywhere |

**TripAgentMessage bubble**: sand cream background, 4px deep-navy border, `4px 4px 0 #1E3A5F` shadow, 12px padding, monospace text.

**TripContextPanel**: deep navy background, sand cream text, sticky position, `min-height: 100vh` on desktop.

**InteractiveSlot (saving state)**: semi-transparent sky-blue overlay at `opacity: 0.6`, a pixel-art spinner (CSS `@keyframes` rotating a 4px block), centred.

**Badge colours follow the requirements exactly:**
- Price level: green (`#4ADE80`) = budget, amber (`#FB923C`) = moderate, red (`#EF4444`) = premium
- Crowd level: green = low, amber = moderate, red = high
- Budget status: green = within, amber = near, red = over
- Stage readiness: green = all submitted, orange = pending

**PixelAvatar decorative layers** carry `aria-hidden="true"` on all SVG elements.

**Focus indicators**: all interactive elements get `outline: 3px solid #A855F7; outline-offset: 2px` on `:focus-visible`. This neon purple outline meets WCAG AA contrast against both light and dark backgrounds.
