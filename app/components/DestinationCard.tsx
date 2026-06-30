"use client";

import type { DestinationSuggestion } from "@/lib/types";

/**
 * DestinationCard — the visual payoff for Demo Moment 1 ("Why this place?").
 *
 * Presentational only. Renders a single {@link DestinationSuggestion} so the
 * reader can see *at a glance* why this destination fits THIS group at THIS
 * time. Five fields are deliberately the most prominent:
 *
 *   1. `recommendationReason`  — quote-style hero block, the "why".
 *   2. `weatherSummary` + `seasonalitySummary` — concrete timing reasoning.
 *   3. `downsides`            — amber, honest trade-offs (never hidden).
 *   4. `personaFitSummary`    — how it lands for this group's mix.
 *
 * `fitScore`, `crowdLevel`, and `priceLevel` are surfaced as compact badges so
 * they read quickly without competing with the reasoning above.
 *
 * No data fetching here — the parent stage owns I/O and passes a fully-formed
 * suggestion in.
 */
export default function DestinationCard({
  suggestion,
}: {
  suggestion: DestinationSuggestion;
}) {
  return (
    <article className="overflow-hidden border-4 border-[#1E3A5F] bg-[#FEF3C7] shadow-[4px_4px_0px_#1E3A5F]">
      {/* Header: name + fit score */}
      <header className="flex items-start justify-between gap-4 border-b-4 border-[#1E3A5F] bg-[#38BDF8] px-6 py-4">
        <h3 className="text-2xl font-bold text-[#1E3A5F]">
          {suggestion.destinationName}
        </h3>
        <FitScoreBadge score={suggestion.fitScore} />
      </header>

      <div className="flex flex-col gap-5 px-6 py-5">
        {/* Recommendation reason — the hero "why" */}
        <section
          aria-label="Why this destination"
          className="border-l-4 border-[#38BDF8] bg-[#e0f2fe] px-4 py-3"
        >
          <p className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F]">
            Why this place
          </p>
          <p className="mt-1 text-base font-semibold leading-relaxed text-[#1E3A5F]">
            {suggestion.recommendationReason}
          </p>
        </section>

        {/* Weather + seasonality — concrete timing reasoning */}
        <section
          aria-label="Timing and weather"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <ReasoningTile
            label="Weather"
            body={suggestion.weatherSummary}
            tone="sky"
          />
          <ReasoningTile
            label="Seasonality"
            body={suggestion.seasonalitySummary}
            tone="emerald"
          />
        </section>

        {/* Crowd + price level — compact pills */}
        <section
          aria-label="Crowd and price"
          className="flex flex-wrap items-center gap-2"
        >
          <CrowdPill level={suggestion.crowdLevel} />
          <PricePill level={suggestion.priceLevel} />
        </section>

        {/* Best activities */}
        {suggestion.bestActivities.length > 0 && (
          <section aria-label="Best activities">
            <h4 className="text-sm font-bold text-[#1E3A5F]">
              Best activities
            </h4>
            <ul className="mt-2 flex flex-col gap-1 text-sm font-semibold text-[#1E3A5F]">
              {suggestion.bestActivities.map((activity, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-1 inline-block h-1.5 w-1.5 flex-none bg-[#38BDF8]"
                  />
                  <span>{activity}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Downsides — visually distinct so they can't be missed */}
        {suggestion.downsides.length > 0 && (
          <section
            aria-label="Trade-offs"
            className="border-l-4 border-[#FB923C] bg-amber-50 px-4 py-3"
          >
            <h4 className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F]">
              Honest trade-offs
            </h4>
            <ul className="mt-1 flex flex-col gap-1 text-sm font-semibold text-[#1E3A5F]">
              {suggestion.downsides.map((d, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span aria-hidden="true" className="select-none">
                    •
                  </span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Persona fit — small footer section */}
        <section
          aria-label="Persona fit"
          className="border-t-4 border-[#1E3A5F] pt-4"
        >
          <h4 className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F]">
            Fit for this group
          </h4>
          <p className="mt-1 text-sm font-semibold leading-relaxed text-[#1E3A5F]">
            {suggestion.personaFitSummary}
          </p>
        </section>
      </div>
    </article>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

/** Compact "Fit 87/100" badge. Color steps with the score. */
function FitScoreBadge({ score }: { score: number }) {
  const rounded = Math.round(score);
  const tone =
    rounded >= 80
      ? "bg-[#4ADE80] text-[#1E3A5F] border-[#1E3A5F]"
      : rounded >= 60
        ? "bg-[#38BDF8] text-[#1E3A5F] border-[#1E3A5F]"
        : rounded >= 40
          ? "bg-[#FB923C] text-[#1E3A5F] border-[#1E3A5F]"
          : "bg-red-400 text-white border-red-700";
  return (
    <span
      aria-label={`Fit score ${rounded} out of 100`}
      className={`inline-flex flex-none items-center gap-1 border-2 px-3 py-1 text-sm font-bold shadow-[2px_2px_0px_#1E3A5F] ${tone}`}
    >
      <span className="text-xs uppercase tracking-wide opacity-70">Fit</span>
      <span>{rounded}</span>
      <span className="text-xs opacity-70">/100</span>
    </span>
  );
}

/** A labelled paragraph tile used for weather/seasonality. */
function ReasoningTile({
  label,
  body,
  tone,
}: {
  label: string;
  body: string;
  tone: "sky" | "emerald";
}) {
  const toneClasses =
    tone === "sky"
      ? "border-[#38BDF8] bg-[#e0f2fe]"
      : "border-[#4ADE80] bg-[#f0fdf4]";
  return (
    <div className={`border-2 px-4 py-3 shadow-[2px_2px_0px_#1E3A5F] ${toneClasses}`}>
      <p className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F]">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold leading-relaxed text-[#1E3A5F]">{body}</p>
    </div>
  );
}

const CROWD_TONES = {
  low: "bg-[#4ADE80] text-[#1E3A5F] border-[#1E3A5F]",
  moderate: "bg-[#FB923C] text-[#1E3A5F] border-[#1E3A5F]",
  high: "bg-red-400 text-white border-red-700",
} as const;

const CROWD_LABELS = {
  low: "Low crowds",
  moderate: "Moderate crowds",
  high: "Heavy crowds",
} as const;

function CrowdPill({ level }: { level: "low" | "moderate" | "high" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 border-2 px-2.5 py-1 text-xs font-bold shadow-[2px_2px_0px_#1E3A5F] ${CROWD_TONES[level]}`}
    >
      <span aria-hidden="true">👥</span>
      <span>{CROWD_LABELS[level]}</span>
    </span>
  );
}

const PRICE_TONES = {
  budget: "bg-[#4ADE80] text-[#1E3A5F] border-[#1E3A5F]",
  moderate: "bg-[#38BDF8] text-[#1E3A5F] border-[#1E3A5F]",
  premium: "bg-[#A855F7] text-white border-[#1E3A5F]",
} as const;

const PRICE_LABELS = {
  budget: "Budget",
  moderate: "Mid-range",
  premium: "Premium",
} as const;

function PricePill({
  level,
}: {
  level: "budget" | "moderate" | "premium";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 border-2 px-2.5 py-1 text-xs font-bold shadow-[2px_2px_0px_#1E3A5F] ${PRICE_TONES[level]}`}
    >
      <span aria-hidden="true">💸</span>
      <span>{PRICE_LABELS[level]}</span>
    </span>
  );
}
