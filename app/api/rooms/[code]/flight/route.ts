import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";

import { mapRoomRow, type TripRoomRow } from "../../roomHelpers";

/**
 * POST /api/rooms/[code]/flight
 *
 * Persists the flight category chosen via the flight vote round onto the room
 * (`trip_rooms.selected_flight_option`). Host-gated: only the room's
 * `hostUserId` may write this field.
 *
 * The flight vote winner is determined client-side from the votes tally (or,
 * in a tie, picked by the host) and then committed here before the stage is
 * advanced to `ACTIVITIES`.
 *
 * Request body:
 *   {
 *     selectedFlightOption: "budget" | "comfort" | "best_value",
 *     requestingUserId: string
 *   }
 *
 * Returns the updated room in the camelCase {@link TripRoom} shape.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Postgres "no rows" code returned by `.single()` when nothing matches. */
const NO_ROWS = "PGRST116";

const VALID_FLIGHT_OPTIONS = ["budget", "comfort", "best_value"] as const;
type FlightOption = (typeof VALID_FLIGHT_OPTIONS)[number];

function isValidFlightOption(value: unknown): value is FlightOption {
  return (
    typeof value === "string" &&
    (VALID_FLIGHT_OPTIONS as readonly string[]).includes(value)
  );
}

interface PostBody {
  selectedFlightOption?: unknown;
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

  const { selectedFlightOption, requestingUserId } = body;

  if (!isValidFlightOption(selectedFlightOption)) {
    return NextResponse.json(
      {
        error: `selectedFlightOption must be one of: ${VALID_FLIGHT_OPTIONS.join(", ")}`,
      },
      { status: 400 },
    );
  }
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
    console.log(`[rooms/${code}/flight] failed to load room:`, loadError.message);
    return NextResponse.json(
      { error: "Failed to load room" },
      { status: 500 },
    );
  }

  const room = mapRoomRow(roomData as TripRoomRow);

  if (requestingUserId !== room.hostUserId) {
    return NextResponse.json(
      { error: "Only the host can set the selected flight option" },
      { status: 403 },
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("trip_rooms")
    .update({ selected_flight_option: selectedFlightOption })
    .eq("id", room.id)
    .select()
    .single();

  if (updateError || !updated) {
    console.log(
      `[rooms/${code}/flight] failed to update room:`,
      updateError?.message ?? "no rows returned",
    );
    return NextResponse.json(
      { error: "Failed to save selected flight option" },
      { status: 500 },
    );
  }

  console.log(
    `[rooms/${code}/flight] selected_flight_option set to "${selectedFlightOption}"`,
  );

  return NextResponse.json(mapRoomRow(updated as TripRoomRow));
}
