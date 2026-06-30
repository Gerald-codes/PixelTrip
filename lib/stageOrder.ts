import { RoomStage } from "./types";

/**
 * The ordered pipeline of room stages from LOBBY to FINAL.
 *
 * This is the single source of truth for stage ordering, used by both
 * `StageProgress` (to render pipeline dots) and `StageRouter` (to derive
 * predecessor/successor stages).
 */
export const STAGE_ORDER: RoomStage[] = [
  RoomStage.LOBBY,
  RoomStage.PERSONA,
  RoomStage.AVAILABILITY,
  RoomStage.GROUP_PROFILE,
  RoomStage.DESTINATIONS,
  RoomStage.DESTINATION_VOTE,
  RoomStage.FLIGHTS,
  RoomStage.FLIGHT_VOTE,
  RoomStage.ACTIVITIES,
  RoomStage.ITINERARY,
  RoomStage.FEEDBACK,
  RoomStage.NEGOTIATION,
  RoomStage.FINAL,
];
