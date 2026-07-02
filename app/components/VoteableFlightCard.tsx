"use client";

/**
 * VoteableFlightCard — displays a single flight category option with voting.
 *
 * Used in the FLIGHTS and FLIGHT_VOTE stages inside TripAgentChat's
 * InteractiveSlot. Each card represents one of the three flight categories
 * ("budget" | "best_value" | "comfort") and allows a user to vote once.
 *
 * Badges rendered:
 *   - Category name (always — derived from `category` prop)
 *   - Price range     (from `priceRange`      — omitted when null/undefined)
 *   - Travel duration (from `estimatedDuration`— omitted when null/undefined)
 *   - Stops           (from `stops`            — omitted when null/undefined)
 *   - Budget impact   (from `budgetImpact`     — omitted when null/undefined)
 *     green (#4ADE80) when "within", amber (#FB923C) when "near", red (#EF4444) when "over"
 *   - Itinerary comfort (from `itineraryComfort` — omitted when null/undefined)
 * Badges are discrete visual elements — NOT rendered as prose sentences.
 *
 * Optimistic vote pattern (mirrors VoteableDestinationCard, Req 8.5):
 *   1. On Vote click: increment displayedCount, set localHasVoted=true
 *   2. POST /api/votes with voteType:"flight"
 *   3a. 2xx         → retain optimistic state
 *   3b. 409         → retain optimistic state (vote already counted)
 *   3c. 5xx / throw → revert displayedCount and localHasVoted, show voteError
 *
 * Server reconciliation: when `voteCount` prop from server ≥ displayedCount,
 * accept the server value to avoid double-incrementing on next poll.
 *
 * Vote button: labelled "🗳 Vote", disabled and visually distinct when
 * `hasVoted` (or `localHasVoted`) is true.
 *
 * Visual rules (pixel-art, Req 12.4, 12.5):
 *   - Zero border-radius
 *   - 4px solid deep-navy border on card; 2px on badges
 *   - 4px 4px 0 #1E3A5F box-shadow on card
 *   - Monospace font throughout
 *   - No white (#ffffff) backgrounds — palette colours only
 *   - focus-visible: outline 3px solid #A855F7, offset 2px
 *
 * Palette:
 *   Deep navy     #1E3A5F  — borders, text
 *   Sand cream    #FEF3C7  — card background
 *   Grass green   #4ADE80  — "within" budget badge
 *   Sunset orange #FB923C  — "near" budget badge
 *   Red           #EF4444  — "over" budget badge
 *   Sky blue      #38BDF8  — vote count badge
 *   Neon purple   #A855F7  — focus ring
 *
 * Requirements: 8.2, 8.3, 8.4, 8.5, 12.4, 12.5
 */

import React, { useEffect, useState } from "react";

// ─── Palette ─────────────────────────────────────────────────────────────────

const DEEP_NAVY = "#1E3A5F";
const SAND_CREAM = "#FEF3C7";
const GRASS_GREEN = "#4ADE80";
const SUNSET_ORANGE = "#FB923C";
const RED = "#EF4444";
const SKY_BLUE = "#38BDF8";
const NEON_PURPLE = "#A855F7";

// ─── Category display labels ──────────────────────────────────────────────────

const CATEGORY_LABELS: Record<"budget" | "best_value" | "comfort", string> = {
  budget: "Budget Flights",
  best_value: "Best Value",
  comfort: "Comfort",
};

/** Accent colours per category (card header background). */
const CATEGORY_ACCENT: Record<"budget" | "best_value" | "comfort", string> = {
  budget: GRASS_GREEN,
  best_value: SKY_BLUE,
  comfort: NEON_PURPLE,
};

// ─── Budget impact colours ────────────────────────────────────────────────────

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
  /** The flight tier category. Determines display name and card accent colour. */
  category: "budget" | "best_value" | "comfort";
  /** Formatted price range string, e.g. "$180–$250". Omit badge if not provided. */
  priceRange?: string | null;
  /** Formatted duration string, e.g. "~8 hrs". Omit badge if not provided. */
  estimatedDuration?: string | null;
  /** Number of stops. Omit badge if not provided (null/undefined). */
  stops?: number | null;
  /** Budget impact classification. Omit badge if not provided. */
  budgetImpact?: "within" | "near" | "over" | null;
  /** Free-form itinerary comfort label, e.g. "Comfortable". Omit badge if not provided. */
  itineraryComfort?: string | null;
  /** True if the current user has already voted for this flight category. */
  hasVoted: boolean;
  /** Server-authoritative vote count for this category. */
  voteCount: number;
  /** Async callback that triggers POST /api/votes for this category. */
  onVote: (category: string) => Promise<void>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function VoteableFlightCard({
  category,
  priceRange,
  estimatedDuration,
  stops,
  budgetImpact,
  itineraryComfort,
  hasVoted,
  voteCount,
  onVote,
}: VoteableFlightCardProps) {
  // ── Optimistic vote state ──────────────────────────────────────────────────
  const [displayedCount, setDisplayedCount] = useState(voteCount);
  const [localHasVoted, setLocalHasVoted] = useState(hasVoted);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [isVoting, setIsVoting] = useState(false);

  // Reconcile with server: accept server value when it is ≥ local optimistic count.
  // This prevents a double-increment if the poll arrives after an optimistic update.
  // Also sync localHasVoted DOWN — if the server says this option is no longer the
  // user's vote (they changed to a different option), clear the local voted state.
  useEffect(() => {
    if (voteCount >= displayedCount) {
      setDisplayedCount(voteCount);
    }
    // If server says hasVoted is true, mark locally as voted.
    // If server says hasVoted is false (user changed to another option), unmark.
    setLocalHasVoted(hasVoted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voteCount, hasVoted]);

  // ── Vote handler ───────────────────────────────────────────────────────────
  async function handleVoteClick(clickedCategory: string) {
    if (isVoting) return;
    // If clicking the same option already voted, treat as a no-op.
    if (localHasVoted && clickedCategory === category) return;

    const previousCount = displayedCount;
    const wasVoted = localHasVoted;

    // Optimistic update: increment if new vote, otherwise it's a change
    if (!localHasVoted) {
      setDisplayedCount((prev) => prev + 1);
    }
    setLocalHasVoted(true);
    setVoteError(null);
    setIsVoting(true);

    try {
      await onVote(clickedCategory);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("409")) {
        // Duplicate — retain
      } else {
        // Revert on real failure
        setDisplayedCount(previousCount);
        setLocalHasVoted(wasVoted);
        setVoteError("Vote failed — please try again");
      }
    } finally {
      setIsVoting(false);
    }
  }

  // ── Derived display values ─────────────────────────────────────────────────
  const categoryLabel = CATEGORY_LABELS[category];
  const accentColour = CATEGORY_ACCENT[category];

  const stopsLabel =
    stops === 0
      ? "Non-stop"
      : stops === 1
        ? "1 stop"
        : stops != null
          ? `${stops} stops`
          : null;

  return (
    <article
      aria-label={`${categoryLabel} flight option — ${displayedCount} vote${displayedCount !== 1 ? "s" : ""}`}
      style={{
        fontFamily: "'Courier New', Courier, monospace",
        backgroundColor: SAND_CREAM,
        border: `4px solid ${DEEP_NAVY}`,
        borderRadius: 0,
        boxShadow: `4px 4px 0 ${DEEP_NAVY}`,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        maxWidth: "100%",
        width: "100%",
      }}
    >
      {/* ── Card header: category name + accent bar ── */}
      <header
        style={{
          backgroundColor: accentColour,
          borderBottom: `4px solid ${DEEP_NAVY}`,
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            color: DEEP_NAVY,
            fontFamily: "'Courier New', Courier, monospace",
            letterSpacing: "0.03em",
          }}
        >
          ✈ {categoryLabel}
        </h3>

        {/* Vote count badge */}
        <span
          aria-label={`${displayedCount} vote${displayedCount !== 1 ? "s" : ""}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            backgroundColor: SAND_CREAM,
            border: `2px solid ${DEEP_NAVY}`,
            borderRadius: 0,
            padding: "2px 8px",
            fontSize: 13,
            fontWeight: 700,
            color: DEEP_NAVY,
            whiteSpace: "nowrap",
          }}
        >
          🗳 {displayedCount}
        </span>
      </header>

      {/* ── Badge row ── */}
      <div
        style={{
          padding: "12px 16px 8px",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "flex-start",
        }}
      >
        {/* Price range badge */}
        {priceRange != null && priceRange !== "" && (
          <FlightBadge
            label="Price"
            value={priceRange}
            bg={SAND_CREAM}
          />
        )}

        {/* Duration badge */}
        {estimatedDuration != null && estimatedDuration !== "" && (
          <FlightBadge
            label="Duration"
            value={estimatedDuration}
            bg={SAND_CREAM}
          />
        )}

        {/* Stops badge */}
        {stopsLabel != null && (
          <FlightBadge
            label="Stops"
            value={stopsLabel}
            bg={SAND_CREAM}
          />
        )}

        {/* Budget impact badge */}
        {budgetImpact != null && (
          <FlightBadge
            label="Budget"
            value={BUDGET_IMPACT_LABELS[budgetImpact]}
            bg={BUDGET_IMPACT_COLOURS[budgetImpact]}
          />
        )}

        {/* Itinerary comfort badge */}
        {itineraryComfort != null && itineraryComfort !== "" && (
          <FlightBadge
            label="Comfort"
            value={itineraryComfort}
            bg={SAND_CREAM}
          />
        )}
      </div>

      {/* ── Vote button + error ── */}
      <div
        style={{
          padding: "8px 16px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          alignItems: "flex-start",
        }}
      >
        <button
          type="button"
          onClick={() => void handleVoteClick(category)}
          disabled={isVoting}
          aria-label={
            localHasVoted
              ? `Change vote — currently voted for ${categoryLabel}`
              : `Vote for ${categoryLabel} flights`
          }
          aria-pressed={localHasVoted}
          className="voteable-flight-card__vote-btn"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 18px",
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: 14,
            fontWeight: 700,
            color: isVoting ? SAND_CREAM : DEEP_NAVY,
            backgroundColor: localHasVoted
              ? "#4ADE80"   // green = voted
              : isVoting
                ? DEEP_NAVY
                : SUNSET_ORANGE,
            border: `3px solid ${DEEP_NAVY}`,
            borderRadius: 0,
            boxShadow: isVoting ? "none" : `3px 3px 0 ${DEEP_NAVY}`,
            cursor: isVoting ? "not-allowed" : "pointer",
            opacity: isVoting ? 0.65 : 1,
            transition: "background-color 0.1s, box-shadow 0.1s",
            outline: "none",
          }}
          onFocus={(e) => {
            e.currentTarget.style.outline = `3px solid ${NEON_PURPLE}`;
            e.currentTarget.style.outlineOffset = "2px";
          }}
          onBlur={(e) => {
            e.currentTarget.style.outline = "none";
          }}
        >
          🗳 {isVoting ? "Saving…" : localHasVoted ? "Voted ✓" : "Vote"}
        </button>

        {/* Inline error message */}
        {voteError != null && (
          <p
            role="alert"
            style={{
              margin: 0,
              fontSize: 12,
              fontWeight: 600,
              color: RED,
              fontFamily: "'Courier New', Courier, monospace",
            }}
          >
            ⚠ {voteError}
          </p>
        )}
      </div>
    </article>
  );
}

// ─── Badge sub-component ──────────────────────────────────────────────────────

interface FlightBadgeProps {
  /** Short uppercase label shown above the value. */
  label: string;
  /** The value string to display. */
  value: string;
  /** Background colour of the badge. */
  bg: string;
}

function FlightBadge({ label, value, bg }: FlightBadgeProps) {
  return (
    <span
      aria-label={`${label}: ${value}`}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        border: `2px solid ${DEEP_NAVY}`,
        borderRadius: 0,
        boxShadow: `2px 2px 0 ${DEEP_NAVY}`,
        padding: "4px 8px",
        minWidth: 0,           // allow shrinking inside flex containers
        maxWidth: "100%",
        fontFamily: "'Courier New', Courier, monospace",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: DEEP_NAVY,
          lineHeight: 1,
          marginBottom: 2,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: DEEP_NAVY,
          lineHeight: 1.2,
          wordBreak: "break-word",    // wrap long values instead of overflowing
          overflowWrap: "break-word",
          textAlign: "center",
        }}
      >
        {value}
      </span>
    </span>
  );
}
