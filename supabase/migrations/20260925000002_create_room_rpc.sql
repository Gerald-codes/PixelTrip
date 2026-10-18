-- Atomic room creation: room, owner guest, owner membership, character, and preferences
-- are inserted in one transaction. If any insert fails, nothing is kept.
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

    RETURN jsonb_build_object(
        'room',               row_to_json(v_room),
        'guest',              row_to_json(v_guest),
        'member',             row_to_json(v_member),
        'character',          row_to_json(v_character),
        'travel_preferences', row_to_json(v_prefs)
    );
END;
$$;

-- Room creation goes through FastAPI (service role) only; the anon client cannot call it.
REVOKE EXECUTE ON FUNCTION create_room_with_owner(TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_room_with_owner(TEXT, TEXT, TEXT, JSONB) TO service_role;
