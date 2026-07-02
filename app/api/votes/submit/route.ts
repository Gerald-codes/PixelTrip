import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { RoomStage } from "@/lib/types";
import { getNextStage, mapRoomRow, type TripRoomRow } from "../../rooms/roomHelpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VALID_VOTE_TYPES = ["destination", "flight", "conflict_resolution"] as const;
type VoteType = (typeof VALID_VOTE_TYPES)[number];

function isValidVoteType(v: unknown): v is VoteType {
  return typeof v === "string" && (VALID_VOTE_TYPES as readonly string[]).includes(v);
}

interface SubmitBody {
  roomId?: unknown;
  userId?: unknown;
  voteType?: unknown;
  selectedOptions?: unknown; // string[]
}

/**
 * POST /api/votes/submit
 *
 * Atomically replaces a user's votes for a given vote type with a new set of
 * selected options. Supports multi-vote (e.g. voting for multiple destinations).
 *
 * After saving, checks if ALL room members have cast at least one vote.
 * If everyone has voted:
 *   - Computes the winner (most votes, unique) or detects a tie.
 *   - If a clear winner: updates trip_rooms.selected_destination (or
 *     selected_flight_option) and advances the room stage automatically.
 *   - If tied: returns { allVoted: true, tied: true, tiedOptions } so the
 *     client can show a tiebreaker UI. Does NOT advance the stage.
 *
 * Request body:
 *   {
 *     roomId: string,
 *     userId: string,
 *     voteType: "destination" | "flight" | "conflict_resolution",
 *     selectedOptions: string[]   // one or more
 *   }
 *
 * Response:
 *   {
 *     votes: Vote[],              // all votes for this user after save
 *     allVoted: boolean,
 *     tied?: boolean,
 *     tiedOptions?: string[],
 *     winner?: string,
 *     roomAdvanced?: boolean,
 *     updatedRoom?: TripRoom
 *   }
 */
export async function POST(request: Request) {
  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { roomId, userId, voteType, selectedOptions } = body;

  if (typeof roomId !== "string" || !roomId.trim()) {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }
  if (typeof userId !== "string" || !userId.trim()) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (!isValidVoteType(voteType)) {
    return NextResponse.json({ error: `voteType must be one of: ${VALID_VOTE_TYPES.join(", ")}` }, { status: 400 });
  }
  if (!Array.isArray(selectedOptions) || selectedOptions.length === 0) {
    return NextResponse.json({ error: "selectedOptions must be a non-empty array" }, { status: 400 });
  }
  const options = selectedOptions as string[];
  if (options.some((o) => typeof o !== "string" || !o.trim())) {
    return NextResponse.json({ error: "All selectedOptions must be non-empty strings" }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  // ── 1. Delete existing votes for this user+type in this room ────────────
  const { error: deleteError } = await supabase
    .from("votes")
    .delete()
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .eq("vote_type", voteType);

  if (deleteError) {
    return NextResponse.json({ error: "Failed to replace existing votes" }, { status: 500 });
  }

  // ── 2. Insert new votes (one row per selected option) ───────────────────
  const inserts = options.map((opt) => ({
    room_id: roomId,
    user_id: userId,
    vote_type: voteType,
    selected_option: opt.trim(),
  }));

  const { data: insertedRows, error: insertError } = await supabase
    .from("votes")
    .insert(inserts)
    .select();

  if (insertError || !insertedRows) {
    return NextResponse.json({ error: "Failed to save votes" }, { status: 500 });
  }

  // ── 3. Count how many distinct users have voted for this type ────────────
  const { data: distinctVoters, error: voterError } = await supabase
    .from("votes")
    .select("user_id")
    .eq("room_id", roomId)
    .eq("vote_type", voteType);

  if (voterError) {
    // Non-fatal — return saved votes without allVoted check
    return NextResponse.json({ votes: insertedRows, allVoted: false });
  }

  const votedUserIds = [...new Set((distinctVoters ?? []).map((r: { user_id: string }) => r.user_id))];

  // ── 4. Count total room members ──────────────────────────────────────────
  const { count: memberCount, error: memberError } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("room_id", roomId);

  if (memberError || memberCount === null) {
    return NextResponse.json({ votes: insertedRows, allVoted: false });
  }

  const allVoted = votedUserIds.length >= memberCount && memberCount > 0;

  if (!allVoted) {
    return NextResponse.json({ votes: insertedRows, allVoted: false });
  }

  // ── 5. All voted — tally votes ───────────────────────────────────────────
  const { data: allVotesRows, error: allVotesError } = await supabase
    .from("votes")
    .select("selected_option")
    .eq("room_id", roomId)
    .eq("vote_type", voteType);

  if (allVotesError) {
    return NextResponse.json({ votes: insertedRows, allVoted: true });
  }

  const tally: Record<string, number> = {};
  for (const row of allVotesRows ?? []) {
    const opt = (row as { selected_option: string }).selected_option;
    tally[opt] = (tally[opt] ?? 0) + 1;
  }

  let maxCount = 0;
  for (const count of Object.values(tally)) {
    if (count > maxCount) maxCount = count;
  }

  const topOptions = Object.entries(tally)
    .filter(([, count]) => count === maxCount)
    .map(([opt]) => opt);

  // ── 6. Tie — return without advancing ────────────────────────────────────
  if (topOptions.length > 1) {
    return NextResponse.json({
      votes: insertedRows,
      allVoted: true,
      tied: true,
      tiedOptions: topOptions,
    });
  }

  const winner = topOptions[0];

  // ── 7. Clear winner — update room and advance stage ──────────────────────
  const { data: roomData, error: roomError } = await supabase
    .from("trip_rooms")
    .select()
    .eq("id", roomId)
    .single();

  if (roomError || !roomData) {
    // Can't advance — return result without room update
    return NextResponse.json({ votes: insertedRows, allVoted: true, winner });
  }

  const room = mapRoomRow(roomData as TripRoomRow);

  // For destination votes, resolve the winner ID to the destination name
  // so selected_destination stores a human-readable value.
  let selectedDestinationValue = winner;
  if (voteType === "destination") {
    const { data: destRow } = await supabase
      .from("destination_suggestions")
      .select("destination_name")
      .eq("id", winner)
      .maybeSingle();
    if (destRow && typeof (destRow as Record<string, unknown>).destination_name === "string") {
      selectedDestinationValue = (destRow as Record<string, unknown>).destination_name as string;
    }
  }

  // Apply the winner to the appropriate room field
  const roomUpdate: Record<string, string> = {};
  if (voteType === "destination") {
    roomUpdate.selected_destination = selectedDestinationValue;
  } else if (voteType === "flight") {
    roomUpdate.selected_flight_option = winner;
  }

  // Advance stage
  const nextStage = getNextStage(room.currentStage);
  if (nextStage) {
    roomUpdate.current_stage = nextStage;
  }

  if (Object.keys(roomUpdate).length > 0) {
    const { data: updatedRoomData, error: updateError } = await supabase
      .from("trip_rooms")
      .update(roomUpdate)
      .eq("id", roomId)
      .select()
      .single();

    if (!updateError && updatedRoomData) {
      const updatedRoom = mapRoomRow(updatedRoomData as TripRoomRow);
      return NextResponse.json({
        votes: insertedRows,
        allVoted: true,
        winner,
        roomAdvanced: !!nextStage,
        updatedRoom,
      });
    }
  }

  return NextResponse.json({ votes: insertedRows, allVoted: true, winner });
}
