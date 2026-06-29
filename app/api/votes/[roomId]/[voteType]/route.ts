import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
import type { Vote } from "@/lib/types";

// Vote tallies must always be live — never cache this route.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Allowed vote rounds, mirroring {@link Vote.voteType}. */
const VALID_VOTE_TYPES = [
  "destination",
  "flight",
  "conflict_resolution",
] as const;
type VoteType = (typeof VALID_VOTE_TYPES)[number];

function isValidVoteType(value: string): value is VoteType {
  return (VALID_VOTE_TYPES as readonly string[]).includes(value);
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

interface TallyResult {
  tally: Record<string, number>;
  winner: string | null;
  tiedOptions: string[];
}

/**
 * Compute per-option vote counts, the winner (option with strictly the most
 * votes), and the tied options when no single winner exists.
 *
 * Selection rule:
 * - `winner` is the option with strictly the highest count.
 * - When two or more options share the top count, `winner` is `null` and
 *   `tiedOptions` lists every option tied for the max (length >= 2). The
 *   reusable VotingStage uses this to launch a tie-break round.
 * - When there are no votes, `winner` is `null` and `tiedOptions` is `[]`.
 */
function computeTally(votes: Vote[]): TallyResult {
  const tally: Record<string, number> = {};
  for (const vote of votes) {
    tally[vote.selectedOption] = (tally[vote.selectedOption] ?? 0) + 1;
  }

  const entries = Object.entries(tally);
  if (entries.length === 0) {
    return { tally, winner: null, tiedOptions: [] };
  }

  let maxCount = 0;
  for (const [, count] of entries) {
    if (count > maxCount) maxCount = count;
  }

  const topOptions = entries
    .filter(([, count]) => count === maxCount)
    .map(([option]) => option);

  if (topOptions.length === 1) {
    return { tally, winner: topOptions[0], tiedOptions: [] };
  }

  return { tally, winner: null, tiedOptions: topOptions };
}

/**
 * GET /api/votes/[roomId]/[voteType]
 *
 * Returns the tallied results for a single vote round.
 *
 * Response shape:
 *   {
 *     votes: Vote[],                       // all cast votes for this round
 *     tally: Record<string, number>,       // option -> count
 *     totalVoters: number,                 // members in the room (denominator)
 *     totalVotes: number,                  // votes cast in this round
 *     winner: string | null,               // option with strictly the most votes
 *     tiedOptions: string[]                // tied-for-max options when winner is null
 *   }
 *
 * `totalVoters` is the count of users in the room, so the UI can show
 * progress ("3 of 5 voted") and decide when the round is complete.
 */
export async function GET(
  _request: Request,
  { params }: { params: { roomId: string; voteType: string } },
) {
  const roomId = params.roomId?.trim();
  const voteType = params.voteType?.trim();

  if (!roomId) {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }
  if (!voteType || !isValidVoteType(voteType)) {
    return NextResponse.json(
      {
        error: `voteType must be one of: ${VALID_VOTE_TYPES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();

  const [votesResult, votersResult] = await Promise.all([
    supabase
      .from("votes")
      .select("id, room_id, user_id, vote_type, selected_option, created_at")
      .eq("room_id", roomId)
      .eq("vote_type", voteType)
      .order("created_at", { ascending: true }),
    supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("room_id", roomId),
  ]);

  if (votesResult.error) {
    console.log("[votes] failed to load votes:", votesResult.error.message);
    return NextResponse.json(
      { error: "Failed to load votes" },
      { status: 500 },
    );
  }
  if (votersResult.error) {
    console.log(
      "[votes] failed to count voters:",
      votersResult.error.message,
    );
    return NextResponse.json(
      { error: "Failed to load voter count" },
      { status: 500 },
    );
  }

  const votes = (votesResult.data as VoteRow[]).map(mapVoteRow);
  const totalVoters = votersResult.count ?? 0;
  const { tally, winner, tiedOptions } = computeTally(votes);

  return NextResponse.json({
    votes,
    tally,
    totalVoters,
    totalVotes: votes.length,
    winner,
    tiedOptions,
  });
}
