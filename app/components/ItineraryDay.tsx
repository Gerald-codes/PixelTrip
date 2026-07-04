"use client";

import { useState } from "react";
import type { ItineraryDay, ItineraryItem } from "@/lib/types";

interface ItineraryDayProps {
  day: ItineraryDay;
  dayNumber: number;
  /** When true the day starts expanded. Defaults to false. */
  defaultOpen?: boolean;
}

// ── Section config ─────────────────────────────────────────────────────────
//
// Each time section has:
//   - a distinct accent colour used for its left border stripe + header text
//   - a dark background for the header bar (visible against the card)
//   - a lighter header text colour that has strong contrast on the dark bg

const SECTION_CONFIG = {
  morning: {
    label: "Morning",
    emoji: "🌅",
    // Dark navy header with sky-blue accent text — clearly readable
    headerBg: "#0D2238",
    headerBorder: "#38BDF8",
    accentColour: "#38BDF8",
    stripeBg: "rgba(56,189,248,0.08)",
  },
  afternoon: {
    label: "Afternoon",
    emoji: "☀️",
    // Dark amber header with orange accent text
    headerBg: "#1C0F00",
    headerBorder: "#FB923C",
    accentColour: "#FB923C",
    stripeBg: "rgba(251,146,60,0.06)",
  },
  evening: {
    label: "Evening",
    emoji: "🌆",
    // Dark purple header with purple accent text
    headerBg: "#150A2E",
    headerBorder: "#A78BFA",
    accentColour: "#A78BFA",
    stripeBg: "rgba(167,139,250,0.06)",
  },
  night: {
    label: "Night",
    emoji: "🌙",
    // Very dark header with muted cyan accent text
    headerBg: "#081820",
    headerBorder: "#4FD1C5",
    accentColour: "#4FD1C5",
    stripeBg: "rgba(79,209,197,0.06)",
  },
} as const;

type TimeSection = keyof typeof SECTION_CONFIG;

// Ordered list so render order is always deterministic
const TIME_SECTION_ORDER: TimeSection[] = [
  "morning",
  "afternoon",
  "evening",
  "night",
];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function countItems(day: ItineraryDay): number {
  return (
    (day.morning?.length ?? 0) +
    (day.afternoon?.length ?? 0) +
    (day.evening?.length ?? 0) +
    (day.night?.length ?? 0)
  );
}

function getItemsForSection(day: ItineraryDay, section: TimeSection): ItineraryItem[] {
  return day[section] ?? [];
}

// ── Item Card ───────────────────────────────────────────────────────────────

function ItemCard({
  item,
  accentColour,
}: {
  item: ItineraryItem;
  accentColour: string;
}) {
  return (
    <article
      style={{
        backgroundColor: "var(--pt-bg-card)",
        border: "2px solid var(--pt-border-subtle, rgba(47,94,147,0.4))",
        borderLeft: `3px solid ${accentColour}`,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* Title row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <h4
          style={{
            margin: 0,
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: "0.9rem",
            fontWeight: 700,
            color: "var(--pt-text-primary, #EAF2FF)",
            lineHeight: 1.35,
            flex: 1,
            minWidth: 0,
            wordBreak: "break-word",
          }}
        >
          {item.title}
        </h4>
        {item.type && (
          <span
            style={{
              flexShrink: 0,
              padding: "2px 8px",
              fontSize: "0.6875rem",
              fontFamily: "'Courier New', Courier, monospace",
              fontWeight: 700,
              color: accentColour,
              border: `1px solid ${accentColour}`,
              backgroundColor: "transparent",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              whiteSpace: "nowrap",
            }}
          >
            {item.type}
          </span>
        )}
      </div>

      {/* Description */}
      {item.description && (
        <p
          style={{
            margin: 0,
            fontSize: "0.8125rem",
            color: "var(--pt-text-secondary, #AFC5E6)",
            lineHeight: 1.6,
            wordBreak: "break-word",
          }}
        >
          {item.description}
        </p>
      )}

      {/* Persona benefit chips */}
      {item.personaBenefits && item.personaBenefits.length > 0 && (
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 5 }}
          aria-label="Good for"
        >
          {item.personaBenefits.map((persona, i) => (
            <span
              key={i}
              style={{
                padding: "2px 8px",
                fontSize: "0.6875rem",
                fontFamily: "'Courier New', Courier, monospace",
                fontWeight: 700,
                color: "#081A33",
                backgroundColor: "#4ADE80",
                border: "1px solid #22C55E",
              }}
            >
              {persona}
            </span>
          ))}
        </div>
      )}

      {/* Reason / AI note */}
      {item.reason && (
        <p
          style={{
            margin: 0,
            fontSize: "0.75rem",
            color: "var(--pt-text-muted, rgba(175,197,230,0.6))",
            fontStyle: "italic",
            lineHeight: 1.5,
            wordBreak: "break-word",
          }}
        >
          {item.reason}
        </p>
      )}

      {/* Estimated cost */}
      {typeof item.estimatedCost === "number" && item.estimatedCost > 0 && (
        <p
          style={{
            margin: 0,
            fontSize: "0.75rem",
            fontFamily: "'Courier New', Courier, monospace",
            fontWeight: 700,
            color: accentColour,
          }}
        >
          ~${item.estimatedCost.toLocaleString("en-US")} / person
        </p>
      )}
    </article>
  );
}

// ── Time Section Block ──────────────────────────────────────────────────────
//
// Renders a collapsible section (Morning / Afternoon / Evening / Night).
// The section header is always visible as the toggle — clicking it expands
// or collapses the list of activity cards below.
// Empty sections (no items) are hidden entirely — they add no value.

function TimeSectionBlock({
  section,
  items,
}: {
  section: TimeSection;
  items: ItineraryItem[];
}) {
  // Start open — users see activities immediately without extra clicks
  const [open, setOpen] = useState(true);

  // Skip rendering entirely for empty sections
  if (items.length === 0) return null;

  const cfg = SECTION_CONFIG[section];

  return (
    <div
      role="region"
      aria-label={cfg.label}
      style={{ display: "flex", flexDirection: "column", gap: 0 }}
    >
      {/* ── Section header (always visible — acts as toggle) ── */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 12px",
          backgroundColor: cfg.headerBg,
          border: `2px solid ${cfg.headerBorder}`,
          borderBottom: open ? `1px solid ${cfg.headerBorder}30` : `2px solid ${cfg.headerBorder}`,
          cursor: "pointer",
          textAlign: "left",
          outline: "none",
        }}
        onFocus={(e) => {
          e.currentTarget.style.outline = `2px solid ${cfg.accentColour}`;
          e.currentTarget.style.outlineOffset = "2px";
        }}
        onBlur={(e) => {
          e.currentTarget.style.outline = "none";
        }}
      >
        {/* Left: emoji + label + item count */}
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: "1rem", lineHeight: 1 }}>
            {cfg.emoji}
          </span>
          <span
            style={{
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: "0.75rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: cfg.accentColour,
            }}
          >
            {cfg.label}
          </span>
          {/* Item count badge — always visible so users know what's inside */}
          <span
            style={{
              fontSize: "0.6875rem",
              fontFamily: "'Courier New', Courier, monospace",
              fontWeight: 700,
              color: cfg.accentColour,
              border: `1px solid ${cfg.accentColour}50`,
              padding: "0 6px",
              opacity: 0.8,
            }}
          >
            {items.length} {items.length === 1 ? "activity" : "activities"}
          </span>
        </span>

        {/* Right: chevron */}
        <span
          aria-hidden="true"
          style={{
            fontSize: "0.625rem",
            fontWeight: 700,
            color: cfg.accentColour,
            flexShrink: 0,
            transition: "transform 0.15s",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            display: "inline-block",
          }}
        >
          ▼
        </span>
      </button>

      {/* ── Activity list (conditionally rendered) ── */}
      {open && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "8px 0 0 0",
            backgroundColor: cfg.stripeBg,
            borderLeft: `2px solid ${cfg.headerBorder}`,
            borderRight: `2px solid ${cfg.headerBorder}`,
            borderBottom: `2px solid ${cfg.headerBorder}`,
          }}
        >
          {items.map((item, i) => (
            <div key={i} style={{ padding: "0 8px", paddingBottom: i === items.length - 1 ? 8 : 0 }}>
              <ItemCard item={item} accentColour={cfg.accentColour} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ItineraryDay ────────────────────────────────────────────────────────────

export default function ItineraryDay({
  day,
  dayNumber,
  defaultOpen = false,
}: ItineraryDayProps) {
  const [open, setOpen] = useState(defaultOpen);
  const total = countItems(day);

  // Non-empty sections in fixed order — only count sections with items for
  // the "N activities" chip so it accurately reflects visible content
  const populatedSections = TIME_SECTION_ORDER.filter(
    (s) => getItemsForSection(day, s).length > 0
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        // Pixel-style card shadow
        boxShadow: "4px 4px 0 #081A33",
      }}
    >
      {/* ── Day header — collapsible toggle ── */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        aria-controls={`itinerary-day-${dayNumber}`}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 16px",
          backgroundColor: "#0D2342",
          border: "3px solid #2F5E93",
          borderBottom: open ? "1px solid #2F5E93" : "3px solid #2F5E93",
          cursor: "pointer",
          textAlign: "left",
          outline: "none",
          transition: "background-color 0.1s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1B3964";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#0D2342";
        }}
        onFocus={(e) => {
          e.currentTarget.style.outline = "2px solid #A78BFA";
          e.currentTarget.style.outlineOffset = "2px";
        }}
        onBlur={(e) => {
          e.currentTarget.style.outline = "none";
        }}
      >
        {/* Left: Day number + date */}
        <span
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            minWidth: 0,
            flex: 1,
          }}
        >
          <span
            style={{
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: "0.9375rem",
              fontWeight: 700,
              color: "#EAF2FF",
              whiteSpace: "nowrap",
            }}
          >
            Day {dayNumber}
          </span>
          <span
            style={{
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: "0.8125rem",
              color: "#AFC5E6",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {formatDate(day.date)}
          </span>
        </span>

        {/* Right: activity count + time-section pills + chevron */}
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          {/* Total activity count — always visible */}
          <span
            style={{
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: "0.6875rem",
              fontWeight: 700,
              color: "#38BDF8",
              border: "1px solid #38BDF850",
              padding: "2px 8px",
              whiteSpace: "nowrap",
              backgroundColor: "rgba(56,189,248,0.08)",
            }}
          >
            {total} {total === 1 ? "activity" : "activities"}
          </span>

          {/* Section pills — compact indicator of which time slots have content */}
          {!open && populatedSections.length > 0 && (
            <span
              style={{
                display: "flex",
                gap: 3,
              }}
              aria-hidden="true"
            >
              {populatedSections.map((s) => (
                <span
                  key={s}
                  title={SECTION_CONFIG[s].label}
                  style={{
                    fontSize: "0.875rem",
                    lineHeight: 1,
                  }}
                >
                  {SECTION_CONFIG[s].emoji}
                </span>
              ))}
            </span>
          )}

          {/* Chevron */}
          <span
            aria-hidden="true"
            style={{
              fontSize: "0.625rem",
              fontWeight: 700,
              color: "#AFC5E6",
              transition: "transform 0.15s",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              display: "inline-block",
              marginLeft: 2,
            }}
          >
            ▼
          </span>
        </span>
      </button>

      {/* ── Expanded content ── */}
      {open && (
        <div
          id={`itinerary-day-${dayNumber}`}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 0,
            border: "3px solid #2F5E93",
            borderTop: "none",
            backgroundColor: "var(--pt-bg-surface, #0D2342)",
            padding: "12px 12px 14px",
          }}
        >
          {/* Time sections in fixed order — empty ones are skipped by TimeSectionBlock */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {TIME_SECTION_ORDER.map((section) => (
              <TimeSectionBlock
                key={section}
                section={section}
                items={getItemsForSection(day, section)}
              />
            ))}
          </div>

          {/* Fallback when ALL sections are empty (shouldn't happen with real data) */}
          {total === 0 && (
            <p
              style={{
                margin: 0,
                padding: "16px",
                fontSize: "0.8125rem",
                fontFamily: "'Courier New', Courier, monospace",
                color: "var(--pt-text-muted, rgba(175,197,230,0.5))",
                fontStyle: "italic",
                textAlign: "center",
              }}
            >
              No activities scheduled for this day.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
