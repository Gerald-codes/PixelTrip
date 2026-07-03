"use client";

/**
 * MessageBubble — a single chat message in the Trip Agent conversation thread.
 *
 * Renders distinct styling for the three broad message families:
 *   - Agent messages  (type === "agent"): left-aligned, tinted with the named
 *     agent's personality colour, showing the agent NAME + an inline avatar dot.
 *   - User messages   (type === "user"): right-aligned, sand-cream bg / navy
 *     text, showing the sender's display name.
 *   - System messages (everything else — "system" | "skipped" | "celebration"
 *     | "intro" | "confirmation" | "waiting" | "error" | "negotiation"):
 *     centred / full-width muted styling. "skipped" renders an italic
 *     "Skipped {stage}" note; "celebration" gets a celebratory accent.
 *
 * Visual rules (pixel-art):
 *   - Zero border-radius (blocky corners)
 *   - Monospace font throughout
 *   - 4px 4px 0 offset box-shadows (no blur)
 *   - Palette: deep-navy #1E3A5F, sand-cream var(--pt-bg-card), neon-purple var(--pt-agent-atlas),
 *     grass-green #4ADE80, sunset-orange #FB923C
 *
 * Accessibility / responsiveness:
 *   - maxWidth ~80% so bubbles never span the full column
 *   - wordBreak: break-word so long text/URLs wrap instead of overflowing
 *   - font-size scales down slightly on small screens via clamp()
 *
 * Requirements: 3.x (named agents), 6.7 (user messages), 7.9 / 25.4 (skipped
 * notes), 23 (celebration moments).
 */

import React from "react";
import type { AgentMessage, AgentPersonality } from "@/lib/types";
import { resolvePersonality } from "@/lib/agentPersonality";

// ─── Palette ─────────────────────────────────────────────────────────────────

const DEEP_NAVY = "#1E3A5F";
const SAND_CREAM = "var(--pt-bg-card)";
const NEON_PURPLE = "var(--pt-agent-atlas)";
const GRASS_GREEN = "#4ADE80";
const SUNSET_ORANGE = "#FB923C";

const MONO = "'Courier New', Courier, monospace";
// Scales the body text down slightly on narrow viewports.
const BODY_FONT_SIZE = "clamp(12px, 3.2vw, 14px)";

// ─── Stage label map (for "skipped" notes) ────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  LOBBY: "Character Creation",
  PERSONA: "Persona Selection",
  AVAILABILITY: "Dates & Vibes",
  GROUP_PROFILE: "Group Profile",
  DESTINATIONS: "Destination Suggestions",
  DESTINATION_VOTE: "Destination Vote",
  FLIGHTS: "Flight Options",
  FLIGHT_VOTE: "Flight Vote",
  ACTIVITIES: "Activities",
  ITINERARY: "Itinerary",
  FEEDBACK: "Feedback",
  NEGOTIATION: "Negotiation",
  FINAL: "Final Plan",
};

// ─── Props ─────────────────────────────────────────────────────────────────

export interface MessageBubbleProps {
  /** The message to render. */
  message: AgentMessage;
  /**
   * Optional resolved personality for an "agent" message. When omitted and the
   * message carries an `agentId`, the personality is resolved via
   * `resolvePersonality`. When both are missing, a generic "Guide" style is used.
   */
  personality?: AgentPersonality;
}

// ─── Small helpers ────────────────────────────────────────────────────────────

/** An inline square "pixel" avatar dot tinted with the agent's colour. */
function AvatarDot({ colorHex }: { colorHex: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        flexShrink: 0,
        backgroundColor: colorHex,
        border: `2px solid ${DEEP_NAVY}`,
        borderRadius: 0,
        imageRendering: "pixelated",
      }}
    />
  );
}

// ─── Sub-renderers ────────────────────────────────────────────────────────────

function AgentBubble({
  message,
  personality,
}: {
  message: AgentMessage;
  personality?: AgentPersonality;
}) {
  // Resolve a personality: prefer the explicit prop, then resolve by agentId,
  // then fall back to a generic "Guide" default.
  const resolved: AgentPersonality =
    personality ??
    (message.agentId ? resolvePersonality(message.agentId) : resolvePersonality("guide"));

  const accent = resolved.colorHex;
  const generic = !personality && !message.agentId;
  const name = generic ? "Guide" : resolved.name;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-start",
        width: "100%",
      }}
    >
      <div
        style={{
          maxWidth: "80%",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {/* Name + avatar dot */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <AvatarDot colorHex={accent} />
          <span
            style={{
              fontFamily: MONO,
              fontSize: 11,
              fontWeight: 700,
              color: accent,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={name}
          >
            {name}
          </span>
        </div>

        {/* Bubble body — tinted with the personality colour accent. */}
        <div
          style={{
            backgroundColor: DEEP_NAVY,
            color: SAND_CREAM,
            border: `2px solid ${accent}`,
            borderLeftWidth: 6,
            borderRadius: 0,
            boxShadow: `4px 4px 0 ${accent}`,
            padding: "8px 10px",
            fontFamily: MONO,
            fontSize: BODY_FONT_SIZE,
            lineHeight: 1.45,
            wordBreak: "break-word",
            overflowWrap: "anywhere",
            whiteSpace: "pre-wrap",
          }}
        >
          {message.text}
        </div>
      </div>
    </div>
  );
}

function UserBubble({ message }: { message: AgentMessage }) {
  const name = message.senderName ?? "You";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        width: "100%",
      }}
    >
      <div
        style={{
          maxWidth: "80%",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 4,
        }}
      >
        {/* Sender name */}
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 700,
            color: DEEP_NAVY,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "100%",
          }}
          title={name}
        >
          {name}
        </span>

        {/* Bubble body — distinct user styling: sand-cream bg, navy text. */}
        <div
          style={{
            backgroundColor: SAND_CREAM,
            color: DEEP_NAVY,
            border: `2px solid ${DEEP_NAVY}`,
            borderRightWidth: 6,
            borderRadius: 0,
            boxShadow: `4px 4px 0 ${DEEP_NAVY}`,
            padding: "8px 10px",
            fontFamily: MONO,
            fontSize: BODY_FONT_SIZE,
            fontWeight: 600,
            lineHeight: 1.45,
            textAlign: "right",
            wordBreak: "break-word",
            overflowWrap: "anywhere",
            whiteSpace: "pre-wrap",
          }}
        >
          {message.text}
        </div>
      </div>
    </div>
  );
}

function SystemBubble({ message }: { message: AgentMessage }) {
  const isCelebration = message.type === "celebration";
  const isSkipped = message.type === "skipped";
  const isError = message.type === "error";

  // Accent per system sub-type.
  const accent = isCelebration
    ? GRASS_GREEN
    : isError
      ? SUNSET_ORANGE
      : NEON_PURPLE;

  // Skipped notes render an italic "Skipped {stage}" prefix.
  const skippedStageLabel = message.skippedStage
    ? STAGE_LABELS[message.skippedStage] ?? String(message.skippedStage)
    : null;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <div
        style={{
          maxWidth: "80%",
          minWidth: 0,
          backgroundColor: `${DEEP_NAVY}0D`,
          color: DEEP_NAVY,
          border: `2px dashed ${accent}`,
          borderRadius: 0,
          padding: "6px 12px",
          fontFamily: MONO,
          fontSize: "clamp(11px, 3vw, 13px)",
          lineHeight: 1.4,
          textAlign: "center",
          fontStyle: isSkipped ? "italic" : "normal",
          fontWeight: isCelebration ? 700 : 500,
          wordBreak: "break-word",
          overflowWrap: "anywhere",
          whiteSpace: "pre-wrap",
          ...(isCelebration
            ? { boxShadow: `4px 4px 0 ${GRASS_GREEN}` }
            : {}),
        }}
      >
        {isCelebration && <span aria-hidden="true">🎉 </span>}
        {isSkipped && skippedStageLabel ? (
          <span>Skipped {skippedStageLabel}</span>
        ) : (
          message.text
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MessageBubble({ message, personality }: MessageBubbleProps) {
  if (message.type === "agent") {
    return <AgentBubble message={message} personality={personality} />;
  }
  if (message.type === "user") {
    return <UserBubble message={message} />;
  }
  // "system" | "skipped" | "celebration" | "intro" | "confirmation"
  // | "waiting" | "error" | "negotiation"
  return <SystemBubble message={message} />;
}
