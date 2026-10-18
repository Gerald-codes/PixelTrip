-- PixelTrip - Supabase/PostgreSQL initial schema
-- Source of truth: .kiro/steering/supabase-architecture.md
-- Guest/demo trust model: no Supabase Auth, no auth.users references.
-- Identity rule: room + normalized display name -> room member.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE planning_stage AS ENUM ('setup','discover','logistics','build','refine','wrap');
CREATE TYPE room_status AS ENUM ('active','finalised','cancelled');
-- Application-state progression (see system-workflow.md "Application States").
CREATE TYPE trip_status AS ENUM (
  'trip_created','group_formed','preferences_collected','destination_selected',
  'flight_selected','itinerary_generated','feedback_collected','refinement_completed',
  'trip_approved','trip_exported'
);
CREATE TYPE member_role AS ENUM ('owner','member');
CREATE TYPE sender_type AS ENUM ('user','ai');
CREATE TYPE message_kind AS ENUM ('text','recommendation','vote','summary');
CREATE TYPE vote_session_status AS ENUM ('open','closed');
CREATE TYPE selection_kind AS ENUM ('destination','flight');
CREATE TYPE itinerary_source AS ENUM ('build','refine');
CREATE TYPE itinerary_status AS ENUM ('proposed','approved','rejected','superseded');
CREATE TYPE feedback_status AS ENUM ('open','addressed');
CREATE TYPE agent_run_type AS ENUM ('discovery','logistics','itinerary','refinement');
CREATE TYPE agent_run_status AS ENUM ('pending','running','completed','failed');

CREATE TABLE guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 50),
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE party_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL UNIQUE CHECK (room_code ~ '^[A-Z0-9]{4,12}$'),
  name TEXT NOT NULL,
  status room_status NOT NULL DEFAULT 'active',
  planning_stage planning_stage NOT NULL DEFAULT 'setup',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 50),
  -- Whitespace-collapsed, trimmed, lower-cased display name used for identity matching
  -- ("Gerald", "gerald" and " GERald " are the same member). Must match
  -- normalize_display_name() in the backend: " ".join(name.split()).lower().
  normalized_name TEXT GENERATED ALWAYS AS (
    lower(btrim(regexp_replace(display_name, '\s+', ' ', 'g')))
  ) STORED,
  role member_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, normalized_name)
);

-- At most one owner membership per room.
CREATE UNIQUE INDEX uq_room_members_one_owner ON room_members(room_id) WHERE role = 'owner';

CREATE TABLE characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL UNIQUE REFERENCES room_members(id) ON DELETE CASCADE,
  appearance JSONB NOT NULL DEFAULT '{}'::JSONB,
  sprite_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE travel_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL UNIQUE REFERENCES room_members(id) ON DELETE CASCADE,
  available_dates JSONB NOT NULL DEFAULT '[]'::JSONB,
  destinations JSONB NOT NULL DEFAULT '[]'::JSONB,
  travel_style TEXT,
  budget NUMERIC(12,2) CHECK (budget IS NULL OR budget >= 0),
  interests JSONB NOT NULL DEFAULT '[]'::JSONB,
  activities JSONB NOT NULL DEFAULT '[]'::JSONB,
  hard_constraints JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  sender_type sender_type NOT NULL,
  sender_member_id UUID REFERENCES room_members(id) ON DELETE SET NULL,
  kind message_kind NOT NULL DEFAULT 'text',
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- AI messages never carry a member sender.
  CHECK (sender_type = 'user' OR sender_member_id IS NULL)
);

CREATE TABLE vote_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::JSONB,
  status vote_session_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- option_id refers to an id inside vote_sessions.options; the service validates it.
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vote_session_id UUID NOT NULL REFERENCES vote_sessions(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vote_session_id, member_id)
);

CREATE TABLE selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES party_rooms(id) ON DELETE CASCADE,
  kind selection_kind NOT NULL,
  data JSONB NOT NULL,
  vote_session_id UUID REFERENCES vote_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, kind)
);

CREATE TABLE trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL UNIQUE REFERENCES party_rooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT,
  status trip_status NOT NULL DEFAULT 'trip_created',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE itinerary_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  source itinerary_source NOT NULL,
  status itinerary_status NOT NULL DEFAULT 'proposed',
  itinerary JSONB NOT NULL,
  change_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trip_id, version),
  -- Target for the composite FK in feedback (version must belong to the same trip).
  UNIQUE (id, trip_id),
  -- Version 1 comes from BUILD; later versions come from REFINE.
  CHECK ((version = 1) = (source = 'build'))
);

-- Only one approved version per trip.
CREATE UNIQUE INDEX uq_itinerary_versions_one_approved
  ON itinerary_versions(trip_id) WHERE status = 'approved';

CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  itinerary_version_id UUID NOT NULL,
  member_id UUID NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  target JSONB NOT NULL DEFAULT '{}'::JSONB,
  comment TEXT NOT NULL CHECK (char_length(btrim(comment)) > 0),
  status feedback_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (itinerary_version_id, trip_id)
    REFERENCES itinerary_versions(id, trip_id) ON DELETE CASCADE
);

CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  created_by_member_id UUID REFERENCES room_members(id) ON DELETE SET NULL,
  run_type agent_run_type NOT NULL,
  -- Itinerary version number the run started from (0 = no version yet).
  base_version INTEGER NOT NULL DEFAULT 0 CHECK (base_version >= 0),
  status agent_run_status NOT NULL DEFAULT 'pending',
  idempotency_key TEXT UNIQUE,
  result_version_id UUID REFERENCES itinerary_versions(id) ON DELETE SET NULL,
  iteration_count INTEGER NOT NULL DEFAULT 0 CHECK (iteration_count >= 0),
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_room_members_room ON room_members(room_id);
CREATE INDEX idx_room_members_guest ON room_members(guest_id);
CREATE INDEX idx_messages_room ON messages(room_id, created_at);
CREATE INDEX idx_vote_sessions_room ON vote_sessions(room_id);
CREATE INDEX idx_votes_member ON votes(member_id);
CREATE INDEX idx_itinerary_versions_trip ON itinerary_versions(trip_id, version DESC);
CREATE INDEX idx_feedback_itinerary ON feedback(itinerary_version_id);
CREATE INDEX idx_feedback_trip ON feedback(trip_id);
CREATE INDEX idx_agent_runs_trip ON agent_runs(trip_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'guests','party_rooms','room_members','characters','travel_preferences',
    'vote_sessions','votes','selections','trips','itinerary_versions','feedback','agent_runs'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END;
$$;

-- RLS is enabled everywhere. With no policies, only the service role (FastAPI) can
-- read/write. Anon read/realtime policies are added once the MVP access needs are agreed.
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE travel_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE vote_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE itinerary_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;

ALTER PUBLICATION supabase_realtime ADD TABLE
  party_rooms, room_members, messages, vote_sessions, votes,
  selections, trips, itinerary_versions, feedback;

-- TODO before production:
-- 1. Add anon read/realtime RLS policies scoped to the MVP's room-oriented access.
-- 2. Confirm one-vote vs ranked/multi-select voting.
-- 3. Confirm group budget vs per-person budget semantics.
-- 4. Decide whether hotels are part of MVP.
-- 5. Freeze TripContext and AgentProposal Pydantic contracts.
