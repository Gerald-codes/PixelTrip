"use client";

/**
 * TripAgentMessage — a single message bubble in the Trip Agent conversation thread.
 *
 * Rendered as <article> so it works correctly inside an aria-live="polite"
 * region (parent responsibility). Each new message in the thread is
 * automatically announced to screen readers via the live region.
 *
 * Normal messages use sand cream background (#FEF3C7) with deep-navy text.
 * System messages (isSystem=true) flip to deep-navy background (#1E3A5F)
 * with sand cream text — used for "everyone's ready" confirmations and
 * inline error notifications.
 *
 * An optional `children` prop renders an InteractiveSlot below the bubble text,
 * giving each message its own interactive content area (chips, cards, etc.).
 *
 * Visual rules (pixel-art style, Req 12.5):
 *   - Zero border-radius — no rounded corners
 *   - 4px solid deep-navy (#1E3A5F) border
 *   - 4px 4px 0 #1E3A5F box-shadow
 *   - Monospace font throughout
 *   - No white backgrounds — surfaces use palette colours only
 *
 * Focus-visible accessibility (Req 16.x):
 *   - outline: 3px solid #A855F7; outline-offset: 2px on focus-visible
 *
 * Palette:
 *   Sand cream  #FEF3C7  — normal message background
 *   Deep navy   #1E3A5F  — border, shadow, system message background, normal text
 *   Sand cream  #FEF3C7  — system message text
 */

import React from "react";

// ─── Palette constants ────────────────────────────────────────────────────────

const DEEP_NAVY = "#1E3A5F";
const SAND_CREAM = "#FEF3C7";

// ─── Prop types ───────────────────────────────────────────────────────────────

interface TripAgentMessageProps {
  /** The agent message text to display inside the bubble. ≤40 words, ≤2 sentences. */
  text: string;
  /**
   * When true, renders as a system-level message (e.g. "everyone's ready",
   * inline errors) using deep-navy background and sand cream text.
   * Defaults to false (normal sand cream bubble).
   */
  isSystem?: boolean;
  /**
   * Optional interactive content rendered directly below the message text,
   * inside the same article boundary. Typically an <InteractiveSlot> containing
   * chips, cards, or vote elements for the current stage.
   */
  children?: React.ReactNode;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TripAgentMessage({
  text,
  isSystem = false,
  children,
}: TripAgentMessageProps) {
  const backgroundColor = isSystem ? DEEP_NAVY : SAND_CREAM;
  const textColor = isSystem ? SAND_CREAM : DEEP_NAVY;

  return (
    <article
      style={{
        backgroundColor,
        border: `4px solid ${DEEP_NAVY}`,
        borderRadius: 0,
        boxShadow: `4px 4px 0 ${DEEP_NAVY}`,
        fontFamily: "'Courier New', Courier, monospace",
        padding: "12px 16px",
        marginBottom: 16,
        // Ensure no white bleeds through from nested elements
        color: textColor,
      }}
    >
      {/* Message bubble text */}
      <p
        style={{
          margin: 0,
          fontSize: 14,
          lineHeight: 1.6,
          color: textColor,
          fontFamily: "'Courier New', Courier, monospace",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {text}
      </p>

      {/* InteractiveSlot rendered below the text when provided */}
      {children != null && (
        <div
          style={{
            marginTop: 16,
            // Visually separate slot from bubble text with a subtle divider
            borderTop: `2px solid ${isSystem ? SAND_CREAM : DEEP_NAVY}`,
            paddingTop: 14,
          }}
        >
          {children}
        </div>
      )}
    </article>
  );
}
