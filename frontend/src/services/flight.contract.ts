/**
 * Flight service contract (LOGISTICS stage).
 *
 * A `logistics` run (`POST /trips/{tripId}/runs`) searches flights for the locked
 * destination, filters them by dates and budget, ranks them, posts a
 * `kind:"recommendation"` message (`category:"flight"`) and opens a vote. Each
 * item's `meta` carries the factual flight fields (carrier, flight_number,
 * origin, destination, depart_at, arrive_at, price, duration_minutes, stops,
 * return_at, return_arrive_at) plus the card keys (score, whyThisFits, tags,
 * tradeOff, details). See "Recommendation Response Structure" in
 * `api-contracts.md`.
 */
import type { Unsubscribe } from "@/types";

import type {
  BreakTieInput,
  DestinationVote,
  TiebreakAdvice,
} from "./destination.contract";

/** One recommended flight. */
export interface FlightOption {
  id: string;
  title: string;
  description?: string;
  meta?: Record<string, unknown>;
}

/** The locked flight after the vote resolves. */
export interface SelectedFlight {
  id: string;
  title: string;
}

/** A snapshot of the LOGISTICS stage for a room. */
export interface LogisticsState {
  /** True while nothing is posted yet (no flights and no vote). */
  loading: boolean;
  options: readonly FlightOption[];
  selectedFlight: SelectedFlight | null;
  vote: DestinationVote | null;
  tiePending: boolean;
  tiebreak: TiebreakAdvice | null;
  /** The guide's latest plain-text message (e.g. why it found no flights). */
  guideNote: string | null;
}

export interface StartLogisticsInput {
  tripId: string;
  memberId: string;
  /** Start a fresh run even if an earlier one (e.g. a failed one) exists. */
  retry?: boolean;
}

export interface CastFlightVoteInput {
  voteSessionId: string;
  memberId: string;
  optionId: string;
}

export interface FlightService {
  /** Ensure a logistics run exists for the trip (idempotent on the backend). */
  startLogistics(input: StartLogisticsInput): Promise<void>;

  /** Live LOGISTICS state; primes once, then follows Realtime changes. */
  subscribeLogistics(
    roomId: string,
    onChange: (state: LogisticsState) => void,
  ): Unsubscribe;

  /** Cast (or change) this member's flight vote. */
  castVote(input: CastFlightVoteInput): Promise<void>;

  /** Owner-only: pick the winner of a tied flight vote. */
  breakTie(input: BreakTieInput): Promise<void>;
}
