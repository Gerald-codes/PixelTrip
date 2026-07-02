import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
import type { ConflictOption, ConflictResolution } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_ROWS = "PGRST116";

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

function mapConflictRow(row: ConflictResolutionRow): ConflictResolution {
  return {
    id: row.id,
    roomId: row.room_id,
    itineraryId: row.itinerary_id,
    conflictSummary: row.conflict_summary,
    affectedUsers: row.affected_users,
    proposedOptions: row.proposed_options,
    selectedResolution: row.selected_resolution,
    status: row.status,
  };
}

interface PatchBody {
  selectedResolution?: unknown;
  status?: unknown;
}

/**
 * PATCH /api/conflicts/[id]
 *
 * Updates a conflict_resolutions row.
 * Accepts: { selectedResolution?: string, status?: "open"|"voting"|"resolved" }
 * Returns the updated ConflictResolution.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const id = params.id?.trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if (body.selectedResolution !== undefined) {
    if (
      typeof body.selectedResolution !== "string" ||
      body.selectedResolution.trim() === ""
    ) {
      return NextResponse.json(
        { error: "selectedResolution must be a non-empty string" },
        { status: 400 },
      );
    }
    update.selected_resolution = body.selectedResolution.trim();
  }

  if (body.status !== undefined) {
    if (!["open", "voting", "resolved"].includes(body.status as string)) {
      return NextResponse.json(
        { error: "status must be one of: open, voting, resolved" },
        { status: 400 },
      );
    }
    update.status = body.status;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "At least one field (selectedResolution or status) is required" },
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("conflict_resolutions")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === NO_ROWS) {
      return NextResponse.json(
        { error: "Conflict resolution not found" },
        { status: 404 },
      );
    }
    console.log(`[conflicts/${id}] failed to update:`, error.message);
    return NextResponse.json(
      { error: "Failed to update conflict resolution" },
      { status: 500 },
    );
  }

  return NextResponse.json(mapConflictRow(data as ConflictResolutionRow));
}
