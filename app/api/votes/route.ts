import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
import type { Vote } from "@/lib/types";

// Votes are part of a live, collaborative flow — never cache this route.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Postgres unique-violation error code, raised by the votes_room_user_type_unique constraint. */
const UNIQUE_VIOLATION = "23505";

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
 * Records a single vote in a destination, flight, or conflict-resolution round.
 *
 * The unique constraint `votes_room_user_type_unique` on
 * (room_id, user_id, vote_type) blocks duplicates at the DB level. A duplicate
 * surfaces here as Postgres error code 23505 and is mapped to a 409 with a
 * clear "already voted" message so the client can render the existing vote
 * rather than retry blindly.
 *
 * Request body:
 *   {
 *     roomId: string,
 *     userId: string,
 *     voteType: "destination" | "flight" | "conflict_resolution",
 *     selectedOption: string
 *   }
 *
 * Returns 201 with the inserted {@link Vote} in camelCase.
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

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("votes")
    .insert({
      room_id: roomId,
      user_id: userId,
      vote_type: voteType,
      selected_option: selectedOption,
    })
    .select()
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json(
        {
          error: `User has already voted in this ${voteType} round`,
          retryable: false,
        },
        { status: 409 },
      );
    }
    console.log("[votes] failed to insert vote:", error.message);
    return NextResponse.json(
      { error: "Failed to record vote" },
      { status: 500 },
    );
  }

  const vote = mapVoteRow(data as VoteRow);

  // Server-side trace for demo visibility. Truncate the userId for readability;
  // the room is logged by id (the route doesn't have the room code on hand).
  console.log(
    `[votes] room ${vote.roomId} userId ${vote.userId.slice(0, 8)} voted ${vote.voteType}:${vote.selectedOption}`,
  );

  return NextResponse.json(vote, { status: 201 });
}
