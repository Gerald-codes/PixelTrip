/**
 * Vote service — real (backend-backed) implementation.
 *
 * Placeholder for the Foundation phase: every method throws
 * {@link NotImplementedError} and performs no Supabase/FastAPI access. It holds
 * the shape of the real integration without implementing it, so all backend
 * access stays confined to the service layer. Behaviour arrives when the
 * backend endpoints land; until then run with `NEXT_PUBLIC_SERVICE_MODE=mock`.
 */
import type { VoteSession } from "@/types";
import { notImplemented } from "@/lib/errors";
import type { CastVoteInput, VoteService } from "./vote.contract";

class VoteApiService implements VoteService {
  castVote(_input: CastVoteInput): Promise<void> {
    throw notImplemented("VoteService.castVote");
  }

  getSession(_voteSessionId: string): Promise<VoteSession | null> {
    throw notImplemented("VoteService.getSession");
  }
}

/** Singleton real Vote service placeholder. */
export const voteApiService: VoteService = new VoteApiService();
