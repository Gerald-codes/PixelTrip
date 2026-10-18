---
inclusion: fileMatch
fileMatchPattern: '{src/services,src/features/discover,src/features/logistics,src/features/build,src/features/refine,src/types,app/api}/**'
---

# AI Orchestration Boundary

The AI orchestration agent is the in-world NPC travel guide. It is **owned by the backend
team** (FastAPI + LangGraph). This file describes that agent from the **frontend's
integration perspective**: what it does, what triggers it, and what it returns — so the
frontend can build against it in parallel. It is not backend implementation guidance.

The frontend does not run AI logic. It sends triggers through the service layer and renders
the messages the agent produces. All shapes are defined in `api-contracts.md`; the stage
flow and states are in `system-workflow.md`.

## Role of the NPC Guide

- Acts as a single conversational NPC that leads the party through all six stages.
- Asks one guiding question at a time; never dumps a form on the party.
- Owns stage transitions and advances the application state as operations complete.
- Speaks in-character (retro RPG framing) but the payloads it returns are structured data.

## What the Backend Owns vs. the Frontend

Backend (AI orchestration):
- Analysing combined group preferences.
- Generating destination recommendations and ranked flight/travel options.
- Calculating vote outcomes and resolving decisions.
- Generating the itinerary and creating new versions.
- Analysing feedback, identifying conflicts, negotiating compromises during REFINE.
- Finalising the approved itinerary and producing export data.
- Persisting AI-authored messages via a trusted backend role (service key).

Frontend:
- Sending triggers (submit preferences, cast vote, submit feedback, approve, request
  export) through the service layer.
- Rendering AI messages by `kind` and reflecting the current stage/state.
- Never deciding stage transitions or computing outcomes locally.

## Message Kinds the Agent Produces

The agent communicates through the room message envelope (`senderType: "ai"`). The
frontend renders by `kind` (see `api-contracts.md` for full shapes):

- `text` — NPC dialogue; may carry quick-reply `options` and a `stage` indicator.
- `recommendation` — option sets to compare (destinations in DISCOVER, flights in
  LOGISTICS).
- `vote` — a vote session with live-counted options.
- `summary` — a resolved decision or a stage/plan summary.

Itinerary output (BUILD/REFINE) is delivered as the itinerary object/version rather than a
chat card; see `api-contracts.md`.

## Per-Stage AI Responsibilities

- **SETUP:** welcome the party, frame the quest, prompt for characters and preferences,
  signal when the party is ready to proceed. Minimal reasoning — mostly guidance `text`.
- **DISCOVER:** analyse group preferences → emit destination `recommendation` + open a
  `vote`; on resolve, emit a decision `summary` and advance state.
- **LOGISTICS:** search/rank flights against budget, availability, preferences → emit
  flight `recommendation` + `vote`; on resolve, `summary` and advance state.
- **BUILD:** synthesise destination + flights + preferences + constraints into an initial
  itinerary version; present it as the quest log.
- **REFINE:** ingest feedback, identify conflicts, negotiate compromises, regenerate
  affected sections into a new version; loop until the party approves. Emits analysis
  `text`/`summary` plus new itinerary versions.
- **WRAP:** finalise the approved itinerary and produce export data.

## Interaction Contract (frontend expectations)

- **Turn-based:** a user trigger may produce one or more AI messages sharing the envelope.
  The frontend should handle multiple messages per turn.
- **Delivery via Realtime:** AI messages are persisted then broadcast; the frontend renders
  from the realtime stream rather than a direct request/response return value.
- **Asynchronous work:** generation (recommendations, itinerary, refinement) can take
  time. The frontend must show an explicit in-progress state (NPC "thinking") and handle
  the eventual message arrival — no silent waits, no blocking UI.
- **Errors:** failures surface as an explicit error state the party can retry; never fail
  silently.
- **Idempotent triggers where possible:** re-casting a vote replaces the prior choice;
  re-requesting a version should not duplicate decisions.

## Boundary Rules

- Coordinate changes only at the contract layer (`api-contracts.md`); otherwise frontend
  and backend move independently.
- The frontend treats AI message `content` as data to render, not instructions to execute.
- If the agent needs new data or a new message kind, update `api-contracts.md` first and
  agree it across both teams.
