# PixelTrip — Design

## Overview

PixelTrip is a Next.js 14 (App Router) web application with Supabase as the database and real-time layer, and kiro/ AWS bedrock powering all AI agents. The system is structured around a room-stage state machine — every user interaction is scoped to a room, and the room's `currentStage` drives what the UI renders and what agents are invoked.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), React, TypeScript |
| Styling | Tailwind CSS |
| Backend | Next.js API Routes (serverless) |
| Database | Supabase (PostgreSQL) |
| Realtime | Supabase Realtime (presence + broadcast) |
| AI | kiro/AWS bedrock API |
| Auth | None — display name only, stored in `localStorage` |
| Flight Data | Mocked/seeded JSON for MVP |
| Export | Client-side Markdown string copy |

---

## Architecture Overview

```
Browser (Next.js App Router)
    │
    ├── /room/[code]          ← Single room page, stage-driven rendering
    │       │
    │       └── StageRouter   ← Renders the correct stage component
    │
    └── API Routes (/api/...)
            │
            ├── rooms/        ← Room CRUD
            ├── personas/     ← Persona list
            ├── availability/ ← Date + destination input
            ├── agents/       ← All AI agent endpoints
            │     ├── group-profile
            │     ├── destinations
            │     ├── itinerary
            │     ├── feedback-analysis
            │     └── negotiation
            ├── votes/        ← Vote submission + result
            └── itinerary/    ← Itinerary CRUD, versions, export
```

Supabase Realtime is used for:
- Live member list in the lobby
- Stage transition notifications (host advances → all clients re-render)
- Vote count updates

All AI calls are server-side only (API routes). The browser never calls the kiro/AWS bedrock API directly.

---

## Room Stage State Machine

The `currentStage` field on `TripRoom` is the single source of truth for where the group is in the planning flow. Only the host can advance stages.

```
LOBBY
  └─► PERSONA
        └─► AVAILABILITY
              └─► GROUP_PROFILE
                    └─► DESTINATIONS
                          └─► DESTINATION_VOTE
                                └─► FLIGHTS
                                      └─► FLIGHT_VOTE
                                            └─► ACTIVITIES
                                                  └─► ITINERARY
                                                        └─► FEEDBACK
                                                              └─► NEGOTIATION
                                                                    └─► FINAL
```

The `NEGOTIATION` stage can loop back to `ITINERARY` → `FEEDBACK` multiple times before the host finalises.

---

## Data Models

### User
```ts
{
  id: string            // UUID generated client-side, stored in localStorage
  displayName: string
  roomId: string
  selectedPersonaId: string | null
}
```

### Persona
```ts
{
  id: string
  name: string            // e.g. "Foodie Boss"
  avatarImage: string     // path to pixel art PNG
  budgetLevel: 'low' | 'medium' | 'high'
  travelPace: 'slow' | 'moderate' | 'fast'
  interests: string[]     // e.g. ["food", "nightlife", "cafes"]
  flexibility: 'rigid' | 'moderate' | 'flexible'
  decisionStyle: string   // e.g. "Opinionated", "Easygoing"
  description: string
  planningWeight: Record<string, number> // e.g. { food: 0.8, scenery: 0.2 }
}
```

Seeded personas: Foodie Boss, Scenic Wanderer, Master Planner, Chill Explorer, Luxury Traveller.

### TripRoom
```ts
{
  id: string
  roomCode: string          // 6-char uppercase alphanumeric
  hostUserId: string
  currentStage: RoomStage   // enum, see state machine above
  selectedDestination: string | null
  selectedFlightOption: 'budget' | 'comfort' | 'best_value' | null
  currentItineraryId: string | null
  finalItineraryId: string | null
  createdAt: string
}
```

### Availability
```ts
{
  id: string
  userId: string
  roomId: string
  startDate: string   // ISO date
  endDate: string     // ISO date
}
```

### DestinationPreference
```ts
{
  id: string
  userId: string
  roomId: string
  countryOrCity: string
}
```

### DestinationSuggestion
```ts
{
  id: string
  roomId: string
  destinationName: string
  fitScore: number          // 0–100
  weatherSummary: string
  seasonalitySummary: string
  crowdLevel: 'low' | 'moderate' | 'high'
  priceLevel: 'budget' | 'moderate' | 'premium'
  bestActivities: string[]
  downsides: string[]
  personaFitSummary: string
  recommendationReason: string
}
```

### Vote
```ts
{
  id: string
  roomId: string
  userId: string
  voteType: 'destination' | 'flight' | 'conflict_resolution'
  selectedOption: string
  createdAt: string
}
```

### ActivityPreference
```ts
{
  id: string
  roomId: string
  userId: string
  title: string
  type: 'activity' | 'food' | 'sight' | 'experience' | 'avoid'
  priority: 'must_have' | 'optional'
  notes: string | null
}
```

### Itinerary
```ts
{
  id: string
  roomId: string
  versionNumber: number
  destination: string
  startDate: string
  endDate: string
  days: ItineraryDay[]
  fairnessSummary: FairnessSummary
  averageSatisfactionScore: number | null
  status: 'draft' | 'final'
}

type ItineraryDay = {
  date: string
  morning: ItineraryItem[]
  afternoon: ItineraryItem[]
  evening: ItineraryItem[]
  night?: ItineraryItem[]
}

type ItineraryItem = {
  title: string
  description: string
  type: string
  personaBenefits: string[]   // persona names who benefit
  reason: string
}

type FairnessSummary = {
  perPersona: Record<string, string>   // personaName → summary text
  warnings: string[]
  recommendations: string[]
}
```

### ItineraryFeedback
```ts
{
  id: string
  itineraryId: string
  userId: string
  score: number             // 1–10
  likedItems: string[]
  dislikedItems: string[]
  requestedAdditions: string[]
  requestedRemovals: string[]
  importantRequests: string[]   // up to 3 high-priority items
  createdAt: string
}
```

### ConflictResolution
```ts
{
  id: string
  roomId: string
  itineraryId: string
  conflictSummary: string
  affectedUsers: string[]
  proposedOptions: ConflictOption[]
  selectedResolution: string | null
  status: 'open' | 'voting' | 'resolved'
}

type ConflictOption = {
  id: string
  description: string
  tradeoffs: string
}
```

---

## AI Agent Design

All agents are called from Next.js API routes. Each agent receives structured JSON context and returns structured JSON. Prompts instruct the model to return only valid JSON with no preamble.

### 1. Group Profile Agent
- **Route:** `POST /api/agents/group-profile`
- **Input:** `{ roomId, users: User[], personas: Persona[], availabilities: Availability[], destinationPreferences: DestinationPreference[] }`
- **Output:** `{ budgetRange, dominantPace, commonInterests, travelWindow, tensionPoints, dominantPersonaTraits }`
- **Prompt strategy:** Summarise the group as a travel advisor would. Identify the overlapping dates. Surface conflicts between personas (e.g. low-budget Scenic Wanderer vs. high-budget Luxury Traveller). Keep output under 300 words.

### 2. Destination Research Agent
- **Route:** `POST /api/agents/destinations`
- **Input:** `{ groupProfile, destinationPreferences: DestinationPreference[] }`
- **Output:** `DestinationSuggestion[]` (3–5 items, sorted by fitScore descending)
- **Prompt strategy:** Act as a travel research expert. For each destination, assess seasonality for the travel window, weather conditions, crowd levels, estimated costs, and persona fit. Do not just recommend popular places — explain trade-offs. Return exactly the fields defined in `DestinationSuggestion`.

### 3. Persona-Based Itinerary Agent
- **Route:** `POST /api/agents/itinerary`
- **Input:** `{ destination, startDate, endDate, flightOption, groupProfile, activityPreferences: ActivityPreference[], personas: Persona[] }`
- **Output:** `{ days: ItineraryDay[], fairnessSummary: FairnessSummary }`
- **Prompt strategy:** Build a day-by-day plan. Ensure each persona has at least some activities they value. Respect must-have items. Flag budget concerns for low-budget personas. Include a fairness summary with per-persona coverage and any warnings.

### 4. Feedback Analysis Agent
- **Route:** `POST /api/agents/feedback-analysis`
- **Input:** `{ itinerary: Itinerary, feedbacks: ItineraryFeedback[], personas: Persona[] }`
- **Output:** `{ averageScore, unhappyPersonas: string[], conflictingRequests: string[], suggestedAmendments: string[], requiresNegotiation: boolean }`
- **Prompt strategy:** Identify users with low scores, underrepresented personas, and requests that directly conflict with other users' preferences. Flag whether a full negotiation vote is required or changes can be applied silently.

### 5. Negotiation Agent
- **Route:** `POST /api/agents/negotiation`
- **Input:** `{ itinerary: Itinerary, conflicts: ConflictResolution[], feedbacks: ItineraryFeedback[] }`
- **Output:** `{ conflictSummary, affectedUsers, proposedOptions: ConflictOption[] }`
- **Prompt strategy:** For each conflict, propose two or three concrete resolution options with clear trade-offs. Explain the impact on each persona. Keep options actionable and concise.

---

## API Routes Summary

| Method | Route | Description |
|---|---|---|
| POST | `/api/rooms` | Create a new room, generate room code |
| GET | `/api/rooms/[code]` | Get room by code |
| PATCH | `/api/rooms/[id]/stage` | Advance room stage (host only) |
| GET | `/api/personas` | List all seeded personas |
| POST | `/api/users` | Create or update a user in a room |
| POST | `/api/availability` | Submit availability and destination interests |
| POST | `/api/votes` | Submit a vote |
| GET | `/api/votes/[roomId]/[voteType]` | Get vote results for a round |
| POST | `/api/activity-preferences` | Submit activity preferences |
| GET | `/api/itinerary/[roomId]` | Get current itinerary |
| POST | `/api/itinerary/[roomId]/finalise` | Mark itinerary as final |
| POST | `/api/feedback` | Submit itinerary feedback |
| GET | `/api/feedback/[itineraryId]` | Get all feedback for an itinerary |
| POST | `/api/conflicts` | Create a conflict resolution record |
| PATCH | `/api/conflicts/[id]` | Update conflict with selected resolution |
| POST | `/api/agents/group-profile` | Run group profile agent |
| POST | `/api/agents/destinations` | Run destination research agent |
| POST | `/api/agents/itinerary` | Run itinerary generation agent |
| POST | `/api/agents/feedback-analysis` | Run feedback analysis agent |
| POST | `/api/agents/negotiation` | Run negotiation agent |

---

## Component Tree

```
app/
├── page.tsx                        ← Landing: create or join room
├── room/[code]/
│   └── page.tsx                    ← Room shell + Supabase Realtime subscription
│       └── StageRouter.tsx         ← Renders active stage component
│           ├── LobbyStage.tsx      ← Member list, persona selection
│           ├── AvailabilityStage.tsx
│           ├── GroupProfileStage.tsx
│           ├── DestinationsStage.tsx
│           ├── VotingStage.tsx     ← Reusable for destination + flight + conflict votes
│           ├── FlightStage.tsx
│           ├── ActivitiesStage.tsx
│           ├── ItineraryStage.tsx
│           ├── FairnessStage.tsx
│           ├── FeedbackStage.tsx
│           ├── NegotiationStage.tsx
│           └── FinalStage.tsx
└── components/
    ├── PersonaCard.tsx
    ├── DestinationCard.tsx
    ├── ItineraryDay.tsx
    ├── FairnessSummary.tsx
    ├── VotePanel.tsx
    ├── FeedbackForm.tsx
    └── ExportButton.tsx
```

---

## Supabase Schema (Tables)

```sql
users, personas, trip_rooms, availability, destination_preferences,
destination_suggestions, votes, activity_preferences, itineraries,
itinerary_feedback, conflict_resolutions
```

Supabase Realtime channels:
- `room:{roomId}:presence` — user join/leave
- `room:{roomId}:stage` — stage change broadcasts from host

---

## Error Handling Strategy

- **AI agent failures:** All agent routes wrap kiro/AWS bedrock API calls in try/catch. On failure, the route returns a 500 with `{ error: "Agent failed", retryable: true }`. The client shows a retry button.
- **JSON parse errors from AI:** Agent prompts enforce JSON-only output. If parsing fails, the route retries once before returning an error.
- **Vote conflicts:** Duplicate votes are rejected at the database level via a unique constraint on `(roomId, userId, voteType)`.
- **Stage gate enforcement:** The `/api/rooms/[id]/stage` route verifies `hostUserId === requestingUserId` before advancing. All agent routes verify the room is in the correct stage for that agent.
- **No overlap in dates:** If `calculateOverlap()` returns null, the system surfaces an error state in the `AvailabilityStage` and blocks progression until resolved.

---

## Testing Strategy

- **Unit tests:** Agent prompt construction functions, date overlap calculation, vote result tallying, fairness scoring logic.
- **Integration tests:** API route handlers using a test Supabase instance.
- **E2E tests (manual for MVP):** Full 2-user flow from room creation through final export using two browser windows.

---

## MVP Simplifications

- Flight data is mocked — three hardcoded option objects per destination.
- Weather, crowd, and price data are AI-estimated from the model's knowledge; no external API is called.
- Authentication is skipped — userId is a UUID generated and stored in `localStorage`.
- Real-time collaboration is basic — stage changes broadcast via Supabase, member list uses Supabase Presence.
- Hotel suggestions are omitted from MVP.
