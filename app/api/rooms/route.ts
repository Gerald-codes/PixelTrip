import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
import { RoomStage } from "@/lib/types";

import { generateRoomCode, mapRoomRow, type TripRoomRow } from "./roomHelpers";

/** Postgres unique-violation error code, raised on a duplicate room_code. */
const UNIQUE_VIOLATION = "23505";
/** Max attempts to generate a non-colliding room code before giving up. */
const MAX_CODE_ATTEMPTS = 5;

interface CreateRoomBody {
  hostUserId?: unknown;
}

/**
 * POST /api/rooms
 *
 * Creates a new trip room. Generates a unique 6-char uppercase room code,
 * stores the host user, and initialises the stage to LOBBY. Retries on the rare
 * room-code unique-constraint collision.
 */
export async function POST(request: Request) {
  let body: CreateRoomBody;
  try {
    body = (await request.json()) as CreateRoomBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const hostUserId = body.hostUserId;
  if (typeof hostUserId !== "string" || hostUserId.trim() === "") {
    return NextResponse.json(
      { error: "hostUserId is required" },
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const roomCode = generateRoomCode();

    const { data, error } = await supabase
      .from("trip_rooms")
      .insert({
        room_code: roomCode,
        host_user_id: hostUserId,
        current_stage: RoomStage.LOBBY,
      })
      .select()
      .single();

    if (!error && data) {
      return NextResponse.json(mapRoomRow(data as TripRoomRow), {
        status: 201,
      });
    }

    // Retry only on a room_code collision; surface any other error.
    if (error?.code !== UNIQUE_VIOLATION) {
      return NextResponse.json(
        { error: "Failed to create room" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(
    { error: "Could not generate a unique room code, please try again" },
    { status: 503 },
  );
}
