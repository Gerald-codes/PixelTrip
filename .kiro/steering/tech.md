# PixelTrip — Tech Stack & Conventions

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript (strict) |
| UI | React + Tailwind CSS |
| Backend | Next.js API Routes (serverless) |
| Database | Supabase (PostgreSQL) |
| Realtime | Supabase Realtime (presence + broadcast) |
| AI | kiro / AWS Bedrock API |
| Auth | None — display name only, `userId` is a client-generated UUID in `localStorage` |
| Flight data | Mocked / seeded JSON (no live flight API for MVP) |
| Export | Client-side plain text / Markdown copy |

## Hard Rules

- **All AI calls are server-side only.** Agents are invoked exclusively from `/api/agents/*` routes. The browser must never call the Bedrock API directly or hold AI credentials.
- **Agents return JSON only.** Every agent prompt enforces JSON-only output with no preamble. Routes parse the response, retry once on parse failure, and return `{ error, retryable: true }` with a 500 on failure.
- **No authentication.** Identity is a `localStorage` UUID plus a display name. Do not add login, sessions, or password flows.
- **Host-gated stage transitions.** Only `hostUserId` may advance the room stage. `/api/rooms/[id]/stage` verifies `requestingUserId === hostUserId` before advancing.
- **Stage-scoped agents.** Each agent route verifies the room is in the correct stage before running.
- **Duplicate votes blocked at the DB level** via a unique constraint on `votes (room_id, user_id, vote_type)`.

## Environment

- Secrets live in `.env.local` (gitignored); document every key in `.env.example`.
- Required keys: Supabase URL + anon/service keys, and the kiro/AWS Bedrock credentials.
- Never commit secrets or echo their values in logs or responses.

## Conventions

- Shared types live in `lib/types.ts` and are imported by both client and server — do not redefine model shapes inline.
- The Supabase client helper is `lib/supabase.ts`; the Bedrock wrapper is `lib/bedrock.ts`.
- Prefer mocked/seeded data and AI-estimated values (weather, crowd, price) over live external APIs for the MVP to reduce demo risk.
- Use exact/pinned dependency versions.

## Commands

This is a Next.js project; use the standard scripts once scaffolded:
- `npm run dev` — local dev server (run manually, do not launch from automated steps)
- `npm run build` — production build / type-check
- `npm run lint` — lint
