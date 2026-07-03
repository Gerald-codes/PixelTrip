/**
 * Budget estimation constants and pure functions for PixelTrip.
 *
 * All functions are pure — no side effects, no API calls. The estimate is
 * computed entirely from the constants below and the caller's inputs.
 *
 * Import `BudgetEstimate` and `BudgetLevel` from `lib/types.ts`.
 */

import type { BudgetEstimate, BudgetLevel } from "./types";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Flat per-person flight cost by flight category (USD). */
export const FLIGHT_COSTS: Record<"budget" | "best_value" | "comfort", number> =
  {
    budget: 215,
    best_value: 335,
    comfort: 520,
  };

/** Daily per-person cost by the user's budget level (USD). */
export const DAILY_COSTS: Record<BudgetLevel, number> = {
  low: 80,
  medium: 150,
  high: 280,
};

/**
 * Destination price multiplier applied to daily costs.
 * A "premium" destination scales daily spend by 1.4×; a "budget" one by 0.8×.
 */
export const DESTINATION_MULTIPLIERS: Record<
  "budget" | "moderate" | "premium",
  number
> = {
  budget: 0.8,
  moderate: 1.0,
  premium: 1.4,
};

/**
 * Per-person budget threshold by budget level (USD).
 * Used to classify the estimate as "within", "near", or "over" budget.
 */
export const BUDGET_THRESHOLDS: Record<BudgetLevel, number> = {
  low: 800,
  medium: 2000,
  high: 5000,
};

// ─── Pure functions ───────────────────────────────────────────────────────────

/**
 * Compute the effective per-person budget limit scaled by trip length.
 *
 * BUDGET_THRESHOLDS is calibrated for a baseline 7-day trip. For shorter or
 * longer trips the limit scales proportionally so:
 *   - 3-day trip → lower limit (cheaper overall)
 *   - 14-day trip → higher limit (costs naturally accumulate)
 *
 * Both the forecast badge and the running-spend bar use this function so
 * their limits always match.
 */
export function computeScaledBudgetLimit(
  budgetLevel: BudgetLevel,
  tripLengthDays: number,
): number {
  const baseline = BUDGET_THRESHOLDS[budgetLevel]; // calibrated for 7 days
  const BASELINE_DAYS = 7;
  return Math.round(baseline * (tripLengthDays / BASELINE_DAYS));
}

/**
 * Classify a numeric estimate relative to a given limit.
 *
 * - "within" — estimate < 80% of limit
 * - "near"   — 80% of limit ≤ estimate ≤ limit
 * - "over"   — estimate > limit
 */
export function classifyBudgetStatus(
  estimate: number,
  budgetLevel: BudgetLevel,
  tripLengthDays?: number,
): "within" | "near" | "over" {
  const threshold = tripLengthDays != null
    ? computeScaledBudgetLimit(budgetLevel, tripLengthDays)
    : BUDGET_THRESHOLDS[budgetLevel];
  const nearFloor = 0.8 * threshold;

  if (estimate > threshold) return "over";
  if (estimate >= nearFloor) return "near";
  return "within";
}

/**
 * Compute a per-person budget estimate from the user's selections.
 *
 * Formula:
 *   totalPerPerson =
 *     FLIGHT_COSTS[flightCategory]
 *     + DESTINATION_MULTIPLIERS[destinationPriceLevel] × tripLengthDays × DAILY_COSTS[budgetLevel]
 *
 * `tripLengthDays` is inclusive (endDate − startDate + 1 calendar days).
 *
 * Pure function — no side effects, no API calls.
 */
export function computeBudgetEstimate(
  flightCategory: "budget" | "best_value" | "comfort",
  destinationPriceLevel: "budget" | "moderate" | "premium",
  tripLengthDays: number,
  budgetLevel: BudgetLevel,
): BudgetEstimate {
  const flightCost = FLIGHT_COSTS[flightCategory];
  const dailyCost =
    DESTINATION_MULTIPLIERS[destinationPriceLevel] *
    tripLengthDays *
    DAILY_COSTS[budgetLevel];
  const totalPerPerson = flightCost + dailyCost;
  const budgetLimitPerPerson = computeScaledBudgetLimit(budgetLevel, tripLengthDays);
  const status = classifyBudgetStatus(totalPerPerson, budgetLevel, tripLengthDays);

  // Determine which component is the larger cost driver.
  const costDriverLine = buildCostDriverLine(
    flightCategory,
    flightCost,
    dailyCost,
    tripLengthDays,
  );

  return {
    flightCost,
    dailyCost,
    totalPerPerson,
    budgetLimitPerPerson,
    status,
    costDriverLine,
    tripLengthDays,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build the cost-driver explanation line (≤ 80 characters).
 *
 * - Flight driver: "[Category] flights add ~$[flightCost] to your estimate"
 * - Daily driver : "Daily costs for [N] days add ~$[dailyCost] to your estimate"
 *
 * The category label is title-cased for readability (e.g. "Best Value").
 */
function buildCostDriverLine(
  flightCategory: "budget" | "best_value" | "comfort",
  flightCost: number,
  dailyCost: number,
  tripLengthDays: number,
): string {
  let line: string;

  if (flightCost > dailyCost) {
    const categoryLabel = toTitleCase(flightCategory.replace(/_/g, " "));
    line = `${categoryLabel} flights add ~$${Math.round(flightCost)} to your estimate`;
  } else {
    line = `Daily costs for ${tripLengthDays} day${tripLengthDays === 1 ? "" : "s"} add ~$${Math.round(dailyCost)} to your estimate`;
  }

  // Truncate to 80 characters.
  return line.slice(0, 80);
}

/** Convert a space-separated string to Title Case. */
function toTitleCase(str: string): string {
  return str
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// ─── Running spend tracker (progressive budget bar) ───────────────────────────

/**
 * A running per-person "money committed so far" tally, distinct from
 * {@link BudgetEstimate} (which forecasts a total once destination + flight
 * are both known). This tracker starts at $0 and fills up incrementally as
 * the group commits to a flight, then as activity-wishlist or itinerary items
 * with a cost are added — matching the low/medium/high budget bar caps
 * (800/2000/5000 via BUDGET_THRESHOLDS).
 */
export interface RunningBudgetEstimate {
  /** Per-person total committed so far (flight + activity-or-itinerary cost). */
  totalSpent: number;
  /** Per-person cap for the group's most conservative budget level. */
  limitPerPerson: number;
  flightCost: number;
  /** The non-flight cost component actually used in totalSpent (see usingItineraryCost). */
  activityOrItineraryCost: number;
  status: "within" | "near" | "over";
  /**
   * True once a real itinerary exists and its per-item costs replaced the
   * provisional activity-wishlist sum — prevents double-counting the same
   * spend once the itinerary has been generated.
   */
  usingItineraryCost: boolean;
}

/**
 * Compute the running per-person spend from committed costs so far.
 *
 * - `flightCost`: FLIGHT_COSTS[selectedFlightOption] once a flight is chosen, else 0.
 * - `activityCosts`: per-person estimatedCost values from ActivityPreference rows
 *   (provisional wishlist figures before an itinerary exists).
 * - `itineraryCosts`: per-person estimatedCost values from every ItineraryItem
 *   across the current itinerary's days; 0 for free items.
 *
 * When `itineraryCosts` is non-empty, it REPLACES the activity-wishlist sum
 * (the itinerary supersedes the wishlist once generated) rather than adding
 * to it — this avoids double-counting the same planned spend.
 *
 * Pure function — no side effects, no API calls.
 */
export function computeRunningBudgetEstimate(
  budgetLevel: BudgetLevel,
  tripLengthDays: number,
  flightCost: number,
  activityCosts: number[],
  itineraryCosts: number[],
): RunningBudgetEstimate {
  const activitySum = activityCosts.reduce((sum, c) => sum + (Number.isFinite(c) ? c : 0), 0);
  const itinerarySum = itineraryCosts.reduce((sum, c) => sum + (Number.isFinite(c) ? c : 0), 0);

  const usingItineraryCost = itineraryCosts.length > 0;
  const activityOrItineraryCost = usingItineraryCost ? itinerarySum : activitySum;

  const totalSpent = flightCost + activityOrItineraryCost;
  const limitPerPerson = computeScaledBudgetLimit(budgetLevel, tripLengthDays);
  const status = classifyBudgetStatus(totalSpent, budgetLevel, tripLengthDays);

  return {
    totalSpent,
    limitPerPerson,
    flightCost,
    activityOrItineraryCost,
    status,
    usingItineraryCost,
  };
}
