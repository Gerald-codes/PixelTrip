# Development Rules

Shared conventions for the PixelArt Trip Planner frontend. Keep the codebase consistent
so three people can work in parallel.

## Coding Standards

- TypeScript everywhere; `strict` mode on. Avoid `any` — prefer precise types or `unknown`.
- All shared data shapes live in `src/types` and match the contracts in `api-contracts.md`.
- Keep functions and components small and single-purpose.
- No direct Supabase / FastAPI calls in UI. Data access goes through `src/services`
  (see `frontend-architecture.md`). The service layer is mock-inclusive: UI depends only on
  the service interfaces and the single `getServices()` selector, never on a concrete mock
  or real implementation.
- Handle loading and error states explicitly; no silent failures.
- Lint and format before committing (project ESLint + Prettier config once established).

## File Organisation Rules

- Feature-based structure: group by feature under `src/features/<feature>`, not by type.
- Shared, reusable UI lives in `src/components`; shared hooks in `src/hooks`; utilities in
  `src/lib`; types in `src/types`; mock fixture data in `src/mocks` (consumed only by the
  mock service implementations, never imported by the UI).
- One primary component per file. File name matches the component (PascalCase for
  components, camelCase for hooks/utils).
- Route files stay thin and compose feature components.

## Reusable Component Requirements

- UI primitives (buttons, cards, dialogue boxes, chat bubble, character sprite) come from
  the pixel design system in `src/components` — do not re-implement them per feature.
- Components are presentational where possible: take data via props, raise events via
  callbacks, avoid embedding data-fetching.
- Style with Tailwind CSS using the design-system theme tokens (`pixel-design-system.md`),
  never raw hex or arbitrary magic values.
- New shared primitive? Add it to `src/components` with clear props, don't fork a copy.

## Service Layer (Mock-Inclusive Model)

- Each service interface has two interchangeable implementations: a **mock**
  (`src/services/*.mock.ts`, returning contract-shaped fixtures from `src/mocks`) and a
  **real** one (`src/services/*.api.ts`, calling Supabase/FastAPI). Both must satisfy the
  same interface so they are swappable.
- Mock services are the initial development path — build the UI against them first — and
  must implement every interface method the real services do, with matching shapes.
- Implementations are selected at exactly one point: `getServices()` in
  `src/services/index.ts`, driven by the `NEXT_PUBLIC_SERVICE_MODE` flag (`"mock"` default,
  or `"real"`). Do not select or import a concrete implementation anywhere else.
- `api-contracts.md` is the single source of truth for all data shapes. Mock fixtures,
  `src/types`, and both implementations derive from it and must not contradict it; any shape
  change starts in `api-contracts.md`.

## Testing Expectations

- Do not add tests speculatively. Write tests when adding non-trivial logic or fixing bugs.
- Prioritize testing service-layer logic (the API boundary), including the selector and that
  mock responses are contract-shaped.
- Once a test framework is agreed, run relevant tests before merging.
- Both mock and real service-layer implementations must stay in sync with the contracts in
  `api-contracts.md`.

## Documentation Requirements

- Each feature folder has a short README or top-comment: what it does and its key pieces.
- Document any deviation from these steering rules and why.
- Keep the service interfaces documented — they are the frontend/backend agreement.
- Update the relevant steering file when a shared convention changes.

## Git Workflow Recommendations

- Work on feature branches; do not commit directly to the main branch.
- Small, focused commits with clear messages (imperative mood, e.g. "add voting card").
- Open a pull request for review; describe what changed and how it was verified.
- Stage specific files rather than everything; never commit secrets or `.env` files.
- Keep frontend and backend changes coordinated only at the contract layer
  (`api-contracts.md`); otherwise both sides move independently.
