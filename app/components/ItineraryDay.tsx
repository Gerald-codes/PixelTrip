"use client";

import type { ItineraryDay, ItineraryItem } from "@/lib/types";

interface ItineraryDayProps {
  day: ItineraryDay;
  dayNumber: number;
}

// ── Colour palette ─────────────────────────────────────────────────────────
const SECTION_CONFIG = {
  morning: {
    label: "Morning",
    emoji: "🌅",
    headerBg: "bg-[#38BDF8]",
    headerText: "text-[#1E3A5F]",
    borderColor: "border-[#38BDF8]",
  },
  afternoon: {
    label: "Afternoon",
    emoji: "☀️",
    headerBg: "bg-[#FB923C]",
    headerText: "text-[#1E3A5F]",
    borderColor: "border-[#FB923C]",
  },
  evening: {
    label: "Evening",
    emoji: "🌆",
    headerBg: "bg-[#A855F7]",
    headerText: "text-white",
    borderColor: "border-[#A855F7]",
  },
  night: {
    label: "Night",
    emoji: "🌙",
    headerBg: "bg-[#1E3A5F]",
    headerText: "text-white",
    borderColor: "border-[#1E3A5F]",
  },
} as const;

type TimeSection = keyof typeof SECTION_CONFIG;

// ── Date formatter ──────────────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  try {
    // Parse as local date to avoid timezone shifts (e.g. "2025-07-20")
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("en-US", {
      weekday: undefined,
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
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
function TimeSection({
  section,
  items,
}: {
  section: TimeSection;
  items: ItineraryItem[];
}) {
  const config = SECTION_CONFIG[section];

  return (
    <section aria-label={config.label}>
      {/* Section header */}
      <div
        className={`flex items-center gap-2 border-2 border-[#1E3A5F] ${config.headerBg} px-4 py-2 shadow-[2px_2px_0px_#1E3A5F]`}
      >
        <span aria-hidden="true" className="text-lg">
          {config.emoji}
        </span>
        <span className={`text-sm font-bold uppercase tracking-wide ${config.headerText}`}>
          {config.label}
        </span>
      </div>

      {/* Items or empty placeholder */}
      <div className="mt-3 flex flex-col gap-3">
        {items.length === 0 ? (
          <p className="border-2 border-dashed border-[#1E3A5F] px-4 py-3 text-sm text-[#1E3A5F] opacity-50 italic">
            Nothing scheduled
          </p>
        ) : (
          items.map((item, i) => <ItemCard key={i} item={item} />)
        )}
      </div>
    </section>
  );
}

// ── ItineraryDay ────────────────────────────────────────────────────────────
export default function ItineraryDay({ day, dayNumber }: ItineraryDayProps) {
  const hasNight = Array.isArray(day.night) && day.night.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Day header */}
      <header className="border-4 border-[#1E3A5F] bg-[#38BDF8] shadow-[4px_4px_0px_#1E3A5F] p-4">
        <h3 className="text-xl font-bold text-[#1E3A5F]">
          Day {dayNumber}
          <span className="mx-2 opacity-60">—</span>
          {formatDate(day.date)}
        </h3>
      </header>

      {/* Time sections */}
      <TimeSection section="morning" items={day.morning ?? []} />
      <TimeSection section="afternoon" items={day.afternoon ?? []} />
      <TimeSection section="evening" items={day.evening ?? []} />
      {hasNight && <TimeSection section="night" items={day.night!} />}
    </div>
  );
}
