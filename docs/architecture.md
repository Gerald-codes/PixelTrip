# Architecture

This page is a short orientation to the PixelArt Trip Planner architecture. It is **not**
the source of truth. The canonical architecture and conventions live in the steering
directory: [`.kiro/steering`](../.kiro/steering). When this page and steering disagree,
steering wins.

## Canonical steering references

- [Product vision](../.kiro/steering/product.md) — the RPG party-adventure framing and the
  six-stage user journey.
- [Frontend architecture](../.kiro/steering/frontend-architecture.md) — folder conventions,
  the service layer, and the mock/real implementation model.
- [Development rules](../.kiro/steering/development-rules.md) — coding standards, file
  organisation, reusable components, and testing expectations.
- [API contracts](../.kiro/steering/api-contracts.md) — the single source of truth for all
  shared data shapes (see also [Contracts](./contracts.md)).
- [Pixel design system](../.kiro/steering/pixel-design-system.md) — design tokens and the
  8-bit visual language.
- [Supabase architecture](../.kiro/steering/supabase-architecture.md) — data, realtime,
  storage, and the frontend/backend ownership split.
- [AI orchestration](../.kiro/steering/ai-orchestration.md) — the NPC guide and LangGraph
  workflow (backend concern; not part of the foundation).
- [System workflow](../.kiro/steering/system-workflow.md) — how the pieces move through the
  stages together.

## Monorepo shape

The repository is a monorepo with three independently deployable parts. The two runnable
parts share nothing at runtime except the agreed data shapes in
[`api-contracts.md`](../.kiro/steering/api-contracts.md).

```
PixelArt-Trip-Planner/
├── frontend/   # Next.js App Router app (independently deployable)
├── backend/    # FastAPI app placeholder (independently deployable)
└── docs/       # documentation
```

## The contract-first service layer

The defining decision of the frontend is a **contract-first service layer** with a single
mock/real selection point. The UI depends only on typed service interfaces whose shapes are
dictated by [`api-contracts.md`](../.kiro/steering/api-contracts.md). Two implementations
exist behind one selector chosen by an environment flag (`NEXT_PUBLIC_SERVICE_MODE`):

- **mock** — in-memory, contract-shaped fixtures for independent frontend development.
- **real** — placeholder backend/Supabase integration (raises `NotImplementedError` in the
  foundation).

Switching from mock to real is a configuration change, never a UI change. For the precise
rules, read [frontend-architecture.md](../.kiro/steering/frontend-architecture.md).

## Team boundary

- Frontend owns the app experience, UI, Supabase anon-client integration, and the API
  integration layer.
- Backend owns FastAPI, LangGraph orchestration, AI workflows, and privileged Supabase
  (service-role) access.
- Both sides coordinate only at the contract layer
  ([`api-contracts.md`](../.kiro/steering/api-contracts.md)).
