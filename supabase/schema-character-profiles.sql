-- Additive migration: character_profiles table
-- No DROP TABLE, DROP COLUMN, or ALTER COLUMN TYPE statements.

CREATE TABLE IF NOT EXISTS character_profiles (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text        NOT NULL,
  room_id          uuid        NOT NULL REFERENCES trip_rooms(id) ON DELETE CASCADE,
  display_name     text        NOT NULL,
  budget_level     text        NOT NULL CHECK (budget_level IN ('low', 'medium', 'high')),
  travel_style     text        NOT NULL CHECK (travel_style IN ('leader', 'planner', 'follower', 'chill', 'adventurer')),
  trip_interests   text[]      NOT NULL DEFAULT '{}',
  avatar_config    jsonb       NOT NULL DEFAULT '{}',
  generated_persona_name text  NOT NULL DEFAULT '',
  planning_weights jsonb       NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, room_id)
);

CREATE INDEX IF NOT EXISTS character_profiles_room_id_idx ON character_profiles (room_id);
