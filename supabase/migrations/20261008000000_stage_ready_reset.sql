-- Reset every member's stage_ready whenever a room moves to a new planning stage.
--
-- stage_ready (20261005000000_stage_readiness.sql) means "this member has done their part
-- in the party's CURRENT stage". Every stage change goes through
-- set_trip_status_and_stage, which updates party_rooms.planning_stage -- whether it was
-- triggered by everyone saving preferences, a vote resolving, or an AI run. Resetting
-- here, in one place, keeps "waiting for X of N" correct for every stage instead of
-- relying on each code path to remember.
--
-- Fires only when planning_stage actually changes, so status moves within a stage (for
-- example feedback_collected inside REFINE) do not clear readiness.

CREATE OR REPLACE FUNCTION reset_stage_ready_on_stage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE room_members
       SET stage_ready = false
     WHERE room_id = NEW.id
       AND stage_ready;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_party_rooms_reset_stage_ready ON party_rooms;

CREATE TRIGGER trg_party_rooms_reset_stage_ready
AFTER UPDATE OF planning_stage ON party_rooms
FOR EACH ROW
WHEN (OLD.planning_stage IS DISTINCT FROM NEW.planning_stage)
EXECUTE FUNCTION reset_stage_ready_on_stage_change();
