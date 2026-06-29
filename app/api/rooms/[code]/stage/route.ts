import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
import { RoomStage } from "@/lib/types";

import { getNextStage, mapRoomRow, type TripRoomRow } from "../../roomHelpers";

/** Postgres "no rows" code returned by `.single()` when nothing matches. */
const NO_ROWS = "PGRST116";

interface AdvanceStageBody {
  requestingUserId?: unknown;
}

/**
 * PATCH /api/rooms/[code]/stage
 *
 * Advances the room to the next stage in the state machine. Only the host
 * (`requestingUserId === hostUserId`) may advance; any other requester is
 * rejected with a 403.
 *
 * NOTE: The dynamic segment is named `code` to satisfy the App Router rule that
 * sibling dynamic segments share one slug name. A room code uniquely identifies
 * a room, so addressing the stage endpoint by code is equivalent to addressing
 * it by id.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { code: string } },
) {
  const code = params.code?.trim().toUpperCase();
  if (!code) {
    return NextResponse.json(
      { error: "Room code is required" },
      { status: 400 },
    );
  }

  let body: AdvanceStageBody;
  try {
    body = (await request.json()) as AdvanceStageBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const requestingUserId = body.requestingUserId;
  if (typeof requestingUserId !== "string" || requestingUserId.trim() === "") {
    return NextResponse.json(
      { error: "requestingUserId is required" },
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();

  const { data: roomData, error: loadError } = await supabase
    .from("trip_rooms")
    .select()
    .eq("room_code", code)
    .single();

  if (loadError) {
    if (loadError.code === NO_ROWS) {
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

  const room = mapRoomRow(roomData as TripRoomRow);

  // Host-gated stage transition.
  if (requestingUserId !== room.hostUserId) {
    return NextResponse.json(
      { error: "Only the host can advance the stage" },
      { status: 403 },
    );
  }

  const nextStage = getNextStage(room.currentStage);
  if (nextStage === null) {
    return NextResponse.json(
      { error: `Room is already at the final stage (${RoomStage.FINAL})` },
      { status: 409 },
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("trip_rooms")
    .update({ current_stage: nextStage })
    .eq("id", room.id)
    .select()
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: "Failed to advance stage" },
      { status: 500 },
    );
  }

  return NextResponse.json(mapRoomRow(updated as TripRoomRow));
}
