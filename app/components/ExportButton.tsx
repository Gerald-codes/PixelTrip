"use client";

import { useCallback, useRef, useState } from "react";
import type { Itinerary, ItineraryDay, ItineraryItem } from "@/lib/types";

// ── Props ───────────────────────────────────────────────────────────────────

interface ExportButtonProps {
  itinerary: Itinerary;
  format: "text" | "markdown";
  /** Optional flight option — sourced from TripRoom.selectedFlightOption */
  flightOption?: "budget" | "comfort" | "best_value" | null;
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function flightLabel(option: string | null | undefined): string {
  switch (option) {
    case "budget":
      return "Budget";
    case "comfort":
      return "Comfort";
    case "best_value":
      return "Best Value";
    default:
      return option ?? "—";
  }
}

// ── Plain-text formatter ─────────────────────────────────────────────────────

function formatAsText(
  itinerary: Itinerary,
  flightOption?: string | null
): string {
  const lines: string[] = [];

  // Header
  lines.push("PIXELTRIP ITINERARY");
  lines.push("===================");
  lines.push(`Destination: ${itinerary.destination}`);
  lines.push(
    `Dates: ${formatDate(itinerary.startDate)} to ${formatDate(itinerary.endDate)}`
  );
  lines.push(`Flight: ${flightLabel(flightOption)}`);

  // Days
  itinerary.days.forEach((day: ItineraryDay, index: number) => {
    lines.push("");
    lines.push(`DAY ${index + 1} — ${formatDate(day.date)}`);

    const renderSection = (label: string, items: ItineraryItem[]) => {
      if (!items || items.length === 0) return;
      lines.push(`  ${label.toUpperCase()}`);
      items.forEach((item) => {
        lines.push(`    • ${item.title}: ${item.description}`);
      });
    };

    renderSection("Morning", day.morning ?? []);
    renderSection("Afternoon", day.afternoon ?? []);
    renderSection("Evening", day.evening ?? []);
    if (day.night && day.night.length > 0) {
      renderSection("Night", day.night);
    }
  });

  // Fairness summary
  lines.push("");
  lines.push("FAIRNESS SUMMARY");

  const { perPersona, warnings, recommendations } = itinerary.fairnessSummary;

  Object.entries(perPersona).forEach(([persona, summary]) => {
    lines.push(`  ${persona}: ${summary}`);
  });

  if (warnings && warnings.length > 0) {
    lines.push("");
    lines.push("WARNINGS:");
    warnings.forEach((w) => lines.push(`  • ${w}`));
  }

  if (recommendations && recommendations.length > 0) {
    lines.push("");
    lines.push("RECOMMENDATIONS:");
    recommendations.forEach((r) => lines.push(`  • ${r}`));
  }

  return lines.join("\n");
}

// ── Markdown formatter ───────────────────────────────────────────────────────

function formatAsMarkdown(
  itinerary: Itinerary,
  flightOption?: string | null
): string {
  const lines: string[] = [];

  // Header
  lines.push("# PixelTrip Itinerary");
  lines.push("");
  lines.push(`**Destination:** ${itinerary.destination}  `);
  lines.push(
    `**Dates:** ${formatDate(itinerary.startDate)} to ${formatDate(itinerary.endDate)}  `
  );
  lines.push(`**Flight:** ${flightLabel(flightOption)}`);

  // Days
  itinerary.days.forEach((day: ItineraryDay, index: number) => {
    lines.push("");
    lines.push(`## Day ${index + 1} — ${formatDate(day.date)}`);

    const renderSection = (label: string, items: ItineraryItem[]) => {
      if (!items || items.length === 0) return;
      lines.push("");
      lines.push(`### ${label}`);
      items.forEach((item) => {
        lines.push(`- **${item.title}**: ${item.description}`);
      });
    };

    renderSection("Morning", day.morning ?? []);
    renderSection("Afternoon", day.afternoon ?? []);
    renderSection("Evening", day.evening ?? []);
    if (day.night && day.night.length > 0) {
      renderSection("Night", day.night);
    }
  });

  // Fairness summary
  lines.push("");
  lines.push("## Fairness Summary");

  const { perPersona, warnings, recommendations } = itinerary.fairnessSummary;

  Object.entries(perPersona).forEach(([persona, summary]) => {
    lines.push("");
    lines.push(`**${persona}**: ${summary}`);
  });

  if (warnings && warnings.length > 0) {
    lines.push("");
    lines.push("### Warnings");
    warnings.forEach((w) => lines.push(`- ${w}`));
  }

  if (recommendations && recommendations.length > 0) {
    lines.push("");
    lines.push("### Recommendations");
    recommendations.forEach((r) => lines.push(`- ${r}`));
  }

  return lines.join("\n");
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ExportButton({
  itinerary,
  format,
  flightOption,
}: ExportButtonProps) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "fallback">(
    "idle"
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const label = format === "text" ? "📄 Copy as Text" : "📝 Copy as Markdown";
  const isCopied = state === "copied";
  const isBusy = state === "copying";

  const getContent = useCallback(
    () =>
      format === "text"
        ? formatAsText(itinerary, flightOption)
        : formatAsMarkdown(itinerary, flightOption),
    [format, itinerary, flightOption]
  );

  const handleClick = useCallback(async () => {
    if (isBusy || isCopied) return;

    setState("copying");

    try {
      await navigator.clipboard.writeText(getContent());
      setState("copied");
      // Reset after 2 seconds
      setTimeout(() => setState("idle"), 2000);
    } catch {
      // Clipboard API unavailable — show textarea fallback
      setState("fallback");
      // Auto-select textarea contents on next render tick
      setTimeout(() => {
        textareaRef.current?.select();
      }, 50);
    }
  }, [getContent, isBusy, isCopied]);

  // ── Fallback textarea ──────────────────────────────────────────────────────
  if (state === "fallback") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-bold text-pt-text-primary">
          Clipboard not available — select all and copy manually:
        </p>
        <textarea
          ref={textareaRef}
          readOnly
          defaultValue={getContent()}
          rows={12}
          className="w-full border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-3 font-mono text-xs text-pt-text-primary shadow-pixel-card resize-y focus:outline-none"
          aria-label={`${format === "text" ? "Plain text" : "Markdown"} itinerary for manual copy`}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          onClick={() => setState("idle")}
          className="self-start border-4 border-pt-text-primary border-opacity-20 bg-[#FB923C] px-4 py-2 font-bold text-pt-text-primary shadow-pixel-card active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
        >
          ✕ Close
        </button>
      </div>
    );
  }

  // ── Normal button ─────────────────────────────────────────────────────────
  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={isBusy || isCopied}
      aria-label={isCopied ? "Copied to clipboard" : label}
      className={[
        "border-4 border-pt-text-primary border-opacity-20 px-4 py-2 font-bold text-pt-text-primary",
        "shadow-pixel-card",
        "transition-colors",
        // Active / copied state → sky-blue; default → grass-green
        isCopied ? "bg-[#38BDF8]" : "bg-[#4ADE80]",
        // Visual press effect
        !isBusy && !isCopied
          ? "hover:brightness-95 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
          : "",
        isBusy || isCopied ? "cursor-not-allowed opacity-80" : "cursor-pointer",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {isCopied ? "✓ Copied!" : label}
    </button>
  );
}
