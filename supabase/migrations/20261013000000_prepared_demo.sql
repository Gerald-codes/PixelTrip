-- Prepared booth rooms share the normal tables and Realtime subscriptions.
ALTER TABLE public.party_rooms
  ADD COLUMN IF NOT EXISTS demo_scenario TEXT,
  ADD COLUMN IF NOT EXISTS demo_start DATE;

ALTER TABLE public.party_rooms ADD CONSTRAINT party_rooms_demo_scenario_check
  CHECK ((demo_scenario IS NULL AND demo_start IS NULL) OR
         (demo_scenario IS NOT NULL AND demo_scenario = 'vietnam-five-days' AND demo_start IS NOT NULL));

-- Keep the existing RPC signature and transaction: demo metadata is part of creation.
CREATE OR REPLACE FUNCTION public.create_room_with_owner(
    p_room_name TEXT, p_room_code TEXT, p_owner_display_name TEXT,
    p_appearance JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
    v_room party_rooms;
    v_guest guests;
    v_member room_members;
    v_character characters;
    v_prefs travel_preferences;
    v_trip trips;
    v_demo BOOLEAN := lower(btrim(regexp_replace(p_owner_display_name, '\s+', ' ', 'g'))) = 'demoalice';
BEGIN
    INSERT INTO party_rooms(name, room_code, status, planning_stage, demo_scenario, demo_start)
      VALUES (p_room_name, p_room_code, 'active', 'setup',
              CASE WHEN v_demo THEN 'vietnam-five-days' END,
              CASE WHEN v_demo THEN (NOW() AT TIME ZONE 'Asia/Singapore')::date + 7 END)
      RETURNING * INTO v_room;
    INSERT INTO guests(display_name) VALUES (p_owner_display_name) RETURNING * INTO v_guest;
    INSERT INTO room_members(room_id, guest_id, display_name, role)
      VALUES (v_room.id, v_guest.id, p_owner_display_name, 'owner') RETURNING * INTO v_member;
    INSERT INTO characters(member_id, appearance)
      VALUES (v_member.id, p_appearance) RETURNING * INTO v_character;
    INSERT INTO travel_preferences(member_id) VALUES (v_member.id) RETURNING * INTO v_prefs;
    INSERT INTO trips(room_id, title) VALUES (v_room.id, p_room_name) RETURNING * INTO v_trip;
    RETURN jsonb_build_object('room', row_to_json(v_room), 'guest', row_to_json(v_guest),
      'member', row_to_json(v_member), 'character', row_to_json(v_character),
      'travel_preferences', row_to_json(v_prefs), 'trip', row_to_json(v_trip));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_room_with_owner(TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_room_with_owner(TEXT, TEXT, TEXT, JSONB) TO service_role;

-- Enforce the two named seats even for concurrent joins; name uniqueness already exists.
CREATE OR REPLACE FUNCTION public.check_demo_member() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_demo TEXT; v_name TEXT;
BEGIN
    SELECT demo_scenario INTO v_demo FROM public.party_rooms WHERE id = NEW.room_id FOR UPDATE;
    IF v_demo IS NOT NULL THEN
      v_name := lower(btrim(regexp_replace(NEW.display_name, '\s+', ' ', 'g')));
      IF (NEW.role = 'owner' AND v_name <> 'demoalice') OR
         (NEW.role = 'member' AND v_name <> 'demobob') THEN
        RAISE EXCEPTION 'Demo rooms reserve their two seats for DemoAlice and DemoBob'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_demo_member BEFORE INSERT OR UPDATE OF room_id, display_name, role
  ON public.room_members FOR EACH ROW EXECUTE FUNCTION public.check_demo_member();
