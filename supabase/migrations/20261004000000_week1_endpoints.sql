-- Week 1 endpoints: one trip per room, preference submission tracking, the departure
-- origin for flight search, and anon read access for the tables the party watches live.
-- Additive only; safe to run on a database that already has rooms.

-- ---------------------------------------------------------------------------
-- 1. Every room gets its trip at creation.
-- Itinerary versions, feedback and agent runs all hang off trips.id, so a room
-- without a trip cannot plan. create_room_with_owner now also creates the trip in the
-- same transaction and returns it as 'trip'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_room_with_owner(
    p_room_name TEXT,
    p_room_code TEXT,
    p_owner_display_name TEXT,
    p_appearance JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_room      party_rooms;
    v_guest     guests;
    v_member    room_members;
    v_character characters;
    v_prefs     travel_preferences;
    v_trip      trips;
BEGIN
    INSERT INTO party_rooms(name, room_code, status, planning_stage)
        VALUES (p_room_name, p_room_code, 'active', 'setup')
        RETURNING * INTO v_room;

    INSERT INTO guests(display_name)
        VALUES (p_owner_display_name)
        RETURNING * INTO v_guest;

    INSERT INTO room_members(room_id, guest_id, display_name, role)
        VALUES (v_room.id, v_guest.id, p_owner_display_name, 'owner')
        RETURNING * INTO v_member;

    INSERT INTO characters(member_id, appearance)
        VALUES (v_member.id, p_appearance)
        RETURNING * INTO v_character;

    INSERT INTO travel_preferences(member_id)
        VALUES (v_member.id)
        RETURNING * INTO v_prefs;

    INSERT INTO trips(room_id, title)
        VALUES (v_room.id, p_room_name)
        RETURNING * INTO v_trip;

    RETURN jsonb_build_object(
        'room',               row_to_json(v_room),
        'guest',              row_to_json(v_guest),
        'member',             row_to_json(v_member),
        'character',          row_to_json(v_character),
        'travel_preferences', row_to_json(v_prefs),
        'trip',               row_to_json(v_trip)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION create_room_with_owner(TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_room_with_owner(TEXT, TEXT, TEXT, JSONB) TO service_role;

-- Rooms created before this migration get their trip now.
INSERT INTO trips(room_id, title)
SELECT r.id, r.name
FROM party_rooms r
WHERE NOT EXISTS (SELECT 1 FROM trips t WHERE t.room_id = r.id);

-- ---------------------------------------------------------------------------
-- 2. Travel preferences.
-- origin: departure city or IATA code for flight search (Backend Change Request
--   Entry 1 in .kiro/specs/03-AI-agents/requirements.md).
-- submitted_at: set when the member saves their preferences. NULL means the member
--   still has the empty defaults from joining; "preferences collected" requires every
--   member to have a non-NULL submitted_at.
-- ---------------------------------------------------------------------------
ALTER TABLE travel_preferences
  ADD COLUMN IF NOT EXISTS origin TEXT CHECK (origin IS NULL OR char_length(btrim(origin)) BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 3. Anon read access (for direct reads and Realtime) on the tables the party watches.
-- Same guest/demo trust model as 20260926000000_anon_room_read_policies.sql.
-- agent_runs stays backend-only (clients use GET /runs/{runId}); travel_preferences
-- stays backend-only (budget).
-- ---------------------------------------------------------------------------
CREATE POLICY anon_read_trips ON trips FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_messages ON messages FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_vote_sessions ON vote_sessions FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_votes ON votes FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_selections ON selections FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_itinerary_versions ON itinerary_versions FOR SELECT TO anon USING (true);
CREATE POLICY anon_read_feedback ON feedback FOR SELECT TO anon USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON trips, messages, vote_sessions, votes, selections, itinerary_versions, feedback, agent_runs
  FROM anon, authenticated;
