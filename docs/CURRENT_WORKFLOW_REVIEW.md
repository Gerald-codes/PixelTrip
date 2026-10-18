# Current workflow review

Reviewed: 2026-10-10 (Asia/Singapore).

Prepared destination update: 2026-10-14. New demo votes offer Da Nang (Vietnam),
Bali (Indonesia) and Phuket (Thailand), each with its own five-day activities,
traveller-fit explanations and trade-offs. Flights now depend on the selected
destination: SIN–DAD, SIN–DPS or SIN–HKT, using real airline names (Scoot, Vietjet Air,
Garuda Indonesia, Thai AirAsia and Singapore Airlines). Dates, schedules and fares
remain illustrative; local offsets and elapsed durations are consistent with the
sample route. Separate additions use Seminyak/Patong locations for the island plans.
The persisted `vietnam-five-days` scenario key stays compatible with existing rooms,
and old Hoi An/Hue selections can still finish. No new SQL migration is needed.
Deploy the updated backend and frontend, then create a fresh room to see the choices.
Verification: 55 backend tests and 13 frontend tests passed, plus TypeScript and Ruff.
The backend tests cover all nine destination/flight combinations through real voting,
tiebreaks, reviews, separate activity insertion and final approval with no provider
calls, plus route timing and old selections. Existing RoomShell tests emit React
`act` warnings. No live database change or deployment was performed.

Prepared-demo implementation update: 2026-10-13. New DemoAlice-owned rooms carry a
shared `vietnam-five-days` scenario and future departure date; DemoBob fills the
second seat. Prepared execution bypasses the live graph in both synchronous and
HTTP/background paths, including tiebreak advice. The normal Supabase lifecycle
still handles votes, leader decisions, review readiness, selections and versions.
Both demo profiles are prefilled, five-day sample plans exist for Da Nang, Hoi An
and Hue, and each day offers a validated prepared refinement. Fast completed runs
now unlock reviews whenever a newer version arrives, independent of whether the
frontend observed a running phase. See [PREPARED_DEMO.md](./PREPARED_DEMO.md) for
deployment order and the walkthrough. The new migration has not been applied to
a live database, and the live two-device smoke test remains pending deployment.

Demo questionnaire choices are now editable at the user's request. Changed roles
and preferences are saved normally and update the character, while prepared
recommendations, flights and itinerary content still come from the room scenario.
The setup screen explains this. The updated edit/save test and TypeScript passed.

Prepared tiebreak prose now explains each option's fit and trade-offs and includes
per-member reasons based on the saved traveller role. It uses the frontend's
`whyThisFits` field rather than the previously ignored `analysis` field. The advice
and explanations do not explicitly label themselves demo/sample/prepared; option
scores and leader-only decisions remain unchanged. All 14 prepared-demo backend
tests and Ruff passed, including destination and flight copy assertions.

Tiebreak copy was subsequently shortened to one sentence per traveller and one
sentence for the main recommendation. Reasons now name Alice/Bob, connect saved
interests to concrete destination features, and explain flight timing benefits.
Role-based preferences are only a fallback. The prepared option scores remain
unchanged, no LLM is called, and all 15 demo tests and Ruff passed.

Destination match explanations now describe concrete food/nightlife and
scenery/culture benefits for Alice and Bob. Single-sentence traveller-specific
trade-offs are shared by recommendation and tiebreak cards. The demo-duration
explanation was removed without changing the five-day dates. The 15 demo tests
and Ruff still pass.

This is a working orientation snapshot, not a replacement for the steering files or an exhaustive line-by-line audit. Repository files, spec structure and task progress were surveyed; the current BUILD/REFINE/WRAP implementation and its integration paths were read in detail. Secrets, dependency directories, generated files and local environment contents were excluded. No live API calls or database changes were made.

## Product and architecture

- PixelTrip is a collaborative RPG-style travel planner. MILO guides the party inside one shared Party Room; the persistent sidebar displays the party, decisions, budget and progress.
- Stages: SETUP -> DISCOVER -> LOGISTICS -> BUILD -> REFINE -> WRAP.
- Guest identity is room plus normalized display name; there is no account authentication flow.
- Frontend: Next.js App Router, React, TypeScript and Tailwind. UI uses `getServices()`; mock and real implementations share interfaces. The registry currently contains eleven services.
- Backend: FastAPI routes -> services -> repositories. LangGraph runs an orchestrator followed by the specialist selected by run type, including the added tiebreak specialist.
- Supabase stores authoritative trip state and streams shared updates. Frontend writes go through FastAPI; approved direct reads and Realtime use the anon client.
- Character creation is now the simplified budget-tier, group-role and trip-priority flow, with Singapore as the fixed origin. Earlier archetype/outfit/accessory specs describe the previous design.

## Documentation and spec map

The canonical rules are under `.kiro/steering/`, including `api-contracts.md`, `system-workflow.md`, frontend architecture, development rules, product, pixel design, Supabase architecture and AI orchestration.

Four spec packages exist, each with requirements, design and tasks:

| Package | Original purpose | Task-list state observed |
| --- | --- | --- |
| `01-project-foundation` | Scaffold, design tokens, types, mock/real service boundary | Top-level tasks checked |
| `02-backend-core` | Database, repositories, room APIs, error envelope | Top-level tasks checked |
| `03-AI-agents` | Run lifecycle, proposals, guardrails, discovery/logistics/build/refinement | Top-level tasks checked |
| `03-lobby-character-creation` | Earlier character creator and sidebar | Top-level tasks checked |

Checked tasks are documentation claims, not evidence that the current working tree passes all tests. `03-lobby-character-creation/BACKEND_CHANGE_REQUESTS.md` also records recommendation-card enrichment requests.

Several descriptions are historical: the party-lobby README, `lib/stages.ts` comments/helper, real-registry comments and early spec introductions still refer to placeholders or older contracts. Preserve their historical scope, but do not use them to infer that the live integration is absent.

## Current work in progress

At review time, Git showed sixteen modified tracked files and three untracked files before this note was added. The existing untracked files were `PROJECT_CONTEXT.MD`, `backend/requirements.windows.txt` and `BuildStageContent.tsx`. Existing work was left intact.

The current changes add:

- BUILD, REFINE and WRAP rendering through `BuildStageContent` in `PartyRoomShell`.
- A readable day-by-day quest log with selected outbound and return flight times.
- Per-day keep/change choices and comments, followed by one complete-review lock-in.
- Real itinerary version retrieval, feedback submission and member review requests.
- A backend `/trips/{tripId}/itinerary/versions/{versionId}/review` endpoint.
- `allReady` and `needsRefinement` results to separate party readiness from the need for another AI run.
- Day-level feedback as a fallback for each activity on the targeted day; item-specific feedback takes precedence.
- Flight schedule context and arrival/departure-day instructions in the itinerary generation prompt.
- Local Markdown download in WRAP.

## Current activity and refinement flow

1. Members create characters and save preferences. Once everyone has submitted, the backend moves the room to DISCOVER.
2. The owner entering DISCOVER starts discovery. Recommendations and the destination vote arrive through the service/Realtime layer. A clear winner locks the destination; ties receive guide advice and an owner decision.
3. LOGISTICS follows the same pattern for flights. The locked flight advances the trip to BUILD.
4. The owner entering BUILD starts itinerary generation if no current version exists. The generator reads selections and party preferences, drafts activities with the flight schedule in its prompt, and persists version 1 as `source=build`, `status=proposed`.
5. Persistence moves the trip to `itinerary_generated`, hence REFINE. The same component displays the saved plan.
6. Every member chooses keep or change for every day. On lock-in, the frontend posts feedback for each changed day, then posts an approve/refine review. A blank change comment uses the default request to improve the day.
7. The review service marks the member ready and checks all members plus the trip's open feedback. If everyone is ready and feedback remains open, it returns `needsRefinement=true`; the client handling that response starts a refinement run. If the final reviewer chooses approve and no feedback is open, the service approves the version and advances to WRAP.
8. Negotiation loads the latest version and up to fifty open feedback rows. It resolves targets, computes affected scope and conflicts, asks the model for item revisions, and preserves unrelated content. It appends a proposed `source=refine` version, supersedes older proposed versions, marks addressed feedback and advances to `refinement_completed`.
9. The database trigger resets readiness when the trip status changes to `refinement_completed`. The UI attempts to clear local comments, decisions and lock-in when it observes a newer version during refinement. Members review again.
10. WRAP displays the plan and offers a browser-generated Markdown download. The separate backend export endpoint packages the approved trip and advances `trip_exported`; the current button does not invoke that endpoint.

Shared room, roster and selection updates use Realtime. Guide runs are polled; the itinerary component polls versions every two seconds while review/refinement is active. UI loading states expose MILO's work in player-facing language.

## Integration points to revisit

These are observations from the current code, not fixes made by this review:

- **Contract documentation:** the canonical API contract documents the older owner-only `/decision` path but does not yet describe the new member `/review` path. Both endpoints currently exist.
- **Readiness versus lock-in:** `submit_feedback()` already sets `stage_ready=true`, before the frontend has posted all changed-day feedback and its final review. Consequently the shared readiness flag does not strictly represent a finished complete-review lock-in.
- **Review recovery:** local `locked`, comments and decisions are reset only when a newer version is loaded while the component considers refinement active. Refresh/rejoin and fast-run polling races merit verification; readiness itself is not stored per version.
- **Mock parity:** mock itinerary review always returns `needsRefinement=false` and does not implement the multiplayer refinement loop.
- **Export integration:** local Markdown export does not use the real export service or update the backend's export status. The real itinerary service's `export()` still throws.
- **Day-level expectations:** an existing negotiation test still expects a day-only target never to reach the model, which conflicts with the new day-feedback implementation. That async test could not execute because of the Windows fixture issue below.
- **Flight feasibility:** the new scheduling constraints are prompt instructions. This review has not established a deterministic guarantee that generated activities stay outside all flight windows.

## Verification performed

- Frontend TypeScript: `tsc --noEmit --incremental false` passed.
- Backend: `pytest tests/test_refine_export_chat.py -q -p no:cacheprovider --tb=short` using `backend/env_1/Scripts/python.exe`: 24 passed.
- Selected frontend Vitest files: 17 passed, 5 failed across service selector, mock shapes and PartyRoomShell tests. Four failures expect the old five-service registry; one omits `stageReady` from the expected room-member shape. All three PartyRoomShell tests passed, with React act warnings.
- Agent negotiation/itinerary tests: async setup errors occurred because the agent fixture patches `socket.connect`, and Python 3.14 on Windows uses a loopback connection for the event loop's socket pair. These errors are test setup failures, not verified agent behavior failures.
- Live multi-browser behavior, deployed migrations, external flight/LLM providers and production configuration were not tested.

## Keeping this context current

### Confirmed flight-provider quota exhaustion (2026-10-10)

Room DI22HQ's logistics run failed at `searching_flights` for Singapore to Krabi, with availability 19-22 October 2026. Read-only origin airport lookups to the configured Booking COM and Sky Scrapper providers both returned HTTP 429. Each response reported `x-ratelimit-requests-limit=20` and `x-ratelimit-requests-remaining=0`, with approximately 31 days until reset. The configured fallback chain cannot recover while both provider quotas are exhausted. Provider source comments describing larger free quotas do not reflect these account responses. No new flight search or database mutation was performed; two diagnostic airport requests were made. Restarting the application does not replenish provider-side quota.

Flight key follow-up: after the user changed `FLIGHT_API_KEY`, fresh-process checks using the current backend `.env` returned HTTP 403 with `not subscribed` from both Booking COM and Sky Scrapper. No shell key override was present in the diagnostic process. This is distinct from the previous key's HTTP 429 quota exhaustion. The account associated with the current key needs the relevant API subscriptions. Restart the running backend after configuration changes: settings are cached and provider cooldowns are process-wide. These checks did not establish which key the already-running server holds. No credentials were printed or saved.

### Confirmed refinement failure (2026-10-10)

A second refinement was diagnosed with a read-only replay of the saved version and open feedback. Day-level feedback asking to remove one meal was classified as `remove`; `regenerate_affected_only()` applied that outcome to every activity on the targeted day. Three activities became zero, and `ItineraryModel` rejected the day because it requires 1-10 items. This replay called no AI provider and changed no database records.

At diagnosis, the UI's `failureLine()` mapped any failed run at `asking_guide` to an AI-unavailable message. Negotiation retained that phase while constructing and validating its result, so this validation error was presented as provider downtime. Retrying the same persisted feedback repeated the removal. The initial diagnostic did not change implementation code.

Room 15JITH subsequently reproduced this with day-2 feedback: `remove the lunch activity and change it to a bar lunch activity`. Local replay reduced four activities to zero and raised `a day must carry 1 to 10 items, got 0`. A code fix now classifies replacement wording as an edit in both conflict detection and LLM drafting; day-level pure deletion stays open rather than deleting every item, and item deletions that would empty a day preserve that day and leave its feedback open. Negated removal wording and whole-word removal detection were also corrected. Addressed IDs are deduplicated and unresolved proposal IDs include all unapplied feedback. Validation now records `checking_answer`, and refinement failures use a neutral message rather than assuming AI downtime.

Verification of the empty-day fix: 35 backend tests passed (11 focused regression cases plus 24 refine/export/chat tests), six GuideThinking frontend tests passed, and TypeScript checking passed. Read-only replay of 15JITH's saved feedback now validates, keeps day 2 at four activities, selects both feedback rows for revision, and leaves days 3-5 unchanged. No real AI revision or live room retry was performed. Pure day-level deletion still needs a concrete item target to be applied. Restart/reload the running application and retry to verify the live result.

### Separate activity additions during refinement (2026-10-10)

The prior item-only revision schema required exactly one rewrite per existing item, so requests to add clubbing after dinner or dinner before an activity merged the requested activity into an existing row. Refinement now classifies explicit add/insert/include/schedule requests separately and drafts new activities with an existing anchor, before/after placement, their own title, time, description and location. The backend assigns stable new IDs, validates feedback and day/item scope, timing between adjacent known activity times, hard constraints, explicit counts and the ten-item daily cap. Existing activities remain unchanged by additions. Missing, invalid or unavailable additions leave their feedback open rather than appending a note or pretending they were applied. New rows use the existing frontend activity-list rendering; no UI schema change was needed.

Verification: 48 backend tests passed, including before/after insertion, item-level targets, invalid anchors/directions/times, constraints, full days, provider failures and node-level persistence/feedback settlement. Ruff checking and formatting passed for the changed backend files. No live AI call or database modification was performed. Already merged activities are not automatically split by this change; the new insertion path applies to subsequent refinement requests.

Follow-up: room 15JITH's latest feedback was `extra activity after dinner, suggest 1 popular club location nearby for me`. The first insertion implementation classified this as edit because it lacked a recognized insertion verb; version 5 still had two activities on day 1. Refinement now calls an AI intent interpretation step on natural-language feedback before deterministic conflict resolution. Its validated add/edit/remove/retain outcome and requested addition count are shared by drafting and application, rather than requiring particular words. Keyword matching is a fallback only; ambiguous feedback remains open when interpretation is unavailable. Extra/additional/another activity wording is also covered by the fallback. Saved feedback is not modified by interpretation.

Verification of semantic routing: 56 backend tests passed, including a node-level request `something fun after we eat`, malformed/unknown/duplicate intent responses, and failed interpretation without silently rewriting an existing activity. Ruff passed. Automatic approval review rejected the proposed live AI diagnostic because it would export saved room feedback, itinerary and constraints to the configured external AI service and consume quota without specific diagnostic consent. That call was not executed. Live semantic interpretation remains unverified pending approval or the user's normal in-app retry. No room data was changed.

Latest read-only follow-up: 15JITH's newest feedback is `create another activity at 10pm to go another club as well`, already addressed by refinement from version 5 to version 6. Version 6 was saved at 19:50:42 Singapore time and still has two day-1 items with clubbing folded into their descriptions. The semantic-routing implementation file was last saved at 19:53:57 Singapore time, after that run. Therefore this saved version does not verify the newest fix. No newer refinement run was found in this check. A backend restart and a new refinement request are needed; previously addressed feedback will not automatically run again. The ten-activity cap is not the issue for this two-activity day.

Before subsequent changes, recheck Git status/diffs, this note and the relevant steering/spec sections. Track implementation progress separately from old checked task lists. Update this snapshot when the review/lock-in contract, refinement lifecycle or export behavior changes. Inspect environment variable names only when needed; do not copy credential values into notes or chat.
