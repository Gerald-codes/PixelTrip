-- PixelTrip — Additive migration: room_profiles
--
-- This is an ADDITIVE migration. It is safe to apply on top of the existing
-- schema (supabase/schema.sql) without dropping data — it only creates a new
-- table. Run it once in the Supabase SQL editor (or via the CLI).
--
-- Persists the AI-generated GroupProfile (see lib/types.ts) so the UI can
-- display the most recently generated profile for a room without re-running
-- the agent. One row per room (unique on room_id); the agent route upserts
-- on room_id, so re-running the agent replaces the prior profile.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

create table if not exists room_profiles (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null unique references trip_rooms (id) on delete cascade,
  profile    jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists room_profiles_room_id_idx on room_profiles (room_id);
