-- Per-member stage readiness for the multiplayer "everyone acts, then advance" flow.
--
-- The frontend already subscribes to room_members over Realtime (the live roster), and
-- room_members is anon-readable (20260926000000_anon_room_read_policies.sql). Mirroring a
-- NON-SENSITIVE "ready for the current stage" flag onto that row lets every client see
-- "waiting for X of N party members" live, WITHOUT exposing travel_preferences (which
-- stays backend-only because it holds budget). The backend (service role) is the only
-- writer, consistent with the guest/demo trust model.
--
-- Additive and idempotent; safe to run on a database that already has rooms.

-- ---------------------------------------------------------------------------
-- 1. Readiness flag on the anon-readable members table.
--    true  = this member has completed the party's CURRENT planning stage
--            (saved their character in SETUP, picked a destination in DISCOVER, ...).
--    Reset to false for every member when the trip advances to the next stage, so each
--    stage starts fresh. Existing members default to not-ready.
-- ---------------------------------------------------------------------------
ALTER TABLE room_members
  ADD COLUMN IF NOT EXISTS stage_ready BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. Realtime change feeds for the tables the party watches live.
--    RLS SELECT policies alone do not stream changes; the table must also be in the
--    supabase_realtime publication. room_members already streams (the roster works);
--    adding party_rooms and trips lets clients react to planning_stage / status changes
--    (SETUP -> DISCOVER) the moment the backend advances them.
--    Guarded so re-running does not error if a table is already published.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'room_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE room_members;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'party_rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE party_rooms;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trips'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE trips;
  END IF;
END
$$;

-- Readiness is written only by the backend (service role). Keep the client write ban
-- that the earlier migrations established explicit for the new column too.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON room_members FROM anon, authenticated;
