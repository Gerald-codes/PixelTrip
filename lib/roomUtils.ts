import { TripRoom } from "./types";

/**
 * Compares two `TripRoom` snapshots on the five fields that drive UI updates.
 *
 * Returns `true` if at least one of the following fields differs between `a`
 * and `b`, allowing the caller to skip a re-render when nothing relevant has
 * changed:
 *
 *   - `currentStage`
 *   - `selectedDestination`
 *   - `selectedFlightOption`
 *   - `currentItineraryId`
 *   - `finalItineraryId`
 *
 * Used by `RoomShell` to guard `onRoomUpdated` calls after polling
 * `GET /api/rooms/[code]` every 3 seconds.
 *
 * Requirements: 7.9
 */
export function roomChanged(a: TripRoom, b: TripRoom): boolean {
  return (
    a.currentStage !== b.currentStage ||
    a.selectedDestination !== b.selectedDestination ||
    a.selectedFlightOption !== b.selectedFlightOption ||
    a.currentItineraryId !== b.currentItineraryId ||
    a.finalItineraryId !== b.finalItineraryId
  );
}
