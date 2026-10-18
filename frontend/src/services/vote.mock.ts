/**
 * Mock vote service.
 *
 * In-memory implementation of {@link VoteService} returning contract-shaped
 * fixture data (no Supabase/FastAPI access). `castVote` resolves with no value
 * (matching the contract's `Promise<void>`); `getSession` resolves a fixture
 * session or `null`.
 */
import type { VoteSession } from "@/types";
import { mockVoteSessionsById } from "@/mocks";
import type { CastVoteInput, VoteService } from "./vote.contract";

export class MockVoteService implements VoteService {
  async castVote(_input: CastVoteInput): Promise<void> {
    // Contract-shaped no-op: a real implementation persists the vote and lets
    // Realtime update counts. The mock simply acknowledges.
    return Promise.resolve();
  }

  async getSession(voteSessionId: string): Promise<VoteSession | null> {
    return Promise.resolve(mockVoteSessionsById[voteSessionId] ?? null);
  }
}
