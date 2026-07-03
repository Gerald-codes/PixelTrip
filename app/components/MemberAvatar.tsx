"use client";

/**
 * MemberAvatar — displays a single room member's avatar, name, and status.
 *
 * Shows a PixelAvatar when a CharacterProfile is available, or a neutral
 * placeholder silhouette when the member hasn't created their character yet.
 * Hosts get a crown badge positioned top-right of the avatar frame.
 *
 * Palette:
 *   Sunset orange  #FB923C  — crown badge fill
 *   Deep navy      var(--pt-bg-card)  — crown outline, placeholder border
 *   Grass green    #4ADE80  — online indicator dot
 *   Grey           #9CA3AF  — placeholder silhouette
 */

import React from "react";
import type { User, CharacterProfile } from "@/lib/types";
import PixelAvatar from "./PixelAvatar";

// ─── Prop types ──────────────────────────────────────────────────────────────

interface MemberAvatarProps {
  user: User;
  characterProfile: CharacterProfile | null;
  isHost: boolean;
}

// ─── Crown SVG badge ─────────────────────────────────────────────────────────

/**
 * 16×12px pixel crown — 3-pronged shape in sunset-orange (#FB923C)
 * with a deep-navy (var(--pt-bg-card)) outline.
 */
function CrownBadge() {
  return (
    <svg
      width="16"
      height="12"
      viewBox="0 0 16 12"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ imageRendering: "pixelated" }}
    >
      {/* Base band */}
      <rect x="1" y="7" width="14" height="4" fill="#FB923C" stroke="var(--pt-bg-card)" strokeWidth="1" />
      {/* Left prong */}
      <rect x="1" y="3" width="3" height="5" fill="#FB923C" stroke="var(--pt-bg-card)" strokeWidth="1" />
      {/* Centre prong (tallest) */}
      <rect x="6" y="1" width="4" height="7" fill="#FB923C" stroke="var(--pt-bg-card)" strokeWidth="1" />
      {/* Right prong */}
      <rect x="12" y="3" width="3" height="5" fill="#FB923C" stroke="var(--pt-bg-card)" strokeWidth="1" />
      {/* Jewels on band */}
      <rect x="3" y="8" width="2" height="2" fill="var(--pt-bg-card)" />
      <rect x="7" y="8" width="2" height="2" fill="var(--pt-bg-card)" />
      <rect x="11" y="8" width="2" height="2" fill="var(--pt-bg-card)" />
    </svg>
  );
}

// ─── Placeholder silhouette ───────────────────────────────────────────────────

/**
 * 32×48px neutral grey pixel-block figure (same size as sm PixelAvatar).
 * Shown when the member hasn't confirmed their character yet.
 *
 * Layout:
 *   Head:  10×10 grey rect centred at top
 *   Body:  12×14 grey rect below head
 * Background: #9CA3AF, border: 2px solid var(--pt-bg-card)
 */
function PlaceholderSilhouette() {
  return (
    <div
      style={{
        width: 32,
        height: 48,
        backgroundColor: "#9CA3AF",
        border: "2px solid rgba(232, 236, 241, 0.2)",
        position: "relative",
        imageRendering: "pixelated",
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 32 48"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
      >
        {/* Head: 10×10 centred at top (x=11, y=3) */}
        <rect x="11" y="3" width="10" height="10" fill="#6B7280" />
        {/* Body: 12×14 centred below head */}
        <rect x="10" y="17" width="12" height="14" fill="#6B7280" />
        {/* Arms */}
        <rect x="5" y="17" width="5" height="10" fill="#6B7280" />
        <rect x="22" y="17" width="5" height="10" fill="#6B7280" />
        {/* Legs */}
        <rect x="10" y="31" width="5" height="12" fill="#6B7280" />
        <rect x="17" y="31" width="5" height="12" fill="#6B7280" />
      </svg>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Truncates displayName to 10 chars with an ellipsis if longer. */
function truncateName(name: string): string {
  if (name.length <= 10) return name;
  return name.slice(0, 10) + "…";
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MemberAvatar({
  user,
  characterProfile,
  isHost,
}: MemberAvatarProps) {
  const displayName = truncateName(user.displayName);

  return (
    <div
      aria-label={`${user.displayName}'s avatar`}
      style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}
    >
      {/* Avatar frame — relative so the crown badge can be absolute inside it */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        {characterProfile !== null ? (
          <PixelAvatar avatarConfig={characterProfile.avatarConfig} size="sm" />
        ) : (
          <PlaceholderSilhouette />
        )}

        {/* Crown badge — top-right corner, only for host */}
        {isHost && (
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              transform: "translate(30%, -40%)",
              pointerEvents: "none",
            }}
            title="Room host"
          >
            <CrownBadge />
          </div>
        )}
      </div>

      {/* Display name + online dot */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          maxWidth: 64,
        }}
      >
        {/* Online dot */}
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: "#4ADE80",
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 10,
            color: "var(--pt-bg-card)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={user.displayName}
        >
          {displayName}
        </span>
      </div>
    </div>
  );
}
