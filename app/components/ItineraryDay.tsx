"use client";

import { useState } from "react";
import type { ItineraryDay, ItineraryItem } from "@/lib/types";

interface ItineraryDayProps {
  day: ItineraryDay;
  dayNumber: number;
  /** When true the day starts expanded. Defaults to false. */
  defaultOpen?: boolean;
}

// ── Colour palette ─────────────────────────────────────────────────────────
const SECTION_CONFIG = {
  morning: {
    label: "Morning",
    emoji: "🌅",
    headerBg: "bg-[#38BDF8]",
    headerText: "text-[#1E3A5F]",
  },
  afternoon: {
    label: "Afternoon",
    emoji: "☀️",
    headerBg: "bg-[#FB923C]",
    headerText: "text-[#1E3A5F]",
  },
  evening: {
    label: "Evening",
    emoji: "🌆",
    headerBg: "bg-[#A855F7]",
    headerText: "text-white",
  },
  night: {
    label: "Night",
    emoji: "🌙",
    headerBg: "bg-[#1E3A5F]",
    headerText: "text-white",
  },
} as const;

type TimeSection = keyof typeof SECTION_CONFIG;

// ── Date formatter ──────────────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

// ── Item count helper ───────────────────────────────────────────────────────
function countItems(day: ItineraryDay): number {
  return (
    (day.morning?.length ?? 0) +
    (day.afternoon?.length ?? 0) +
    (day.evening?.length ?? 0) +
    (day.night?.length ?? 0)
  );
}

// ── Item Card ───────────────────────────────────────────────────────────────
function ItemCard({ item }: { item: ItineraryItem }) {
  return (
    <article className="border-2 border-[#1E3A5F] bg-[#FEF3C7] shadow-[2px_2px_0px_#1E3A5F] p-4 flex flex-col gap-2">
      {/* Title + type badge row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h4 className="font-bold text-[#1E3A5F] text-base leading-tight">
          {item.title}
        </h4>
        {item.type && (
          <span className="inline-flex items-center border-2 border-[#1E3A5F] bg-[#38BDF8] px-2 py-0.5 text-xs font-bold text-[#1E3A5F] uppercase tracking-wide shadow-[1px_1px_0px_#1E3A5F] whitespace-nowrap flex-none">
            {item.type}
          </span>
        )}
      </div>

      {/* Description */}
      {item.description && (
        <p className="text-sm text-[#1E3A5F] leading-relaxed">
          {item.description}
        </p>
      )}

      {/* Persona benefits chips */}
      {item.personaBenefits && item.personaBenefits.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Benefits for">
          {item.personaBenefits.map((persona, i) => (
            <span
              key={i}
              className="inline-flex items-center border-2 border-[#1E3A5F] bg-[#4ADE80] px-2 py-0.5 text-xs font-bold text-[#1E3A5F] shadow-[1px_1px_0px_#1E3A5F]"
            >
              {persona}
            </span>
          ))}
        </div>
      )}

      {/* Reason */}
      {item.reason && (
        <p className="text-xs text-[#1E3A5F] italic opacity-70 leading-relaxed">
          {item.reason}
        </p>
      )}
    </article>
  );
}

// ── Time Section ────────────────────────────────────────────────────────────
function TimeSectionBlock({
  section,
  items,
}: {
  section: TimeSection;
  items: ItineraryItem[];
}) {
  const config = SECTION_CONFIG[section];
  const [open, setOpen] = useState(true);

  return (
    <section aria-label={config.label}>
      {/* Section header — acts as toggle */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        className={[
          "w-full flex items-center justify-between gap-2",
          "border-2 border-[#1E3A5F]",
          config.headerBg,
          "px-4 py-2 shadow-[2px_2px_0px_#1E3A5F]",
          "hover:opacity-90 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7] focus-visible:ring-offset-1",
          "transition-opacity",
        ].join(" ")}
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="text-lg">{config.emoji}</span>
          <span className={`text-sm font-bold uppercase tracking-wide ${config.headerText}`}>
            {config.label}
          </span>
          {!open && items.length > 0 && (
            <span
              className={`border border-current px-1.5 py-0 text-xs font-bold ${config.headerText} opacity-70`}
            >
              {items.length}
            </span>
          )}
        </span>
        <span
          aria-hidden="true"
          className={`text-xs font-bold ${config.headerText}`}
          style={{ transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          ▼
        </span>
      </button>

      {/* Items */}
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          {items.length === 0 ? (
            <p className="border-2 border-dashed border-[#1E3A5F] px-4 py-3 text-sm text-[#1E3A5F] opacity-50 italic">
              Nothing scheduled
            </p>
          ) : (
            items.map((item, i) => <ItemCard key={i} item={item} />)
          )}
        </div>
      )}
    </section>
  );
}

// ── ItineraryDay ────────────────────────────────────────────────────────────
export default function ItineraryDay({ day, dayNumber, defaultOpen = false }: ItineraryDayProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasNight = Array.isArray(day.night) && day.night.length > 0;
  const total = countItems(day);

  return (
    <div className="flex flex-col gap-0">
      {/* ── Collapsible day header (button) ── */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        aria-controls={`itinerary-day-${dayNumber}`}
        className={[
          "w-full flex items-center justify-between gap-3",
          "border-4 border-[#1E3A5F] bg-[#38BDF8]",
          "px-4 py-3 text-left",
          "shadow-[4px_4px_0px_#1E3A5F]",
          "hover:bg-[#0ea5e9] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7] focus-visible:ring-offset-1",
          "transition-colors",
        ].join(" ")}
      >
        {/* Left: Day label + date */}
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="text-lg font-bold text-[#1E3A5F] whitespace-nowrap">
            Day {dayNumber}
          </span>
          <span className="text-sm font-semibold text-[#1E3A5F] opacity-70 whitespace-nowrap">
            {formatDate(day.date)}
          </span>
        </span>

        {/* Right: item count chip + chevron */}
        <span className="flex items-center gap-2 flex-shrink-0">
          {!open && (
            <span className="border-2 border-[#1E3A5F] bg-[#FEF3C7] px-2 py-0.5 text-xs font-bold text-[#1E3A5F] shadow-[1px_1px_0px_#1E3A5F] whitespace-nowrap">
              {total} {total === 1 ? "activity" : "activities"}
            </span>
          )}
          <span
            aria-hidden="true"
            className="text-sm font-bold text-[#1E3A5F]"
            style={{ transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            ▼
          </span>
        </span>
      </button>

      {/* ── Collapsible content ── */}
      {open && (
        <div
          id={`itinerary-day-${dayNumber}`}
          className="flex flex-col gap-5 border-l-4 border-r-4 border-b-4 border-[#1E3A5F] shadow-[4px_4px_0px_#1E3A5F] px-4 pt-4 pb-5"
        >
          <TimeSectionBlock section="morning" items={day.morning ?? []} />
          <TimeSectionBlock section="afternoon" items={day.afternoon ?? []} />
          <TimeSectionBlock section="evening" items={day.evening ?? []} />
          {hasNight && <TimeSectionBlock section="night" items={day.night!} />}
        </div>
      )}
    </div>
  );
}
