---
inclusion: fileMatch
fileMatchPattern: '{app,src,components,features,hooks,lib,services,types}/**'
---

# Frontend Architecture

Stack: Next.js (App Router) + React + TypeScript, styled with Tailwind CSS. No additional
frameworks unless a concrete need is agreed by the team.

## Next.js Structure

Use the App Router. Suggested top-level layout:

```
app/                # routes, layouts, pages (App Router)
src/
  features/         # feature-based modules (see below)
  components/       # shared, reusable UI primitives (pixel design system)
  hooks/            # shared React hooks
  lib/              # framework-agnostic utilities, clients (e.g. supabase client)
  services/         # data access layer (service interfaces + mock + real implementations + selector)
  mocks/            # mock fixture data consumed by the mock service implementations
  types/            # shared TypeScript types and data models
```

- Route files stay thin. They compose feature components; they do not hold business logic.
- Server vs. client components: default to server components; mark `"use client"` only
  when interactivity, state, or browser APIs are required.

## Component Organisation

Two tiers:
- **Shared components** (`src/components/`) — reusable, theme-level primitives with no
  feature-specific logic (buttons, cards, dialogue boxes, character sprite, chat bubble).
- **Feature components** (`src/features/<feature>/components/`) — screens and widgets
  specific to one feature.

## Feature-Based Architecture

Group code by feature, not by file type. Each feature is self-contained:

```
src/features/<feature>/
  components/       # UI for this feature
  hooks/            # feature-specific hooks
  services/         # feature data access (uses the service interface)
  types.ts          # feature-local types
```

Expected features map to the six-stage journey (see `product.md` / `system-workflow.md`):
`setup` (guest-name entry, trip create/join + invite, character creation, preferences),
`discover` (destination recommendations + voting), `logistics` (flight options + voting),
`build` (itinerary quest log), `refine` (feedback, versions, approval), and `wrap` (final
summary + export). The shared `party-room` surface (roster, chat, NPC guide, progress)
hosts the DISCOVER→WRAP stages. There is no auth feature — users enter as guests.

Cross-feature sharing goes through `src/components`, `src/hooks`, `src/lib`, `src/types`.

## Frontend State Management Approach

Prefer the simplest tool that fits:
- Local component state (`useState`, `useReducer`) for UI-local concerns.
- React Context for small, cross-cutting state (e.g. current user, current party room).
- Server state (data fetching, caching, realtime) lives in the service layer and hooks.
- Do not introduce a global state library unless a clear, agreed need arises.

## Service Layer Approach

Frontend and backend are built in parallel by different team members. Both sides work
against the agreed API contracts (`api-contracts.md`), so the frontend integrates with the
real backend as each part lands. Because the frontend cannot wait on live endpoints, the
service layer follows a **mock-inclusive model**: every service interface has two
interchangeable implementations selected at a single point.

- Every data interaction goes through a **service interface** (a TypeScript type/contract)
  whose method signatures and returned shapes match `api-contracts.md`. `api-contracts.md`
  remains the single source of truth for those shapes; the interfaces and `src/types` are
  its TypeScript expression and never redefine or contradict it.
- Each interface has **two interchangeable implementations**:
  - **Mock services** (`src/services/*.mock.ts`) that return contract-shaped fixture data
    from `src/mocks`, so the frontend runs with no backend.
  - **Real services** (`src/services/*.api.ts`) that call Supabase and/or FastAPI.
  Both implementations satisfy the identical service interface, so they are swappable
  without any UI change.
- **One selection point.** A single selector (`getServices()` in `src/services/index.ts`)
  is the only place a concrete implementation is chosen. It reads the
  `NEXT_PUBLIC_SERVICE_MODE` environment flag (`"mock"` — the default — or `"real"`) and
  returns the matching set of implementations.
- The service interface is the single integration point: because UI depends only on the
  interface and the selector, switching from mock to real is a configuration change (flip
  `NEXT_PUBLIC_SERVICE_MODE`), never a UI change, and backend changes stay isolated to the
  service layer.

## Separation Between UI and API Layer

Strict layering:
- **UI layer** (components, hooks): renders state, raises events. Never calls Supabase or
  FastAPI directly.
- **Service layer** (`src/services/`): the only place that talks to Supabase or FastAPI.
  Exposes typed methods defined by the service interfaces, implemented by both the mock and
  real implementations and chosen through the single `getServices()` selector. UI imports
  the interface/selector only — never a concrete `*.mock.ts` or `*.api.ts` file directly.
- **Mock fixtures** (`src/mocks/`): the contract-shaped fixture data the mock
  implementations return; not imported by the UI directly.
- **Types layer** (`src/types/`): shared data models used by both layers.

This boundary keeps backend integration isolated to the service layer, so parallel
frontend/backend work integrates without UI restructuring. See `api-contracts.md` for the
contract shapes the service layer must satisfy — it is the single source of truth, and the
shapes here must not diverge from it.
