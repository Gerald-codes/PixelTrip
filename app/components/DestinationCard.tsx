"use client";

import { useState } from "react";
import type { DestinationSuggestion } from "@/lib/types";

/**
 * DestinationCard — scannable destination card with expandable details.
 *
 * Collapsed (default):
 *   Header:      name  |  fit score badge
 *   Reason:      short recommendation reason (≤ 2 sentences)
 *   Chip row:    price  crowd  season
 *   Trade-off:   first downside, always visible
 *   Toggle:      ▼ Why this fits
 *
 * Expanded:
 *   Full reason, weather + seasonality tiles, all activities,
 *   all trade-offs, persona fit summary.
 */
export default function DestinationCard({ suggestion }: { suggestion: DestinationSuggestion }) {
  const [expanded, setExpanded] = useState(false);

  // Truncate reason to first 2 sentences for collapsed view
  const shortReason = (() => {
    const sentences = suggestion.recommendationReason.match(/[^.!?]+[.!?]+/g) ?? [];
    return sentences.slice(0, 2).join(" ").trim() || suggestion.recommendationReason.slice(0, 140) + "…";
  })();

  const seasonChip =
    suggestion.seasonalitySummary.length > 0
      ? `🌤 ${suggestion.seasonalitySummary.split(" ").slice(0, 6).join(" ")}…`
      : suggestion.weatherSummary.length > 0
        ? `🌤 ${suggestion.weatherSummary.split(" ").slice(0, 6).join(" ")}…`
        : null;

  return (
    <article className="w-full max-w-full overflow-hidden border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] shadow-pixel-card">

      {/* ── Header: name + fit score ── */}
      <header className="flex flex-wrap items-center gap-3 border-b-4 border-pt-text-primary border-opacity-20 bg-[#38BDF8] px-4 py-3">
        <h3 className="min-w-0 flex-1 break-words text-lg font-bold text-pt-text-primary">
          📍 {suggestion.destinationName}
        </h3>
        <FitBadge score={suggestion.fitScore} />
      </header>

      <div className="flex flex-col gap-3 px-4 py-3">

        {/* ── Short reason ── */}
        <p className="break-words text-sm font-semibold leading-relaxed text-pt-text-primary">
          {shortReason}
        </p>

        {/* ── Chip row ── */}
        <div className="flex flex-wrap gap-2">
          <PriceChip level={suggestion.priceLevel} />
          <CrowdChip level={suggestion.crowdLevel} />
          {seasonChip && <Chip label={seasonChip} />}
        </div>

        {/* ── First trade-off — always visible ── */}
        {suggestion.downsides.length > 0 && (
          <div className="border-l-4 border-[#FB923C] pl-2">
            <p className="text-xs font-bold uppercase tracking-wide text-pt-text-primary opacity-60">
              Trade-off
            </p>
            <p className="mt-0.5 break-words text-xs font-semibold leading-relaxed text-pt-text-primary">
              {suggestion.downsides[0]}
            </p>
          </div>
        )}

        {/* ── Expanded details ── */}
        {expanded && (
          <div className="flex flex-col gap-4 border-t-2 border-pt-text-primary border-opacity-20 pt-3">

            {/* Full recommendation reason */}
            {suggestion.recommendationReason !== shortReason && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-pt-text-primary opacity-60">
                  Full recommendation
                </p>
                <p className="mt-1 break-words text-sm font-semibold leading-relaxed text-pt-text-primary">
                  {suggestion.recommendationReason}
                </p>
              </div>
            )}

            {/* Weather + seasonality */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <InfoTile label="Weather" body={suggestion.weatherSummary} bgColour="#071E2E" borderColour="#0369A1" textColour="#BAE6FD" />
              <InfoTile label="Best season" body={suggestion.seasonalitySummary} bgColour="#0A2A1A" borderColour="#15803D" textColour="#86EFAC" />
            </div>

            {/* Best activities */}
            {suggestion.bestActivities.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-pt-text-primary opacity-60">
                  Best activities
                </p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {suggestion.bestActivities.map((a, i) => (
                    <li key={i}>
                      <Chip label={a} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* All trade-offs */}
            {suggestion.downsides.length > 0 && (
              <div className="border-l-4 border-[#FB923C] pl-3 py-2">
                <p className="text-xs font-bold uppercase tracking-wide text-pt-text-primary">
                  All trade-offs
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {suggestion.downsides.map((d, i) => (
                    <li key={i} className="flex min-w-0 items-start gap-2 text-sm font-semibold text-pt-text-primary">
                      <span aria-hidden="true" className="select-none">•</span>
                      <span className="break-words">{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Persona fit */}
            {suggestion.personaFitSummary && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-pt-text-primary opacity-60">
                  Fit for this group
                </p>
                <p className="mt-1 break-words text-sm font-semibold leading-relaxed text-pt-text-primary">
                  {suggestion.personaFitSummary}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Toggle ── */}
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          aria-expanded={expanded}
          className="self-start border-2 border-pt-text-primary border-opacity-20 bg-[#38BDF8] px-3 py-1 text-xs font-bold text-pt-text-primary shadow-pixel-sm hover:bg-[#0ea5e9] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
        >
          {expanded ? "▲ Less" : "▼ Why this fits"}
        </button>
      </div>
    </article>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FitBadge({ score }: { score: number }) {
  const r = Math.round(score);
  const cls =
    r >= 80 ? "bg-[#4ADE80]" :
    r >= 60 ? "bg-[#38BDF8]" :
    r >= 40 ? "bg-[#FB923C]" : "bg-red-400 text-white";
  return (
    <span
      aria-label={`Fit score ${r} out of 100`}
      className={`inline-flex flex-none items-center gap-1 border-2 border-pt-text-primary border-opacity-20 px-2 py-0.5 text-xs font-bold text-pt-text-primary shadow-pixel-sm ${cls}`}
    >
      <span className="opacity-70">Fit</span>
      <span>{r}</span>
    </span>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center border-2 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] px-2 py-0.5 text-xs font-bold text-pt-text-primary shadow-pixel-bubble">
      {label}
    </span>
  );
}

const PRICE_CFG = {
  budget:   { label: "💸 Budget",    cls: "bg-[#4ADE80]" },
  moderate: { label: "💸 Mid-range", cls: "bg-[#38BDF8]" },
  premium:  { label: "💸 Premium",   cls: "bg-[var(--pt-agent-atlas)] text-white" },
} as const;

const CROWD_CFG = {
  low:      { label: "👥 Low crowds",  cls: "bg-[#4ADE80]" },
  moderate: { label: "👥 Moderate",   cls: "bg-[#FB923C]" },
  high:     { label: "👥 Busy",        cls: "bg-red-400 text-white border-red-700" },
} as const;

function PriceChip({ level }: { level: keyof typeof PRICE_CFG }) {
  const { label, cls } = PRICE_CFG[level];
  return (
    <span className={`inline-flex items-center border-2 border-pt-text-primary border-opacity-20 px-2 py-0.5 text-xs font-bold text-pt-text-primary shadow-pixel-bubble ${cls}`}>
      {label}
    </span>
  );
}

function CrowdChip({ level }: { level: keyof typeof CROWD_CFG }) {
  const { label, cls } = CROWD_CFG[level];
  return (
    <span className={`inline-flex items-center border-2 border-pt-text-primary border-opacity-20 px-2 py-0.5 text-xs font-bold text-pt-text-primary shadow-pixel-bubble ${cls}`}>
      {label}
    </span>
  );
}

function InfoTile({ label, body, bgColour, borderColour, textColour }: { label: string; body: string; bgColour: string; borderColour: string; textColour: string }) {
  return (
    <div
      className="border-2 px-3 py-2"
      style={{ backgroundColor: bgColour, borderColor: borderColour }}
    >
      <p className="text-xs font-bold uppercase tracking-wide opacity-70" style={{ color: textColour }}>{label}</p>
      <p className="mt-1 break-words text-xs font-semibold leading-relaxed" style={{ color: textColour }}>{body}</p>
    </div>
  );
}
