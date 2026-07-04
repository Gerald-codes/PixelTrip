"use client";

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

// ── Filename helpers ─────────────────────────────────────────────────────────

function slugifyDestination(destination: string): string {
  return destination
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function computeFilename(
  destination: string | undefined | null,
  format: "text" | "markdown"
): string {
  const ext = format === "markdown" ? "md" : "txt";
  const slug = destination ? slugifyDestination(destination) : "";
  if (!slug) {
    return `pixeltrip-itinerary.${ext}`;
  }
  return `pixeltrip-${slug}-itinerary.${ext}`;
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
  const label =
    format === "text" ? "📄 Download Text File" : "📝 Download Markdown";

  function handleDownload(): void {
    try {
      const content =
        format === "text"
          ? formatAsText(itinerary, flightOption)
          : formatAsMarkdown(itinerary, flightOption);

      const mimeType =
        format === "markdown"
          ? "text/markdown;charset=utf-8"
          : "text/plain;charset=utf-8";

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = computeFilename(itinerary.destination, format);
      a.click();

      URL.revokeObjectURL(url);
    } catch {
      // Silent failure — no error state, no visual change
    }
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="border-4 border-pt-text-primary border-opacity-20 px-4 py-2 font-bold text-pt-text-primary shadow-pixel-card bg-[#4ADE80] hover:brightness-95 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
    >
      {label}
    </button>
  );
}
