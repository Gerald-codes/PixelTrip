# Contracts

## Single source of truth

[`api-contracts.md`](../.kiro/steering/api-contracts.md) is the **single source of truth**
for all API contracts and shared data shapes in PixelArt Trip Planner. Every frontend type
and every backend model derives from it. When any other document (including this one) and
`api-contracts.md` disagree, `api-contracts.md` wins.

> **Source of truth:** [`../.kiro/steering/api-contracts.md`](../.kiro/steering/api-contracts.md)

## How the contract is used

- **Frontend** — the typed service interfaces in `src/services/*.contract.ts` and the shapes
  in `src/types` mirror the contract. The UI depends only on these types, never on
  Supabase- or FastAPI-specific types. See
  [frontend-architecture.md](../.kiro/steering/frontend-architecture.md).
- **Backend** — request/response models under `app/schemas` mirror the contract.
- **Mock services** — in-memory fixtures must return contract-shaped data (all required
  fields present, no extra fields), so switching from mock to real is a configuration change
  only.

## Changing a contract

Any change to a shared data shape starts in
[`api-contracts.md`](../.kiro/steering/api-contracts.md) first. Only after the contract is
updated do the frontend types and backend models follow. This keeps the frontend and backend
in agreement while they are built in parallel, since the contract layer is their only
coordination point.

## Related

- [Architecture](./architecture.md) — where the contract fits in the overall design.
- [Getting Started](./getting-started.md) — parallel development against the contract.
