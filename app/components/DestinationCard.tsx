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
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header: name + fit score */}
      <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
        <h3 className="text-2xl font-bold text-gray-900">
          {suggestion.destinationName}
        </h3>
        <FitScoreBadge score={suggestion.fitScore} />
      </header>

      <div className="flex flex-col gap-5 px-6 py-5">
        {/* Recommendation reason — the hero "why" */}
        <section
          aria-label="Why this destination"
          className="rounded-lg border-l-4 border-blue-500 bg-blue-50 px-4 py-3"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
            Why this place
          </p>
          <p className="mt-1 text-base leading-relaxed text-blue-900">
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
            <h4 className="text-sm font-semibold text-gray-700">
              Best activities
            </h4>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-gray-700">
              {suggestion.bestActivities.map((activity, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-1 inline-block h-1.5 w-1.5 flex-none rounded-full bg-blue-500"
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
            className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3"
          >
            <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800">
              Honest trade-offs
            </h4>
            <ul className="mt-1 flex flex-col gap-1 text-sm text-amber-900">
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
          className="border-t border-gray-100 pt-4"
        >
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Fit for this group
          </h4>
          <p className="mt-1 text-sm leading-relaxed text-gray-700">
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
      ? "bg-green-100 text-green-800 border-green-200"
      : rounded >= 60
        ? "bg-blue-100 text-blue-800 border-blue-200"
        : rounded >= 40
          ? "bg-amber-100 text-amber-800 border-amber-200"
          : "bg-red-100 text-red-800 border-red-200";
  return (
    <span
      aria-label={`Fit score ${rounded} out of 100`}
      className={`inline-flex flex-none items-center gap-1 rounded-full border px-3 py-1 text-sm font-semibold ${tone}`}
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
      ? "border-sky-200 bg-sky-50"
      : "border-emerald-200 bg-emerald-50";
  const headingClasses =
    tone === "sky" ? "text-sky-800" : "text-emerald-800";
  const bodyClasses = tone === "sky" ? "text-sky-900" : "text-emerald-900";
  return (
    <div className={`rounded-lg border px-4 py-3 ${toneClasses}`}>
      <p
        className={`text-xs font-semibold uppercase tracking-wide ${headingClasses}`}
      >
        {label}
      </p>
      <p className={`mt-1 text-sm leading-relaxed ${bodyClasses}`}>{body}</p>
    </div>
  );
}

const CROWD_TONES = {
  low: "bg-green-100 text-green-800 border-green-200",
  moderate: "bg-amber-100 text-amber-800 border-amber-200",
  high: "bg-red-100 text-red-800 border-red-200",
} as const;

const CROWD_LABELS = {
  low: "Low crowds",
  moderate: "Moderate crowds",
  high: "Heavy crowds",
} as const;

function CrowdPill({ level }: { level: "low" | "moderate" | "high" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${CROWD_TONES[level]}`}
    >
      <span aria-hidden="true">👥</span>
      <span>{CROWD_LABELS[level]}</span>
    </span>
  );
}

const PRICE_TONES = {
  budget: "bg-green-100 text-green-800 border-green-200",
  moderate: "bg-blue-100 text-blue-800 border-blue-200",
  premium: "bg-purple-100 text-purple-800 border-purple-200",
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
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${PRICE_TONES[level]}`}
    >
      <span aria-hidden="true">💸</span>
      <span>{PRICE_LABELS[level]}</span>
    </span>
  );
}
