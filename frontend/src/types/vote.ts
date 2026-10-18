/**
 * Voting shapes.
 *
 * Mirrors the "Voting Structure" contract in `api-contracts.md`: a vote
 * session with per-option live counts.
 */

/** A single choosable option within a vote session. */
export interface VoteOption {
  id: string;
  label: string;
  count: number;
}

/** A voting session presented to the party. */
export interface VoteSession {
  voteSessionId: string;
  roomId: string;
  question: string;
  options: VoteOption[];
  status: "open" | "closed";
}
