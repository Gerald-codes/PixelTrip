# Implementation Plan: Project Foundation

## Overview

This plan scaffolds the PixelArt Trip Planner monorepo so one frontend developer and two
backend developers can work in parallel. It is **scaffolding only**: no business logic, no
AI/LangGraph, no real Supabase feature calls, and no auth. The backbone is the contract-first
service layer — typed interfaces (placeholders, signatures only) whose behaviour is supplied
exclusively by Mock implementations (contract-shaped fixtures) or Real placeholders (throw
`NotImplementedError`), selected at a single switch point via `NEXT_PUBLIC_SERVICE_MODE`.

Work is sequenced so the shared repo scaffold lands first, then the frontend and backend tracks
proceed independently, integrating only at the contract layer (`api-contracts.md`, the single
source of truth). Per the design's Testing Strategy, property-based testing is **not** warranted
for pure scaffolding; testing is limited to the selector unit tests, mock-shape smoke tests
(Vitest, single-shot), and the backend `/health` smoke test (pytest). All test sub-tasks are
marked optional (`*`).

## Tasks

- [x] 1. Root monorepo scaffold and secrets hygiene
  - Create the repository root `PixelArt-Trip-Planner/` containing top-level `frontend/`,
    `backend/`, and `docs/` directories.
  - Add a root `README.md` with a project description section, a "run the frontend" section, and
    a "run the backend" section.
  - Add a root `.gitignore` that ignores dependency directories, build output, `.env`, and all
    local `.env*` variants (`.env.local`, `.env.development`, `.env.production`) while explicitly
    NOT ignoring `.env.example`.
  - Add a root `.env.example` that references `frontend/.env.example` and `backend/.env.example`
    by relative path (placeholder, non-real values only).
  - Ensure no `.env` file is committed at the root, in `frontend/`, or in `backend/`.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 12.1, 12.2_

- [x] 2. Initialize the Next.js frontend app (App Router + TS strict + Tailwind)
  - [x] 2.1 Scaffold the Next.js App Router application with React and TypeScript
    - Create `frontend/` as a Next.js App Router app with TypeScript as the source language.
    - Set `"strict": true` in `frontend/tsconfig.json`.
    - Add `frontend/package.json` with `next`, `react`, `react-dom`, `typescript` and dev/test
      tooling entries (Tailwind, ESLint, Prettier, Vitest, RTL) per the design Dependencies.
    - Add `frontend/.env.example` with `NEXT_PUBLIC_SERVICE_MODE` plus placeholder Supabase/API
      URL slots (placeholder values only; no service key).
    - _Requirements: 2.1, 2.2, 1.5, 12.1_

  - [x] 2.2 Configure Tailwind and add thin App Router entry files
    - Add `frontend/postcss.config` + `frontend/tailwind.config.ts` and wire Tailwind so utility
      classes produce styles at build time.
    - Create `app/layout.tsx`, `app/page.tsx` (placeholder landing), and `app/globals.css`
      (Tailwind entry + pixel base), each limited to layout/routing/composition with no business
      logic, no data transformation, and no service/API calls.
    - _Requirements: 2.1, 2.3, 2.8, 2.9_

- [x] 3. Create frontend folder conventions and stage placeholders
  - Create `src/features`, `src/components`, `src/hooks`, `src/lib`, `src/services`, `src/types`,
    and `src/mocks`.
  - Under `src/features`, create the six stage folders `setup`, `discover`, `logistics`, `build`,
    `refine`, `wrap` plus the shared `party-room` folder, each an empty placeholder with a short
    README/top-comment and no feature business logic.
  - _Requirements: 2.4, 2.5, 2.6, 2.7_

- [x] 4. Define pixel design tokens in tailwind.config.ts
  - Define the ten color-role tokens (`bg`, `bg-alt`, `ink`, `primary`, `primary-dark`, `accent`,
    `success`, `warning`, `danger`, `muted`), each mapping to exactly one color value.
  - Define an 8px-multiple spacing scale including 8/16/24/32.
  - Define a `display` (pixel/bitmap) font role and a `body` font role.
  - Expose a pixelated `image-rendering` utility.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.8_

- [x] 5. Add placeholder primitive component shells
  - Create typed shell components under `src/components` for exactly five primitives:
    `PixelButton`, `PixelCard`, `DialogueBox`, `ChatBubble`, `CharacterSprite`.
  - Each exports typed props, compiles under strict mode with zero type errors, and produces
    minimal/no visible output (no full feature implementation), styled only via design tokens.
  - _Requirements: 3.5, 3.6, 3.7_

- [x] 6. Define shared types mirroring api-contracts.md
  - [x] 6.1 Create `src/types` shapes for guest, room/member, message, vote, itinerary/version,
        feedback, export, and stage
    - Add `guest.ts`, `room.ts` (incl. `RoomMember`, `PlanningStage`), `message.ts`
      (`SenderType`, `MessageKind`, `content: unknown`), `vote.ts`, `itinerary.ts`
      (`Itinerary`, `ItineraryVersion`), `feedback.ts`, `export.ts`.
    - Every field named in the contract shape is present; no field absent from the contract is
      added. Contract-optional (`?`) fields declared optional, all others required.
    - Type all ids and timestamps as `string`; use `unknown` (never `any`) for kind-dependent
      content.
    - _Requirements: 5.3, 5.4, 5.5_

  - [x]* 6.2 Add a lightweight contract-shape check for the types
    - Add compile-time assertions (or minimal type tests) confirming the shapes match
      `api-contracts.md` field lists.
    - _Requirements: 5.3, 5.4_

- [x] 7. Define the contract-first service interfaces
  - Create exactly five `*.contract.ts` interfaces in `src/services` — `guest`, `room`, `chat`,
    `vote`, `itinerary` — with method signatures only and no feature/business logic.
  - Type every parameter and return value with a named type from `src/types`; no inline anonymous
    object types, no `any`, and no Supabase/FastAPI types in any exported signature or shape.
  - _Requirements: 5.1, 5.2, 5.6, 5.7_

- [x] 8. Implement the single service selector
  - Create `src/services/index.ts` exposing `ServiceMode`, `ServiceRegistry`, and `getServices()`
    as the only place a concrete Mock or Real implementation is chosen.
  - Read `NEXT_PUBLIC_SERVICE_MODE`; default to `"mock"` when unset/empty/whitespace-only; match
    `"mock"`/`"real"` by exact, case-sensitive comparison; throw a config error naming the invalid
    value and variable on any other value (fail-fast, no registry returned).
  - Guarantee the returned registry exposes the identical interface set/keys regardless of mode.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 9. Implement mock services and fixtures
  - Create `src/services/*.mock.ts` implementing every method of each interface, returning
    contract-shaped fixture data (all required fields present, no extra fields) backed by
    fixtures in `src/mocks`.
  - Implement realtime `subscribe` with a lightweight local emitter that returns an unsubscribe
    function; after unsubscribe returns, deliver zero further callbacks (clean up timers).
  - Wire `buildMockRegistry()` into the selector.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 9.2, 9.5_

- [x] 10. Implement real placeholder services and lib clients
  - Create `src/services/*.api.ts` implementing every interface method as a placeholder that
    throws `NotImplementedError` (no value returned, no Supabase/FastAPI access); wire
    `buildRealRegistry()` into the selector.
  - Add `src/lib/supabaseClient.ts` (anon-key oriented placeholder, no network calls; never holds
    the service key) and `src/lib/apiClient.ts` (placeholder), confining all Supabase/FastAPI
    access to the service layer — zero such calls under `app/`, `src/features`, `src/components`.
  - _Requirements: 7.5, 7.6, 7.7, 13.1, 13.4_

- [x] 11. Checkpoint - frontend scaffold compiles and runs on mock
  - Ensure the app type-checks and builds under strict mode, the primary route renders with
    `mode=mock` and no backend, and no network request is emitted to the backend. Ensure all
    tests pass, ask the user if questions arise.
  - _Requirements: 8.1, 8.2, 8.6, 2.10_

- [x] 12. Initialize the FastAPI backend placeholder
  - [x] 12.1 Scaffold the FastAPI app and Python environment
    - Create `backend/` with `app/__init__.py`, `app/main.py` (FastAPI app + router include),
      `app/api/__init__.py`, `app/api/routes/__init__.py`, `app/core/__init__.py`,
      `app/core/config.py` (settings from env; clear startup error on required-but-missing
      values), and reserved empty `app/schemas/__init__.py`.
    - Add a Python dependency manifest (`pyproject.toml` or `requirements.txt`) declaring
      `fastapi`, `uvicorn`, `pydantic`, `pydantic-settings`, and `pytest`, plus a tooling config
      file, both at the backend root. Exclude LangGraph/AI deps.
    - _Requirements: 4.1, 4.6_

  - [x] 12.2 Implement the health endpoint
    - Add `app/api/routes/health.py` with `GET /health` returning exactly `{"status": "ok"}`
      within 1000 ms; include the router in `app/main.py`.
    - Non-GET methods at `/health` return a 405 client error and never the `{"status": "ok"}` body.
    - _Requirements: 4.2, 4.3, 4.4_

  - [x]* 12.3 Add the /health smoke test (pytest)
    - Add `tests/test_health.py` asserting `GET /health` returns success and the exact body
      `{"status": "ok"}`; optionally assert a non-GET method yields 405.
    - _Requirements: 4.5_

- [x] 13. Add backend env example with service-key ownership
  - Add `backend/.env.example` with placeholder slots including a Supabase service-role key slot,
    documenting that the backend owns privileged/service-role access and AI-related data
    workflows and the frontend never holds the service key. Placeholder values only.
  - _Requirements: 12.1, 12.4, 13.2, 13.3_

- [x] 14. Checkpoint - backend builds and serves /health independently
  - Ensure the backend builds/starts with no frontend present and `GET /health` returns success
    within 1000 ms. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 8.3, 8.4, 8.5, 9.3, 9.4_

- [x]* 15. Frontend selector and mock-shape tests (Vitest, single-shot)
  - Add Vitest + RTL config (run via `vitest --run`).
  - Test `getServices()`: returns mock by default, returns real when flagged, throws on unknown
    mode; assert both registries expose identical keys/interfaces.
  - Add mock-shape smoke tests asserting each mock method returns contract-shaped data and that
    unsubscribe stops further callbacks. Keep minimal and non-speculative.
  - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 7.2, 7.3, 7.4, 9.1_

- [x] 16. Create the docs/ structure
  - Add `docs/README.md` (index) with navigable links to the other three docs; `docs/architecture.md`
    (links back to `.kiro/steering` as canonical); `docs/getting-started.md` (how the three devs
    set up frontend + backend); `docs/contracts.md` naming `api-contracts.md` as the single source
    of truth with a navigable link to it.
  - _Requirements: 11.1, 11.2, 11.3_

- [x] 17. Verify secrets hygiene
  - Confirm only `.env.example` files (placeholder values) are committed and no `.env`/local
    `.env*` variant is tracked; confirm `.gitignore` excludes `.env*` but not `.env.example`;
    confirm the frontend bundle/committed files exclude the Supabase service key.
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 18. Reconcile steering docs to the mock-inclusive service model (documentation only)
  - Update `frontend-architecture.md` and `development-rules.md` so both describe two
    interchangeable service implementations (mock + real) selected at exactly one point, and
    document the `src/mocks` location — while keeping `api-contracts.md` as the single source of
    truth with no conflicting contract statements. This is a documentation change, not code.
  - _Requirements: 11.4, 11.5, 11.6_

- [x] 19. Final checkpoint - foundation complete and scope guards hold
  - Verify both parts build/run independently, integrate only at the contract layer, and that the
    scope guards hold: no auth flows/fields, no AI/LangGraph, no real Supabase calls, no business
    logic beyond the selector + contract-shaped mocks. Ensure all tests pass, ask the user if
    questions arise.
  - _Requirements: 8.5, 9.4, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP; per the design's
  Testing Strategy, property-based tests are intentionally excluded at foundation stage and only
  the selector unit tests, mock-shape smoke tests, and backend `/health` smoke test are included.
- Each task references specific requirement sub-clauses for traceability.
- Checkpoints ensure incremental validation at natural breaks (frontend on mock, backend
  standalone, final scope-guard verification).
- `api-contracts.md` is the single source of truth; all `src/types` and mock shapes derive from it.
- Task 18 is documentation-only (steering reconciliation) and involves no code.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "12.1", "13", "16", "18"] },
    { "id": 2, "tasks": ["2.2", "3", "6.1", "12.2"] },
    { "id": 3, "tasks": ["4", "5", "6.2", "7", "12.3"] },
    { "id": 4, "tasks": ["8"] },
    { "id": 5, "tasks": ["9", "10"] },
    { "id": 6, "tasks": ["15", "17"] }
  ]
}
```
