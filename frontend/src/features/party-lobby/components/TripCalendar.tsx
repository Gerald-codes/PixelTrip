"use client";

/**
 * TripCalendar — the leader picks the trip's first and last day.
 *
 * A RangeCalendar with the trip's rules: only days the whole party is free can be
 * chosen, the trip stays inside one free period, and its length is within the
 * allowed range.
 */
import type { ReactElement } from "react";

import type { TripDates } from "@/services/tripDates.contract";

import { canEndOn, canStartOn, windowOf } from "../lib/tripDates";
import { RangeCalendar } from "./RangeCalendar";

export interface TripCalendarProps {
  dates: TripDates;
  /** First day (ISO), or `null` before one is picked. */
  start: string | null;
  /** Last day (ISO), or `null` while the last day is still to be picked. */
  end: string | null;
  today: string;
  disabled?: boolean;
  onChange: (start: string, end: string | null) => void;
  /** Receives the element to focus when the dialog opens. */
  focusRef?: (element: HTMLButtonElement | null) => void;
}

export function TripCalendar({
  dates,
  start,
  end,
  today,
  disabled = false,
  onChange,
  focusRef,
}: TripCalendarProps): ReactElement {
  const firstFree = dates.windows
    .map((w) => (w.start > today ? w.start : today))
    .filter((day) => windowOf(dates.windows, day) !== null)
    .sort()[0];
  const lastFree = dates.windows.map((w) => w.end).sort().at(-1);

  return (
    <RangeCalendar
      isFree={(iso) => windowOf(dates.windows, iso) !== null && iso >= today}
      canStart={(iso) => canStartOn(dates, iso, today)}
      canEnd={(from, iso) => canEndOn(dates, from, iso)}
      firstMonth={(firstFree ?? today).slice(0, 7)}
      lastMonth={(lastFree ?? today).slice(0, 7)}
      start={start}
      end={end}
      disabled={disabled}
      onChange={onChange}
      focusRef={focusRef}
    />
  );
}

export default TripCalendar;
