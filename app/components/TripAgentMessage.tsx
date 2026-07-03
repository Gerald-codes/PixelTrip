"use client";

/**
 * TripAgentMessage — a single message in the conversation thread.
 *
 * Renders as either:
 *   - Agent turn (default): left-aligned bubble with Milo avatar + name
 *   - System turn (isSystem=true): centred muted pill
 *   - User turn (isUser=true): right-aligned compact bubble
 *
 * Visual rules:
 *   - Dark card background with rounded corners (8px)
 *   - Agent-coloured left border
 *   - Clean, readable Inter font body
 *   - Soft shadows — no hard pixel-art edges
 *   - Max-width ~700px conversation column centring
 */

import React from "react";

// ─── Palette ──────────────────────────────────────────────────────────────────

const MILO_COLOR = "#FFB869";
const BG_CARD = "var(--pt-bg-card, #162032)";
const TEXT_PRIMARY = "var(--pt-text-primary, #E8ECF1)";
const TEXT_MUTED = "var(--pt-text-muted, rgba(232,236,241,0.55))";

// ─── Milo sprite SVG (inline, 24×24) ──────────────────────────────────────────

function MiloSprite() {
  const c = "#FFB869";
  const dark = "#C47E2A";
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true" style={{ imageRendering: "pixelated" }}>
      <rect x="7" y="1" width="10" height="10" fill={c} />
      <rect x="7" y="1" width="10" height="2" fill={dark} />
      <rect x="9" y="5" width="2" height="2" fill={dark} />
      <rect x="13" y="5" width="2" height="2" fill={dark} />
      <rect x="9" y="8" width="6" height="1" fill={dark} />
      <rect x="6" y="12" width="12" height="8" fill={c} />
      <rect x="6" y="14" width="12" height="2" fill={dark} />
      <rect x="3" y="12" width="3" height="6" fill={c} />
      <rect x="18" y="12" width="3" height="6" fill={c} />
    </svg>
  );
}

// ─── Prop types ───────────────────────────────────────────────────────────────

interface TripAgentMessageProps {
  text: string;
  isSystem?: boolean;
  isUser?: boolean;
  senderName?: string;
  timestamp?: number;
  children?: React.ReactNode;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TripAgentMessage({
  text,
  isSystem = false,
  isUser = false,
  senderName,
  timestamp,
  children,
}: TripAgentMessageProps) {
  const timeStr = timestamp
    ? new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  // ── System message: centred pill ─────────────────────────────────────────
  if (isSystem) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
        <div
          style={{
            backgroundColor: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 20,
            padding: "6px 16px",
            fontSize: 12,
            color: TEXT_MUTED,
            fontFamily: "var(--pt-font-body)",
            textAlign: "center",
            maxWidth: "80%",
          }}
        >
          {text}
        </div>
      </div>
    );
  }

  // ── User message: right-aligned bubble ───────────────────────────────────
  if (isUser) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, maxWidth: "70%" }}>
          <div
            style={{
              backgroundColor: "rgba(79,209,197,0.12)",
              border: "1px solid rgba(79,209,197,0.25)",
              borderRadius: 12,
              borderBottomRightRadius: 4,
              padding: "10px 14px",
              fontSize: 13,
              lineHeight: 1.5,
              color: TEXT_PRIMARY,
              fontFamily: "var(--pt-font-body)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {text}
          </div>
          {timeStr && (
            <span style={{ fontSize: 10, color: TEXT_MUTED, fontFamily: "var(--pt-font-body)" }}>
              {timeStr}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── Agent message (Milo): left-aligned with avatar ───────────────────────
  return (
    <article style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 0" }}>
      {/* Avatar */}
      <div
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${MILO_COLOR}20`,
          border: `2px solid ${MILO_COLOR}`,
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <MiloSprite />
      </div>

      {/* Name + bubble */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0, maxWidth: 560 }}>
        {/* Agent name */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontFamily: "var(--pt-font-pixel)",
              fontSize: 9,
              color: MILO_COLOR,
              letterSpacing: "0.04em",
              lineHeight: 1,
              textTransform: "uppercase",
            }}
          >
            Milo
          </span>
          {timeStr && (
            <span style={{ fontSize: 10, color: TEXT_MUTED, fontFamily: "var(--pt-font-body)" }}>
              {timeStr}
            </span>
          )}
        </div>

        {/* Bubble */}
        <div
          style={{
            backgroundColor: BG_CARD,
            borderLeft: `3px solid ${MILO_COLOR}`,
            borderRadius: 8,
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
            padding: "12px 16px",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.6,
              color: TEXT_PRIMARY,
              fontFamily: "var(--pt-font-body)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {text}
          </p>

          {/* Interactive widget slot below text */}
          {children != null && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {children}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
