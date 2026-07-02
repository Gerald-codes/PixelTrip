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
    <article className="w-full max-w-full overflow-hidden border-4 border-[#1E3A5F] bg-[#FEF3C7] shadow-[4px_4px_0px_#1E3A5F]">

      {/* ── Header: name + fit score ── */}
      <header className="flex flex-wrap items-center gap-3 border-b-4 border-[#1E3A5F] bg-[#38BDF8] px-4 py-3">
        <h3 className="min-w-0 flex-1 break-words text-lg font-bold text-[#1E3A5F]">
          📍 {suggestion.destinationName}
        </h3>
        <FitBadge score={suggestion.fitScore} />
      </header>

      <div className="flex flex-col gap-3 px-4 py-3">

        {/* ── Short reason ── */}
        <p className="break-words text-sm font-semibold leading-relaxed text-[#1E3A5F]">
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
            <p className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F] opacity-60">
              Trade-off
            </p>
            <p className="mt-0.5 break-words text-xs font-semibold leading-relaxed text-[#1E3A5F]">
              {suggestion.downsides[0]}
            </p>
          </div>
        )}

        {/* ── Expanded details ── */}
        {expanded && (
          <div className="flex flex-col gap-4 border-t-2 border-[#1E3A5F] pt-3">

            {/* Full recommendation reason */}
            {suggestion.recommendationReason !== shortReason && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F] opacity-60">
                  Full recommendation
                </p>
                <p className="mt-1 break-words text-sm font-semibold leading-relaxed text-[#1E3A5F]">
                  {suggestion.recommendationReason}
                </p>
              </div>
            )}

            {/* Weather + seasonality */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <InfoTile label="Weather" body={suggestion.weatherSummary} colour="#e0f2fe" />
              <InfoTile label="Best season" body={suggestion.seasonalitySummary} colour="#f0fdf4" />
            </div>

            {/* Best activities */}
            {suggestion.bestActivities.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F] opacity-60">
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
                <p className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F]">
                  All trade-offs
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {suggestion.downsides.map((d, i) => (
                    <li key={i} className="flex min-w-0 items-start gap-2 text-sm font-semibold text-[#1E3A5F]">
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
                <p className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F] opacity-60">
                  Fit for this group
                </p>
                <p className="mt-1 break-words text-sm font-semibold leading-relaxed text-[#1E3A5F]">
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
          className="self-start border-2 border-[#1E3A5F] bg-[#38BDF8] px-3 py-1 text-xs font-bold text-[#1E3A5F] shadow-[2px_2px_0px_#1E3A5F] hover:bg-[#0ea5e9] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
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
      className={`inline-flex flex-none items-center gap-1 border-2 border-[#1E3A5F] px-2 py-0.5 text-xs font-bold text-[#1E3A5F] shadow-[2px_2px_0px_#1E3A5F] ${cls}`}
    >
      <span className="opacity-70">Fit</span>
      <span>{r}</span>
    </span>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center border-2 border-[#1E3A5F] bg-[#FEF3C7] px-2 py-0.5 text-xs font-bold text-[#1E3A5F] shadow-[1px_1px_0px_#1E3A5F]">
      {label}
    </span>
  );
}

const PRICE_CFG = {
  budget:   { label: "💸 Budget",    cls: "bg-[#4ADE80]" },
  moderate: { label: "💸 Mid-range", cls: "bg-[#38BDF8]" },
  premium:  { label: "💸 Premium",   cls: "bg-[#A855F7] text-white" },
} as const;

const CROWD_CFG = {
  low:      { label: "👥 Low crowds",  cls: "bg-[#4ADE80]" },
  moderate: { label: "👥 Moderate",   cls: "bg-[#FB923C]" },
  high:     { label: "👥 Busy",        cls: "bg-red-400 text-white border-red-700" },
} as const;

function PriceChip({ level }: { level: keyof typeof PRICE_CFG }) {
  const { label, cls } = PRICE_CFG[level];
  return (
    <span className={`inline-flex items-center border-2 border-[#1E3A5F] px-2 py-0.5 text-xs font-bold text-[#1E3A5F] shadow-[1px_1px_0px_#1E3A5F] ${cls}`}>
      {label}
    </span>
  );
}

function CrowdChip({ level }: { level: keyof typeof CROWD_CFG }) {
  const { label, cls } = CROWD_CFG[level];
  return (
    <span className={`inline-flex items-center border-2 border-[#1E3A5F] px-2 py-0.5 text-xs font-bold text-[#1E3A5F] shadow-[1px_1px_0px_#1E3A5F] ${cls}`}>
      {label}
    </span>
  );
}

function InfoTile({ label, body, colour }: { label: string; body: string; colour: string }) {
  return (
    <div
      className="border-2 border-[#1E3A5F] px-3 py-2"
      style={{ backgroundColor: colour }}
    >
      <p className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F] opacity-70">{label}</p>
      <p className="mt-1 break-words text-xs font-semibold leading-relaxed text-[#1E3A5F]">{body}</p>
    </div>
  );
}
