"use client";

/**
 * AgentAvatar — a single named agent's animated pixel avatar.
 *
 * Renders a blocky, pixel-art avatar tile for one of PixelTrip's named agents
 * (Milo, Compass, Atlas, Harmony, Echo) with a visible activity state and a
 * per-character animation. Used by `AgentRoster` and `AgentTypingIndicator`.
 *
 * Visual states (Req 2.5–2.7):
 *   - idle      → static tile
 *   - thinking  → gentle pulse
 *   - working   → per-character motion (wave/bounce/organize/nod/think) plus an
 *                 optional thin progress bar when `progressPercent` is provided
 *   - completed → a brief check-flash overlay
 *
 * Per-character animation hint (Req 3.9) comes from `personality.animation`:
 *   wave | bounce | organize | nod | think — each mapped to a lightweight,
 *   CSS-only transform animation.
 *
 * Resilience (Req 3.8): the caller passes a resolved personality, but this
 * component still guards against missing fields by falling back to
 * `resolvePersonality(personality.id)` and neutral defaults so it always
 * renders something valid.
 *
 * Sizing (Req 20.5): `size="sm"` scales the tile down to ~32px for mobile
 * rosters; `size="md"` is the default desktop size.
 *
 * Pixel-art conventions (steering):
 *   - Zero border-radius (no rounded corners)
 *   - Monospace font
 *   - `4px 4px 0` blocky shadows
 *   - `image-rendering: pixelated`
 *
 * Requirements: 2.5, 2.6, 2.7, 2.9, 3.8, 3.9, 20.5
 */

import React from "react";
import type {
  AgentPersonality,
  AgentActivityState,
  AgentAnimation,
} from "@/lib/types";
import { resolvePersonality } from "@/lib/agentPersonality";

// ─── Palette ─────────────────────────────────────────────────────────────────

const DEEP_NAVY = "var(--pt-bg-card)";
const SAND_CREAM = "var(--pt-bg-card)";
const NEON_PURPLE = "var(--pt-agent-atlas)";
const GRASS_GREEN = "#4ADE80";

// ─── Icon map (avatarIcon → emoji) ─────────────────────────────────────────────

/**
 * Maps a personality's `avatarIcon` key to a pixel-friendly emoji.
 * Falls back to a neutral compass when the key is unrecognised.
 */
const ICON_EMOJI: Record<string, string> = {
  guide: "🛎️", // Milo — guild host who greets the party
  compass: "🧭", // Compass — destination explorer
  calendar: "🗓️", // Atlas — planner
  handshake: "🤝", // Harmony — facilitator
  chart: "📊", // Echo — analyst
};

const DEFAULT_ICON = "🧭";

// ─── Prop types ───────────────────────────────────────────────────────────────

export interface AgentAvatarProps {
  /** The resolved personality for this agent (guarded here regardless). */
  personality: AgentPersonality;
  /** The agent's current activity/visual state. */
  state: AgentActivityState;
  /** Optional 0–100 progress; renders a thin bar while `working` (Req 2.9). */
  progressPercent?: number;
  /** Tile size — "sm" scales to ~32px for mobile rosters (Req 20.5). */
  size?: "sm" | "md";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return a non-empty trimmed string, or `fallback`. */
function safeStr(value: string | undefined | null, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return fallback;
}

/** Clamp a possibly-undefined percent into the 0–100 range, or null. */
function clampPercent(value: number | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/**
 * Map a per-character animation hint to the CSS animation shorthand applied to
 * the icon while the agent is `working`. Keyframes are defined in the inline
 * <style> block below (keyed by these names).
 */
function workingAnimationFor(animation: AgentAnimation): string {
  switch (animation) {
    case "wave":
      return "aa-wave 1s ease-in-out infinite";
    case "bounce":
      return "aa-bounce 0.7s ease-in-out infinite";
    case "organize":
      return "aa-organize 1.1s ease-in-out infinite";
    case "nod":
      return "aa-nod 0.9s ease-in-out infinite";
    case "think":
      return "aa-think 1.4s ease-in-out infinite";
    default:
      return "aa-bounce 0.7s ease-in-out infinite";
  }
}

// ─── Keyframes (CSS-only, scoped by unique class prefix) ───────────────────────

const KEYFRAMES = `
@keyframes aa-wave {
  0%, 100% { transform: rotate(-12deg); }
  50% { transform: rotate(12deg); }
}
@keyframes aa-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
@keyframes aa-organize {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-3px); }
  75% { transform: translateX(3px); }
}
@keyframes aa-nod {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(2px) rotate(4deg); }
}
@keyframes aa-think {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.06); opacity: 0.75; }
}
@keyframes aa-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.05); opacity: 0.65; }
}
@keyframes aa-flash {
  0% { transform: scale(0.4); opacity: 0; }
  40% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
`;

// ─── Component ────────────────────────────────────────────────────────────────

function AgentAvatar({
  personality,
  state,
  progressPercent,
  size = "md",
}: AgentAvatarProps) {
  // Guard: fall back to documented defaults for any missing fields (Req 3.8).
  // `personality.id` is used to synthesize a safe fallback personality; if even
  // that is missing we resolve the neutral default via the "guide" id.
  const fallback = resolvePersonality(personality?.id ?? "guide");

  const name = safeStr(personality?.name, fallback.name);
  const colorHex = safeStr(personality?.colorHex, fallback.colorHex);
  const avatarIcon = safeStr(personality?.avatarIcon, fallback.avatarIcon);
  const animation: AgentAnimation = personality?.animation ?? fallback.animation;

  const emoji = ICON_EMOJI[avatarIcon] ?? DEFAULT_ICON;
  const percent = clampPercent(progressPercent);

  // Dimensions per size.
  const tileSize = size === "sm" ? 32 : 56;
  const iconFontSize = size === "sm" ? 16 : 28;
  const shadowOffset = size === "sm" ? 3 : 4;
  const nameFontSize = size === "sm" ? 10 : 12;

  // Tile-level animation (pulse for thinking; per-character motion is on the icon).
  const tileAnimation = state === "thinking" ? "aa-pulse 1.3s ease-in-out infinite" : "none";

  // Icon-level animation only while working.
  const iconAnimation = state === "working" ? workingAnimationFor(animation) : "none";

  const showProgress = state === "working" && percent !== null;
  const showCheck = state === "completed";

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: size === "sm" ? 3 : 5,
        fontFamily: "'Courier New', Courier, monospace",
      }}
      aria-label={`${name} — ${state}`}
      title={`${name} (${state})`}
    >
      {/* Scoped keyframes */}
      <style>{KEYFRAMES}</style>

      {/* Avatar tile */}
      <div
        style={{
          position: "relative",
          width: tileSize,
          height: tileSize,
          backgroundColor: colorHex,
          border: `2px solid ${DEEP_NAVY}`,
          borderRadius: 0,
          boxShadow: `${shadowOffset}px ${shadowOffset}px 0 ${DEEP_NAVY}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          imageRendering: "pixelated",
          animation: tileAnimation,
          flexShrink: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            fontSize: iconFontSize,
            lineHeight: 1,
            display: "inline-block",
            animation: iconAnimation,
            transformOrigin: "center bottom",
          }}
        >
          {emoji}
        </span>

        {/* Completed check flash overlay */}
        {showCheck && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              width: size === "sm" ? 14 : 18,
              height: size === "sm" ? 14 : 18,
              backgroundColor: GRASS_GREEN,
              border: `2px solid ${DEEP_NAVY}`,
              borderRadius: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: size === "sm" ? 9 : 11,
              fontWeight: 700,
              color: DEEP_NAVY,
              animation: "aa-flash 0.5s ease-out",
            }}
          >
            ✓
          </span>
        )}

        {/* Working progress bar (Req 2.9) */}
        {showProgress && (
          <div
            style={{
              position: "absolute",
              left: 2,
              right: 2,
              bottom: 2,
              height: size === "sm" ? 3 : 5,
              backgroundColor: `${DEEP_NAVY}80`,
              border: `1px solid ${DEEP_NAVY}`,
              borderRadius: 0,
              overflow: "hidden",
            }}
            role="progressbar"
            aria-valuenow={Math.round(percent!)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${name} progress`}
          >
            <div
              style={{
                width: `${percent}%`,
                height: "100%",
                backgroundColor: NEON_PURPLE,
                transition: "width 0.2s ease-out",
              }}
            />
          </div>
        )}
      </div>

      {/* Name label */}
      <span
        style={{
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: nameFontSize,
          fontWeight: 700,
          color: DEEP_NAVY,
          maxWidth: tileSize + 24,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
    </div>
  );
}

export default AgentAvatar;
