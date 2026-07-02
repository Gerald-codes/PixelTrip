"use client";

/**
 * BudgetStatusBadge — per-person budget estimate status indicator.
 *
 * Displays the computed trip budget estimate with a colour-coded status and
 * a short cost-driver explanation line below the badge.
 *
 * Status colours:
 *   "within" — grass green  (#4ADE80)  estimate is comfortably under budget
 *   "near"   — sunset orange (#FB923C)  estimate is approaching the threshold
 *   "over"   — red          (#EF4444)  estimate exceeds the budget threshold
 *
 * Visual rules (pixel-art):
 *   - Zero border-radius (no rounded corners)
 *   - 2px solid deep-navy (#1E3A5F) border
 *   - 4px 4px 0 #1E3A5F box-shadow (blocky offset shadow)
 *   - Monospace font throughout
 *   - No white backgrounds; deep navy (#1E3A5F) for all text
 *
 * Layout:
 *   - Top row: coloured status pill with "$N per person" estimate label
 *   - Sub-line: costDriverLine (≤80 chars) rendered below the badge in
 *     smaller monospace text, same deep-navy colour
 *
 * Requirements: 10.4, 10.5, 12.2, 12.5
 */

import React from "react";

// ─── Prop types ───────────────────────────────────────────────────────────────

interface BudgetStatusBadgeProps {
  /** Budget status classification. */
  status: "within" | "near" | "over";
  /** Total per-person estimate in USD (integer or float). */
  estimate: number;
  /**
   * Short explanation of the dominant cost driver.
   * Capped at 80 characters by the upstream computeBudgetEstimate() function.
   */
  costDriverLine: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEEP_NAVY = "#1E3A5F";
const GRASS_GREEN = "#4ADE80";
const SUNSET_ORANGE = "#FB923C";
const RED = "#EF4444";

const STATUS_COLOURS: Record<BudgetStatusBadgeProps["status"], string> = {
  within: GRASS_GREEN,
  near: SUNSET_ORANGE,
  over: RED,
};

const STATUS_LABELS: Record<BudgetStatusBadgeProps["status"], string> = {
  within: "Within budget",
  near: "Near budget",
  over: "Over budget",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format a USD amount as "$N" (no decimal places for whole dollars, 2dp otherwise). */
function formatUSD(amount: number): string {
  const rounded = Math.round(amount);
  return `$${rounded.toLocaleString("en-US")}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BudgetStatusBadge({
  status,
  estimate,
  costDriverLine,
}: BudgetStatusBadgeProps) {
  const bg = STATUS_COLOURS[status];
  const statusLabel = STATUS_LABELS[status];
  const formattedEstimate = formatUSD(estimate);

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 6,
        fontFamily: "'Courier New', Courier, monospace",
      }}
    >
      {/* ── Status pill + estimate ── */}
      <div
        aria-label={`Budget status: ${statusLabel}. Estimated ${formattedEstimate} per person.`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          paddingTop: 4,
          paddingBottom: 4,
          paddingLeft: 10,
          paddingRight: 10,
          backgroundColor: bg,
          border: `2px solid ${DEEP_NAVY}`,
          borderRadius: 0,
          boxShadow: `4px 4px 0 ${DEEP_NAVY}`,
          userSelect: "none",
          whiteSpace: "nowrap",
        }}
      >
        {/* Status label */}
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: DEEP_NAVY,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {statusLabel}
        </span>

        {/* Divider */}
        <span
          aria-hidden="true"
          style={{
            color: DEEP_NAVY,
            opacity: 0.5,
            fontSize: 12,
          }}
        >
          |
        </span>

        {/* Per-person estimate */}
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: DEEP_NAVY,
          }}
        >
          {formattedEstimate}{" "}
          <span style={{ fontSize: 11, fontWeight: 400 }}>/ person</span>
        </span>
      </div>

      {/* ── Cost-driver sub-line ── */}
      {costDriverLine && (
        <p
          style={{
            margin: 0,
            fontSize: 11,
            color: DEEP_NAVY,
            fontFamily: "'Courier New', Courier, monospace",
            opacity: 0.8,
            maxWidth: 280,
            lineHeight: 1.4,
          }}
        >
          {costDriverLine}
        </p>
      )}
    </div>
  );
}
