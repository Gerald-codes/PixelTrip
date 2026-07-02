"use client";

/**
 * VoteableDestinationCard — enriched destination suggestion card with voting.
 *
 * Used in the DESTINATIONS and DESTINATION_VOTE stages inside TripAgentChat's
 * InteractiveSlot. Each card represents one AI-generated destination and lets
 * the current user cast a single vote.
 *
 * Collapsed (default) view shows:
 *   - Destination name + fit score badge
 *   - "Why this fits" summary (≤ 30 words — from recommendationReason, truncated)
 *   - Price level badge   (green=budget, amber=moderate, red=premium)
 *   - Crowd level badge   (green=low, amber=moderate, red=high)
 *   - Best season/weather badge
 *   - Vote button + vote count
 *   - "View full details" toggle (collapsed)
 *
 * Expanded view (toggled) additionally shows:
 *   - Full recommendationReason
 *   - Downsides list
 *   - Best activities list
 *   - personaFitSummary
 *
 * Optimistic vote pattern (Req 7.5):
 *   1. Click Vote → increment displayedCount immediately, set localHasVoted=true
 *   2. POST /api/votes via onVote callback
 *   3a. 2xx   → retain optimistic state
 *   3b. 409   → retain optimistic state (vote already registered in DB)
 *   3c. 5xx/network error → revert count, revert localHasVoted, set voteError
 *
 * Server reconciliation: when `voteCount` prop from server ≥ displayedCount,
 * accept server value (prevents double-increment if optimistic + poll overlap).
 *
 * Vote button: label "🗳 Vote", disabled + visually distinct when user has voted.
 * "View full details" toggle: `expanded` state, collapsed by default.
 *
 * Visual rules (pixel-art, Req 12.5):
 *   - Zero border-radius
 *   - 4px solid deep-navy (#1E3A5F) border on card; 2px on badges
 *   - 4px 4px 0 #1E3A5F box-shadow on card, 2px 2px 0 #1E3A5F on badges
 *   - Monospace font throughout
 *   - No white (#ffffff) backgrounds — palette colours only
 *   - focus-visible: outline 3px solid #A855F7, offset 2px (via className)
 *
 * Badge colours per Req 12.2:
 *   Price level:  budget=green, moderate=amber, premium=red
 *   Crowd level:  low=green, moderate=amber, high=red
 *   Fit score:    ≥80=green, ≥60=sky-blue, ≥40=amber, <40=red
 *
 * Palette:
 *   Deep navy     #1E3A5F  — borders, text, box-shadow
 *   Sand cream    #FEF3C7  — card background
 *   Sky blue      #38BDF8  — card header accent, fit score (mid)
 *   Grass green   #4ADE80  — good/low/budget badge
 *   Sunset orange #FB923C  — moderate/near badge (amber)
 *   Red           #EF4444  — premium/high/over badge
 *   Neon purple   #A855F7  — focus ring, vote count badge accent
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 12.3, 12.4, 12.5, 12.7
 */

import React, { useEffect, useState } from "react";
import type { DestinationSuggestion } from "@/lib/types";

// ─── Palette ─────────────────────────────────────────────────────────────────

const DEEP_NAVY = "#1E3A5F";
const SAND_CREAM = "#FEF3C7";
const SKY_BLUE = "#38BDF8";
const GRASS_GREEN = "#4ADE80";
const SUNSET_ORANGE = "#FB923C";
const RED = "#EF4444";
const NEON_PURPLE = "#A855F7";

// ─── Badge colour maps ────────────────────────────────────────────────────────

const PRICE_COLOURS: Record<"budget" | "moderate" | "premium", string> = {
  budget: GRASS_GREEN,
  moderate: SUNSET_ORANGE,
  premium: RED,
};

const PRICE_LABELS: Record<"budget" | "moderate" | "premium", string> = {
  budget: "💸 Budget",
  moderate: "💸 Mid-range",
  premium: "💸 Premium",
};

const CROWD_COLOURS: Record<"low" | "moderate" | "high", string> = {
  low: GRASS_GREEN,
  moderate: SUNSET_ORANGE,
  high: RED,
};

const CROWD_LABELS: Record<"low" | "moderate" | "high", string> = {
  low: "👥 Low crowds",
  moderate: "👥 Moderate",
  high: "👥 Heavy crowds",
};

// ─── Prop types ───────────────────────────────────────────────────────────────

interface VoteableDestinationCardProps {
  /** The full AI-generated destination suggestion. */
  suggestion: DestinationSuggestion;
  /** The current user's ID — used for aria labelling. */
  currentUserId: string;
  /** Whether the current user has already voted for this destination. */
  hasVoted: boolean;
  /** Server-authoritative vote count for this destination. */
  voteCount: number;
  /** Async callback that triggers POST /api/votes for this destination. */
  onVote: (destinationId: string) => Promise<void>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Truncate a string to at most `maxWords` words. If truncated, appends "…".
 * Used to enforce the ≤30-word "Why this fits" summary.
 */
function truncateToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "…";
}

/**
 * Colour for the fit score badge.
 *   ≥80 → grass green
 *   ≥60 → sky blue
 *   ≥40 → sunset orange
 *   <40  → red
 */
function fitScoreColour(score: number): string {
  if (score >= 80) return GRASS_GREEN;
  if (score >= 60) return SKY_BLUE;
  if (score >= 40) return SUNSET_ORANGE;
  return RED;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface BadgeProps {
  label: string;
  bg: string;
  /** Optional contrasting text colour — defaults to DEEP_NAVY. */
  textColor?: string;
}

function PixelBadge({ label, bg, textColor = DEEP_NAVY }: BadgeProps) {
  return (
    <span
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        backgroundColor: bg,
        border: `2px solid ${DEEP_NAVY}`,
        borderRadius: 0,
        boxShadow: `2px 2px 0 ${DEEP_NAVY}`,
        padding: "3px 10px",
        fontSize: 12,
        fontWeight: 700,
        color: textColor,
        fontFamily: "'Courier New', Courier, monospace",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VoteableDestinationCard({
  suggestion,
  currentUserId: _currentUserId, // retained in props for API parity; unused in rendering
  hasVoted,
  voteCount,
  onVote,
}: VoteableDestinationCardProps) {
  // ── Optimistic vote state ──────────────────────────────────────────────────
  const [displayedCount, setDisplayedCount] = useState(voteCount);
  const [localHasVoted, setLocalHasVoted] = useState(hasVoted);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [isVoting, setIsVoting] = useState(false);

  // ── Expanded / collapsed detail toggle ────────────────────────────────────
  const [expanded, setExpanded] = useState(false);

  // ── Server reconciliation ──────────────────────────────────────────────────
  // When the parent polls and passes a fresher voteCount prop, accept it if
  // it's ≥ our optimistic local count (prevents double-increment on poll overlap).
  useEffect(() => {
    if (voteCount >= displayedCount) {
      setDisplayedCount(voteCount);
    }
    // Sync hasVoted from server only when it becomes true (can't un-vote server-side).
    if (hasVoted) {
      setLocalHasVoted(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voteCount, hasVoted]);

  // ── Vote handler ───────────────────────────────────────────────────────────
  async function handleVoteClick() {
    if (localHasVoted || isVoting) return;

    const previousCount = displayedCount;

    // Step 1: Optimistic update — immediate, < 100ms
    setDisplayedCount((prev) => prev + 1);
    setLocalHasVoted(true);
    setVoteError(null);
    setIsVoting(true);

    try {
      // Step 2: Delegate POST /api/votes to parent callback
      await onVote(suggestion.id);
      // Step 3a: 2xx — retain optimistic state (already applied)
    } catch (err: unknown) {
      // onVote is expected to throw an Error whose message contains the HTTP
      // status code on server errors. "409" = duplicate vote → retain optimistic.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("409")) {
        // Step 3b: Duplicate vote — vote was already counted; retain optimistic.
      } else {
        // Step 3c: 5xx or network error — revert
        setDisplayedCount(previousCount);
        setLocalHasVoted(false);
        setVoteError("Vote failed — please try again");
      }
    } finally {
      setIsVoting(false);
    }
  }

  // ── Derived display values ─────────────────────────────────────────────────
  const isDisabled = localHasVoted || isVoting;
  const fitScore = Math.round(suggestion.fitScore);
  const fitBg = fitScoreColour(fitScore);

  // "Why this fits" summary — capped at 30 words (Req 7.3, 12.3)
  const whyThisFits = truncateToWords(suggestion.recommendationReason, 30);

  // Season/weather badge — combine best season + weather cues
  const seasonBadge =
    suggestion.seasonalitySummary.length > 0
      ? `🌤 ${truncateToWords(suggestion.seasonalitySummary, 6)}`
      : suggestion.weatherSummary.length > 0
        ? `🌤 ${truncateToWords(suggestion.weatherSummary, 6)}`
        : null;

  return (
    <>
      {/* Inject focus-visible ring style once */}
      <style>{`
        .vdc-vote-btn:focus-visible,
        .vdc-toggle-btn:focus-visible {
          outline: 3px solid ${NEON_PURPLE};
          outline-offset: 2px;
        }
      `}</style>

      <article
        aria-label={`${suggestion.destinationName} — ${fitScore}/100 fit, ${displayedCount} vote${displayedCount !== 1 ? "s" : ""}`}
        style={{
          fontFamily: "'Courier New', Courier, monospace",
          backgroundColor: SAND_CREAM,
          border: `4px solid ${DEEP_NAVY}`,
          borderRadius: 0,
          boxShadow: `4px 4px 0 ${DEEP_NAVY}`,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* ── Card header: destination name + fit score ── */}
        <header
          style={{
            backgroundColor: SKY_BLUE,
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
              letterSpacing: "0.02em",
              lineHeight: 1.2,
            }}
          >
            📍 {suggestion.destinationName}
          </h3>

          {/* Fit score badge */}
          <span
            aria-label={`Fit score: ${fitScore} out of 100`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              backgroundColor: fitBg,
              border: `2px solid ${DEEP_NAVY}`,
              borderRadius: 0,
              boxShadow: `2px 2px 0 ${DEEP_NAVY}`,
              padding: "3px 10px",
              fontSize: 13,
              fontWeight: 700,
              color: DEEP_NAVY,
              fontFamily: "'Courier New', Courier, monospace",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 10, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Fit
            </span>
            <span>{fitScore}</span>
            <span style={{ fontSize: 10, opacity: 0.7 }}>/100</span>
          </span>
        </header>

        {/* ── Body ── */}
        <div
          style={{
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* "Why this fits" summary — ≤ 30 words (Req 7.3, 12.3) */}
          <section aria-label="Why this fits">
            <p
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 600,
                color: DEEP_NAVY,
                lineHeight: 1.55,
                fontFamily: "'Courier New', Courier, monospace",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  display: "block",
                  marginBottom: 3,
                  color: DEEP_NAVY,
                  opacity: 0.65,
                }}
              >
                Why this fits
              </span>
              {whyThisFits}
            </p>
          </section>

        {/* ── Badge row: price, crowd, season ── */}
          <section
            aria-label="Destination badges"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              alignItems: "flex-start",
            }}
          >
            <PixelBadge
              label={PRICE_LABELS[suggestion.priceLevel]}
              bg={PRICE_COLOURS[suggestion.priceLevel]}
            />
            <PixelBadge
              label={CROWD_LABELS[suggestion.crowdLevel]}
              bg={CROWD_COLOURS[suggestion.crowdLevel]}
            />
            {seasonBadge != null && (
              <PixelBadge label={seasonBadge} bg={SAND_CREAM} />
            )}
          </section>

          {/* ── First trade-off always visible (collapsed) ── */}
          {suggestion.downsides.length > 0 && !expanded && (
            <div
              style={{
                borderLeft: `3px solid ${SUNSET_ORANGE}`,
                paddingLeft: 8,
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
                  opacity: 0.6,
                  marginBottom: 2,
                  fontFamily: "'Courier New', Courier, monospace",
                }}
              >
                Trade-off
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  color: DEEP_NAVY,
                  lineHeight: 1.4,
                  fontFamily: "'Courier New', Courier, monospace",
                  wordBreak: "break-word",
                }}
              >
                {suggestion.downsides[0]}
              </p>
            </div>
          )}

          {/* ── Expanded details section (collapsed by default) ── */}
          {expanded && (
            <section
              id={`vdc-details-${suggestion.id}`}
              aria-label="Full destination details"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                borderTop: `2px solid ${DEEP_NAVY}`,
                paddingTop: 12,
              }}
            >
              {/* Full recommendation reason */}
              <div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    color: DEEP_NAVY,
                    opacity: 0.65,
                    marginBottom: 4,
                    fontFamily: "'Courier New', Courier, monospace",
                  }}
                >
                  Recommendation
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    lineHeight: 1.55,
                    color: DEEP_NAVY,
                    fontFamily: "'Courier New', Courier, monospace",
                  }}
                >
                  {suggestion.recommendationReason}
                </p>
              </div>

              {/* Persona fit summary */}
              {suggestion.personaFitSummary && (
                <div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      color: DEEP_NAVY,
                      opacity: 0.65,
                      marginBottom: 4,
                      fontFamily: "'Courier New', Courier, monospace",
                    }}
                  >
                    Fit for this group
                  </p>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      lineHeight: 1.55,
                      color: DEEP_NAVY,
                      fontFamily: "'Courier New', Courier, monospace",
                    }}
                  >
                    {suggestion.personaFitSummary}
                  </p>
                </div>
              )}

              {/* Best activities */}
              {suggestion.bestActivities.length > 0 && (
                <div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      color: DEEP_NAVY,
                      opacity: 0.65,
                      marginBottom: 6,
                      fontFamily: "'Courier New', Courier, monospace",
                    }}
                  >
                    Best activities
                  </p>
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    {suggestion.bestActivities.map((activity, i) => (
                      <li
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                          fontSize: 13,
                          color: DEEP_NAVY,
                          fontFamily: "'Courier New', Courier, monospace",
                          lineHeight: 1.45,
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-block",
                            width: 6,
                            height: 6,
                            marginTop: 5,
                            backgroundColor: SKY_BLUE,
                            flexShrink: 0,
                          }}
                        />
                        {activity}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Downsides */}
              {suggestion.downsides.length > 0 && (
                <div
                  style={{
                    borderLeft: `4px solid ${SUNSET_ORANGE}`,
                    paddingLeft: 12,
                    paddingTop: 8,
                    paddingBottom: 8,
                    backgroundColor: SAND_CREAM, // palette colour — no white/near-white surfaces
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 6px 0",
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      color: DEEP_NAVY,
                      fontFamily: "'Courier New', Courier, monospace",
                    }}
                  >
                    Honest trade-offs
                  </p>
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    {suggestion.downsides.map((d, i) => (
                      <li
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 6,
                          fontSize: 13,
                          color: DEEP_NAVY,
                          fontFamily: "'Courier New', Courier, monospace",
                          lineHeight: 1.45,
                        }}
                      >
                        <span aria-hidden="true">•</span>
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>

        {/* ── Footer: vote button + count + expand toggle ── */}
        <footer
          style={{
            padding: "10px 16px 14px",
            borderTop: `2px solid ${DEEP_NAVY}`,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {/* Vote button row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            {/* Vote button */}
            <button
              type="button"
              onClick={() => void handleVoteClick()}
              disabled={isDisabled}
              aria-label={
                localHasVoted
                  ? `You have already voted for ${suggestion.destinationName}`
                  : `Vote for ${suggestion.destinationName}`
              }
              aria-pressed={localHasVoted}
              className="vdc-vote-btn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 18px",
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: 14,
                fontWeight: 700,
                color: isDisabled ? SAND_CREAM : DEEP_NAVY,
                backgroundColor: isDisabled ? DEEP_NAVY : SUNSET_ORANGE,
                border: `3px solid ${DEEP_NAVY}`,
                borderRadius: 0,
                boxShadow: isDisabled ? "none" : `3px 3px 0 ${DEEP_NAVY}`,
                cursor: isDisabled ? "not-allowed" : "pointer",
                opacity: isDisabled ? 0.65 : 1,
                outline: "none",
                transition: "background-color 0.1s, box-shadow 0.1s",
              }}
            >
              🗳 {localHasVoted ? "Voted" : "Vote"}
            </button>

            {/* Vote count badge */}
            <span
              aria-label={`${displayedCount} vote${displayedCount !== 1 ? "s" : ""}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                backgroundColor: NEON_PURPLE,
                border: `2px solid ${DEEP_NAVY}`,
                borderRadius: 0,
                boxShadow: `2px 2px 0 ${DEEP_NAVY}`,
                padding: "3px 10px",
                fontSize: 13,
                fontWeight: 700,
                color: SAND_CREAM,
                fontFamily: "'Courier New', Courier, monospace",
                whiteSpace: "nowrap",
              }}
            >
              🗳 {displayedCount}
            </span>
          </div>

          {/* Inline vote error */}
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

          {/* "View full details" toggle */}
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            aria-controls={`vdc-details-${suggestion.id}`}
            className="vdc-toggle-btn"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: 12,
              fontWeight: 700,
              color: DEEP_NAVY,
              backgroundColor: SKY_BLUE,
              border: `2px solid ${DEEP_NAVY}`,
              borderRadius: 0,
              boxShadow: `2px 2px 0 ${DEEP_NAVY}`,
              cursor: "pointer",
              outline: "none",
              alignSelf: "flex-start",
              transition: "background-color 0.1s",
            }}
          >
            {expanded ? "▲ Hide details" : "▼ View full details"}
          </button>
        </footer>
      </article>
    </>
  );
}
