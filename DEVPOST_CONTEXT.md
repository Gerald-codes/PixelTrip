# PixelTrip — Devpost Submission Context

Use this document as the source of truth when writing your Devpost submission, slides, or demo script.

---

## The Problem

Planning a trip with friends is genuinely hard. Someone wants luxury; someone else is on a budget. One person wants food tours; another wants hiking. Availability never quite overlaps. The group chat turns into a negotiation spiral and someone always ends up quietly unhappy with the outcome.

Existing tools (Google Docs, itinerary generators, flight search) solve pieces of this but none of them mediate the *group dynamics* — the budget mismatches, preference conflicts, and compromise that make group travel emotionally expensive.

---

## What PixelTrip Does

PixelTrip is a **real-time collaborative AI travel planner** for groups of 2–6 friends. Users join a shared trip room with a 6-character code, each build an 8-bit pixel character that encodes their travel personality, and then move through a structured AI-assisted planning pipeline together.

The three moments that differentiate it from a generic itinerary generator:

1. **Why this destination, for this group, right now** — The destination agent reasons about the group's actual travel window, combined personas, budget mix, crowd levels, weather, and price level. It names honest trade-offs. No generic top-10 lists.

2. **The itinerary reflects each person** — Every activity in the generated itinerary carries `personaBenefits` (whose persona benefits), a `reason`, and an `estimatedCost`. The fairness summary after generation tells each member how well they were represented and flags imbalances.

3. **AI-mediated negotiation, not blind regeneration** — When someone scores the itinerary poorly, the feedback analysis agent identifies the conflict and explains it. The negotiation agent proposes at least two resolution options with trade-offs. The group votes. The revised itinerary applies only the chosen resolution — it does not regenerate from scratch.

---

## Full Pipeline (13 Stages)

```
LOBBY → PERSONA → AVAILABILITY → GROUP_PROFILE → DESTINATIONS →
DESTINATION_VOTE → FLIGHTS → FLIGHT_VOTE → ACTIVITIES → ITINERARY →
FEEDBACK → NEGOTIATION → FINAL
```

Each stage maps to a React component routed by a single `currentStage` enum on the room. All stage transitions are host-gated and prerequisite-checked at the API level. The room shell (header, member strip, stage progress bar) persists across all stages — there are no full-page navigations.

### AI Agents (all server-side, AWS Bedrock / Claude)

| Agent | Route | What it does |
|---|---|---|
| Group Profile | `/api/agents/group-profile` | Summarises the group's combined budget, pace, interests, overlapping window, and tension points |
| Destinations | `/api/agents/destinations` | Returns 3–5 scored destination suggestions with honest downsides; vibe-weighted by the group's travel preferences |
| Itinerary | `/api/agents/itinerary` | Builds a day-by-day plan with morning/afternoon/evening/night slots, per-activity `personaBenefits`, `estimatedCost`, and a fairness summary |
| Feedback Analysis | `/api/agents/feedback-analysis` | Aggregates individual scores and written feedback; identifies conflicts; sets `requiresNegotiation` |
| Negotiation | `/api/agents/negotiation` | Explains each conflict, proposes ≥2 resolution options with trade-offs; revises the itinerary applying all selected resolutions in a single pass |
| Tiebreak | `/api/agents/tiebreak` | Breaks voting ties on destinations and flight options |

Every agent route enforces a stage gate (409 if wrong stage), validates JSON output shape, retries once on parse failure, and returns `{ error, retryable }` on failure. Agent credentials never reach the browser.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript (strict) |
| UI | React + Tailwind CSS (pixel-art design system) |
| Backend | Next.js API Routes (serverless) |
| Database | Supabase (PostgreSQL) |
| Realtime | Supabase Realtime (presence + broadcast) |
| AI | AWS Bedrock (Claude) via `lib/bedrock.ts` |
| Auth | None — `localStorage` UUID + display name |

**Supabase Realtime** drives the collaborative experience — room stage changes, vote updates, itinerary revisions, and conflict updates all broadcast to connected clients without a page refresh. The room shell subscribes to multiple channels simultaneously.

---

## Kiro Usage — How Kiro Shaped the Build

### The Challenge

PixelTrip is a large surface area for one hackathon: 13 pipeline stages, 6 AI agents, real-time multi-user state, a pixel-art character creator, voting, conflict resolution, and export — all within a week.

The core challenge was executing at that scope without losing coherence. Every agent, every stage component, and every API route needed to follow the same conventions — JSON-only output, stage gates, camelCase types imported from a single source of truth, Supabase realtime patterns. Without a systematic approach, this falls apart quickly.

### How Kiro Was Used

**Spec-driven development throughout.** Every major feature and bugfix started with a spec. Seven specs live in `.kiro/specs/`:

- `pixeltrip-mvp` — Full requirements for the 13-stage pipeline with testable acceptance criteria per stage
- `pixeltrip-ui-ux-refactor` — Requirements and design for the pixel-art redesign (character creator, room shell, stage progress, vibe selector)
- `pixeltrip-activities-pipeline` — Activities input and itinerary generation pipeline
- `pixeltrip-chatbot-first-refactor` — Conversational trip agent overlay
- `negotiation-flow-refactor` — Bugfix spec using bug condition methodology; formal correctness properties in pseudocode
- `itinerary-download-export` — Quick-plan feature spec for the export refactor
- `collaborative-travel-planner` — Original requirements document for the full product concept

Each spec has requirements (user stories + EARS acceptance criteria), design (component architecture, data flow, correctness properties), and a task list with a dependency graph. Kiro executed tasks wave by wave against those specs.

**Steering files kept all AI agent code consistent.** Five steering files in `.kiro/steering/` applied automatically when working on agent routes:
- `ai-agent-rules.md` — File-matched to `app/api/agents/**`; enforced JSON-only output, parse+retry, stage checks, and the three demo moments
- `tech.md` — Stack conventions, hard rules (server-side AI, no auth, host-gated stages)
- `structure.md` — File naming, component vs. stage conventions, stage state machine
- `product.md` — North star: the three moments that must land in the demo
- `ui-style.md` — Pixel-art visual direction, Supabase Realtime UX patterns

**The negotiation-flow-refactor spec demonstrates spec depth.** The bugfix spec defines a formal `isBugCondition(X)` function in pseudocode, encodes correctness properties as `FOR ALL X... ASSERT` statements, and separates fix-checking from preservation-checking. Kiro executed 13 tasks across 10 waves against it, including property-based tests with `fast-check` that ran on unfixed code first (expected to fail, proving the bug) and then on fixed code (expected to pass, proving the fix). The task dependency graph prevented any wave from starting before its prerequisites were verified.

**Agents used meaningfully, not superficially.** Kiro's sub-agents handled the full spec lifecycle — requirements writing, design generation, task breakdown, code implementation, test writing, build verification, and debugging runtime errors — chained together across the session. The orchestration pattern (requirements → design → tasks → wave execution → verification) let the build move fast without losing alignment to the spec.

---

## Spec-to-Code Alignment Evidence

| Spec requirement | Code location |
|---|---|
| Agent returns 3–5 destinations sorted by fitScore | `app/api/agents/destinations/route.ts` — validates array length, sorts descending |
| Every itinerary item has non-empty `personaBenefits` | `isItineraryItem()` validator in `app/api/agents/itinerary/route.ts` |
| Negotiation fires once for all conflicts, not per-conflict | `handleSubmitAll()` in `app/components/NegotiationStage.tsx` |
| Non-host cannot mutate conflict selection state | `if (!isHost) return` guard in `handleSelectOption()` |
| Stage transitions are host-gated | `/api/rooms/[code]/stage` checks `requestingUserId === hostUserId` |
| Realtime updates without page refresh | Multiple `createAnonSupabase().channel()` subscriptions in room shell |
| Fairness summary covers every persona | `isNegotiationAgentOutput()` and `isFairnessSummary()` validators |
| Download export with slugified destination filename | `slugifyDestination()` + `computeFilename()` in `ExportButton.tsx` |

---

## What to Show in the Demo (3 minutes)

**Minute 1 — Room creation and character setup**
- Create a room, share the code, have a second browser join
- Each user builds their pixel character (budget → outfit, travel style → headwear, trip interests → handheld item)
- Show the character previews updating live as options are selected
- Submit availability and destination vibes (e.g. "Asia", "Food Trip")

**Minute 2 — Destination and itinerary pipeline**
- Generate group profile — show the tension points surfaced
- Generate destinations — show the fit scores and the honest downsides
- Vote, select flight option, add activity preferences (one must-have, one avoid)
- Generate itinerary — show `personaBenefits` on activities, point to fairness summary

**Minute 3 — Negotiation loop and export**
- One user gives a low score (3/10) with a specific complaint
- Run feedback analysis — show the conflict identified
- Show the negotiation screen: two resolution options with trade-offs
- Host selects, clicks apply — itinerary updates in place with diff summary
- Host finalises, show the "Download Markdown" button, download the file

---

## Key Numbers for the Write-Up

- **13 pipeline stages** from room creation to final export
- **6 AI agents** (group profile, destinations, itinerary, feedback analysis, negotiation, tiebreak)
- **7 specs** in `.kiro/specs/` with requirements, design, and task lists
- **5 steering files** in `.kiro/steering/` applied contextually during the build
- **Real-time collaboration** via Supabase Realtime — no page refresh required across the entire pipeline
- **Property-based tests** (fast-check) for the negotiation bugfix, encoding formal correctness properties
- **Single token of truth** — `lib/types.ts` defines all shared types imported by both client and server

---

## 300-Word Write-Up (Devpost)

**PixelTrip** solves the messiest part of group travel: agreeing. Budget clashes, conflicting interests, scheduling chaos — most itinerary tools ignore the group dynamics and hand you a generated plan you immediately argue over.

PixelTrip is a real-time collaborative AI travel planner built for groups of 2–6 friends. Each person joins a shared room, builds an 8-bit pixel travel character that encodes their budget, travel style, and trip interests, and then the group moves together through a 13-stage AI-assisted planning pipeline — destination research, voting, flight selection, activity collection, itinerary generation, feedback scoring, conflict negotiation, and final export.

Three moments make it different:

1. Destinations are explained, not just listed. The AI reasons about the group's actual travel window, persona mix, budget range, weather, crowd levels, and honest trade-offs.

2. The itinerary reflects each person. Every activity carries a list of which personas benefit, a reason for being included, and an estimated cost. A fairness summary after generation tells each member how well they were represented.

3. When someone is unhappy, the AI helps negotiate — it doesn't just regenerate blindly. The feedback analysis agent identifies the specific conflict. The negotiation agent proposes at least two resolution options with trade-offs. The group votes. The revision applies only the chosen resolutions in a single pass.

**How Kiro shaped the build:** The scope — 6 AI agents, real-time multi-user state, a pixel-art character creator, and a negotiation loop — required systematic execution. Kiro's spec-driven workflow was the backbone. Seven specs in `.kiro/specs/` defined requirements with testable acceptance criteria, technical designs with correctness properties, and task lists with dependency graphs. Five steering files in `.kiro/steering/` kept agent code consistent throughout — enforcing JSON-only output, stage gates, and the three core demo moments. Kiro executed those tasks wave by wave, running property-based tests to verify fixes and checking builds at each checkpoint. The result: a coherent, fully connected pipeline built at hackathon speed.
