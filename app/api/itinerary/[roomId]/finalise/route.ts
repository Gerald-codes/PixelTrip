import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
import type { Itinerary, ItineraryDay, FairnessSummary } from "@/lib/types";

/** Postgres "no rows" code returned by `.single()` when nothing matches. */
const NO_ROWS = "PGRST116";

/** Shape of an `itineraries` row as returned by Supabase (snake_case columns). */
interface ItineraryRow {
  id: string;
  room_id: string;
  version_number: number;
  destination: string;
  start_date: string;
  end_date: string;
  days: unknown;
  fairness_summary: unknown;
  average_satisfaction_score: number | null;
  status: "draft" | "final";
}

/** Shape of a `trip_rooms` row (minimal — only the fields we need here). */
interface TripRoomRow {
  id: string;
  host_user_id: string;
  current_itinerary_id: string | null;
}

/** Map a snake_case `itineraries` row to the camelCase {@link Itinerary} shape. */
function mapItineraryRow(row: ItineraryRow): Itinerary {
  return {
    id: row.id,
    roomId: row.room_id,
    versionNumber: row.version_number,
    destination: row.destination,
    startDate: row.start_date,
    endDate: row.end_date,
    days: row.days as ItineraryDay[],
    fairnessSummary: row.fairness_summary as FairnessSummary,
    averageSatisfactionScore: row.average_satisfaction_score ?? null,
    status: row.status,
  };
}

/**
 * POST /api/itinerary/[roomId]/finalise
 *
 * Finalises the current itinerary for a room. Only the host may call this.
 *
 * Body: `{ requestingUserId: string }`
 *
 * - 400 if body is invalid
 * - 403 if requestingUserId is not the host
 * - 404 if room or current itinerary is not found
 * - 409 if the itinerary is already finalised
 * - 200 with the updated {@link Itinerary} on success
 */
export async function POST(
  request: Request,
  { params }: { params: { roomId: string } },
) {
  const { roomId } = params;

  if (!roomId) {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }

  let body: { requestingUserId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { requestingUserId } = body;
  if (!requestingUserId) {
    return NextResponse.json(
      { error: "requestingUserId is required" },
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();

  // Load the room
  const { data: roomData, error: roomError } = await supabase
    .from("trip_rooms")
    .select("id, host_user_id, current_itinerary_id")
    .eq("id", roomId)
    .single();

  if (roomError) {
    if (roomError.code === NO_ROWS) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Failed to load room" },
      { status: 500 },
    );
  }

  const room = roomData as TripRoomRow;

  // Only the host may finalise
  if (requestingUserId !== room.host_user_id) {
    return NextResponse.json(
      { error: "Only the host can finalise the itinerary" },
      { status: 403 },
    );
  }

  // Require a current itinerary
  if (!room.current_itinerary_id) {
    return NextResponse.json(
      { error: "No current itinerary found for this room" },
      { status: 404 },
    );
  }

  const currentItineraryId = room.current_itinerary_id;

  // Load the current itinerary
  const { data: itineraryData, error: itineraryError } = await supabase
    .from("itineraries")
    .select()
    .eq("id", currentItineraryId)
    .single();

  if (itineraryError) {
    if (itineraryError.code === NO_ROWS) {
      return NextResponse.json(
        { error: "Current itinerary not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: "Failed to load itinerary" },
      { status: 500 },
    );
  }

  const itinerary = itineraryData as ItineraryRow;

  // Conflict: already finalised
  if (itinerary.status === "final") {
    return NextResponse.json(
      { error: "Itinerary is already finalised" },
      { status: 409 },
    );
  }

  // Mark the itinerary as final
  const { error: updateItineraryError } = await supabase
    .from("itineraries")
    .update({ status: "final" })
    .eq("id", currentItineraryId);

  if (updateItineraryError) {
    return NextResponse.json(
      { error: "Failed to finalise itinerary" },
      { status: 500 },
    );
  }

  // Set final_itinerary_id AND advance stage to FINAL on the room
  const { error: updateRoomError } = await supabase
    .from("trip_rooms")
    .update({
      final_itinerary_id: currentItineraryId,
      current_stage: "FINAL",
    })
    .eq("id", roomId);

  if (updateRoomError) {
    return NextResponse.json(
      { error: "Failed to update room with final itinerary" },
      { status: 500 },
    );
  }

  // Return the updated itinerary
  const updatedItinerary: Itinerary = mapItineraryRow({
    ...itinerary,
    status: "final",
  });

  return NextResponse.json(updatedItinerary);
}
