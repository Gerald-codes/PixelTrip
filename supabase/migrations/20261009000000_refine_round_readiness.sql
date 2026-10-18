-- Reset readiness for each new round of feedback in the REFINE stage.
--
-- In REFINE a member is "ready" once they have given feedback on the current itinerary
-- version. When a refinement run proposes a new version, the trip moves to
-- refinement_completed but the planning stage stays 'refine', so the stage-change trigger
-- (20261008000000_stage_ready_reset.sql) does not fire. This trigger starts the new round
-- by clearing everyone's stage_ready, so "waiting for X of N" counts feedback on the new
-- version rather than the old one.

CREATE OR REPLACE FUNCTION reset_stage_ready_on_new_refinement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE room_members
       SET stage_ready = false
     WHERE room_id = NEW.room_id
       AND stage_ready;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trips_reset_stage_ready_on_refinement ON trips;

CREATE TRIGGER trg_trips_reset_stage_ready_on_refinement
AFTER UPDATE OF status ON trips
FOR EACH ROW
WHEN (NEW.status = 'refinement_completed' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION reset_stage_ready_on_new_refinement();
