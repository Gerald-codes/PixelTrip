"use client";

import { TripInterest } from "@/lib/types";

interface InterestBadgeProps {
  interest: TripInterest;
}

interface InterestMeta {
  icon: string;
  color: string;
  label: string;
}

const INTEREST_MAP: Record<TripInterest, InterestMeta> = {
  food:        { icon: "🍜", color: "#FB923C", label: "Food" },
  scenery:     { icon: "📷", color: "#38BDF8", label: "Scenery" },
  adventure:   { icon: "🏔", color: "#4ADE80", label: "Adventure" },
  shopping:    { icon: "🛍", color: "#A855F7", label: "Shopping" },
  nightlife:   { icon: "🌙", color: "#1E3A5F", label: "Nightlife" },
  culture:     { icon: "🏛", color: "#FEF3C7", label: "Culture" },
  relaxation:  { icon: "🎧", color: "#4ADE80", label: "Relaxation" },
  hidden_gems: { icon: "💎", color: "#A855F7", label: "Hidden Gems" },
  flexible:    { icon: "🗺", color: "#38BDF8", label: "Flexible" },
};

/**
 * InterestBadge — 16×16px square pill badge in 8-bit style.
 *
 * Renders a coloured square with a one-character emoji icon centred inside,
 * plus a tooltip (title attribute) showing the full interest label.
 * No border-radius (matches 8-bit square aesthetic).
 * 2px solid deep-navy border for contrast.
 * Display: inline-flex so multiple badges stack horizontally.
 */
export default function InterestBadge({ interest }: InterestBadgeProps) {
  const meta = INTEREST_MAP[interest];

  // Fallback if an unknown interest value is passed — shouldn't happen with
  // TypeScript but guards against runtime surprises.
  if (!meta) {
    return null;
  }

  return (
    <span
      title={meta.label}
      aria-label={meta.label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        height: "16px",
        backgroundColor: meta.color,
        border: "2px solid #1E3A5F",
        borderRadius: "0",          // 8-bit square — no rounding
        fontSize: "9px",
        lineHeight: 1,
        cursor: "default",
        flexShrink: 0,
        imageRendering: "pixelated",
      }}
    >
      {meta.icon}
    </span>
  );
}
