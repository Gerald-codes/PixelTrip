"use client";

/**
 * AgentBubble — renders a single AgentTurn as a chat message bubble.
 *
 * Phase 2 visual refactor:
 * - Inline SVG pixel-art sprite avatars (8×8 style, rects only)
 * - Agent-colored container with 15% opacity bg + 2px border + border-radius 8px
 * - Dark navy card background, agent-colored left border
 * - Zero business logic changes
 */

import React from "react";
import type { AgentTurn, SpeakingAgentId } from "@/lib/types";

// ─── Agent config ──────────────────────────────────────────────────────────

interface AgentConfig {
  color: string;
  name: string;
}

const AGENT_CONFIG: Record<SpeakingAgentId, AgentConfig> = {
  milo:    { color: "#FFB869", name: "Milo"    },
  compass: { color: "#4FD1C5", name: "Compass" },
  atlas:   { color: "#A78BFA", name: "Atlas"   },
  harmony: { color: "#FB923C", name: "Harmony" },
  echo:    { color: "#67E8F9", name: "Echo"    },
};

// ─── Pixel sprite SVGs ─────────────────────────────────────────────────────
// Each sprite is 24×24, rects only, image-rendering: pixelated
// Structure: head (10×10), body (12×8), eyes (2×2 each)

/** Milo — warm sunny yellow character */
function MiloSprite() {
  const c = "#FFB869";
  const dark = "#C47E2A";
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true" style={{ imageRendering: "pixelated" }}>
      {/* Head */}
      <rect x="7" y="1" width="10" height="10" fill={c} />
      {/* Hair accent */}
      <rect x="7" y="1" width="10" height="2" fill={dark} />
      {/* Eyes */}
      <rect x="9" y="5" width="2" height="2" fill={dark} />
      <rect x="13" y="5" width="2" height="2" fill={dark} />
      {/* Smile */}
      <rect x="9" y="8" width="6" height="1" fill={dark} />
      {/* Body */}
      <rect x="6" y="12" width="12" height="8" fill={c} />
      {/* Shirt stripe */}
      <rect x="6" y="14" width="12" height="2" fill={dark} />
      {/* Arms */}
      <rect x="3" y="12" width="3" height="6" fill={c} />
      <rect x="18" y="12" width="3" height="6" fill={c} />
    </svg>
  );
}

/** Compass — teal explorer with hat */
function CompassSprite() {
  const c = "#4FD1C5";
  const dark = "#1A8F88";
  const hat = "#1A8F88";
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true" style={{ imageRendering: "pixelated" }}>
      {/* Explorer hat brim */}
      <rect x="5" y="2" width="14" height="2" fill={hat} />
      {/* Hat crown */}
      <rect x="7" y="0" width="10" height="3" fill={hat} />
      {/* Head */}
      <rect x="7" y="3" width="10" height="9" fill={c} />
      {/* Eyes */}
      <rect x="9" y="6" width="2" height="2" fill={dark} />
      <rect x="13" y="6" width="2" height="2" fill={dark} />
      {/* Body */}
      <rect x="6" y="13" width="12" height="8" fill={c} />
      {/* Vest */}
      <rect x="9" y="13" width="6" height="8" fill={dark} />
      {/* Arms */}
      <rect x="3" y="13" width="3" height="6" fill={c} />
      <rect x="18" y="13" width="3" height="6" fill={c} />
    </svg>
  );
}

/** Atlas — purple planner with small detail */
function AtlasSprite() {
  const c = "#A78BFA";
  const dark = "#6D4FC7";
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true" style={{ imageRendering: "pixelated" }}>
      {/* Head */}
      <rect x="7" y="1" width="10" height="10" fill={c} />
      {/* Glasses frame */}
      <rect x="8" y="5" width="3" height="3" fill="none" />
      <rect x="8" y="5" width="3" height="1" fill={dark} />
      <rect x="8" y="7" width="3" height="1" fill={dark} />
      <rect x="8" y="5" width="1" height="3" fill={dark} />
      <rect x="13" y="5" width="3" height="1" fill={dark} />
      <rect x="13" y="7" width="3" height="1" fill={dark} />
      <rect x="15" y="5" width="1" height="3" fill={dark} />
      {/* Bridge */}
      <rect x="11" y="6" width="2" height="1" fill={dark} />
      {/* Eyes inside glasses */}
      <rect x="9" y="6" width="2" height="1" fill={dark} />
      <rect x="13" y="6" width="2" height="1" fill={dark} />
      {/* Body */}
      <rect x="6" y="12" width="12" height="8" fill={c} />
      {/* Collar */}
      <rect x="10" y="12" width="4" height="3" fill={dark} />
      {/* Arms */}
      <rect x="3" y="12" width="3" height="6" fill={c} />
      <rect x="18" y="12" width="3" height="6" fill={c} />
    </svg>
  );
}

/** Harmony — warm orange mediator */
function HarmonySprite() {
  const c = "#FB923C";
  const dark = "#C45A0A";
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true" style={{ imageRendering: "pixelated" }}>
      {/* Hair */}
      <rect x="6" y="0" width="12" height="3" fill={dark} />
      <rect x="5" y="2" width="14" height="2" fill={dark} />
      {/* Head */}
      <rect x="7" y="3" width="10" height="9" fill={c} />
      {/* Eyes */}
      <rect x="9" y="7" width="2" height="2" fill={dark} />
      <rect x="13" y="7" width="2" height="2" fill={dark} />
      {/* Smile */}
      <rect x="9" y="10" width="2" height="1" fill={dark} />
      <rect x="13" y="10" width="2" height="1" fill={dark} />
      <rect x="11" y="11" width="2" height="1" fill={dark} />
      {/* Body */}
      <rect x="6" y="13" width="12" height="8" fill={c} />
      {/* Heart detail */}
      <rect x="10" y="15" width="2" height="1" fill={dark} />
      <rect x="12" y="15" width="2" height="1" fill={dark} />
      <rect x="9" y="16" width="6" height="2" fill={dark} />
      <rect x="10" y="18" width="4" height="1" fill={dark} />
      <rect x="11" y="19" width="2" height="1" fill={dark} />
      {/* Arms */}
      <rect x="3" y="13" width="3" height="6" fill={c} />
      <rect x="18" y="13" width="3" height="6" fill={c} />
    </svg>
  );
}

/** Echo — cyan analyst with visor */
function EchoSprite() {
  const c = "#67E8F9";
  const dark = "#0E7490";
  const visor = "#0E7490";
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true" style={{ imageRendering: "pixelated" }}>
      {/* Head */}
      <rect x="7" y="1" width="10" height="10" fill={c} />
      {/* Visor band */}
      <rect x="7" y="4" width="10" height="3" fill={visor} />
      {/* Visor shine */}
      <rect x="8" y="4" width="3" height="1" fill="#67E8F9" opacity="0.5" />
      {/* Eyes below visor */}
      <rect x="9" y="7" width="2" height="2" fill={dark} />
      <rect x="13" y="7" width="2" height="2" fill={dark} />
      {/* Body */}
      <rect x="6" y="12" width="12" height="8" fill={c} />
      {/* Tech stripe */}
      <rect x="6" y="15" width="12" height="1" fill={dark} />
      <rect x="6" y="18" width="12" height="1" fill={dark} />
      {/* Arms */}
      <rect x="3" y="12" width="3" height="6" fill={c} />
      <rect x="18" y="12" width="3" height="6" fill={c} />
    </svg>
  );
}

const AGENT_SPRITES: Record<SpeakingAgentId, React.FC> = {
  milo:    MiloSprite,
  compass: CompassSprite,
  atlas:   AtlasSprite,
  harmony: HarmonySprite,
  echo:    EchoSprite,
};

// ─── Typing dots ───────────────────────────────────────────────────────────

const DOT_KEYFRAMES = `
@keyframes agentBubbleBounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40%           { transform: translateY(-5px); opacity: 1; }
}
`;

function TypingDots({ name, color }: { name: string; color: string }) {
  return (
    <>
      <style>{DOT_KEYFRAMES}</style>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          fontFamily: "var(--pt-font-body)",
          color: "var(--pt-text-muted)",
        }}
      >
        <span style={{ color, fontWeight: 500 }}>{name} is thinking</span>
        <span aria-label="thinking" style={{ display: "inline-flex", gap: 3, marginLeft: 2 }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: color,
                animation: `agentBubbleBounce 1.2s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </span>
      </span>
    </>
  );
}

// ─── Props ─────────────────────────────────────────────────────────────────

interface AgentBubbleProps {
  turn: AgentTurn;
  /** The widget node to embed below the text. Pass null when widgetDone. */
  widget?: React.ReactNode;
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function AgentBubble({ turn, widget }: AgentBubbleProps) {
  const cfg = AGENT_CONFIG[turn.agentId] ?? AGENT_CONFIG.milo;
  const isThinking = turn.status === "thinking";
  const Sprite = AGENT_SPRITES[turn.agentId] ?? AGENT_SPRITES.milo;

  // Agent color at 15% opacity for avatar background
  const avatarBg = `${cfg.color}26`; // 26 hex = ~15% opacity

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        width: "100%",
      }}
    >
      {/* ── Avatar: pixel sprite in colored container ── */}
      <div
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: avatarBg,
          border: `2px solid ${cfg.color}`,
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <Sprite />
      </div>

      {/* ── Name + bubble column ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>

        {/* Agent name in Press Start 2P */}
        <span
          style={{
            fontFamily: "var(--pt-font-pixel)",
            fontSize: 9,
            color: cfg.color,
            letterSpacing: "0.04em",
            lineHeight: 1,
          }}
        >
          {cfg.name}
        </span>

        {/* Bubble */}
        <div
          style={{
            backgroundColor: "var(--pt-bg-card)",
            borderLeft: `3px solid ${cfg.color}`,
            borderRadius: 8,
            boxShadow: "var(--pt-shadow-card)",
            padding: "14px 16px",
            maxWidth: 560,
          }}
        >
          {isThinking ? (
            <TypingDots name={cfg.name} color={cfg.color} />
          ) : (
            <p
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: 1.65,
                fontFamily: "var(--pt-font-body)",
                color: "var(--pt-text-primary)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {turn.text}
            </p>
          )}

          {/* Widget rendered directly inside the bubble, below text */}
          {widget != null && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: "1px solid rgba(255,255,255,0.08)",
                maxHeight: 320,
                overflowY: "auto",
              }}
            >
              {widget}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
