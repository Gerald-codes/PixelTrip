/**
 * Plain-text and calendar (.ics) exports of an approved itinerary.
 *
 * Both builders are pure so they can be tested without a browser;
 * {@link downloadFile} is the only part that touches the DOM.
 */
import type { LockedChoice } from "@/services/selection.contract";
import type { ItineraryDay, ItineraryVersion } from "@/types";

/** Flight times already formatted for people to read. */
export interface FlightSummary {
  title: string;
  departure: string | null;
  arrival: string | null;
  returnDeparture: string | null;
  returnArrival: string | null;
}

/** A filename-safe version of the itinerary title. */
export function exportFileName(title: string, extension: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "adventure"}.${extension}`;
}

/** The itinerary as plain text, readable in any chat or notes app. */
export function buildPlainText(
  version: ItineraryVersion,
  flight?: FlightSummary | null,
): string {
  const { itinerary } = version;
  const lines = [
    itinerary.title.toUpperCase(),
    "=".repeat(itinerary.title.length),
    "",
  ];
  if (itinerary.summary) lines.push(itinerary.summary, "");

  itinerary.days.forEach((day, index) => {
    const heading = `Day ${day.day}${day.date ? ` (${day.date})` : ""}`;
    lines.push(heading, "-".repeat(heading.length));
    if (index === 0 && flight && (flight.departure || flight.arrival)) {
      lines.push(`Outbound flight: ${flight.title}`);
      if (flight.departure) lines.push(`    Departure: ${flight.departure}`);
      if (flight.arrival) lines.push(`    Arrival: ${flight.arrival}`);
    }
    for (const item of day.items) {
      lines.push(`${item.time ? `${item.time}  ` : ""}${item.title}`);
      if (item.location) lines.push(`    Location: ${item.location}`);
      if (item.description) lines.push(`    ${item.description}`);
    }
    if (
      index === itinerary.days.length - 1 &&
      flight &&
      (flight.returnDeparture || flight.returnArrival)
    ) {
      lines.push(`Return flight: ${flight.title}`);
      if (flight.returnDeparture)
        lines.push(`    Departure: ${flight.returnDeparture}`);
      if (flight.returnArrival)
        lines.push(`    Arrival: ${flight.returnArrival}`);
    }
    lines.push("");
  });
  return lines.join("\n");
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})/;
const pad = (value: number): string => String(value).padStart(2, "0");

/** `YYYY-MM-DD` plus a number of days, as `YYYYMMDD`. Null when the date is not one. */
function compactDate(value: string | undefined, addDays = 0): string | null {
  const match = value ? DATE_PATTERN.exec(value) : null;
  if (!match) return null;
  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]) + addDays,
    ),
  );
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

/** The calendar date of a day: its own, else counted from the trip's start. */
function dayDate(
  day: ItineraryDay,
  tripStart: string | undefined,
  addDays = 0,
): string | null {
  return (
    compactDate(day.date, addDays) ??
    compactDate(tripStart, day.day - 1 + addDays)
  );
}

/** Minutes after midnight for an `HH:MM` time. Null for anything else ("Morning"). */
function minutesOfDay(time: string | undefined): number | null {
  const match = time ? TIME_PATTERN.exec(time.trim()) : null;
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** Escape a value for an iCalendar TEXT property. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold a content line so no line is longer than 75 bytes (RFC 5545 §3.1). */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines start with a space, which counts toward their 75.
    if (bytes + size > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/**
 * A flight moment as an iCalendar date-time. A value with a UTC offset becomes
 * a UTC time; one without stays a floating local time, as written.
 */
function flightMoment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(
    value.trim(),
  );
  if (!match) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value.trim())) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return (
      `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
      `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
    );
  }
  return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6] ?? "00"}`;
}

/** True when at least one day can be placed on a calendar. */
export function canExportCalendar(version: ItineraryVersion): boolean {
  const { itinerary } = version;
  return itinerary.days.some(
    (day) => dayDate(day, itinerary.dates?.start) !== null,
  );
}

/**
 * The itinerary as an iCalendar file: one event per activity, plus the flights.
 *
 * Activity times are floating (no time zone), so "09:00" shows as 09:00 at the
 * destination whatever zone the phone is in. A timed activity runs until the
 * next timed one that day, or for an hour; an untimed one is an all-day event.
 *
 * @param stamp When the file was made. Passed in so the output is repeatable.
 */
export function buildCalendar(
  version: ItineraryVersion,
  flight?: LockedChoice | null,
  stamp: Date = new Date(),
): string {
  const { itinerary } = version;
  const dtstamp =
    `${stamp.getUTCFullYear()}${pad(stamp.getUTCMonth() + 1)}${pad(stamp.getUTCDate())}` +
    `T${pad(stamp.getUTCHours())}${pad(stamp.getUTCMinutes())}${pad(stamp.getUTCSeconds())}Z`;
  const uidBase = `${itinerary.tripId || "trip"}-v${version.version}@pixeltrip`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PixelTrip//Itinerary Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(itinerary.title)}`,
  ];

  const event = (
    uid: string,
    when: string[],
    summary: string,
    location?: string,
    description?: string,
  ): void => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}-${uidBase}`,
      `DTSTAMP:${dtstamp}`,
      ...when,
      `SUMMARY:${escapeText(summary)}`,
    );
    if (location) lines.push(`LOCATION:${escapeText(location)}`);
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    lines.push("END:VEVENT");
  };

  const data = flight?.data ?? {};
  const legs = [
    {
      uid: "flight-out",
      label: "Outbound flight",
      start: data.depart_at ?? data.departAt,
      end: data.arrive_at ?? data.arriveAt,
    },
    {
      uid: "flight-return",
      label: "Return flight",
      start: data.return_at ?? data.returnAt,
      end: data.return_arrive_at ?? data.returnArriveAt,
    },
  ];
  for (const leg of legs) {
    const start = flightMoment(leg.start);
    if (!flight || !start) continue;
    const end = flightMoment(leg.end);
    // Only trust an end in the same form as the start (both UTC or both floating).
    const sameForm =
      end !== null && end.endsWith("Z") === start.endsWith("Z") && end > start;
    event(
      leg.uid,
      [`DTSTART:${start}`, `DTEND:${sameForm ? end : start}`],
      `${leg.label}: ${flight.title}`,
    );
  }

  for (const day of itinerary.days) {
    const date = dayDate(day, itinerary.dates?.start);
    if (!date) continue;
    day.items.forEach((item, index) => {
      const uid = `d${day.day}-${item.id ?? index}`;
      const start = minutesOfDay(item.time);
      if (start === null) {
        const next = dayDate(day, itinerary.dates?.start, 1);
        event(
          uid,
          [`DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${next}`],
          item.title,
          item.location,
          item.description,
        );
        return;
      }
      const following = day.items
        .slice(index + 1)
        .map((later) => minutesOfDay(later.time))
        .find(
          (minutes): minutes is number => minutes !== null && minutes > start,
        );
      const end = Math.min(following ?? start + 60, 23 * 60 + 59);
      const at = (minutes: number): string =>
        `${date}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;
      event(
        uid,
        [`DTSTART:${at(start)}`, `DTEND:${at(Math.max(end, start))}`],
        item.title,
        item.location,
        item.description,
      );
    });
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** Hand the browser a file to save. */
export function downloadFile(
  content: string,
  fileName: string,
  mimeType: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
