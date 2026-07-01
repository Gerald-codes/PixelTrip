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
  created_at: string;
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

interface PatchBody {
  selectedResolution?: unknown;
}

/**
 * PATCH /api/conflicts/[id]
 *
 * Body: { selectedResolution: string }
 *
 * Marks the conflict as resolved by setting `selected_resolution` and
 * flipping `status` to `'resolved'`. Returns 200 with the updated
 * {@link ConflictResolution}, or 404 if no matching record exists.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { id } = params;

  if (!id || id.trim() === "") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { selectedResolution } = body;

  if (typeof selectedResolution !== "string" || selectedResolution.trim() === "") {
    return NextResponse.json(
      { error: "selectedResolution is required" },
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("conflict_resolutions")
    .update({
      selected_resolution: selectedResolution.trim(),
      status: "resolved",
    })
    .eq("id", id.trim())
    .select()
    .single();

  if (error) {
    // PGRST116 = no rows matched — treat as 404
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { error: "Conflict resolution not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: "Failed to update conflict resolution" },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Conflict resolution not found" },
      { status: 404 },
    );
  }

  return NextResponse.json(mapConflictRow(data as ConflictResolutionRow), {
    status: 200,
  });
}
