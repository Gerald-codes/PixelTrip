-- The step an AI run is on, so the party sees honest progress ("Searching for
-- flights…") instead of a generic spinner. Written by the backend only; read via
-- GET /trips/{tripId}/runs/latest (agent_runs stays backend-only, no anon access).
-- A failed run keeps the step it failed on, which tells the UI what went wrong.
-- Additive only; safe to run on a database that already has runs.
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS phase TEXT;
