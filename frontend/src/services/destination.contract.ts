/**
 * Destination service contract (DISCOVER stage).
 *
 * The AI produces destination recommendations and opens a vote: a `discovery` run
 * (`POST /trips/{tripId}/runs`) posts a `kind:"recommendation"` message
 * (`category:"destination"`) and opens a `vote_sessions` row. Members cast votes
 * (`POST /votes/{voteSessionId}/cast`); when the last votes, the session resolves
 * and the trip advances to `destination_selected`.
 *
 * This service exposes exactly what the DISCOVER screen needs. Shapes mirror the
 * "Recommendation Response Structure" and "Voting Structure" in `api-contracts.md`.
 * No Supabase/FastAPI types appear here.
 */
import type { Unsubscribe } from "@/types";

/** One recommended destination option the party can vote for. */
export interface DestinationOption {
  id: string;
  title: string;
  description?: string;
  /** Comparison details (region, budget band, highlights, ...). */
  meta?: Record<string, unknown>;
}

/** The locked destination selection persisted after a vote resolves. */
export interface SelectedDestination {
  id: string;
  title: string;
}

/** The open (or resolved) destination vote. */
export interface DestinationVote {
  voteSessionId: string;
  question: string;
  options: readonly { id: string; label: string; count: number }[];
  status: "open" | "closed";
}

/** Per-member fit from the AI's tiebreak advice. */
export interface MemberFit {
  memberId: string;
  displayName: string;
  score: number;
  reason: string;
}

/** One tied option, scored by the AI tiebreak advice (card shape + tie extras). */
export interface TiebreakOption {
  id: string;
  title: string;
  description?: string;
  /** Party-fit score 0-100, when the AI scored it. */
  score?: number;
  whyThisFits?: string;
  tags?: readonly string[];
  tradeOff?: string;
  details?: string;
  /** Display names of members who voted for this option. */
  votes?: readonly string[];
  /** Per-member fit breakdown. */
  memberFit?: readonly MemberFit[];
}

/** The AI's advice for a tied vote the room owner must break. */
export interface TiebreakAdvice {
  voteSessionId: string;
  category: "destination" | "flight";
  /** The leader-facing advice paragraph. */
  advice: string;
  /** The option the guide leans towards, if any. */
  recommendedOptionId: string | null;
  /** The tied options, scored. */
  options: readonly TiebreakOption[];
  /** True while the guide's advice is still being written: the options come from
   * the vote (no scores yet) and the leader may already choose. */
  pending?: boolean;
}

/** A snapshot of the DISCOVER stage for a room. */
export interface DiscoverState {
  /** True while a discovery run is in progress and nothing is posted yet. */
  loading: boolean;
  /** The recommended destinations, or empty until the AI posts them. */
  options: readonly DestinationOption[];
  /** The locked destination, or null while the vote is still open. */
  selectedDestination: SelectedDestination | null;
  /** The destination vote, or null until the AI opens it. */
  vote: DestinationVote | null;
  /** True when the vote tied and awaits the owner's break-tie pick. */
  tiePending: boolean;
  /** The AI's tiebreak advice, or null when there is no pending tie. */
  tiebreak: TiebreakAdvice | null;
  /** The guide's latest plain-text message (e.g. a question it needs answered). */
  guideNote?: string | null;
}

export interface StartDiscoveryInput {
  tripId: string;
  memberId: string;
  /** Start a fresh run even if an earlier one (e.g. a failed one) exists. */
  retry?: boolean;
}

export interface CastDestinationVoteInput {
  voteSessionId: string;
  memberId: string;
  optionId: string;
}

export interface BreakTieInput {
  voteSessionId: string;
  /** Must be the room owner's member id. */
  memberId: string;
  /** One of the tied option ids. */
  optionId: string;
}

export interface DestinationService {
  /**
   * Resolve the trip id for a room (needed to start runs / read trip status).
   */
  getTripId(roomId: string): Promise<string | null>;

  /**
   * Ensure a discovery run is running for the trip. Idempotent on the backend
   * (an in-progress run of the same type is returned), so this is safe to call
   * from any member — though the UI only triggers it from the owner.
   */
  startDiscovery(input: StartDiscoveryInput): Promise<void>;

  /**
   * Live DISCOVER state for a room: the AI's recommendation options and the vote.
   * Primes once immediately, then updates on every `messages` / `vote_sessions`
   * change via Supabase Realtime. Returns an {@link Unsubscribe}.
   */
  subscribeDiscover(
    roomId: string,
    onChange: (state: DiscoverState) => void,
  ): Unsubscribe;

  /** Cast (or change) this member's destination vote. */
  castVote(input: CastDestinationVoteInput): Promise<void>;

  /** Owner-only: pick the winner of a tied vote (`POST .../break-tie`). */
  breakTie(input: BreakTieInput): Promise<void>;
}
