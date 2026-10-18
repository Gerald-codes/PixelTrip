"use client";

/**
 * DestinationMatchCard — a rich recommendation card for one AI-suggested option.
 *
 * Renders the title, an optional FIT score badge, a "WHY THIS FITS" blurb,
 * highlight tags, an optional trade-off note, a Select action, and an expandable
 * "View full details" section. Every enrichment field (score, tags, trade-off,
 * details) is OPTIONAL: the backend AI fills `meta` over time, and this card
 * degrades gracefully — showing just the title + description + Select until the
 * backend provides more. Presentational only; token styling.
 */
import { useState, type ReactElement } from "react";

import { PixelButton } from "@/components/PixelButton";
import { TAG_PILL } from "../lib/tagStyles";

/** One recommendation option; `meta` is the AI's free-form detail bag. */
export interface DestinationMatch {
  id: string;
  title: string;
  description?: string;
  meta?: Record<string, unknown>;
}

export interface DestinationMatchCardProps {
  option: DestinationMatch;
  selected: boolean;
  onToggle: (id: string) => void;
}

/** Read a numeric fit score from any of the keys the backend might use. */
export function readScore(meta: Record<string, unknown> | undefined): number | null {
  if (!meta) return null;
  for (const key of ["score", "fit", "fitScore", "match"]) {
    const value = meta[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
      return Math.round(Number(value));
    }
  }
  return null;
}

/** Read a string from the first present key. */
export function readText(
  meta: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | null {
  if (!meta) return null;
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

/** Read a string[] from the first present key. */
export function readTags(
  meta: Record<string, unknown> | undefined,
  keys: readonly string[],
): string[] {
  if (!meta) return [];
  for (const key of keys) {
    const value = meta[key];
    if (Array.isArray(value)) {
      return value
        .map((v) => (typeof v === "string" ? v : String(v)))
        .filter((v) => v.trim() !== "");
    }
  }
  return [];
}

/** "Thu 15 – Sun 18 Oct" from two ISO dates (same year assumed for display). */
export function formatTripDates(start: unknown, end: unknown): string | null {
  if (typeof start !== "string" || typeof end !== "string") return null;
  const from = new Date(`${start.slice(0, 10)}T00:00:00`);
  const to = new Date(`${end.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  const day = (d: Date, withMonth: boolean): string =>
    d
      .toLocaleDateString("en-SG", {
        weekday: "short",
        day: "numeric",
        ...(withMonth ? { month: "short" } : {}),
      })
      .replace(/,/g, "");
  const sameMonth = from.getMonth() === to.getMonth();
  return `${day(from, !sameMonth)} – ${day(to, true)}`;
}

export function DestinationMatchCard({
  option,
  selected,
  onToggle,
}: DestinationMatchCardProps): ReactElement {
  const [open, setOpen] = useState(false);
  const meta = option.meta;

  const score = readScore(meta);
  const why =
    readText(meta, ["whyThisFits", "why", "reason"]) ?? option.description ?? null;
  const tags = readTags(meta, ["tags", "highlights", "pros"]);
  const tradeOff = readText(meta, ["tradeOff", "tradeoff", "con", "warning"]);
  const details = readText(meta, ["details", "fullDetails", "longDescription"]);
  const tripDays =
    typeof meta?.tripDays === "number" && meta.tripDays > 0 ? meta.tripDays : null;
  const tripDates = formatTripDates(meta?.tripStart, meta?.tripEnd);
  const whyThisLong = readText(meta, ["whyThisLong"]);

  return (
    <article
      className={`flex flex-col gap-16 border-4 bg-ink p-8 text-bg ${
        selected ? "border-success" : "border-primary-dark"
      }`}
    >
      {/* Header: title + fit score */}
      <header className="flex items-center justify-between gap-16 border-2 border-primary-dark bg-primary px-16 py-8 text-bg">
        <h3 className="font-title text-pixel-md">{option.title}</h3>
        {score !== null ? (
          <span className="shrink-0 border-2 border-bg bg-success px-8 py-8 font-display text-bg">
            FIT {score}/100
          </span>
        ) : null}
      </header>

      {/* Suggested trip: its own length and dates, inside when the party is free. */}
      {tripDays !== null ? (
        <div className="flex flex-col gap-8 px-8 pt-8">
          <span className="font-display text-primary-dark">SUGGESTED TRIP</span>
          {/* One face for the whole line, so the length and the dates sit level. */}
          <p className="font-display text-pixel-sm tabular-nums">
            {tripDays} {tripDays === 1 ? "DAY" : "DAYS"}
            {tripDates ? <span> · {tripDates}</span> : null}
          </p>
          {whyThisLong ? (
            <p className="font-body leading-relaxed">{whyThisLong}</p>
          ) : null}
        </div>
      ) : null}

      {/* Why this fits */}
      {why ? (
        <div className="flex flex-col gap-8 px-8 pt-8">
          <span className="font-display text-primary-dark">WHY THIS FITS</span>
          <p className="font-body leading-relaxed">{why}</p>
        </div>
      ) : null}

      {/* Highlight tags */}
      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-8">
          {tags.map((tag) => (
            <li
              key={tag}
              className={TAG_PILL}
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Trade-off */}
      {tradeOff ? (
        <div className="flex flex-col gap-8 border-l-4 border-warning bg-bg px-8 py-8">
          <span className="font-display text-warning">TRADE-OFF</span>
          <p className="font-body leading-relaxed text-ink">{tradeOff}</p>
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex flex-col gap-8 border-t-2 border-muted px-8 pb-8 pt-8">
        <PixelButton
          variant={selected ? "primary" : "option"}
          label={selected ? "Selected" : "Select"}
          ariaPressed={selected}
          onClick={() => onToggle(option.id)}
        />
        {details ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
            className="border-2 border-primary-dark bg-primary px-16 py-8 text-left font-body text-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {open ? "▲ Hide details" : "▼ View full details"}
          </button>
        ) : null}
        {open && details ? (
          <p className="border-2 border-muted bg-bg p-8 font-body leading-relaxed text-ink">
            {details}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export default DestinationMatchCard;
