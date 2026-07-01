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
 * GET /api/itinerary/[roomId]
 *
 * Returns all itinerary versions for a room, ordered by version_number ASC.
 * Returns 404 if the room does not exist.
 */
export async function GET(
  _request: Request,
  { params }: { params: { roomId: string } },
) {
  const { roomId } = params;

  if (!roomId) {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  // Verify the room exists
  const { error: roomError } = await supabase
    .from("trip_rooms")
    .select("id")
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

  // Load all itinerary versions for this room
  const { data, error } = await supabase
    .from("itineraries")
    .select()
    .eq("room_id", roomId)
    .order("version_number", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load itineraries" },
      { status: 500 },
    );
  }

  const itineraries: Itinerary[] = (data as ItineraryRow[]).map(mapItineraryRow);

  return NextResponse.json(itineraries);
}
