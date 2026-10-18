/**
 * Budget service contract — the party's trip budget for the sidebar card.
 *
 * Mirrors `GET /trips/{tripId}/budget` (see "Trip budget" in
 * `.kiro/steering/api-contracts.md`). All amounts are per person, in SGD.
 */
import type { Unsubscribe } from "@/types";

export type BudgetLevel = "low" | "medium" | "high";

/** A budget level's spend per person per day, excluding flights. */
export interface DailyRange {
  low: number;
  /** `null` for the open-ended High level. */
  high: number | null;
  typical: number;
}

export interface BudgetEstimates {
  /** Destination's estimated daily cost × days (an AI estimate). */
  stay: number | null;
  /** The locked flight's price. */
  flight: number | null;
  /** Sum of costed itinerary activities. */
  activities: number | null;
  /** Sum of the known parts; `null` until something is known. */
  total: number | null;
}

export interface BudgetMember {
  memberId: string;
  displayName: string;
  amount: number | null;
  level: BudgetLevel | null;
}

export interface TripBudget {
  currency: string;
  days: number | null;
  /** True when a member typed an amount: options over it are dropped. */
  isHardLimit: boolean;
  /** The lowest typed amount (whole trip, including flights). */
  limit: number | null;
  limitSetBy: string | null;
  /** The lowest budget level any member picked. */
  level: BudgetLevel | null;
  levelCount: number;
  dailyRange: DailyRange | null;
  /** Typical spend for the trip at the level, excluding flights (a guide). */
  levelEstimate: number | null;
  estimates: BudgetEstimates;
  /** `limit - estimates.total`; `null` without a limit. */
  remaining: number | null;
  isOverBudget: boolean;
  members: BudgetMember[];
}

export interface BudgetService {
  /** The room's trip budget, or `null` when the room has no trip yet. */
  getBudget(roomId: string): Promise<TripBudget | null>;

  /**
   * Push the budget now and again whenever something that changes it does
   * (a member saves preferences, a vote locks a destination or flight, an
   * itinerary version arrives). Returns an {@link Unsubscribe}.
   */
  subscribeBudget(
    roomId: string,
    onChange: (budget: TripBudget | null) => void,
  ): Unsubscribe;
}
