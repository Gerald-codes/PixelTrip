"use client";

/**
 * VoteableFlightCard — scannable flight option card for voting.
 *
 * Collapsed (default) — shows everything needed to decide:
 *   Accent header:  ✈ [Style name]
 *   Chip row:       [price] [duration] [stops] [budget impact?]
 *   Impact line:    one short sentence from itineraryImpact
 *   CTA:            Select / Selected ✓ button
 *
 * Expanded (toggle) — adds full explanation text.
 *
 * Selection model — matches VoteableDestinationCard: clicking the card only
 * toggles a local `isSelected` flag (single-select across the flight option
 * list, enforced by the parent). No network call happens until the parent's
 * "Submit vote" button is clicked, at which point every card becomes
 * `isLocked`. Vote counts are never shown on this card — results are only
 * revealed once everyone has submitted.
 */

import React, { useState } from "react";

// ─── Palette ─────────────────────────────────────────────────────────────────

const DEEP_NAVY = "#1E3A5F";
const SAND_CREAM = "#FEF3C7";
const GRASS_GREEN = "#4ADE80";
const SUNSET_ORANGE = "#FB923C";
const RED = "#EF4444";
const SKY_BLUE = "#38BDF8";
const NEON_PURPLE = "#A855F7";

// ─── Category config ──────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<"budget" | "best_value" | "comfort", string> = {
  budget: "Budget",
  best_value: "Best Value",
  comfort: "Comfort",
};

const CATEGORY_ACCENT: Record<"budget" | "best_value" | "comfort", string> = {
  budget: GRASS_GREEN,
  best_value: SKY_BLUE,
  comfort: NEON_PURPLE,
};

/** One short sentence summarising the itinerary impact — always fits in collapsed view. */
const IMPACT_SUMMARY: Record<"budget" | "best_value" | "comfort", string> = {
  budget: "Late arrival on Day 1 — lighter first day.",
  best_value: "Morning arrival — full first and last days.",
  comfort: "Afternoon arrival — proper half-day on Day 1.",
};

const BUDGET_IMPACT_COLOURS: Record<"within" | "near" | "over", string> = {
  within: GRASS_GREEN,
  near: SUNSET_ORANGE,
  over: RED,
};
const BUDGET_IMPACT_LABELS: Record<"within" | "near" | "over", string> = {
  within: "Within budget",
  near: "Near budget",
  over: "Over budget",
};

// ─── Prop types ───────────────────────────────────────────────────────────────

interface VoteableFlightCardProps {
  category: "budget" | "best_value" | "comfort";
  priceRange?: string | null;
  estimatedDuration?: string | null;
  stops?: number | null;
  budgetImpact?: "within" | "near" | "over" | null;
  /** Full itinerary impact paragraph — shown in the "Why?" expanded section. */
  itineraryComfort?: string | null;
  /** Whether this option is currently selected (local draft, not yet submitted). */
  isSelected: boolean;
  /** True once the current user has submitted their vote — locks the card. */
  isLocked: boolean;
  /** Toggle this option's selection. Purely local — no network call. */
  onToggle: (category: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function VoteableFlightCard({
  category,
  priceRange,
  estimatedDuration,
  stops,
  budgetImpact,
  itineraryComfort,
  isSelected,
  isLocked,
  onToggle,
}: VoteableFlightCardProps) {
  const [expanded, setExpanded] = useState(false);

  function handleToggleClick() {
    if (isLocked) return;
    onToggle(category);
  }

  const label = CATEGORY_LABEL[category];
  const accent = CATEGORY_ACCENT[category];
  const impactLine = IMPACT_SUMMARY[category];
  const stopsChip = stops === 0 ? "Non-stop" : stops === 1 ? "1 stop" : stops != null ? `${stops} stops` : null;

  return (
    <article
      aria-label={`${label}${isSelected ? ", selected" : ""}`}
      style={{
        fontFamily: "'Courier New', Courier, monospace",
        backgroundColor: SAND_CREAM,
        border: `4px solid ${DEEP_NAVY}`,
        borderRadius: 0,
        boxShadow: `4px 4px 0 ${DEEP_NAVY}`,
        overflow: "hidden",
        width: "100%",
        minWidth: 0,
      }}
    >
      {/* ── Header — vote counts never shown ── */}
      <header
        style={{
          backgroundColor: accent,
          borderBottom: `4px solid ${DEEP_NAVY}`,
          padding: "8px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: DEEP_NAVY }}>
          ✈ {label}
        </h3>
        {isSelected && (
          <span
            aria-hidden="true"
            style={{
              backgroundColor: GRASS_GREEN,
              border: `2px solid ${DEEP_NAVY}`,
              padding: "1px 8px",
              fontSize: 12,
              fontWeight: 700,
              color: DEEP_NAVY,
              whiteSpace: "nowrap",
            }}
          >
            ✓ Selected
          </span>
        )}
      </header>

      {/* ── Chip row ── */}
      <div
        style={{
          padding: "10px 14px 0",
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {priceRange && <Chip label={priceRange} />}
        {estimatedDuration && <Chip label={`⏱ ${estimatedDuration}`} />}
        {stopsChip && <Chip label={stopsChip} />}
        {budgetImpact && (
          <Chip
            label={BUDGET_IMPACT_LABELS[budgetImpact]}
            bg={BUDGET_IMPACT_COLOURS[budgetImpact]}
          />
        )}
      </div>

      {/* ── Impact one-liner ── */}
      <div style={{ padding: "8px 14px 0" }}>
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: DEEP_NAVY,
            lineHeight: 1.4,
            borderLeft: `3px solid ${SUNSET_ORANGE}`,
            paddingLeft: 8,
          }}
        >
          {impactLine}
        </p>
      </div>

      {/* ── Expanded: full explanation ── */}
      {expanded && itineraryComfort && (
        <div
          style={{
            margin: "8px 14px 0",
            backgroundColor: "#FFF8E1",
            border: `2px solid ${SUNSET_ORANGE}`,
            padding: "8px 10px",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: DEEP_NAVY,
              opacity: 0.65,
              marginBottom: 4,
            }}
          >
            Full itinerary impact
          </p>
          <p style={{ margin: 0, fontSize: 12, color: DEEP_NAVY, lineHeight: 1.5, wordBreak: "break-word" }}>
            {itineraryComfort}
          </p>
        </div>
      )}

      {/* ── Footer: CTA row ── */}
      <div
        style={{
          padding: "10px 14px 12px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          marginTop: 4,
        }}
      >
        {/* Select / Selected button — purely local toggle; no vote counts shown */}
        <button
          type="button"
          onClick={handleToggleClick}
          disabled={isLocked}
          aria-label={
            isLocked
              ? isSelected
                ? `${label} was submitted as your vote`
                : `${label} — vote submitted`
              : isSelected
                ? `Deselect ${label}`
                : `Select ${label}`
          }
          aria-pressed={isSelected}
          className="voteable-flight-card__vote-btn"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "7px 16px",
            fontSize: 13,
            fontWeight: 700,
            color: DEEP_NAVY,
            backgroundColor: isSelected ? GRASS_GREEN : isLocked ? DEEP_NAVY : SUNSET_ORANGE,
            border: `3px solid ${DEEP_NAVY}`,
            borderRadius: 0,
            boxShadow: isLocked && !isSelected ? "none" : `3px 3px 0 ${DEEP_NAVY}`,
            cursor: isLocked ? "not-allowed" : "pointer",
            opacity: isLocked && !isSelected ? 0.65 : 1,
            outline: "none",
            transition: "background-color 0.1s",
          }}
        >
          {isSelected ? "✓ Selected" : "🗳 Select"}
        </button>

        {/* Why? toggle */}
        {itineraryComfort && (
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            aria-expanded={expanded}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "5px 12px",
              fontSize: 11,
              fontWeight: 700,
              color: DEEP_NAVY,
              backgroundColor: SKY_BLUE,
              border: `2px solid ${DEEP_NAVY}`,
              borderRadius: 0,
              boxShadow: `2px 2px 0 ${DEEP_NAVY}`,
              cursor: "pointer",
              outline: "none",
            }}
          >
            {expanded ? "▲ Less" : "▼ Why?"}
          </button>
        )}


      </div>
    </article>
  );
}

// ─── Chip ────────────────────────────────────────────────────────────────────

function Chip({ label, bg = SAND_CREAM }: { label: string; bg?: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        backgroundColor: bg,
        border: `2px solid ${DEEP_NAVY}`,
        borderRadius: 0,
        padding: "3px 8px",
        fontSize: 11,
        fontWeight: 700,
        color: DEEP_NAVY,
        whiteSpace: "nowrap",
        boxShadow: `1px 1px 0 ${DEEP_NAVY}`,
      }}
    >
      {label}
    </span>
  );
}
