"use client";

/**
 * TravelVibeSelector — ten selectable 8-bit style cards for choosing travel vibes.
 *
 * Vibes:
 *   asia            → "Asia"            — torii gate SVG
 *   western_cities  → "Western Cities"  — Eiffel tower SVG
 *   beach_escape    → "Beach Escape"    — palm tree + waves SVG
 *   nature_scenery  → "Nature & Scenery"— mountain peak SVG
 *   food_trip       → "Food Trip"       — ramen bowl SVG
 *   culture_trip    → "Cultural Trip"   — temple/museum SVG
 *   adventure_trip  → "Adventure Trip"  — compass SVG
 *   shopping_city   → "Shopping City"   — shopping bag SVG
 *   hidden_gems     → "Hidden Gems"     — diamond/gem SVG
 *   anywhere        → "Anywhere!"       — globe SVG
 *
 * Multi-selection: toggling adds/removes a vibe; all others unaffected.
 *
 * Selected card:  sky-blue #38BDF8 background + 2px sunset-orange #FB923C border + ✓ checkmark
 * Unselected card: sand-cream var(--pt-bg-card) background + 2px deep-navy var(--pt-bg-card) border
 * No border-radius (8-bit pixel style).
 *
 * Disabled: 50% opacity + cursor-not-allowed + clicks blocked.
 * Keyboard: Tab + Enter/Space to toggle; visible focus ring.
 *
 * The `vibe:` prefix is NEVER shown in the UI — labels are human-readable only.
 */

import React from "react";
import type { TravelVibe } from "@/lib/types";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TravelVibeSelectorProps {
  value: TravelVibe[];
  onChange: (v: TravelVibe[]) => void;
  disabled?: boolean;
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

/** Torii gate — asia */
function ToriiGateIcon() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Left pillar */}
      <rect x="5" y="10" width="4" height="20" fill="#FB923C" />
      {/* Right pillar */}
      <rect x="23" y="10" width="4" height="20" fill="#FB923C" />
      {/* Top crossbeam (wide, curves up at ends) */}
      <rect x="2" y="6" width="28" height="4" fill="var(--pt-bg-card)" />
      {/* Lower crossbeam */}
      <rect x="5" y="13" width="22" height="3" fill="var(--pt-bg-card)" />
      {/* Top cap ends */}
      <rect x="0" y="4" width="6" height="3" fill="var(--pt-bg-card)" />
      <rect x="26" y="4" width="6" height="3" fill="var(--pt-bg-card)" />
      {/* Pillar feet */}
      <rect x="4" y="28" width="6" height="3" fill="var(--pt-bg-card)" />
      <rect x="22" y="28" width="6" height="3" fill="var(--pt-bg-card)" />
    </svg>
  );
}

/** Eiffel tower — western_cities */
function EiffelTowerIcon() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Tip */}
      <rect x="15" y="1" width="2" height="4" fill="var(--pt-bg-card)" />
      {/* Upper section */}
      <rect x="14" y="5" width="4" height="5" fill="var(--pt-bg-card)" />
      {/* Upper spread */}
      <rect x="12" y="10" width="8" height="3" fill="var(--pt-bg-card)" />
      {/* Mid section — narrowing body */}
      <rect x="11" y="13" width="2" height="7" fill="var(--pt-bg-card)" />
      <rect x="19" y="13" width="2" height="7" fill="var(--pt-bg-card)" />
      {/* Mid cross brace */}
      <rect x="11" y="17" width="10" height="2" fill="var(--pt-bg-card)" />
      {/* Lower spread */}
      <rect x="8" y="20" width="16" height="3" fill="var(--pt-bg-card)" />
      {/* Legs */}
      <rect x="7" y="23" width="4" height="7" fill="var(--pt-bg-card)" />
      <rect x="21" y="23" width="4" height="7" fill="var(--pt-bg-card)" />
      {/* Arch between legs */}
      <rect x="11" y="25" width="10" height="3" fill="#38BDF8" />
      <rect x="11" y="23" width="2" height="5" fill="var(--pt-bg-card)" />
      <rect x="19" y="23" width="2" height="5" fill="var(--pt-bg-card)" />
    </svg>
  );
}

/** Palm tree + waves — beach_escape */
function PalmBeachIcon() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Trunk */}
      <rect x="14" y="8" width="4" height="16" fill="#FB923C" />
      {/* Trunk lean */}
      <rect x="13" y="12" width="2" height="4" fill="#FB923C" />
      {/* Left leaf */}
      <rect x="4" y="5" width="12" height="3" fill="#4ADE80" />
      <rect x="4" y="3" width="8" height="3" fill="#4ADE80" />
      {/* Right leaf */}
      <rect x="16" y="5" width="12" height="3" fill="#4ADE80" />
      <rect x="20" y="3" width="8" height="3" fill="#4ADE80" />
      {/* Top center leaves */}
      <rect x="12" y="2" width="8" height="4" fill="#4ADE80" />
      {/* Coconuts */}
      <rect x="14" y="8" width="3" height="3" fill="#FB923C" />
      {/* Wave 1 */}
      <rect x="2" y="25" width="8" height="3" fill="#38BDF8" />
      <rect x="12" y="24" width="8" height="3" fill="#38BDF8" />
      <rect x="22" y="25" width="8" height="3" fill="#38BDF8" />
      {/* Wave 2 (lighter) */}
      <rect x="6" y="28" width="8" height="2" fill="#38BDF8" opacity="0.5" />
      <rect x="18" y="28" width="8" height="2" fill="#38BDF8" opacity="0.5" />
    </svg>
  );
}

/** Mountain peak — nature_scenery */
function MountainIcon() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Snow cap */}
      <rect x="14" y="2" width="4" height="3" fill="var(--pt-bg-card)" />
      <rect x="12" y="5" width="8" height="3" fill="var(--pt-bg-card)" />
      {/* Main mountain */}
      <rect x="10" y="8" width="12" height="3" fill="var(--pt-bg-card)" />
      <rect x="8" y="11" width="16" height="3" fill="var(--pt-bg-card)" />
      <rect x="6" y="14" width="20" height="3" fill="var(--pt-bg-card)" />
      <rect x="4" y="17" width="24" height="3" fill="var(--pt-bg-card)" />
      <rect x="2" y="20" width="28" height="3" fill="var(--pt-bg-card)" />
      {/* Base ground */}
      <rect x="0" y="23" width="32" height="4" fill="#4ADE80" />
      {/* Small mountain (background) */}
      <rect x="18" y="16" width="8" height="2" fill="var(--pt-agent-atlas)" opacity="0.6" />
      <rect x="20" y="14" width="4" height="2" fill="var(--pt-agent-atlas)" opacity="0.6" />
    </svg>
  );
}

/** Ramen bowl — food_trip */
function RamenBowlIcon() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Chopsticks */}
      <rect x="10" y="2" width="2" height="12" fill="#FB923C" transform="rotate(-10 11 8)" />
      <rect x="20" y="2" width="2" height="12" fill="#FB923C" transform="rotate(10 21 8)" />
      {/* Bowl rim */}
      <rect x="4" y="12" width="24" height="3" fill="var(--pt-bg-card)" />
      {/* Bowl body */}
      <rect x="5" y="15" width="22" height="10" fill="var(--pt-bg-card)" />
      {/* Soup surface */}
      <rect x="5" y="15" width="22" height="3" fill="#FB923C" opacity="0.6" />
      {/* Noodles wave */}
      <rect x="7" y="17" width="4" height="2" fill="var(--pt-bg-card)" />
      <rect x="13" y="16" width="4" height="2" fill="var(--pt-bg-card)" />
      <rect x="19" y="17" width="4" height="2" fill="var(--pt-bg-card)" />
      {/* Toppings */}
      <rect x="8" y="19" width="4" height="3" fill="#4ADE80" />
      <rect x="14" y="20" width="3" height="3" fill="#FB923C" />
      <rect x="19" y="19" width="4" height="3" fill="var(--pt-agent-atlas)" />
      {/* Bowl bottom curve */}
      <rect x="7" y="25" width="18" height="3" fill="var(--pt-bg-card)" />
      <rect x="11" y="27" width="10" height="2" fill="var(--pt-bg-card)" />
    </svg>
  );
}

/** Temple/museum — culture_trip */
function TempleIcon() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Roof tier 1 (top) */}
      <rect x="13" y="2" width="6" height="3" fill="var(--pt-agent-atlas)" />
      {/* Roof tier 2 */}
      <rect x="9" y="5" width="14" height="3" fill="var(--pt-agent-atlas)" />
      {/* Roof eaves */}
      <rect x="6" y="8" width="20" height="3" fill="var(--pt-bg-card)" />
      {/* Upper body */}
      <rect x="10" y="11" width="12" height="5" fill="var(--pt-bg-card)" />
      {/* Upper windows */}
      <rect x="12" y="12" width="3" height="3" fill="#38BDF8" />
      <rect x="17" y="12" width="3" height="3" fill="#38BDF8" />
      {/* Lower roof */}
      <rect x="5" y="16" width="22" height="3" fill="var(--pt-bg-card)" />
      {/* Lower body */}
      <rect x="8" y="19" width="16" height="7" fill="var(--pt-bg-card)" />
      {/* Door */}
      <rect x="13" y="21" width="6" height="5" fill="var(--pt-bg-card)" />
      <rect x="14" y="22" width="2" height="4" fill="#FB923C" />
      <rect x="17" y="22" width="2" height="4" fill="#FB923C" />
      {/* Steps */}
      <rect x="4" y="26" width="24" height="2" fill="var(--pt-bg-card)" />
      <rect x="2" y="28" width="28" height="2" fill="var(--pt-bg-card)" />
    </svg>
  );
}

/** Compass — adventure_trip */
function CompassIcon() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Outer ring */}
      <rect x="3" y="3" width="26" height="26" fill="none" stroke="var(--pt-bg-card)" strokeWidth="0" />
      {/* Outer border segments (pixel circle approximation) */}
      <rect x="11" y="2" width="10" height="3" fill="var(--pt-bg-card)" />
      <rect x="11" y="27" width="10" height="3" fill="var(--pt-bg-card)" />
      <rect x="2" y="11" width="3" height="10" fill="var(--pt-bg-card)" />
      <rect x="27" y="11" width="3" height="10" fill="var(--pt-bg-card)" />
      <rect x="5" y="5" width="4" height="4" fill="var(--pt-bg-card)" />
      <rect x="23" y="5" width="4" height="4" fill="var(--pt-bg-card)" />
      <rect x="5" y="23" width="4" height="4" fill="var(--pt-bg-card)" />
      <rect x="23" y="23" width="4" height="4" fill="var(--pt-bg-card)" />
      {/* Inner dial */}
      <rect x="5" y="5" width="22" height="22" fill="var(--pt-bg-card)" />
      {/* Cardinal markers */}
      <rect x="15" y="5" width="2" height="4" fill="var(--pt-bg-card)" />
      <rect x="15" y="23" width="2" height="4" fill="var(--pt-bg-card)" />
      <rect x="5" y="15" width="4" height="2" fill="var(--pt-bg-card)" />
      <rect x="23" y="15" width="4" height="2" fill="var(--pt-bg-card)" />
      {/* North arrow (red) */}
      <rect x="15" y="9" width="2" height="7" fill="#FB923C" />
      <rect x="14" y="7" width="4" height="3" fill="#FB923C" />
      {/* South arrow (navy) */}
      <rect x="15" y="16" width="2" height="7" fill="var(--pt-bg-card)" />
      <rect x="14" y="22" width="4" height="3" fill="var(--pt-bg-card)" />
      {/* Center dot */}
      <rect x="14" y="14" width="4" height="4" fill="#38BDF8" />
    </svg>
  );
}

/** Shopping bag — shopping_city */
function ShoppingBagIcon() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Handles */}
      <rect x="10" y="5" width="2" height="8" fill="var(--pt-bg-card)" />
      <rect x="20" y="5" width="2" height="8" fill="var(--pt-bg-card)" />
      <rect x="10" y="5" width="12" height="2" fill="var(--pt-bg-card)" />
      {/* Bag body */}
      <rect x="6" y="11" width="20" height="18" fill="var(--pt-agent-atlas)" />
      {/* Bag top band */}
      <rect x="6" y="11" width="20" height="3" fill="var(--pt-bg-card)" />
      {/* Bag bottom */}
      <rect x="6" y="27" width="20" height="2" fill="var(--pt-bg-card)" />
      {/* Side shadows */}
      <rect x="6" y="11" width="2" height="18" fill="var(--pt-bg-card)" />
      <rect x="24" y="11" width="2" height="18" fill="var(--pt-bg-card)" />
      {/* Logo / label on bag */}
      <rect x="12" y="17" width="8" height="5" fill="var(--pt-bg-card)" />
      <rect x="13" y="18" width="6" height="1" fill="var(--pt-bg-card)" />
      <rect x="13" y="20" width="4" height="1" fill="var(--pt-bg-card)" />
      {/* Tissue paper peeking out top */}
      <rect x="9" y="9" width="4" height="3" fill="#38BDF8" />
      <rect x="19" y="9" width="4" height="3" fill="#FB923C" />
    </svg>
  );
}

/** Diamond / gem — hidden_gems */
function DiamondIcon() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Diamond top (facets) */}
      <rect x="12" y="4" width="8" height="2" fill="#38BDF8" />
      <rect x="9" y="6" width="14" height="2" fill="#38BDF8" />
      <rect x="6" y="8" width="20" height="2" fill="var(--pt-bg-card)" />
      {/* Left upper facet */}
      <rect x="4" y="10" width="8" height="2" fill="var(--pt-agent-atlas)" />
      <rect x="3" y="8" width="4" height="4" fill="var(--pt-agent-atlas)" />
      {/* Right upper facet */}
      <rect x="20" y="10" width="8" height="2" fill="#4ADE80" />
      <rect x="25" y="8" width="4" height="4" fill="#4ADE80" />
      {/* Main body */}
      <rect x="3" y="10" width="26" height="2" fill="#38BDF8" />
      {/* Lower body — converging to point */}
      <rect x="5" y="12" width="22" height="3" fill="#38BDF8" />
      <rect x="7" y="15" width="18" height="3" fill="var(--pt-agent-atlas)" opacity="0.8" />
      <rect x="9" y="18" width="14" height="3" fill="#38BDF8" opacity="0.9" />
      <rect x="11" y="21" width="10" height="3" fill="var(--pt-agent-atlas)" />
      <rect x="13" y="24" width="6" height="3" fill="#38BDF8" />
      <rect x="15" y="27" width="2" height="3" fill="var(--pt-agent-atlas)" />
      {/* Shine */}
      <rect x="8" y="12" width="3" height="5" fill="var(--pt-bg-card)" opacity="0.6" />
    </svg>
  );
}

/** Globe — anywhere */
function GlobeIcon() {
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Outer circle (pixel approximation) */}
      <rect x="11" y="2" width="10" height="2" fill="var(--pt-bg-card)" />
      <rect x="11" y="28" width="10" height="2" fill="var(--pt-bg-card)" />
      <rect x="2" y="11" width="2" height="10" fill="var(--pt-bg-card)" />
      <rect x="28" y="11" width="2" height="10" fill="var(--pt-bg-card)" />
      <rect x="5" y="4" width="4" height="4" fill="var(--pt-bg-card)" />
      <rect x="23" y="4" width="4" height="4" fill="var(--pt-bg-card)" />
      <rect x="5" y="24" width="4" height="4" fill="var(--pt-bg-card)" />
      <rect x="23" y="24" width="4" height="4" fill="var(--pt-bg-card)" />
      {/* Globe body fill */}
      <rect x="4" y="4" width="24" height="24" fill="#38BDF8" />
      {/* Ocean */}
      <rect x="6" y="6" width="20" height="20" fill="#38BDF8" />
      {/* Continents / landmasses */}
      <rect x="8" y="8" width="7" height="5" fill="#4ADE80" />
      <rect x="17" y="7" width="6" height="4" fill="#4ADE80" />
      <rect x="10" y="15" width="5" height="7" fill="#4ADE80" />
      <rect x="18" y="14" width="6" height="5" fill="#4ADE80" />
      <rect x="7" y="20" width="4" height="4" fill="#4ADE80" />
      {/* Latitude lines */}
      <rect x="4" y="16" width="24" height="1" fill="var(--pt-bg-card)" opacity="0.3" />
      {/* Longitude line */}
      <rect x="16" y="4" width="1" height="24" fill="var(--pt-bg-card)" opacity="0.3" />
      {/* Outer border overlay */}
      <rect x="4" y="4" width="24" height="2" fill="var(--pt-bg-card)" opacity="0.4" />
      <rect x="4" y="26" width="24" height="2" fill="var(--pt-bg-card)" opacity="0.4" />
      <rect x="4" y="4" width="2" height="24" fill="var(--pt-bg-card)" opacity="0.4" />
      <rect x="26" y="4" width="2" height="24" fill="var(--pt-bg-card)" opacity="0.4" />
    </svg>
  );
}

// ─── Vibe card data ───────────────────────────────────────────────────────────

interface VibeCard {
  vibe: TravelVibe;
  label: string;
  tagline: string;
  Icon: React.FC;
}

const VIBE_CARDS: VibeCard[] = [
  {
    vibe: "asia",
    label: "Asia",
    tagline: "Rich cultures & buzzing cities",
    Icon: ToriiGateIcon,
  },
  {
    vibe: "western_cities",
    label: "Western Cities",
    tagline: "Architecture, culture & nightlife",
    Icon: EiffelTowerIcon,
  },
  {
    vibe: "beach_escape",
    label: "Beach Escape",
    tagline: "Sun, sand & crystal waters",
    Icon: PalmBeachIcon,
  },
  {
    vibe: "nature_scenery",
    label: "Nature & Scenery",
    tagline: "Mountains, forests & wild beauty",
    Icon: MountainIcon,
  },
  {
    vibe: "food_trip",
    label: "Food Trip",
    tagline: "Eat your way around the world",
    Icon: RamenBowlIcon,
  },
  {
    vibe: "culture_trip",
    label: "Cultural Trip",
    tagline: "History, art & local traditions",
    Icon: TempleIcon,
  },
  {
    vibe: "adventure_trip",
    label: "Adventure Trip",
    tagline: "Thrills, trails & unforgettable moments",
    Icon: CompassIcon,
  },
  {
    vibe: "shopping_city",
    label: "Shopping City",
    tagline: "Fashion, markets & retail therapy",
    Icon: ShoppingBagIcon,
  },
  {
    vibe: "hidden_gems",
    label: "Hidden Gems",
    tagline: "Off-the-beaten-path discoveries",
    Icon: DiamondIcon,
  },
  {
    vibe: "anywhere",
    label: "Anywhere!",
    tagline: "Surprise me — I'm up for anything",
    Icon: GlobeIcon,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function TravelVibeSelector({
  value,
  onChange,
  disabled = false,
}: TravelVibeSelectorProps) {
  function handleToggle(vibe: TravelVibe) {
    if (disabled) return;
    if (value.includes(vibe)) {
      onChange(value.filter((v) => v !== vibe));
    } else {
      onChange([...value, vibe]);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, vibe: TravelVibe) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleToggle(vibe);
    }
  }

  return (
    <div
      className="flex flex-wrap gap-3"
      role="group"
      aria-label="Travel vibe"
      style={disabled ? { opacity: 0.5, pointerEvents: "none" } : undefined}
    >
      {VIBE_CARDS.map(({ vibe, label, tagline, Icon }) => {
        const isSelected = value.includes(vibe);

        return (
          <button
            key={vibe}
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            aria-label={`${label} — ${tagline}`}
            disabled={disabled}
            onClick={() => handleToggle(vibe)}
            onKeyDown={(e) => handleKeyDown(e, vibe)}
            className={[
              // Layout — min-width so the 2-col grid is natural
              "flex flex-col items-center gap-2 p-3",
              "w-[calc(50%-6px)]",
              // 8-bit: no border-radius
              "rounded-none",
              // Focus ring for keyboard accessibility
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#38BDF8]",
              // Transitions
              "transition-opacity",
              // Disabled state
              disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:opacity-90",
            ].join(" ")}
            style={{
              border: isSelected ? "2px solid #FB923C" : "2px solid var(--pt-border, #335F91)",
              backgroundColor: isSelected ? "rgba(56, 189, 248, 0.15)" : "var(--pt-bg-card)",
              boxShadow: isSelected
                ? "3px 3px 0px #FB923C"
                : "none",
              position: "relative",
            }}
          >
            {/* Checkmark badge (top-right, selected only) */}
            {isSelected && (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: "4px",
                  right: "6px",
                  fontFamily: "monospace",
                  fontWeight: 900,
                  fontSize: "14px",
                  color: "var(--pt-text-primary, #E8ECF1)",
                  lineHeight: 1,
                }}
              >
                ✓
              </span>
            )}

            {/* SVG icon */}
            <span
              aria-hidden="true"
              style={{ imageRendering: "pixelated" }}
            >
              <Icon />
            </span>

            {/* Human-readable label — vibe: prefix is NEVER shown */}
            <span
              className="font-bold text-sm text-center leading-tight"
              style={{ color: "var(--pt-text-primary, #E8ECF1)", fontFamily: "monospace" }}
            >
              {label}
            </span>

            {/* Tagline */}
            <span
              className="text-xs text-center leading-tight"
              style={{ color: "var(--pt-text-primary, #E8ECF1)", opacity: isSelected ? 0.8 : 0.65 }}
            >
              {tagline}
            </span>
          </button>
        );
      })}
    </div>
  );
}
