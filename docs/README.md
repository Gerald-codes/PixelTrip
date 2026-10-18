# PixelArt Trip Planner — Documentation

Welcome, adventurers. This is the documentation index for the **PixelArt Trip Planner**
monorepo. It points you to the handful of docs you need to get oriented and start building.

The canonical, authoritative project rules live in [`.kiro/steering`](../.kiro/steering).
The documents here are a navigable entry point that link back to that steering rather than
duplicating it.

## Documents

- [Architecture](./architecture.md) — how the monorepo fits together and where the
  canonical steering lives.
- [Getting Started](./getting-started.md) — how the three developers set up the frontend
  and backend and work in parallel.
- [Contracts](./contracts.md) — where the API contract single source of truth lives and
  how to use it.
- [Supabase Access Boundary](./SUPABASE_ACCESS_BOUNDARY.md) — which writes must go through
  FastAPI and what the frontend may read or subscribe to directly.

## Repository layout at a glance

```
PixelArt-Trip-Planner/
├── frontend/   # Next.js (App Router) + React + TypeScript + Tailwind
├── backend/    # FastAPI + Python placeholder
└── docs/       # you are here
```

For anything not covered here, defer to the steering files under
[`.kiro/steering`](../.kiro/steering).
