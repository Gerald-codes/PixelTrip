-- Agent-layer support functions (spec 03: 03-AI-agents).
--
-- Additive only: two new functions. No ALTER TABLE, no new table, column, enum
-- value, index, constraint, or publication change.
--
-- Why these exist as RPCs rather than Python-side loops:
--   * insert_message_turn   -- Requirement 15.10-15.11: a multi-message agent turn
--     must commit all-or-nothing, with strictly increasing created_at so the
--     transcript has a deterministic order. Sequential client-side inserts can
--     leave a partial turn visible to a realtime subscriber.
--   * set_trip_status_and_stage -- Requirement 18.10: trips.status and
--     party_rooms.planning_stage must move together so no read ever observes one
--     updated without the other.
--
-- Both follow spec 02's create_room_with_owner pattern, including its grant model:
-- callable by the service role (FastAPI) only, never by the anon client.

-- ---------------------------------------------------------------------------
-- insert_message_turn
-- ---------------------------------------------------------------------------
-- Inserts 1..5 messages for one agent turn inside a single transaction.
--
-- Each element of p_messages is an object with keys:
--   sender_type       'user' | 'ai'
--   sender_member_id  uuid as text, or null/absent (must be null when sender_type='ai',
--                     enforced by the messages CHECK constraint)
--   kind              'text' | 'recommendation' | 'vote' | 'summary'
--   content           arbitrary jsonb object
--
-- Returns the inserted rows in presentation order (created_at ascending).
CREATE OR REPLACE FUNCTION insert_message_turn(p_room_id UUID, p_messages JSONB)
RETURNS SETOF messages
LANGUAGE plpgsql
AS $$
DECLARE
    v_message       JSONB;
    v_index         INT := 0;
    v_count         INT;
    v_base          TIMESTAMPTZ := clock_timestamp();
    v_inserted_ids  UUID[] := ARRAY[]::UUID[];
    v_new_id        UUID;
    v_content_bytes INT;
BEGIN
    IF p_messages IS NULL OR jsonb_typeof(p_messages) <> 'array' THEN
        RAISE EXCEPTION 'insert_message_turn: p_messages must be a JSON array';
    END IF;

    v_count := jsonb_array_length(p_messages);

    -- Requirement 15.10: at most 5 messages per turn. Enforced here as well as in
    -- the repository so the invariant holds even for a direct RPC call.
    IF v_count < 1 OR v_count > 5 THEN
        RAISE EXCEPTION 'insert_message_turn: expected 1 to 5 messages, got %', v_count;
    END IF;

    FOR v_message IN SELECT * FROM jsonb_array_elements(p_messages) LOOP
        -- Requirement 15.3: bound the serialized content. Checked before the insert
        -- so an over-size payload aborts the whole turn rather than half-writing it.
        v_content_bytes := octet_length((v_message -> 'content')::TEXT);
        IF v_content_bytes > 16384 THEN
            RAISE EXCEPTION
                'insert_message_turn: content of % bytes exceeds the 16384 byte limit',
                v_content_bytes;
        END IF;

        INSERT INTO messages (
            room_id, sender_type, sender_member_id, kind, content, created_at
        )
        VALUES (
            p_room_id,
            (v_message ->> 'sender_type')::sender_type,
            NULLIF(v_message ->> 'sender_member_id', '')::UUID,
            (v_message ->> 'kind')::message_kind,
            COALESCE(v_message -> 'content', '{}'::JSONB),
            -- Strictly increasing by 1ms so ordering is deterministic. clock_timestamp()
            -- is used rather than NOW(): NOW() is fixed for the whole transaction, so
            -- every row would otherwise share a timestamp.
            v_base + (v_index * INTERVAL '1 millisecond')
        )
        RETURNING id INTO v_new_id;

        v_inserted_ids := array_append(v_inserted_ids, v_new_id);
        v_index := v_index + 1;
    END LOOP;

    -- Return exactly the rows this call inserted, by id. Selecting by room_id with a
    -- LIMIT would be wrong: a concurrent turn in the same room could interleave.
    RETURN QUERY
        SELECT *
        FROM messages
        WHERE id = ANY (v_inserted_ids)
        ORDER BY created_at ASC;
END;
$$;

COMMENT ON FUNCTION insert_message_turn(UUID, JSONB) IS
    'Atomically insert 1-5 messages for one agent turn with strictly increasing '
    'created_at. All-or-nothing; returns the inserted rows in presentation order.';

REVOKE EXECUTE ON FUNCTION insert_message_turn(UUID, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION insert_message_turn(UUID, JSONB) TO service_role;


-- ---------------------------------------------------------------------------
-- set_trip_status_and_stage
-- ---------------------------------------------------------------------------
-- Updates trips.status and the owning party_rooms.planning_stage in one
-- transaction, so the pair is never observed half-updated (Requirement 18.10).
CREATE OR REPLACE FUNCTION set_trip_status_and_stage(
    p_trip_id        UUID,
    p_status         trip_status,
    p_planning_stage planning_stage
)
RETURNS trips
LANGUAGE plpgsql
AS $$
DECLARE
    v_trip trips;
BEGIN
    UPDATE trips
       SET status = p_status
     WHERE id = p_trip_id
    RETURNING * INTO v_trip;

    -- A missing trip must fail loudly. Without this the party_rooms update below
    -- would silently match zero rows and the caller would think it succeeded.
    IF NOT FOUND THEN
        RAISE EXCEPTION 'set_trip_status_and_stage: no trip with id %', p_trip_id;
    END IF;

    UPDATE party_rooms
       SET planning_stage = p_planning_stage
     WHERE id = v_trip.room_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'set_trip_status_and_stage: no party_room with id % for trip %',
            v_trip.room_id, p_trip_id;
    END IF;

    RETURN v_trip;
END;
$$;

COMMENT ON FUNCTION set_trip_status_and_stage(UUID, trip_status, planning_stage) IS
    'Atomically set trips.status and the owning party_rooms.planning_stage so no '
    'read observes one updated without the other.';

REVOKE EXECUTE ON FUNCTION set_trip_status_and_stage(UUID, trip_status, planning_stage)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_trip_status_and_stage(UUID, trip_status, planning_stage)
    TO service_role;
