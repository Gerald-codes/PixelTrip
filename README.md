# PixelArt Trip Planner

An AI-powered collaborative travel planning web app with an 8-bit retro RPG theme.
Planning a trip should feel less like filling out forms and more like a party of
adventurers deciding on their next quest together. Group members are a **party**,
planning is a **quest**, the AI is an in-world **NPC** guide, and the final plan is
an **adventure summary**.

There is no account sign-up or sign-in: users enter with a lightweight guest name
and go straight into the experience.

## Monorepo Layout

This repository is a monorepo with three independently deployable parts:

```
.
├── frontend/   # Next.js (App Router) + React + TypeScript + Tailwind app
├── backend/    # FastAPI + Python placeholder service
└── docs/       # shared documentation
```

The frontend and backend share nothing at runtime except the agreed HTTP contract
described in `.kiro/steering/api-contracts.md` (the single source of truth). This
keeps both parts independently deployable so the team can work in parallel.

## Run the Frontend

The frontend is a Next.js App Router application under `frontend/`. It develops
against mock services by default, so it runs with no backend present.

```bash
cd frontend
cp .env.example .env.local   # then fill in placeholder values
npm install
npm run dev
```

The dev server starts on http://localhost:3000. Service selection is controlled by
`NEXT_PUBLIC_SERVICE_MODE` (`mock` by default, `real` for backend integration).

## Run the Backend

The backend is a FastAPI application under `backend/`. It runs standalone with no
frontend present and exposes a `GET /health` check.

```bash
cd backend
cp .env.example .env         # then fill in placeholder values
python -m venv .venv
# Windows:  .venv\Scripts\activate
# Unix:     source .venv/bin/activate
pip install -e .             # or: pip install -r requirements.txt
uvicorn app.main:app --reload
```

The server starts on http://localhost:8000. Verify it with `GET /health`, which
returns `{"status": "ok"}`.

Add to redeploy

## Documentation

See [`docs/`](./docs) for the documentation index, architecture reference,
getting-started guide, and contracts reference.

For the prepared **DemoAlice / DemoBob** two-device walkthrough, see
[`docs/PREPARED_DEMO.md`](./docs/PREPARED_DEMO.md). Apply its database migration before
deploying the demo code; ordinary rooms continue to use the live planner.
