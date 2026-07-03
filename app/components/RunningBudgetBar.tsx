"use client";

/**
 * RunningBudgetBar — live per-person spend tracker shown in TripContextPanel.
 *
 * Distinct from `BudgetStatusBadge` (which projects a flat estimate from
 * destination price level + trip length): this bar tracks REAL running spend
 * as the group makes selections through the pipeline.
 *
 *   - Bar limit is fixed at the group's most budget-conscious member's
 *     threshold: low=$800, medium=$2000, high=$5000 (BUDGET_THRESHOLDS).
 *   - Before a flight is picked: bar shows $0 / limit.
 *   - After a flight is picked: bar fills by the flight's flat per-person cost.
 *   - While in ACTIVITIES stage (no itinerary yet): bar additionally fills by
 *     the group's activity-wishlist cost sum (provisional).
 *   - Once an itinerary exists: the itinerary's real per-person cost sum
 *     REPLACES the wishlist figure (no double-counting) — see
 *     `computeRunningBudgetEstimate` in `lib/budgetEstimate.ts`.
 *
 * Visual rules (pixel-art):
 *   - Zero border-radius
 *   - 2px solid deep-navy border
 *   - Monospace font
 *   - within=grass-green, near=sunset-orange, over=red fill
 */

import type { RunningBudgetEstimate } from "@/lib/budgetEstimate";

const SUNSET_ORANGE = "#FB923C";
const RED = "#EF4444";
const GRASS_GREEN = "#4ADE80";
const SAND_CREAM = "var(--pt-bg-card)";

const STATUS_FILL: Record<RunningBudgetEstimate["status"], string> = {
  within: GRASS_GREEN,
  near: SUNSET_ORANGE,
  over: RED,
};

function formatUSD(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

export interface RunningBudgetBarProps {
  estimate: RunningBudgetEstimate;
}

export default function RunningBudgetBar({ estimate }: RunningBudgetBarProps) {
  const { totalSpent, limitPerPerson, status, flightCost, activityOrItineraryCost, usingItineraryCost } = estimate;
  const percentageUsed = limitPerPerson > 0 ? Math.round((totalSpent / limitPerPerson) * 100) : 0;
  const barFillPct = Math.min(percentageUsed, 100);
  const fillColour = STATUS_FILL[status];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontFamily: "'Courier New', Courier, monospace",
        width: "100%",
        boxSizing: "border-box",
      }}
      aria-label={`Trip budget: ${formatUSD(totalSpent)} of ${formatUSD(limitPerPerson)} spent per person (${percentageUsed}%).`}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: SAND_CREAM }}>
          {formatUSD(totalSpent)}
          <span style={{ fontWeight: 400, opacity: 0.6 }}>
            {" "}/ {formatUSD(limitPerPerson)}
          </span>
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: fillColour,
          }}
        >
          {percentageUsed}%
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={barFillPct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          width: "100%",
          height: 14,
          backgroundColor: `${SAND_CREAM}30`,
          border: `2px solid ${SAND_CREAM}50`,
          boxSizing: "border-box",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: "100%",
            width: `${barFillPct}%`,
            backgroundColor: fillColour,
            transition: "width 0.3s ease",
          }}
        />
      </div>

      {status === "over" && (
        <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: RED }}>
          ⚠ Over budget for your most budget-conscious member
        </p>
      )}
      {status === "near" && (
        <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: SUNSET_ORANGE }}>
          Approaching the budget limit
        </p>
      )}

      {(flightCost > 0 || activityOrItineraryCost > 0) && (
        <p
          style={{
            margin: 0,
            fontSize: 10,
            color: SAND_CREAM,
            opacity: 0.5,
          }}
        >
          {usingItineraryCost
            ? "Includes flight + full itinerary cost"
            : "Includes flight + activity wishlist (provisional)"}
        </p>
      )}
    </div>
  );
}
