import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
import { RoomStage } from "@/lib/types";

import {
  getNextStage,
  getPreviousStage,
  mapRoomRow,
  type TripRoomRow,
} from "../../roomHelpers";

/** Postgres "no rows" code returned by `.single()` when nothing matches. */
const NO_ROWS = "PGRST116";

interface StageBody {
  requestingUserId?: unknown;
  /** "forward" (default) or "backward" */
  direction?: unknown;
}

/**
 * PATCH /api/rooms/[code]/stage
 *
 * Advances OR retreats the room stage. Only the host may call this.
 *
 * Body:
 *   { requestingUserId: string, direction?: "forward" | "backward" }
 *
 * Forward advancement runs prerequisite checks for the transition and returns
 * 400 with { error, missing, suggestedStage, message } when data is absent.
 *
 * Backward movement has no prerequisite checks — it is always allowed for the
 * host so they can recover from a skipped stage.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { code: string } },
) {
  const code = params.code?.trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "Room code is required" }, { status: 400 });
  }

  let body: StageBody;
  try {
    body = (await request.json()) as StageBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { requestingUserId, direction: rawDirection } = body;

  if (typeof requestingUserId !== "string" || requestingUserId.trim() === "") {
    return NextResponse.json(
      { error: "requestingUserId is required" },
      { status: 400 },
    );
  }

  const direction =
    rawDirection === "backward" ? "backward" : "forward";

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
    return NextResponse.json({ error: "Failed to load room" }, { status: 500 });
  }

  const room = mapRoomRow(roomData as TripRoomRow);

  // Host-gated.
  if (requestingUserId !== room.hostUserId) {
    return NextResponse.json(
      { error: "Only the host can change the stage" },
      { status: 403 },
    );
  }

  if (direction === "backward") {
    // ── Backward movement ────────────────────────────────────────────────────
    const prevStage = getPreviousStage(room.currentStage);
    if (prevStage === null) {
      return NextResponse.json(
        { error: "Room is already at the first stage (LOBBY)" },
        { status: 409 },
      );
    }
    const { data: updated, error: updateError } = await supabase
      .from("trip_rooms")
      .update({ current_stage: prevStage })
      .eq("id", room.id)
      .select()
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "Failed to go back to previous stage" },
        { status: 500 },
      );
    }
    return NextResponse.json(mapRoomRow(updated as TripRoomRow));
  }

  // ── Forward advancement ──────────────────────────────────────────────────
  const nextStage = getNextStage(room.currentStage);
  if (nextStage === null) {
    return NextResponse.json(
      { error: `Room is already at the final stage (${RoomStage.FINAL})` },
      { status: 409 },
    );
  }

  // ── Prerequisite checks ──────────────────────────────────────────────────
  const prereqError = await checkPrerequisites(
    room.id,
    room.currentStage,
    nextStage,
    room,
    supabase,
  );
  if (prereqError) {
    return NextResponse.json(prereqError, { status: 400 });
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

// ── Prerequisite checker ──────────────────────────────────────────────────────

interface PrereqError {
  error: string;
  missing: string[];
  suggestedStage: string;
  message: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = ReturnType<typeof import("@/lib/supabase").getServiceSupabase>;

interface RoomSnapshot {
  selectedDestination: string | null;
  selectedFlightOption: string | null;
  currentItineraryId: string | null;
}

async function checkPrerequisites(
  roomId: string,
  from: RoomStage,
  _to: RoomStage,
  room: RoomSnapshot,
  supabase: SupabaseClient,
): Promise<PrereqError | null> {
  switch (from) {
    case RoomStage.AVAILABILITY: {
      // Must have at least one availability record and one destination preference.
      const [avail, prefs] = await Promise.all([
        supabase
          .from("availability")
          .select("id", { count: "exact", head: true })
          .eq("room_id", roomId),
        supabase
          .from("destination_preferences")
          .select("id", { count: "exact", head: true })
          .eq("room_id", roomId),
      ]);
      const missing: string[] = [];
      if ((avail.count ?? 0) === 0) missing.push("availability");
      if ((prefs.count ?? 0) === 0) missing.push("destination_preferences");
      if (missing.length > 0) {
        return {
          error: "Missing prerequisite",
          missing,
          suggestedStage: RoomStage.AVAILABILITY,
          message:
            "At least one member must submit availability dates and destination interests before generating the group profile.",
        };
      }
      return null;
    }

    case RoomStage.GROUP_PROFILE: {
      // Must have a room_profiles row.
      const { data } = await supabase
        .from("room_profiles")
        .select("room_id")
        .eq("room_id", roomId)
        .maybeSingle();
      if (!data) {
        return {
          error: "Missing prerequisite",
          missing: ["group_profile"],
          suggestedStage: RoomStage.GROUP_PROFILE,
          message:
            "Generate the group profile before moving to destination suggestions.",
        };
      }
      return null;
    }

    case RoomStage.DESTINATIONS: {
      // Must have at least one destination suggestion.
      const { count } = await supabase
        .from("destination_suggestions")
        .select("id", { count: "exact", head: true })
        .eq("room_id", roomId);
      if ((count ?? 0) === 0) {
        return {
          error: "Missing prerequisite",
          missing: ["destination_suggestions"],
          suggestedStage: RoomStage.DESTINATIONS,
          message:
            "Generate destination suggestions before moving to the destination vote.",
        };
      }
      return null;
    }

    case RoomStage.DESTINATION_VOTE: {
      // Must have a selected destination.
      if (!room.selectedDestination) {
        return {
          error: "Missing prerequisite",
          missing: ["selected_destination"],
          suggestedStage: RoomStage.DESTINATION_VOTE,
          message:
            "The destination vote must complete and a destination must be selected before moving to flights.",
        };
      }
      return null;
    }

    case RoomStage.FLIGHT_VOTE: {
      // Must have a selected flight option.
      if (!room.selectedFlightOption) {
        return {
          error: "Missing prerequisite",
          missing: ["selected_flight_option"],
          suggestedStage: RoomStage.FLIGHT_VOTE,
          message:
            "The flight vote must complete before moving to activities.",
        };
      }
      return null;
    }

    case RoomStage.ACTIVITIES: {
      // Must have at least one activity preference.
      const { count } = await supabase
        .from("activity_preferences")
        .select("id", { count: "exact", head: true })
        .eq("room_id", roomId);
      if ((count ?? 0) === 0) {
        return {
          error: "Missing prerequisite",
          missing: ["activity_preferences"],
          suggestedStage: RoomStage.ACTIVITIES,
          message:
            "At least one activity preference must be submitted before generating the itinerary.",
        };
      }
      return null;
    }

    case RoomStage.ITINERARY: {
      if (!room.currentItineraryId) {
        return {
          error: "Missing prerequisite",
          missing: ["current_itinerary_id"],
          suggestedStage: RoomStage.ITINERARY,
          message:
            "Generate the itinerary before moving to the feedback stage.",
        };
      }
      return null;
    }

    default:
      return null;
  }
}
