---
inclusion: fileMatch
fileMatchPattern: '{app,src/features,src/services,src/types}/**'
---

# System Workflow

The end-to-end planning flow, framed so the frontend and backend can build in parallel
against a shared understanding. This file is the map of *what happens when* — the stages,
the states, and, for each stage, the four things the frontend must know:

- **Trigger** — the user action that kicks off backend processing.
- **Required data** — what the frontend must send.
- **Expected response** — the shape/kind the backend returns (see `api-contracts.md`).
- **UI state** — what the party sees while and after processing.

No authentication is involved anywhere in this flow — users are guests (see
`product.md` / `supabase-architecture.md`).

## Stage Machine

The journey is a linear progression with one internal loop (REFINE):

```
SETUP → DISCOVER → LOGISTICS → BUILD → REFINE ⭯ → WRAP
```

- Forward transitions are gated by the application states below (e.g. LOGISTICS cannot
  start until a destination is selected).
- REFINE loops on itself: feedback → negotiation → new version → review, until approved.
- The AI NPC guide owns stage transitions; the frontend reflects the current stage rather
  than deciding it.

## Application States

State is authoritative and persisted (Supabase). The frontend reads it to decide which
stage UI to show; the backend advances it as operations complete.

| # | State | Set after | Active stage |
|---|-------|-----------|--------------|
| 1 | Trip created | A trip room exists | SETUP |
| 2 | Group formed | Members joined the party | SETUP |
| 3 | Preferences collected | All members submitted preferences | SETUP → DISCOVER |
| 4 | Destination selected | DISCOVER vote resolved | DISCOVER → LOGISTICS |
| 5 | Flight selected | LOGISTICS vote resolved | LOGISTICS → BUILD |
| 6 | Itinerary generated | First itinerary version saved | BUILD → REFINE |
| 7 | Feedback collected | Party submitted feedback | REFINE |
| 8 | Refinement completed | A revised version the party accepts | REFINE |
| 9 | Trip approved | Party approves the itinerary | REFINE → WRAP |
| 10 | Final trip exported | Export/share generated | WRAP |

A `planning_stage` field on the room reflects the active stage; individual states above
capture finer progress within/between stages and drive the progress UI.

## Stage-by-Stage Integration

### 1. SETUP — Gather the party
- **Purpose:** create the party and collect the inputs the AI reasons over.
- **Trigger(s):** create trip; join trip via room code + display name; submit character;
  submit preferences.
- **Required data:**
  - Trip: room name (a shareable room code is generated for invites).
  - Join: room code + display name (an existing name in the room resumes that member).
  - Character: avatar appearance, outfit, accessories.
  - Preferences: availability dates, budget, travel style, destination interests,
    activities.
- **Expected response:** created trip/room, guest membership, stored character +
  preferences; readiness signal when all members have submitted.
- **UI state:** party roster fills in as members join; per-member "ready" indicator;
  progress advances to DISCOVER once preferences are collected.

### 2. DISCOVER — Choose the destination
- **Purpose:** find and lock a destination.
- **Trigger:** party enters DISCOVER (preferences collected) → AI produces destination
  recommendations; users cast votes.
- **Required data:** room id (backend reads group preferences); vote casts
  (`voteSessionId`, `optionId`).
- **Expected response:** `recommendation` message (destination options with compare
  details), a `vote` session, and a `summary`/decision when the vote resolves.
- **UI state:** destination recommendation cards + comparison view; live vote counts;
  selected destination shown as a resolved decision. State → destination selected.

### 3. LOGISTICS — Arrange travel
- **Purpose:** select flights / travel arrangements.
- **Trigger:** destination selected → AI searches and ranks flight options; users vote.
- **Required data:** room id (backend uses budget, availability, preferences, chosen
  destination); vote casts.
- **Expected response:** `recommendation` message with ranked flight options (compare
  fields), a `vote` session, and a decision `summary` on resolve.
- **UI state:** flight option cards + comparison; live vote counts; selected flight shown
  as resolved. State → flight selected.

### 4. BUILD — Draft the quest log
- **Purpose:** generate the initial itinerary.
- **Trigger:** flight selected → AI generates itinerary from destination, flights,
  preferences, constraints.
- **Required data:** room id (backend has the accumulated decisions).
- **Expected response:** an itinerary object (version 1) — days, ordered items, optional
  map points (see `api-contracts.md`).
- **UI state:** itinerary rendered as an 8-bit adventure journal / quest log; this is a
  presentation stage (no vote). State → itinerary generated.

### 5. REFINE — Improve together (iterative)
- **Purpose:** improve the itinerary through group feedback until approved.
- **Trigger(s):** submit comment / suggested change; request a new version; approve.
- **Required data:** room id; feedback entries (target section + comment/suggestion);
  approval decision.
- **Expected response:** AI analysis of feedback (conflicts identified, compromises
  negotiated), a regenerated itinerary version, and version metadata so the UI can show
  history. Loop: feedback → negotiation → new version → review.
- **UI state:** current itinerary version with commenting/suggestion affordances; updated
  versions displayed with the ability to compare/step through; approval control. States →
  feedback collected → refinement completed → trip approved.

### 6. WRAP — Complete the adventure
- **Purpose:** finalise and share.
- **Trigger:** trip approved → AI/backend finalises the itinerary and produces export data.
- **Required data:** room id / approved trip id.
- **Expected response:** finalised itinerary + export payload (shareable form).
- **UI state:** final adventure summary (journal, quest log, timeline, map); export/share
  actions. State → final trip exported.

## Frontend / Backend Boundary (summary)

- The frontend never advances state on its own; it renders the current stage/state and
  raises the triggers above through the service layer.
- The backend (FastAPI + LangGraph) owns AI reasoning, recommendation/flight generation,
  vote outcome calculation, itinerary generation/versioning, feedback negotiation, and
  finalisation.
- Supabase owns persistence and realtime for trips, members, characters, preferences,
  messages, votes, itinerary versions, feedback, and state.
- Both sides integrate only through the shapes in `api-contracts.md`. See
  `ai-orchestration.md` for the AI's per-stage responsibilities.
