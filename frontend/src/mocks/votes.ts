/**
 * Vote session fixtures.
 *
 * Contract-shaped `VoteSession` data (see "Voting Structure" in
 * `api-contracts.md`). Consumed only by the mock service implementations.
 * IDs are UUID-format strings.
 */
import type { VoteSession } from "@/types";

/** A stable fixture vote session returned by `vote.mock.ts` lookups. */
export const mockVoteSession: VoteSession = {
  voteSessionId: "99999999-9999-4999-8999-999999999999",
  roomId: "22222222-2222-4222-8222-222222222222",
  question: "Where shall our journey begin?",
  options: [
    { id: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1", label: "Japan", count: 2 },
    { id: "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2", label: "Korea", count: 1 },
    { id: "aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3", label: "Europe", count: 0 },
  ],
  status: "open",
};

/** Keyed vote sessions for id lookups; unknown ids resolve to `null`. */
export const mockVoteSessionsById: Readonly<Record<string, VoteSession>> = {
  [mockVoteSession.voteSessionId]: mockVoteSession,
};
