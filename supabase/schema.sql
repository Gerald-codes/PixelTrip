-- PixelTrip — Supabase schema
--
-- Column names use snake_case and map to the camelCase fields defined in
-- lib/types.ts. Nested / array shapes are stored as JSONB. RoomStage values
-- gate trip_rooms.current_stage via a CHECK constraint (defaults to 'LOBBY').
--
-- This file is idempotent: it drops existing tables before recreating them.
-- Run it in the Supabase SQL editor (or via the CLI) to provision the database.

-- Extensions ---------------------------------------------------------------
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- Drop in dependency order -------------------------------------------------
drop table if exists conflict_resolutions cascade;
drop table if exists itinerary_feedback cascade;
drop table if exists itineraries cascade;
drop table if exists activity_preferences cascade;
drop table if exists votes cascade;
drop table if exists destination_suggestions cascade;
drop table if exists destination_preferences cascade;
drop table if exists availability cascade;
drop table if exists trip_rooms cascade;
drop table if exists personas cascade;
drop table if exists users cascade;

-- personas -----------------------------------------------------------------
-- Maps to Persona. planningWeight + interests are JSONB.
create table personas (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  avatar_image    text not null,
  budget_level    text not null check (budget_level in ('low', 'medium', 'high')),
  travel_pace     text not null check (travel_pace in ('slow', 'moderate', 'fast')),
  interests       jsonb not null default '[]'::jsonb,
  flexibility     text not null check (flexibility in ('rigid', 'moderate', 'flexible')),
  decision_style  text not null,
  description     text not null,
  planning_weight jsonb not null default '{}'::jsonb
);

-- users --------------------------------------------------------------------
-- Maps to User. id is a client-generated UUID (no auth).
create table users (
  id                 uuid primary key,
  display_name       text not null,
  room_id            uuid not null,
  selected_persona_id uuid references personas (id) on delete set null
);

create index users_room_id_idx on users (room_id);

-- trip_rooms ---------------------------------------------------------------
-- Maps to TripRoom. current_stage allowed set = RoomStage enum values.
create table trip_rooms (
  id                    uuid primary key default gen_random_uuid(),
  room_code             text not null unique,
  host_user_id          uuid not null,
  current_stage         text not null default 'LOBBY' check (current_stage in (
                          'LOBBY', 'PERSONA', 'AVAILABILITY', 'GROUP_PROFILE',
                          'DESTINATIONS', 'DESTINATION_VOTE', 'FLIGHTS',
                          'FLIGHT_VOTE', 'ACTIVITIES', 'ITINERARY', 'FEEDBACK',
                          'NEGOTIATION', 'FINAL')),
  selected_destination  text,
  selected_flight_option text check (selected_flight_option in ('budget', 'comfort', 'best_value')),
  current_itinerary_id  uuid,
  final_itinerary_id    uuid,
  created_at            timestamptz not null default now()
);

-- availability -------------------------------------------------------------
-- Maps to Availability. One row per date range per user.
create table availability (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  room_id    uuid not null references trip_rooms (id) on delete cascade,
  start_date date not null,
  end_date   date not null
);

create index availability_room_id_idx on availability (room_id);

-- destination_preferences --------------------------------------------------
-- Maps to DestinationPreference. One row per country/city per user.
create table destination_preferences (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  room_id         uuid not null references trip_rooms (id) on delete cascade,
  country_or_city text not null
);

create index destination_preferences_room_id_idx on destination_preferences (room_id);

-- destination_suggestions --------------------------------------------------
-- Maps to DestinationSuggestion. bestActivities + downsides are JSONB arrays.
create table destination_suggestions (
  id                   uuid primary key default gen_random_uuid(),
  room_id              uuid not null references trip_rooms (id) on delete cascade,
  destination_name     text not null,
  fit_score            integer not null check (fit_score between 0 and 100),
  weather_summary      text not null,
  seasonality_summary  text not null,
  crowd_level          text not null check (crowd_level in ('low', 'moderate', 'high')),
  price_level          text not null check (price_level in ('budget', 'moderate', 'premium')),
  best_activities      jsonb not null default '[]'::jsonb,
  downsides            jsonb not null default '[]'::jsonb,
  persona_fit_summary  text not null,
  recommendation_reason text not null
);

create index destination_suggestions_room_id_idx on destination_suggestions (room_id);

-- votes --------------------------------------------------------------------
-- Maps to Vote. The unique constraint blocks duplicate votes per option per round.
-- Updated to allow one user to vote for multiple options (e.g. multiple destinations).
create table votes (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references trip_rooms (id) on delete cascade,
  user_id         uuid not null,
  vote_type       text not null check (vote_type in ('destination', 'flight', 'conflict_resolution')),
  selected_option text not null,
  created_at      timestamptz not null default now(),
  constraint votes_room_user_type_option_unique unique (room_id, user_id, vote_type, selected_option)
);

create index votes_room_type_idx on votes (room_id, vote_type);

-- activity_preferences -----------------------------------------------------
-- Maps to ActivityPreference. notes + estimated_cost are nullable.
create table activity_preferences (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references trip_rooms (id) on delete cascade,
  user_id         uuid not null,
  title           text not null,
  type            text not null check (type in ('activity', 'food', 'sight', 'experience', 'avoid')),
  priority        text not null check (priority in ('must_have', 'optional')),
  notes           text,
  estimated_cost  numeric check (estimated_cost >= 0)
);

create index activity_preferences_room_id_idx on activity_preferences (room_id);

-- itineraries --------------------------------------------------------------
-- Maps to Itinerary. days + fairnessSummary are JSONB; version per room.
create table itineraries (
  id                          uuid primary key default gen_random_uuid(),
  room_id                     uuid not null references trip_rooms (id) on delete cascade,
  version_number              integer not null,
  destination                 text not null,
  start_date                  date not null,
  end_date                    date not null,
  days                        jsonb not null default '[]'::jsonb,
  fairness_summary            jsonb not null default '{}'::jsonb,
  average_satisfaction_score  numeric,
  status                      text not null default 'draft' check (status in ('draft', 'final')),
  constraint itineraries_room_version_unique unique (room_id, version_number)
);

create index itineraries_room_id_idx on itineraries (room_id);

-- itinerary_feedback -------------------------------------------------------
-- Maps to ItineraryFeedback. The list fields are JSONB arrays.
create table itinerary_feedback (
  id                  uuid primary key default gen_random_uuid(),
  itinerary_id        uuid not null references itineraries (id) on delete cascade,
  user_id             uuid not null,
  score               integer not null check (score between 1 and 10),
  liked_items         jsonb not null default '[]'::jsonb,
  disliked_items      jsonb not null default '[]'::jsonb,
  requested_additions jsonb not null default '[]'::jsonb,
  requested_removals  jsonb not null default '[]'::jsonb,
  important_requests  jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now()
);

create index itinerary_feedback_itinerary_id_idx on itinerary_feedback (itinerary_id);

-- conflict_resolutions -----------------------------------------------------
-- Maps to ConflictResolution. affectedUsers + proposedOptions are JSONB.
create table conflict_resolutions (
  id                  uuid primary key default gen_random_uuid(),
  room_id             uuid not null references trip_rooms (id) on delete cascade,
  itinerary_id        uuid not null references itineraries (id) on delete cascade,
  conflict_summary    text not null,
  affected_users      jsonb not null default '[]'::jsonb,
  proposed_options    jsonb not null default '[]'::jsonb,
  selected_resolution text,
  status              text not null default 'open' check (status in ('open', 'voting', 'resolved'))
);

create index conflict_resolutions_room_id_idx on conflict_resolutions (room_id);
