import { NextResponse } from "next/server";

import { getServiceSupabase, createAnonSupabase } from "@/lib/supabase";
import type { ItineraryFeedback } from "@/lib/types";

// Always run on the server — no caching for mutable feedback data.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ─── Row shape + mapper ───────────────────────────────────────────────────

interface FeedbackRow {
  id: string;
  itinerary_id: string;
  user_id: string;
  score: number;
  liked_items: unknown;
  disliked_items: unknown;
  requested_additions: unknown;
  requested_removals: unknown;
  important_requests: unknown;
  created_at: string;
}

function mapFeedbackRow(row: FeedbackRow): ItineraryFeedback {
  return {
    id: row.id,
    itineraryId: row.itinerary_id,
    userId: row.user_id,
    score: row.score,
    likedItems: row.liked_items as string[],
    dislikedItems: row.disliked_items as string[],
    requestedAdditions: row.requested_additions as string[],
    requestedRemovals: row.requested_removals as string[],
    importantRequests: row.important_requests as string[],
    createdAt: row.created_at,
  };
}

// ─── POST /api/feedback ───────────────────────────────────────────────────

interface PostBody {
  itineraryId?: unknown;
  userId?: unknown;
  score?: unknown;
  likedItems?: unknown;
  dislikedItems?: unknown;
  requestedAdditions?: unknown;
  requestedRemovals?: unknown;
  importantRequests?: unknown;
}

/**
 * POST /api/feedback
 *
 * Body: { itineraryId, userId, score, likedItems, dislikedItems,
 *         requestedAdditions, requestedRemovals, importantRequests }
 *
 * Upserts on (itinerary_id, user_id). After upsert, broadcasts
 * `feedback-submitted` on `room:{roomId}:feedback`.
 *
 * Returns 201 with the upserted `ItineraryFeedback`.
 *
 * Errors:
 *   400 — missing/invalid fields, score out of [1,10], importantRequests > 3
 *   500 — DB failure
 */
export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { itineraryId, userId, score, likedItems, dislikedItems,
          requestedAdditions, requestedRemovals, importantRequests } = body;

  // Required string fields
  if (typeof itineraryId !== "string" || itineraryId.trim() === "") {
    return NextResponse.json({ error: "itineraryId is required" }, { status: 400 });
  }
  if (typeof userId !== "string" || userId.trim() === "") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  // score: must be an integer in [1, 10]
  if (
    typeof score !== "number" ||
    !Number.isInteger(score) ||
    score < 1 ||
    score > 10
  ) {
    return NextResponse.json(
      { error: "score must be an integer between 1 and 10" },
      { status: 400 },
    );
  }

  // Array fields — default to empty array if omitted, validate if present
  const likedArr = Array.isArray(likedItems) ? (likedItems as string[]) : [];
  const dislikedArr = Array.isArray(dislikedItems) ? (dislikedItems as string[]) : [];
  const additionsArr = Array.isArray(requestedAdditions) ? (requestedAdditions as string[]) : [];
  const removalsArr = Array.isArray(requestedRemovals) ? (requestedRemovals as string[]) : [];
  const importantArr = Array.isArray(importantRequests) ? (importantRequests as string[]) : [];

  // importantRequests capped at 3
  if (importantArr.length > 3) {
    return NextResponse.json(
      { error: "importantRequests must contain at most 3 items" },
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();

  // Check for an existing row first, then INSERT or UPDATE accordingly.
  // This avoids relying on a named unique constraint in the upsert call.
  const { data: existingRow } = await supabase
    .from("itinerary_feedback")
    .select("id")
    .eq("itinerary_id", itineraryId)
    .eq("user_id", userId)
    .maybeSingle();

  const payload = {
    itinerary_id: itineraryId,
    user_id: userId,
    score,
    liked_items: likedArr,
    disliked_items: dislikedArr,
    requested_additions: additionsArr,
    requested_removals: removalsArr,
    important_requests: importantArr,
  };

  let savedRow: FeedbackRow | null = null;

  if (existingRow) {
    // UPDATE existing row
    const { data: updatedRows, error: updateError } = await supabase
      .from("itinerary_feedback")
      .update(payload)
      .eq("id", (existingRow as { id: string }).id)
      .select();
    if (updateError || !updatedRows || updatedRows.length === 0) {
      console.error("[feedback/POST] update failed:", updateError?.message ?? "no rows returned");
      return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
    }
    savedRow = updatedRows[0] as FeedbackRow;
  } else {
    // INSERT new row
    const { data: insertedRows, error: insertError } = await supabase
      .from("itinerary_feedback")
      .insert(payload)
      .select();
    if (insertError || !insertedRows || insertedRows.length === 0) {
      console.error("[feedback/POST] insert failed:", insertError?.message ?? "no rows returned");
      return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
    }
    savedRow = insertedRows[0] as FeedbackRow;
  }

  const feedback = mapFeedbackRow(savedRow);

  // Resolve roomId from itinerary so we can broadcast on the right channel
  const { data: itineraryRow, error: itineraryError } = await supabase
    .from("itineraries")
    .select("room_id")
    .eq("id", itineraryId)
    .single();

  if (!itineraryError && itineraryRow) {
    const roomId = (itineraryRow as { room_id: string }).room_id;
    try {
      const anonSupabase = createAnonSupabase();
      await anonSupabase
        .channel(`room:${roomId}:feedback`)
        .send({
          type: "broadcast",
          event: "feedback-submitted",
          payload: { userId },
        });
    } catch (broadcastErr) {
      // Non-fatal — feedback is already saved; broadcast failure should not
      // cause the request to fail.
      console.error("[feedback/POST] broadcast failed:", broadcastErr);
    }
  } else if (itineraryError) {
    console.error("[feedback/POST] could not resolve roomId for broadcast:", itineraryError.message);
  }

  return NextResponse.json(feedback, { status: 201 });
}
