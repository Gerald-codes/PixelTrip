"use client";

/**
 * VoteableDestinationCard — enriched destination suggestion card for voting.
 *
 * Used in the DESTINATIONS and DESTINATION_VOTE stages inside TripAgentChat's
 * InteractiveSlot. Each card represents one AI-generated destination that the
 * current user can select (toggleable) before submitting their full ballot.
 *
 * Selection model — deliberately simple to avoid the previous bugs where
 * clicking a card instantly cast an irreversible server-side vote:
 *   - Clicking the card toggles `isSelected` — purely local state managed by
 *     the parent (TripAgentChat). No network call happens on click.
 *   - The user can select/deselect any number of cards freely.
 *   - Once the parent's "Submit votes" button is clicked, all selected cards
 *     become `isLocked` — no further toggling, and the selection is final.
 *   - Vote counts are NEVER shown on this card, before or after submission.
 *     Results are revealed only via the tiebreak panel or the winner
 *     announcement once everyone has submitted, so no one can see how the
 *     group is leaning mid-vote.
 *
 * Collapsed (default) view shows:
 *   - Destination name + fit score badge
 *   - "Why this fits" summary (≤ 30 words — from recommendationReason, truncated)
 *   - Price level badge   (green=budget, amber=moderate, red=premium)
 *   - Crowd level badge   (green=low, amber=moderate, red=high)
 *   - Best season/weather badge
 *   - Select button (toggles selection)
 *   - "View full details" toggle (collapsed)
 *
 * Expanded view (toggled) additionally shows:
 *   - Full recommendationReason
 *   - Downsides list
 *   - Best activities list
 *   - personaFitSummary
 *
 * Select button: label "🗳 Select" / "✓ Selected", locked once submitted.
 * "View full details" toggle: `expanded` state, collapsed by default.
 *
 * Visual rules (pixel-art, Req 12.5):
 *   - Zero border-radius
 *   - 4px solid deep-navy (var(--pt-bg-card)) border on card; 2px on badges
 *   - 4px 4px 0 var(--pt-bg-card) box-shadow on card, 2px 2px 0 var(--pt-bg-card) on badges
 *   - Monospace font throughout
 *   - No white (#ffffff) backgrounds — palette colours only
 *   - focus-visible: outline 3px solid var(--pt-agent-atlas), offset 2px (via className)
 *
 * Badge colours per Req 12.2:
 *   Price level:  budget=green, moderate=amber, premium=red
 *   Crowd level:  low=green, moderate=amber, high=red
 *   Fit score:    ≥80=green, ≥60=sky-blue, ≥40=amber, <40=red
 *
 * Palette:
 *   Deep navy     var(--pt-bg-card)  — borders, text, box-shadow
 *   Sand cream    var(--pt-bg-card)  — card background
 *   Sky blue      #38BDF8  — card header accent, fit score (mid)
 *   Grass green   #4ADE80  — good/low/budget badge
 *   Sunset orange #FB923C  — moderate/near badge (amber)
 *   Red           #EF4444  — premium/high/over badge
 *   Neon purple   var(--pt-agent-atlas)  — focus ring, vote count badge accent
 *
 * Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 12.3, 12.4, 12.5, 12.7
 */

import React, { useState } from "react";
import type { DestinationSuggestion } from "@/lib/types";

// ─── Palette ─────────────────────────────────────────────────────────────────

const DEEP_NAVY = "var(--pt-bg-deep, #0F1B2E)";
const SAND_CREAM = "var(--pt-text-primary, #E8ECF1)";
const SKY_BLUE = "#38BDF8";
const GRASS_GREEN = "#4ADE80";
const SUNSET_ORANGE = "#FB923C";
const RED = "#EF4444";
const NEON_PURPLE = "var(--pt-agent-atlas)";

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
  /**
   * Whether this destination is currently selected by the current user
   * (toggleable — a local draft, not yet submitted to the server).
   */
  isSelected: boolean;
  /**
   * True once the current user has submitted their votes for this round.
   * When true, the card is locked (read-only) and shows its final selected
   * state — no further toggling is possible.
   */
  isLocked: boolean;
  /**
   * Toggle this destination's selection on/off. Purely local state — no
   * network call happens until the parent's "Submit votes" button is clicked.
   * Vote counts are intentionally never shown on this card: results are only
   * revealed once everyone has submitted (via the tiebreak panel or the
   * winner announcement), so no one can see how others are leaning mid-vote.
   */
  onToggle: (destinationId: string) => void;
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
        borderRadius: 8,
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
  isSelected,
  isLocked,
  onToggle,
}: VoteableDestinationCardProps) {
  // ── Expanded / collapsed detail toggle ────────────────────────────────────
  const [expanded, setExpanded] = useState(false);

  // ── Toggle handler — purely local; no network call happens here ──────────
  function handleToggleClick() {
    if (isLocked) return;
    onToggle(suggestion.id);
  }

  // ── Derived display values ─────────────────────────────────────────────────
  const isDisabled = isLocked;
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
        aria-label={`${suggestion.destinationName} — ${fitScore}/100 fit${isSelected ? ", selected" : ""}`}
        style={{
          fontFamily: "'Courier New', Courier, monospace",
          backgroundColor: SAND_CREAM,
          border: `4px solid ${DEEP_NAVY}`,
          borderRadius: 8,
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
              borderRadius: 8,
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
          {/* Select button row — purely local toggle; no vote counts shown */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={handleToggleClick}
              disabled={isDisabled}
              aria-label={
                isLocked
                  ? isSelected
                    ? `${suggestion.destinationName} was submitted as one of your choices`
                    : `${suggestion.destinationName} — votes submitted`
                  : isSelected
                    ? `Deselect ${suggestion.destinationName}`
                    : `Select ${suggestion.destinationName}`
              }
              aria-pressed={isSelected}
              className="vdc-vote-btn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 18px",
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: 14,
                fontWeight: 700,
                color: isSelected ? DEEP_NAVY : isDisabled ? SAND_CREAM : DEEP_NAVY,
                backgroundColor: isSelected ? GRASS_GREEN : isDisabled ? DEEP_NAVY : SUNSET_ORANGE,
                border: `3px solid ${DEEP_NAVY}`,
                borderRadius: 8,
                boxShadow: isDisabled && !isSelected ? "none" : `3px 3px 0 ${DEEP_NAVY}`,
                cursor: isDisabled ? "not-allowed" : "pointer",
                opacity: isDisabled && !isSelected ? 0.65 : 1,
                outline: "none",
                transition: "background-color 0.1s, box-shadow 0.1s",
              }}
            >
              {isSelected ? "✓ Selected" : "🗳 Select"}
            </button>
          </div>

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
              borderRadius: 8,
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
