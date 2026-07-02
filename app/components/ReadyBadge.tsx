"use client";

/**
 * ReadyBadge — per-member submission status indicator.
 *
 * Displays a pixel-art badge showing whether a trip-room member has submitted
 * their response for the current stage.
 *
 * Submitted   — grass green (#4ADE80) background, ✔ icon, deep-navy text
 * Not submitted — sunset orange (#FB923C) background, … icon, deep-navy text
 *
 * Visual rules (pixel-art):
 *   - Zero border-radius (no rounded corners)
 *   - 2px solid deep-navy (#1E3A5F) border
 *   - 4px 4px 0 #1E3A5F box-shadow (blocky offset shadow)
 *   - Monospace font throughout
 *   - No white backgrounds
 *
 * Accessibility:
 *   - aria-label describes both the member name and their current status
 *
 * Palette:
 *   Grass green   #4ADE80  — submitted background
 *   Sunset orange #FB923C  — pending background
 *   Deep navy     #1E3A5F  — border, shadow, text
 */

import React from "react";

// ─── Prop types ───────────────────────────────────────────────────────────────

interface ReadyBadgeProps {
  /** Whether this member has submitted for the current stage. */
  submitted: boolean;
  /** The member's display name shown inside the badge. */
  displayName: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEEP_NAVY = "#1E3A5F";
const GRASS_GREEN = "#4ADE80";
const SUNSET_ORANGE = "#FB923C";

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReadyBadge({ submitted, displayName }: ReadyBadgeProps) {
  const bg = submitted ? GRASS_GREEN : SUNSET_ORANGE;
  const icon = submitted ? "✔" : "…";
  const statusLabel = submitted ? "submitted" : "not yet submitted";

  return (
    <div
      aria-label={`${displayName} — ${statusLabel}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 8,
        paddingRight: 8,
        backgroundColor: bg,
        border: `2px solid ${DEEP_NAVY}`,
        borderRadius: 0,
        boxShadow: `4px 4px 0 ${DEEP_NAVY}`,
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: 13,
        fontWeight: 600,
        color: DEEP_NAVY,
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      {/* Status icon */}
      <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
        {icon}
      </span>

      {/* Member display name */}
      <span
        style={{
          maxWidth: 120,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={displayName}
      >
        {displayName}
      </span>
    </div>
  );
}
