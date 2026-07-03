"use client";

/**
 * TravelStyleSelector — five selectable 8-bit style cards.
 *
 * Palette:
 *   Sky blue     #38BDF8
 *   Sunset orange #FB923C  ← selected border + shadow
 *   Sand cream   var(--pt-bg-card)  ← unselected card background
 *   Grass green  #4ADE80
 *   Deep navy    var(--pt-bg-card)  ← unselected border + shadow text
 *   Neon purple  var(--pt-agent-atlas)
 *
 * Selected:   2px sunset-orange border + box-shadow 4px 4px 0px var(--pt-bg-card)
 * Unselected: 2px deep-navy border + sand-cream background
 * No border-radius (8-bit square aesthetic)
 * Disabled:   50% opacity, cursor-not-allowed, clicks blocked
 * Keyboard:   Tab to focus card, Enter/Space to select; visible focus ring
 */

import React from "react";
import { TravelStyle } from "@/lib/types";

// ─── Props ────────────────────────────────────────────────────────────────────

interface TravelStyleSelectorProps {
  value: TravelStyle | null;
  onChange: (v: TravelStyle) => void;
  disabled?: boolean;
}

// ─── Card metadata ────────────────────────────────────────────────────────────

interface StyleCard {
  style: TravelStyle;
  label: string;
  description: string;
}

const STYLE_CARDS: StyleCard[] = [
  {
    style: "leader",
    label: "The Leader",
    description: "Takes charge and sets the pace",
  },
  {
    style: "planner",
    label: "The Planner",
    description: "Organises every detail",
  },
  {
    style: "follower",
    label: "The Follower",
    description: "Goes with the group's flow",
  },
  {
    style: "chill",
    label: "The Chill One",
    description: "Vibes with whatever happens",
  },
  {
    style: "adventurer",
    label: "The Adventurer",
    description: "Seeks thrills and new experiences",
  },
];

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

/** Leader: captain/crown-style hat */
function IconLeader() {
  return (
    <svg
      viewBox="0 0 32 24"
      width="48"
      height="36"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Hat brim */}
      <rect x="2" y="15" width="28" height="4" fill="var(--pt-bg-card)" />
      {/* Hat crown */}
      <rect x="8" y="5" width="16" height="11" fill="var(--pt-bg-card)" />
      {/* Crown notch */}
      <rect x="8" y="5" width="4" height="4" fill="var(--pt-bg-card)" />
      <rect x="20" y="5" width="4" height="4" fill="var(--pt-bg-card)" />
      {/* Hat band */}
      <rect x="8" y="13" width="16" height="3" fill="#FB923C" />
      {/* Centre badge / anchor */}
      <rect x="14" y="7" width="4" height="6" fill="var(--pt-bg-card)" />
      <rect x="12" y="11" width="8" height="2" fill="var(--pt-bg-card)" />
      {/* Star on badge */}
      <rect x="15" y="8" width="2" height="4" fill="#FB923C" />
      <rect x="14" y="9" width="4" height="2" fill="#FB923C" />
    </svg>
  );
}

/** Planner: clipboard with a map grid */
function IconPlanner() {
  return (
    <svg
      viewBox="0 0 32 24"
      width="48"
      height="36"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Clipboard body */}
      <rect x="4" y="4" width="24" height="18" fill="var(--pt-bg-card)" />
      <rect x="4" y="4" width="24" height="18" fill="none" stroke="var(--pt-bg-card)" strokeWidth="2" />
      {/* Clip at top */}
      <rect x="11" y="2" width="10" height="5" fill="var(--pt-bg-card)" />
      <rect x="13" y="1" width="6" height="3" fill="#38BDF8" />
      {/* Horizontal grid lines */}
      <rect x="7" y="10" width="18" height="2" fill="var(--pt-bg-card)" />
      <rect x="7" y="14" width="18" height="2" fill="var(--pt-bg-card)" />
      <rect x="7" y="18" width="18" height="2" fill="var(--pt-bg-card)" />
      {/* Vertical grid line */}
      <rect x="16" y="8" width="2" height="13" fill="var(--pt-bg-card)" />
      {/* Location pin top-left cell */}
      <rect x="10" y="7" width="3" height="3" fill="#FB923C" />
      {/* Tick in bottom-right cell */}
      <rect x="19" y="16" width="4" height="2" fill="#4ADE80" />
      <rect x="17" y="17" width="2" height="2" fill="#4ADE80" />
    </svg>
  );
}

/** Follower: simple wide-brim hat / relaxed pose */
function IconFollower() {
  return (
    <svg
      viewBox="0 0 32 24"
      width="48"
      height="36"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Wide brim */}
      <rect x="2" y="14" width="28" height="4" fill="#FB923C" />
      {/* Hat dome */}
      <rect x="8" y="6" width="16" height="9" fill="var(--pt-bg-card)" />
      {/* Hat band */}
      <rect x="8" y="12" width="16" height="3" fill="#4ADE80" />
      {/* Band detail */}
      <rect x="10" y="13" width="2" height="1" fill="var(--pt-bg-card)" />
      <rect x="14" y="13" width="2" height="1" fill="var(--pt-bg-card)" />
      <rect x="18" y="13" width="2" height="1" fill="var(--pt-bg-card)" />
      {/* Small flower / daisy on brim */}
      <rect x="22" y="14" width="2" height="2" fill="#FB923C" />
      <rect x="21" y="15" width="4" height="1" fill="var(--pt-bg-card)" />
      <rect x="22" y="14" width="2" height="3" fill="var(--pt-bg-card)" />
      <rect x="22" y="15" width="2" height="1" fill="#FB923C" />
    </svg>
  );
}

/** Chill: beanie with headphone arc */
function IconChill() {
  return (
    <svg
      viewBox="0 0 32 24"
      width="48"
      height="36"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Beanie body */}
      <rect x="8" y="5" width="16" height="12" fill="var(--pt-agent-atlas)" />
      {/* Beanie rib lines */}
      <rect x="8" y="9" width="16" height="2" fill="var(--pt-bg-card)" />
      <rect x="8" y="13" width="16" height="2" fill="var(--pt-bg-card)" />
      {/* Beanie brim fold */}
      <rect x="7" y="15" width="18" height="3" fill="var(--pt-bg-card)" />
      {/* Pom-pom */}
      <rect x="12" y="2" width="8" height="4" fill="var(--pt-bg-card)" />
      {/* Headphone arc */}
      <rect x="4" y="6" width="4" height="2" fill="var(--pt-bg-card)" />
      <rect x="24" y="6" width="4" height="2" fill="var(--pt-bg-card)" />
      <rect x="4" y="4" width="24" height="3" fill="var(--pt-bg-card)" />
      {/* Ear cups */}
      <rect x="2" y="7" width="5" height="6" fill="#38BDF8" />
      <rect x="25" y="7" width="5" height="6" fill="#38BDF8" />
      {/* Cup highlight */}
      <rect x="3" y="8" width="2" height="3" fill="var(--pt-bg-card)" />
      <rect x="26" y="8" width="2" height="3" fill="var(--pt-bg-card)" />
    </svg>
  );
}

/** Adventurer: wide-brim explorer hat */
function IconAdventurer() {
  return (
    <svg
      viewBox="0 0 32 24"
      width="48"
      height="36"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Wide brim */}
      <rect x="1" y="14" width="30" height="4" fill="#FB923C" />
      {/* Brim side curl left */}
      <rect x="1" y="12" width="4" height="4" fill="#FB923C" />
      {/* Brim side curl right */}
      <rect x="27" y="12" width="4" height="4" fill="#FB923C" />
      {/* Crown body */}
      <rect x="7" y="5" width="18" height="10" fill="#FB923C" />
      {/* Crown indent / pinch crease */}
      <rect x="10" y="5" width="12" height="2" fill="var(--pt-bg-card)" />
      {/* Hat band */}
      <rect x="7" y="12" width="18" height="3" fill="#4ADE80" />
      {/* Band buckle */}
      <rect x="14" y="12" width="4" height="3" fill="var(--pt-bg-card)" />
      <rect x="15" y="13" width="2" height="1" fill="#FB923C" />
      {/* Chin strap lines */}
      <rect x="7" y="17" width="2" height="4" fill="var(--pt-bg-card)" />
      <rect x="23" y="17" width="2" height="4" fill="var(--pt-bg-card)" />
    </svg>
  );
}

const ICON_MAP: Record<TravelStyle, React.FC> = {
  leader: IconLeader,
  planner: IconPlanner,
  follower: IconFollower,
  chill: IconChill,
  adventurer: IconAdventurer,
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function TravelStyleSelector({
  value,
  onChange,
  disabled = false,
}: TravelStyleSelectorProps) {
  function handleSelect(style: TravelStyle) {
    if (disabled) return;
    onChange(style);
  }

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    style: TravelStyle
  ) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleSelect(style);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
        opacity: disabled ? 0.5 : 1,
      }}
      role="radiogroup"
      aria-label="Travel style"
      aria-disabled={disabled}
    >
      {STYLE_CARDS.map(({ style, label, description }) => {
        const isSelected = value === style;
        const Icon = ICON_MAP[style];

        return (
          <button
            key={style}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`${label}: ${description}`}
            disabled={disabled}
            onClick={() => handleSelect(style)}
            onKeyDown={(e) => handleKeyDown(e, style)}
            style={{
              /* Layout */
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
              padding: "12px 14px",
              /* 8-bit square aesthetic — no border-radius */
              borderRadius: 8,
              /* Border: sunset-orange when selected, default border otherwise */
              border: `2px solid ${isSelected ? "#FB923C" : "var(--pt-border, #335F91)"}`,
              /* Shadow: only when selected */
              boxShadow: isSelected ? "4px 4px 0px #FB923C" : "none",
              /* Background: darker card when selected, base card otherwise */
              backgroundColor: isSelected ? "var(--pt-bg-card-hover)" : "var(--pt-bg-card)",
              /* Cursor */
              cursor: disabled ? "not-allowed" : "pointer",
              /* Min width so cards don't shrink too small */
              minWidth: "90px",
              maxWidth: "110px",
              /* Remove default button styles */
              outline: "none",
              /* Transition for feel */
              transition: "box-shadow 0.1s, border-color 0.1s",
            }}
            /* Visible focus ring via a CSS class (see below) */
            className="travel-style-card"
          >
            {/* SVG icon */}
            <span style={{ display: "block", lineHeight: 0 }}>
              <Icon />
            </span>

            {/* Label */}
            <span
              style={{
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: "11px",
                fontWeight: "700",
                color: "var(--pt-text-primary, #E8ECF1)",
                textAlign: "center",
                lineHeight: 1.2,
                letterSpacing: "0.02em",
              }}
            >
              {label}
            </span>

            {/* Description */}
            <span
              style={{
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: "9px",
                color: "var(--pt-text-primary, #E8ECF1)",
                textAlign: "center",
                lineHeight: 1.3,
                opacity: 0.75,
              }}
            >
              {description}
            </span>
          </button>
        );
      })}

      {/*
        Focus ring: injected as a <style> tag so the selector works in
        Next.js App Router without requiring a separate CSS file.
        Using :focus-visible keeps it visible only for keyboard users.
      */}
      <style>{`
        .travel-style-card:focus-visible {
          outline: 3px solid #38BDF8;
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
