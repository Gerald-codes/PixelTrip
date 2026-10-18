/**
 * Vote service contract.
 *
 * Typed method signatures only — no feature or business logic. Behaviour is
 * supplied solely by the mock (`vote.mock.ts`) or real (`vote.api.ts`)
 * implementation. Shapes mirror the "Voting Structure" section of
 * `api-contracts.md` (the single source of truth). No Supabase/FastAPI types
 * appear in this surface.
 */
import type { VoteSession } from "@/types";

/** Input for {@link VoteService.castVote}. */
export interface CastVoteInput {
  voteSessionId: string;
  optionId: string;
  guestId: string;
}

export interface VoteService {
  castVote(input: CastVoteInput): Promise<void>;
  getSession(voteSessionId: string): Promise<VoteSession | null>;
}
