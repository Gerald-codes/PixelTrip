import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
import type { Vote } from "@/lib/types";

// Votes are part of a live, collaborative flow — never cache this route.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Allowed vote rounds, mirroring {@link Vote.voteType}. */
const VALID_VOTE_TYPES = [
  "destination",
  "flight",
  "conflict_resolution",
] as const;
type VoteType = (typeof VALID_VOTE_TYPES)[number];

function isValidVoteType(value: unknown): value is VoteType {
  return (
    typeof value === "string" &&
    (VALID_VOTE_TYPES as readonly string[]).includes(value)
  );
}

/** Shape of a `votes` row as returned by Supabase (snake_case columns). */
interface VoteRow {
  id: string;
  room_id: string;
  user_id: string;
  vote_type: VoteType;
  selected_option: string;
  created_at: string;
}

/** Map a snake_case `votes` row to the camelCase {@link Vote} shape. */
function mapVoteRow(row: VoteRow): Vote {
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    voteType: row.vote_type,
    selectedOption: row.selected_option,
    createdAt: row.created_at,
  };
}

interface PostBody {
  roomId?: unknown;
  userId?: unknown;
  voteType?: unknown;
  selectedOption?: unknown;
}

/**
 * POST /api/votes
 *
 * Records or updates a single vote in a destination, flight, or conflict-resolution round.
 *
 * Uses upsert on the unique constraint `votes_room_user_type_unique`
 * (room_id, user_id, vote_type). If the user has already voted in this round,
 * the existing row is updated with the new `selected_option`; no duplicate is
 * ever created. This lets users change their vote before the round resolves.
 *
 * Request body:
 *   {
 *     roomId: string,
 *     userId: string,
 *     voteType: "destination" | "flight" | "conflict_resolution",
 *     selectedOption: string
 *   }
 *
 * Returns 200 with the upserted {@link Vote} in camelCase.
 */
export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { roomId, userId, voteType, selectedOption } = body;

  if (typeof roomId !== "string" || roomId.trim() === "") {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }
  if (typeof userId !== "string" || userId.trim() === "") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (!isValidVoteType(voteType)) {
    return NextResponse.json(
      {
        error: `voteType must be one of: ${VALID_VOTE_TYPES.join(", ")}`,
      },
      { status: 400 },
    );
  }
  if (typeof selectedOption !== "string" || selectedOption.trim() === "") {
    return NextResponse.json(
      { error: "selectedOption is required" },
      { status: 400 },
    );
  }

  // Manual upsert: check for an existing vote, then update or insert.
  // This avoids the PostgREST onConflict limitation entirely and works
  // regardless of how the unique constraint is named or exposed.
  const supabase = getServiceSupabase();

  // Check for an existing vote for this user in this round.
  const { data: existing } = await supabase
    .from("votes")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .eq("vote_type", voteType)
    .maybeSingle();

  let data: VoteRow | null = null;
  let error: { message: string } | null = null;

  if (existing) {
    // Update the existing vote row with the new selection.
    const result = await supabase
      .from("votes")
      .update({ selected_option: selectedOption })
      .eq("id", existing.id)
      .select()
      .single();
    data = result.data as VoteRow | null;
    error = result.error;
  } else {
    // Insert a fresh vote row.
    const result = await supabase
      .from("votes")
      .insert({
        room_id: roomId,
        user_id: userId,
        vote_type: voteType,
        selected_option: selectedOption,
      })
      .select()
      .single();
    data = result.data as VoteRow | null;
    error = result.error;
  }

  if (error) {
    console.log("[votes] failed to upsert vote:", error.message);
    return NextResponse.json(
      { error: "Failed to record vote" },
      { status: 500 },
    );
  }

  const vote = mapVoteRow(data as VoteRow);

  console.log(
    `[votes] room ${vote.roomId} userId ${vote.userId.slice(0, 8)} voted ${vote.voteType}:${vote.selectedOption}`,
  );

  return NextResponse.json(vote, { status: 200 });
}
