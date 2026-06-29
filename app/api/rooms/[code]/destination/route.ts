import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";

import { mapRoomRow, type TripRoomRow } from "../../roomHelpers";

/**
 * POST /api/rooms/[code]/destination
 *
 * Persists the destination chosen via the destination vote round onto the
 * room (`trip_rooms.selected_destination`). Host-gated, mirroring the stage
 * endpoint: only `room.hostUserId === requestingUserId` may write.
 *
 * The destination vote is decided client-side from the votes tally (or, in a
 * tie, picked by the host) and then committed here before the stage is
 * advanced to `FLIGHTS`.
 *
 * Request body:
 *   {
 *     selectedDestination: string,
 *     requestingUserId: string
 *   }
 *
 * Returns the updated room in the camelCase {@link TripRoom} shape.
 */

// Always run on the server, never cache — this writes state.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Postgres "no rows" code returned by `.single()` when nothing matches. */
const NO_ROWS = "PGRST116";

interface PostBody {
  selectedDestination?: unknown;
  requestingUserId?: unknown;
}

export async function POST(
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

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { selectedDestination, requestingUserId } = body;

  if (
    typeof selectedDestination !== "string" ||
    selectedDestination.trim() === ""
  ) {
    return NextResponse.json(
      { error: "selectedDestination is required" },
      { status: 400 },
    );
  }
  if (
    typeof requestingUserId !== "string" ||
    requestingUserId.trim() === ""
  ) {
    return NextResponse.json(
      { error: "requestingUserId is required" },
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();

  // Load the room to verify it exists and that the requester is the host.
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
    console.log(
      `[rooms/${code}/destination] failed to load room:`,
      loadError.message,
    );
    return NextResponse.json(
      { error: "Failed to load room" },
      { status: 500 },
    );
  }

  const room = mapRoomRow(roomData as TripRoomRow);

  if (requestingUserId !== room.hostUserId) {
    return NextResponse.json(
      { error: "Only the host can set the selected destination" },
      { status: 403 },
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("trip_rooms")
    .update({ selected_destination: selectedDestination })
    .eq("id", room.id)
    .select()
    .single();

  if (updateError || !updated) {
    console.log(
      `[rooms/${code}/destination] failed to update room:`,
      updateError?.message ?? "no rows returned",
    );
    return NextResponse.json(
      { error: "Failed to save selected destination" },
      { status: 500 },
    );
  }

  console.log(
    `[rooms/${code}/destination] selected_destination set to "${selectedDestination}"`,
  );

  return NextResponse.json(mapRoomRow(updated as TripRoomRow));
}
