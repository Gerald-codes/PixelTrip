"use client";

/**
 * FlightMatchCard — one AI-recommended flight, in the same pixel card style as
 * DestinationMatchCard.
 *
 * Shows the flight (carrier + number), a VALUE score (value for money against
 * the other flights shown), the route, outbound times, duration and stops, the
 * return leg, and the price per person, then the guide's why / tags / trade-off
 * and an expandable details section. Every field is optional and degrades to
 * the title + description. Presentational only; token styling.
 */
import { useState, type ReactElement } from "react";

import { PixelButton } from "@/components/PixelButton";

import { readScore, readTags, readText } from "./DestinationMatchCard";
import { TAG_PILL } from "../lib/tagStyles";

export interface FlightMatch {
  id: string;
  title: string;
  description?: string;
  meta?: Record<string, unknown>;
}

export interface FlightMatchCardProps {
  option: FlightMatch;
  selected: boolean;
  onToggle: (id: string) => void;
  /** Currency of the prices (the backend searches in SGD). */
  currency?: string;
}

function num(
  meta: Record<string, unknown> | undefined,
  key: string,
): number | null {
  const value = meta?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * "Sat 20 Dec, 01:00" from a local ISO time, without shifting time zones. A bare
 * date ("2026-12-27", from a provider that gives no return flight time) becomes
 * "Sun 27 Dec".
 */
export function formatTime(iso: unknown): string | null {
  if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-SG", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }
  if (typeof iso !== "string" || iso.length < 16) return null;
  const date = new Date(iso.slice(0, 19));
  if (Number.isNaN(date.getTime())) return null;
  const day = date.toLocaleDateString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `${day}, ${iso.slice(11, 16)}`;
}

export function formatDuration(minutes: number | null): string | null {
  if (minutes === null) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function stopsLabel(stops: number | null): string | null {
  if (stops === null) return null;
  return stops === 0 ? "Direct" : `${stops} stop${stops > 1 ? "s" : ""}`;
}

function Fact({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="flex flex-col">
      <dt className="font-display text-primary-dark">{label}</dt>
      <dd className="font-body tabular-nums">{value}</dd>
    </div>
  );
}

export function FlightMatchCard({
  option,
  selected,
  onToggle,
  currency = "SGD",
}: FlightMatchCardProps): ReactElement {
  const [open, setOpen] = useState(false);
  const meta = option.meta;

  const score = readScore(meta);
  const origin = readText(meta, ["origin"]);
  const destination = readText(meta, ["destination"]);
  const depart = formatTime(meta?.depart_at);
  const arrive = formatTime(meta?.arrive_at);
  const back = formatTime(meta?.return_at);
  const duration = formatDuration(num(meta, "duration_minutes"));
  const stops = stopsLabel(num(meta, "stops"));
  const price = num(meta, "price");
  const why =
    readText(meta, ["whyThisFits", "why", "reason"]) ??
    option.description ??
    null;
  const tags = readTags(meta, ["tags", "highlights", "pros"]);
  const tradeOff = readText(meta, ["tradeOff", "tradeoff", "con", "warning"]);
  const details = readText(meta, ["details", "fullDetails", "longDescription"]);

  return (
    <article
      className={`flex flex-col gap-16 border-4 bg-ink p-8 text-bg ${
        selected ? "border-success" : "border-primary-dark"
      }`}
    >
      <header className="flex items-center justify-between gap-16 border-2 border-primary-dark bg-primary px-16 py-8 text-bg">
        <h3 className="font-title text-pixel-md">{option.title}</h3>
        {score !== null ? (
          <span className="shrink-0 border-2 border-bg bg-success px-8 py-8 font-display text-bg">
            VALUE {score}/100
          </span>
        ) : null}
      </header>

      {/* Route and price: the two things people compare first. */}
      <div className="flex flex-wrap items-center justify-between gap-16 px-8">
        {origin && destination ? (
          <p
            className="font-display"
            aria-label={`${origin} to ${destination}`}
          >
            {origin} <span aria-hidden>→</span> {destination}
          </p>
        ) : null}
        {price !== null ? (
          <p className="font-display tabular-nums text-primary-dark">
            {currency} {Math.round(price).toLocaleString("en-SG")}
            <span className="font-body text-bg">
              {" "}
              / person{back ? ", round trip" : ""}
            </span>
          </p>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-16 px-8">
        {depart ? <Fact label="DEPART" value={depart} /> : null}
        {arrive ? <Fact label="ARRIVE" value={arrive} /> : null}
        {duration || stops ? (
          <Fact
            label="JOURNEY"
            value={[duration, stops].filter(Boolean).join(" · ")}
          />
        ) : null}
        {back ? <Fact label="RETURN" value={back} /> : null}
      </dl>

      {why ? (
        <div className="flex flex-col gap-8 px-8">
          <span className="font-display text-primary-dark">WHY THIS FITS</span>
          <p className="font-body leading-relaxed">{why}</p>
        </div>
      ) : null}

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

      {tradeOff ? (
        <div className="flex flex-col gap-8 border-l-4 border-warning bg-bg px-8 py-8">
          <span className="font-display text-warning">TRADE-OFF</span>
          <p className="font-body leading-relaxed text-ink">{tradeOff}</p>
        </div>
      ) : null}

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

export default FlightMatchCard;
