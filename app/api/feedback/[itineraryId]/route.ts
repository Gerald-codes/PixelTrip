import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
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

// ─── GET /api/feedback/[itineraryId] ─────────────────────────────────────

/**
 * GET /api/feedback/[itineraryId]
 *
 * Returns all feedback for the given itinerary, plus aggregate stats:
 *   - feedback:      ItineraryFeedback[]
 *   - averageScore:  number | null (null if no rows)
 *   - submittedCount: number
 *   - totalMembers:  number (all users in the itinerary's room)
 *
 * Errors:
 *   400 — itineraryId param missing
 *   500 — DB failure
 */
export async function GET(
  _request: Request,
  { params }: { params: { itineraryId: string } },
) {
  const { itineraryId } = params;

  if (!itineraryId || itineraryId.trim() === "") {
    return NextResponse.json({ error: "itineraryId is required" }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  // 1. Load all feedback rows for this itinerary
  const { data: feedbackRows, error: feedbackError } = await supabase
    .from("itinerary_feedback")
    .select("*")
    .eq("itinerary_id", itineraryId);

  if (feedbackError) {
    console.error(
      `[feedback/GET] failed to load feedback for itinerary ${itineraryId}:`,
      feedbackError.message,
    );
    return NextResponse.json({ error: "Failed to load feedback" }, { status: 500 });
  }

  const feedback = (feedbackRows as FeedbackRow[]).map(mapFeedbackRow);
  const submittedCount = feedback.length;

  // Compute average score (null when no rows)
  const averageScore =
    submittedCount > 0
      ? feedback.reduce((sum, f) => sum + f.score, 0) / submittedCount
      : null;

  // 2. Resolve room_id from the itinerary so we can count total members
  const { data: itineraryRow, error: itineraryError } = await supabase
    .from("itineraries")
    .select("room_id")
    .eq("id", itineraryId)
    .single();

  if (itineraryError || !itineraryRow) {
    console.error(
      `[feedback/GET] failed to resolve room_id for itinerary ${itineraryId}:`,
      itineraryError?.message ?? "no row",
    );
    return NextResponse.json(
      { error: "Failed to resolve itinerary room" },
      { status: 500 },
    );
  }

  const roomId = (itineraryRow as { room_id: string }).room_id;

  // 3. Count total members in the room
  const { count, error: countError } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .eq("room_id", roomId);

  if (countError) {
    console.error(
      `[feedback/GET] failed to count members for room ${roomId}:`,
      countError.message,
    );
    return NextResponse.json({ error: "Failed to count members" }, { status: 500 });
  }

  const totalMembers = count ?? 0;

  return NextResponse.json({
    feedback,
    averageScore,
    submittedCount,
    totalMembers,
  });
}
