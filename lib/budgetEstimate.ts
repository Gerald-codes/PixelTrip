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
 * Classify a numeric estimate relative to the user's budget threshold.
 *
 * - "within" — estimate < 80 % of threshold
 * - "near"   — 80 % of threshold ≤ estimate ≤ threshold
 * - "over"   — estimate > threshold
 */
export function classifyBudgetStatus(
  estimate: number,
  budgetLevel: BudgetLevel,
): "within" | "near" | "over" {
  const threshold = BUDGET_THRESHOLDS[budgetLevel];
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
  const budgetLimitPerPerson = BUDGET_THRESHOLDS[budgetLevel];
  const status = classifyBudgetStatus(totalPerPerson, budgetLevel);

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
