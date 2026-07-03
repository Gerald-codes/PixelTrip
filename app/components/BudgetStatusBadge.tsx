"use client";

/**
 * BudgetStatusBadge — per-person budget estimate with progress bar.
 *
 * Always shows:
 *   - Colour-coded status pill (within / near / over)
 *   - "$estimate / $limit per person" text
 *   - Pixel-style progress bar (clamped at 100% visual width)
 *   - Real percentage text when over budget (e.g. "112% of budget")
 *   - Near/over warning message
 *   - Cost-driver sub-line
 *
 * Progress bar thresholds:
 *   within  — percentageUsed < 80%   → grass-green fill
 *   near    — 80% ≤ percentageUsed ≤ 100%  → sunset-orange fill
 *   over    — percentageUsed > 100%  → red fill, visual bar clamped at 100%
 *
 * Visual rules (pixel-art):
 *   - Zero border-radius on all elements
 *   - 2px solid deep-navy border on pill and bar
 *   - Deep-navy text on all coloured surfaces (WCAG AA)
 *   - Monospace font throughout
 *   - max-width: 100% on outer wrapper — never overflows container
 *
 * Requirements: 10.4, 10.5, 10.6, 10.7, 12.2, 12.5
 */

import React from "react";
import type { BudgetEstimate } from "@/lib/types";

// ─── Palette ──────────────────────────────────────────────────────────────────

/** Text/border on all coloured surfaces — must be dark for contrast. */
const DEEP_NAVY = "#0F1B2E";
const GRASS_GREEN = "#4ADE80";
const SUNSET_ORANGE = "#FB923C";
const RED = "#EF4444";
/** Used for the progress bar track and the "over budget" % badge background. */
const SAND_CREAM = "#FEF3C7";
/** Text colour on dark (card) backgrounds. */
const LIGHT_TEXT = "var(--pt-text-primary, #EAF2FF)";

// ─── Prop types ───────────────────────────────────────────────────────────────

interface BudgetStatusBadgeProps {
  /** Full budget estimate from computeBudgetEstimate(). */
  estimate: BudgetEstimate;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_FILL: Record<BudgetEstimate["status"], string> = {
  within: GRASS_GREEN,
  near: SUNSET_ORANGE,
  over: RED,
};

const STATUS_LABELS: Record<BudgetEstimate["status"], string> = {
  within: "Within budget",
  near: "Near budget",
  over: "Over budget",
};

const STATUS_WARNINGS: Record<BudgetEstimate["status"], string | null> = {
  within: null,
  near: "Approaching the budget limit for your most budget-conscious traveller.",
  over: "Over budget for your most budget-conscious traveller.",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatUSD(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BudgetStatusBadge({ estimate }: BudgetStatusBadgeProps) {
  const {
    totalPerPerson,
    budgetLimitPerPerson,
    status,
    costDriverLine,
  } = estimate;

  const percentageUsed = Math.round((totalPerPerson / budgetLimitPerPerson) * 100);
  // Visual bar fill is clamped at 100%; text shows the real % when over.
  const barFillPct = Math.min(percentageUsed, 100);

  const fillColour = STATUS_FILL[status];
  const statusLabel = STATUS_LABELS[status];
  const warningMessage = STATUS_WARNINGS[status];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontFamily: "'Courier New', Courier, monospace",
        maxWidth: "100%",
        width: "100%",
        boxSizing: "border-box",
      }}
      aria-label={`Budget status: ${statusLabel}. ${formatUSD(totalPerPerson)} of ${formatUSD(budgetLimitPerPerson)} per person (${percentageUsed}%).`}
    >
      {/* ── Status pill + estimate + limit ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",        // wrap on narrow containers
          minWidth: 0,
        }}
      >
        {/* Status pill */}
        <span
          style={{
            display: "inline-block",
            flexShrink: 0,
            backgroundColor: fillColour,
            border: `2px solid ${DEEP_NAVY}`,
            boxShadow: `3px 3px 0 ${DEEP_NAVY}`,
            padding: "2px 8px",
            fontSize: 11,
            fontWeight: 700,
            color: DEEP_NAVY,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            whiteSpace: "nowrap",
          }}
        >
          {statusLabel}
        </span>

        {/* Estimate / limit text — wrap if needed */}
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: LIGHT_TEXT,
            wordBreak: "break-word",
            minWidth: 0,
          }}
        >
          {formatUSD(totalPerPerson)}{" "}
          <span style={{ fontWeight: 400, opacity: 0.8 }}>
            / {formatUSD(budgetLimitPerPerson)} per person
          </span>
        </span>

        {/* Real percentage — only shown when over budget */}
        {status === "over" && (
          <span
            aria-label={`${percentageUsed}% of budget`}
            style={{
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 700,
              color: RED,
              backgroundColor: SAND_CREAM,
              border: `2px solid ${RED}`,
              padding: "1px 6px",
              whiteSpace: "nowrap",
            }}
          >
            {percentageUsed}%
          </span>
        )}
      </div>

      {/* ── Progress bar ── */}
      <div
        role="progressbar"
        aria-valuenow={barFillPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Budget used: ${barFillPct}% visually (${percentageUsed}% actual)`}
        style={{
          width: "100%",
          height: 14,
          backgroundColor: "rgba(255,255,255,0.12)",
          border: `2px solid rgba(255,255,255,0.2)`,
          boxSizing: "border-box",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Fill */}
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

      {/* ── Near / over warning ── */}
      {warningMessage && (
        <p
          style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 600,
            color: status === "over" ? RED : SUNSET_ORANGE,
            lineHeight: 1.4,
            wordBreak: "break-word",
          }}
        >
          ⚠ {warningMessage}
        </p>
      )}

      {/* ── Cost-driver sub-line ── */}
      {costDriverLine && (
        <p
          style={{
            margin: 0,
            fontSize: 11,
            color: LIGHT_TEXT,
            opacity: 0.75,
            lineHeight: 1.4,
            wordBreak: "break-word",
          }}
        >
          {costDriverLine}
        </p>
      )}
    </div>
  );
}
