"use client";

/**
 * BudgetSelector — three selectable 8-bit style cards for choosing budget level.
 *
 * Cards:
 *   low    → "Budget Traveller"   — backpack SVG icon
 *   medium → "Mid-Range Explorer" — travel bag SVG icon
 *   high   → "Luxury Seeker"      — suitcase SVG icon
 *
 * Palette:
 *   Sunset orange  #FB923C  — selected border
 *   Deep navy      #1E3A5F  — unselected border, shadow
 *   Sand cream     #FEF3C7  — unselected background
 *   Grass green    #4ADE80
 *   Sky blue       #38BDF8
 *   Neon purple    #A855F7
 */

import React from "react";
import type { BudgetLevel } from "@/lib/types";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BudgetSelectorProps {
  value: BudgetLevel | null;
  onChange: (v: BudgetLevel) => void;
  disabled?: boolean;
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

/** Backpack icon — simple geometric blocky shape, 28×28 viewBox */
function BackpackIcon() {
  return (
    <svg
      viewBox="0 0 28 28"
      width="28"
      height="28"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Shoulder straps (top loop) */}
      <rect x="10" y="2" width="8" height="3" fill="#1E3A5F" />
      {/* Strap left */}
      <rect x="8" y="3" width="3" height="7" fill="#1E3A5F" />
      {/* Strap right */}
      <rect x="17" y="3" width="3" height="7" fill="#1E3A5F" />
      {/* Main body */}
      <rect x="6" y="8" width="16" height="16" fill="#4ADE80" />
      {/* Body outline top */}
      <rect x="6" y="8" width="16" height="2" fill="#1E3A5F" />
      {/* Front pocket */}
      <rect x="9" y="15" width="10" height="7" fill="#FEF3C7" />
      {/* Pocket border top */}
      <rect x="9" y="15" width="10" height="2" fill="#1E3A5F" />
      {/* Pocket zipper pull */}
      <rect x="13" y="13" width="2" height="3" fill="#FB923C" />
      {/* Side accents */}
      <rect x="6" y="10" width="2" height="12" fill="#38BDF8" />
      <rect x="20" y="10" width="2" height="12" fill="#38BDF8" />
      {/* Bottom */}
      <rect x="6" y="22" width="16" height="2" fill="#1E3A5F" />
    </svg>
  );
}

/** Travel bag icon — duffel bag style, 28×28 viewBox */
function TravelBagIcon() {
  return (
    <svg
      viewBox="0 0 28 28"
      width="28"
      height="28"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Handle */}
      <rect x="10" y="4" width="8" height="2" fill="#1E3A5F" />
      <rect x="9" y="4" width="2" height="5" fill="#1E3A5F" />
      <rect x="17" y="4" width="2" height="5" fill="#1E3A5F" />
      {/* Bag body */}
      <rect x="4" y="9" width="20" height="14" fill="#FB923C" />
      {/* Bag top strip */}
      <rect x="4" y="9" width="20" height="3" fill="#1E3A5F" />
      {/* Bag bottom strip */}
      <rect x="4" y="20" width="20" height="3" fill="#1E3A5F" />
      {/* Center zip line */}
      <rect x="4" y="15" width="20" height="1" fill="#FEF3C7" />
      {/* Zip pull */}
      <rect x="13" y="13" width="2" height="4" fill="#FEF3C7" />
      {/* Side pockets */}
      <rect x="4" y="12" width="4" height="8" fill="#1E3A5F" />
      <rect x="20" y="12" width="4" height="8" fill="#1E3A5F" />
      {/* Pocket highlight */}
      <rect x="5" y="13" width="2" height="5" fill="#38BDF8" />
      <rect x="21" y="13" width="2" height="5" fill="#38BDF8" />
    </svg>
  );
}

/** Suitcase icon — hard-shell luxury suitcase, 28×28 viewBox */
function SuitcaseIcon() {
  return (
    <svg
      viewBox="0 0 28 28"
      width="28"
      height="28"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Handle base */}
      <rect x="10" y="3" width="8" height="2" fill="#1E3A5F" />
      <rect x="9" y="3" width="2" height="5" fill="#1E3A5F" />
      <rect x="17" y="3" width="2" height="5" fill="#1E3A5F" />
      {/* Main body */}
      <rect x="4" y="8" width="20" height="17" fill="#A855F7" />
      {/* Body border outline */}
      <rect x="4" y="8" width="20" height="2" fill="#1E3A5F" />
      <rect x="4" y="23" width="20" height="2" fill="#1E3A5F" />
      <rect x="4" y="8" width="2" height="17" fill="#1E3A5F" />
      <rect x="22" y="8" width="2" height="17" fill="#1E3A5F" />
      {/* Horizontal band */}
      <rect x="6" y="15" width="16" height="2" fill="#1E3A5F" />
      {/* Latch */}
      <rect x="12" y="14" width="4" height="4" fill="#FEF3C7" />
      <rect x="13" y="15" width="2" height="2" fill="#FB923C" />
      {/* Wheels */}
      <rect x="6" y="25" width="4" height="2" fill="#1E3A5F" />
      <rect x="18" y="25" width="4" height="2" fill="#1E3A5F" />
      {/* Sheen line */}
      <rect x="6" y="10" width="1" height="12" fill="#FEF3C7" opacity={0.4} />
    </svg>
  );
}

// ─── Card data ────────────────────────────────────────────────────────────────

interface BudgetCard {
  value: BudgetLevel;
  label: string;
  sublabel: string;
  Icon: React.FC;
}

const BUDGET_CARDS: BudgetCard[] = [
  {
    value: "low",
    label: "Budget Traveller",
    sublabel: "Keep it lean & adventurous",
    Icon: BackpackIcon,
  },
  {
    value: "medium",
    label: "Mid-Range Explorer",
    sublabel: "Comfort meets value",
    Icon: TravelBagIcon,
  },
  {
    value: "high",
    label: "Luxury Seeker",
    sublabel: "Only the finest will do",
    Icon: SuitcaseIcon,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function BudgetSelector({
  value,
  onChange,
  disabled = false,
}: BudgetSelectorProps) {
  function handleSelect(budget: BudgetLevel) {
    if (disabled) return;
    onChange(budget);
  }

  function handleKeyDown(e: React.KeyboardEvent, budget: BudgetLevel) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleSelect(budget);
    }
  }

  return (
    <div
      className="flex flex-row gap-3 flex-wrap"
      role="radiogroup"
      aria-label="Budget level"
    >
      {BUDGET_CARDS.map(({ value: cardValue, label, sublabel, Icon }) => {
        const isSelected = value === cardValue;

        return (
          <button
            key={cardValue}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={label}
            disabled={disabled}
            onClick={() => handleSelect(cardValue)}
            onKeyDown={(e) => handleKeyDown(e, cardValue)}
            className={[
              // Layout
              "flex flex-col items-center gap-2 p-4 min-w-[120px] flex-1",
              // 8-bit: no border-radius
              "rounded-none",
              // Focus ring for keyboard accessibility
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#FB923C]",
              // Transition
              "transition-opacity",
              // Disabled state
              disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:opacity-90",
            ].join(" ")}
            style={{
              border: isSelected
                ? "2px solid #FB923C"
                : "2px solid #1E3A5F",
              backgroundColor: isSelected ? "#FFF7ED" : "#FEF3C7",
              boxShadow: isSelected
                ? "4px 4px 0px #1E3A5F"
                : "2px 2px 0px #1E3A5F",
            }}
          >
            {/* SVG icon */}
            <span aria-hidden="true">
              <Icon />
            </span>

            {/* Label */}
            <span
              className="font-bold text-sm text-center leading-tight"
              style={{ color: "#1E3A5F", fontFamily: "monospace" }}
            >
              {label}
            </span>

            {/* Sublabel */}
            <span
              className="text-xs text-center leading-tight"
              style={{ color: "#1E3A5F", opacity: 0.7 }}
            >
              {sublabel}
            </span>

            {/* Selected indicator dot */}
            {isSelected && (
              <span
                className="w-2 h-2 rounded-none"
                style={{ backgroundColor: "#FB923C", display: "block" }}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
