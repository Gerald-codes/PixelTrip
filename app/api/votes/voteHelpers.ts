/**
 * Shared helpers for vote API routes.
 *
 * Centralises the vote type constants, row types, mappers, and tally logic
 * that were previously copy-pasted across votes/route.ts,
 * votes/submit/route.ts, and votes/[roomId]/[voteType]/route.ts.
 */

import type { Vote } from "@/lib/types";

export const VALID_VOTE_TYPES = [
  "destination",
  "flight",
  "conflict_resolution",
] as const;

export type VoteType = (typeof VALID_VOTE_TYPES)[number];

export function isValidVoteType(value: unknown): value is VoteType {
  return (
    typeof value === "string" &&
    (VALID_VOTE_TYPES as readonly string[]).includes(value)
  );
}

/** Shape of a `votes` row as returned by Supabase (snake_case columns). */
export interface VoteRow {
  id: string;
  room_id: string;
  user_id: string;
  vote_type: VoteType;
  selected_option: string;
  created_at: string;
}

/** Map a snake_case `votes` row to the camelCase {@link Vote} shape. */
export function mapVoteRow(row: VoteRow): Vote {
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    voteType: row.vote_type,
    selectedOption: row.selected_option,
    createdAt: row.created_at,
  };
}

export interface TallyResult {
  tally: Record<string, number>;
  winner: string | null;
  tiedOptions: string[];
}

/**
 * Compute per-option vote counts, the winner (strictly highest count),
 * and the tied options when no single winner exists.
 *
 * Each vote row counts as one vote for its selected_option. In multi-select
 * rounds (e.g. destination voting where a user picks A and B), multiple rows
 * are inserted — one per selected option — so option frequency across all rows
 * determines the winner.
 *
 * Example (2 users, multi-select):
 *   User 1 rows: { selected_option: "A" }, { selected_option: "B" }
 *   User 2 rows: { selected_option: "B" }, { selected_option: "C" }
 *   Tally: A=1, B=2, C=1  →  winner="B",  tiedOptions=[]
 *
 * Tie rules:
 * - `winner` is the option with strictly the highest count.
 * - When two or more options share the top count, `winner` is `null` and
 *   `tiedOptions` lists every tied option (length >= 2).
 * - When there are no votes, `winner` is `null` and `tiedOptions` is `[]`.
 *
 * IMPORTANT: Only call this after ALL members have voted. Calling it mid-round
 * may produce false ties (e.g. A=1, B=1 when only one user has submitted
 * [A, B] — a tie that disappears once the second user votes).
 */
export function computeTally(votes: Vote[]): TallyResult {
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
