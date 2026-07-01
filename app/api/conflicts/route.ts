import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
import type { ConflictResolution, ConflictOption } from "@/lib/types";

// Always serve fresh data — never cache this route.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Shape of a `conflict_resolutions` row as returned by Supabase. */
interface ConflictResolutionRow {
  id: string;
  room_id: string;
  itinerary_id: string;
  conflict_summary: string;
  affected_users: string[];
  proposed_options: ConflictOption[];
  selected_resolution: string | null;
  status: "open" | "voting" | "resolved";
}

/** Map a snake_case DB row to the camelCase {@link ConflictResolution} shape. */
function mapConflictRow(row: ConflictResolutionRow): ConflictResolution {
  return {
    id: row.id,
    roomId: row.room_id,
    itineraryId: row.itinerary_id,
    conflictSummary: row.conflict_summary,
    affectedUsers: row.affected_users as string[],
    proposedOptions: row.proposed_options as ConflictOption[],
    selectedResolution: row.selected_resolution,
    status: row.status as "open" | "voting" | "resolved",
  };
}

interface PostBody {
  roomId?: unknown;
  itineraryId?: unknown;
  conflictSummary?: unknown;
  affectedUsers?: unknown;
  proposedOptions?: unknown;
}

/**
 * GET /api/conflicts?roomId=...
 *
 * Returns all {@link ConflictResolution} rows for the given room,
 * ordered by creation time (oldest first).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId")?.trim();

  if (!roomId) {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("conflict_resolutions")
    .select(
      "id, room_id, itinerary_id, conflict_summary, affected_users, proposed_options, selected_resolution, status",
    )
    .eq("room_id", roomId)
    .order("id", { ascending: true });

  if (error) {
    console.error("[conflicts/GET] failed to load conflicts for room", roomId, ":", error.message, error.code);
    return NextResponse.json(
      { error: "Failed to load conflict resolutions" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    (data as ConflictResolutionRow[]).map(mapConflictRow),
    { status: 200 },
  );
}

/**
 * POST /api/conflicts
 *
 * Body: { roomId, itineraryId, conflictSummary, affectedUsers, proposedOptions }
 *
 * Validates that `proposedOptions` contains at least 2 entries, inserts a new
 * row with `status = 'open'`, and returns 201 with the created
 * {@link ConflictResolution}.
 */
export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { roomId, itineraryId, conflictSummary, affectedUsers, proposedOptions } = body;

  if (typeof roomId !== "string" || roomId.trim() === "") {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }
  if (typeof itineraryId !== "string" || itineraryId.trim() === "") {
    return NextResponse.json({ error: "itineraryId is required" }, { status: 400 });
  }
  if (typeof conflictSummary !== "string" || conflictSummary.trim() === "") {
    return NextResponse.json({ error: "conflictSummary is required" }, { status: 400 });
  }
  if (!Array.isArray(affectedUsers)) {
    return NextResponse.json({ error: "affectedUsers must be an array" }, { status: 400 });
  }
  if (!Array.isArray(proposedOptions) || proposedOptions.length < 2) {
    return NextResponse.json(
      { error: "proposedOptions must contain at least 2 options" },
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("conflict_resolutions")
    .insert({
      room_id: roomId.trim(),
      itinerary_id: itineraryId.trim(),
      conflict_summary: conflictSummary.trim(),
      affected_users: affectedUsers,
      proposed_options: proposedOptions,
      selected_resolution: null,
      status: "open",
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create conflict resolution" },
      { status: 500 },
    );
  }

  return NextResponse.json(mapConflictRow(data as ConflictResolutionRow), {
    status: 201,
  });
}
