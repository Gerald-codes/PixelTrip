import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";

import { mapRoomRow, type TripRoomRow } from "../roomHelpers";

/** Postgres "no rows" code returned by `.single()` when nothing matches. */
const NO_ROWS = "PGRST116";

/**
 * GET /api/rooms/[code]
 *
 * Looks up a room by its 6-char room code (case-insensitive). Returns the room
 * in the camelCase {@link TripRoom} shape, or a clear not-found error.
 */
export async function GET(
  _request: Request,
  { params }: { params: { code: string } },
) {
  const code = params.code?.trim().toUpperCase();
  if (!code) {
    return NextResponse.json(
      { error: "Room code is required" },
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("trip_rooms")
    .select()
    .eq("room_code", code)
    .single();

  if (error) {
    if (error.code === NO_ROWS) {
      return NextResponse.json(
        { error: `Room "${code}" not found or has expired` },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: "Failed to load room" },
      { status: 500 },
    );
  }

  return NextResponse.json(mapRoomRow(data as TripRoomRow));
}
