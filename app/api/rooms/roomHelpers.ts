import { RoomStage, type TripRoom } from "@/lib/types";

/**
 * Shared helpers for the room API routes.
 *
 * NOTE: This is a plain module colocated with the rooms route handlers. Only
 * `route.ts` files become routes in the App Router, so importing from here is
 * safe and does not register an endpoint.
 */

/** Shape of a `trip_rooms` row as returned by Supabase (snake_case columns). */
export interface TripRoomRow {
  id: string;
  room_code: string;
  host_user_id: string;
  current_stage: string;
  selected_destination: string | null;
  selected_flight_option: "budget" | "comfort" | "best_value" | null;
  current_itinerary_id: string | null;
  final_itinerary_id: string | null;
  created_at: string;
}

/** Map a snake_case `trip_rooms` row to the camelCase {@link TripRoom} shape. */
export function mapRoomRow(row: TripRoomRow): TripRoom {
  return {
    id: row.id,
    roomCode: row.room_code,
    hostUserId: row.host_user_id,
    currentStage: row.current_stage as RoomStage,
    selectedDestination: row.selected_destination,
    selectedFlightOption: row.selected_flight_option,
    currentItineraryId: row.current_itinerary_id,
    finalItineraryId: row.final_itinerary_id,
    createdAt: row.created_at,
  };
}

const ROOM_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ROOM_CODE_LENGTH = 6;

/** Generate a 6-character uppercase alphanumeric room code. */
export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    const index = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[index];
  }
  return code;
}

/**
 * The linear order of the room-stage state machine. The position in this array
 * defines what "advancing" means for {@link getNextStage}.
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

/**
 * Return the next stage after `current`, or `null` if `current` is the final
 * stage (FINAL) and cannot advance any further.
 */
export function getNextStage(current: RoomStage): RoomStage | null {
  const index = STAGE_ORDER.indexOf(current);
  if (index === -1 || index >= STAGE_ORDER.length - 1) {
    return null;
  }
  return STAGE_ORDER[index + 1];
}

/** Type guard: is `value` a valid {@link RoomStage}? */
export function isRoomStage(value: unknown): value is RoomStage {
  return (
    typeof value === "string" &&
    (Object.values(RoomStage) as string[]).includes(value)
  );
}
