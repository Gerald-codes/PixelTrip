# Getting Started

This guide gets the three developers (one frontend, two backend) set up and running in
parallel. The frontend and backend are independently deployable — neither waits on the
other. They coordinate only at the contract layer
([`api-contracts.md`](../.kiro/steering/api-contracts.md)).

## Prerequisites

- Node.js (LTS) and a package manager (npm / pnpm / yarn) for the frontend.
- Python 3.11+ and a virtual environment tool for the backend.
- Git.

## Clone and configure

```bash
git clone <repo-url>
cd PixelArt-Trip-Planner
```

Copy the example env files and fill in placeholder values. Never commit a real `.env` file —
only `.env.example` files are tracked.

```bash
cp .env.example .env                     # root reference (points to per-part examples)
cp frontend/.env.example frontend/.env   # frontend env
cp backend/.env.example backend/.env     # backend env
```

## Frontend setup (frontend developer)

The frontend runs fully against **mock** services, so no backend is required to build the UI.

```bash
cd frontend
npm install
npm run dev
```

- `NEXT_PUBLIC_SERVICE_MODE` defaults to `mock` when unset. In `mock` mode the app serves
  all data from local fixtures and makes no calls to the backend.
- When real endpoints land, flip `NEXT_PUBLIC_SERVICE_MODE=real` in `frontend/.env` — this
  is the only change needed to switch backends. No component edits.

See [frontend-architecture.md](../.kiro/steering/frontend-architecture.md) for folder
conventions and the service layer, and [development-rules.md](../.kiro/steering/development-rules.md)
for coding standards.

## Backend setup (backend developers)

The backend runs standalone and exposes a `/health` check.

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate
pip install -e .            # or: pip install -r requirements.txt
uvicorn app.main:app --reload
```

Verify it is up:

```bash
curl http://localhost:8000/health
# -> {"status": "ok"}
```

Backend developers extend FastAPI and build response models under `app/schemas` against the
contract. Privileged Supabase (service-role) access and AI workflows belong to the backend
boundary — the frontend never holds the service key. See
[supabase-architecture.md](../.kiro/steering/supabase-architecture.md).

## Working in parallel

- Build against the contract, not against each other's code. No frontend file imports a
  backend file and vice versa.
- The single integration point is [`api-contracts.md`](../.kiro/steering/api-contracts.md).
  Any shared-shape change starts there first. See [Contracts](./contracts.md).
- Use feature branches and open pull requests for review, per
  [development-rules.md](../.kiro/steering/development-rules.md).
