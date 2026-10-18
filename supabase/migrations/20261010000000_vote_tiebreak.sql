-- AI-assisted tiebreak for destination and flight votes (leader decides).
--
-- When a vote ends in a tie, the backend no longer auto-picks the first option. It marks
-- the session as waiting for a tiebreak, an AI "tiebreak" run posts advice for the room
-- owner, and the owner picks the winner (POST /votes/{voteSessionId}/break-tie).
-- Additive only; safe to run on a database that already has votes.

-- 1. New agent run type.
ALTER TYPE agent_run_type ADD VALUE IF NOT EXISTS 'tiebreak';

-- 2. Tie state on vote sessions (streams over Realtime with the rest of the row).
--    tie_pending     true while the session is tied and waiting for the owner's pick
--    tie_option_ids  the ids of the tied options (the only valid picks)
--    category        'destination' or 'flight'; recorded when the tie is detected
ALTER TABLE vote_sessions
  ADD COLUMN IF NOT EXISTS tie_pending BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tie_option_ids JSONB,
  ADD COLUMN IF NOT EXISTS category TEXT
    CHECK (category IS NULL OR category IN ('destination', 'flight'));

-- A tie can only be pending on an open session.
ALTER TABLE vote_sessions
  DROP CONSTRAINT IF EXISTS vote_sessions_tie_pending_only_when_open;
ALTER TABLE vote_sessions
  ADD CONSTRAINT vote_sessions_tie_pending_only_when_open
  CHECK (NOT tie_pending OR status = 'open');
