"use client";

/**
 * RangeCalendar — pick a first and a last day on a month grid.
 *
 * The caller decides which days can be picked through three rules (`isFree`,
 * `canStart`, `canEnd`). The first click sets the first day; the calendar then
 * marks the days the range may end on and the second click sets the last day.
 * Clicking any other free day starts over from there. Pixel style: square cells,
 * gold for the two ends, blue for the days between, a dashed gold edge on days
 * the range may end on.
 *
 * Keyboard: the grid is one Tab stop (the first day, or the first free day);
 * arrow keys move between the days of the month shown.
 *
 * Used by TripCalendar (the leader's trip dates) and AvailabilityPicker (when a
 * member is free), so both read and behave the same way.
 */
import { useState, type KeyboardEvent, type ReactElement } from "react";

import { addDays, formatDay } from "../lib/tripDates";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const NAV_CLASSES =
  "font-display border-2 border-ink bg-bg px-16 py-8 text-ink disabled:border-muted disabled:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-alt";

/** "2026-10" */
function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/** The month as rows of 7 cells, Monday first; `null` pads the first and last row. */
function weeksOf(month: string): (string | null)[][] {
  const [y, m] = month.split("-").map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= count; day += 1) {
    cells.push(`${month}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export interface RangeCalendarProps {
  /** Is this day open at all? Days that are not are struck through. */
  isFree: (iso: string) => boolean;
  /** May a range start on this day? */
  canStart: (iso: string) => boolean;
  /** May a range that starts on `start` end on this day? */
  canEnd: (start: string, iso: string) => boolean;
  /** The first and last month (`YYYY-MM`) the arrows may reach. */
  firstMonth: string;
  lastMonth: string;
  /** First day (ISO), or `null` before one is picked. */
  start: string | null;
  /** Last day (ISO), or `null` while the last day is still to be picked. */
  end: string | null;
  disabled?: boolean;
  onChange: (start: string, end: string | null) => void;
  /** Receives the element to focus when the dialog opens. */
  focusRef?: (element: HTMLButtonElement | null) => void;
}

export function RangeCalendar({
  isFree,
  canStart,
  canEnd,
  firstMonth,
  lastMonth,
  start,
  end,
  disabled = false,
  onChange,
  focusRef,
}: RangeCalendarProps): ReactElement {
  const [month, setMonth] = useState(start ? monthOf(start) : firstMonth);
  const [y, m] = month.split("-").map(Number);
  const pickingEnd = start !== null && end === null;

  const handlePick = (iso: string): void => {
    if (pickingEnd && start !== null && canEnd(start, iso)) {
      onChange(start, iso);
    } else {
      onChange(iso, null);
    }
  };

  // Arrow keys move between days; a disabled day is skipped by moving on.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[
      event.key
    ];
    const from = (event.target as HTMLElement).dataset.day;
    if (step === undefined || from === undefined) return;
    event.preventDefault();
    const grid = event.currentTarget;
    for (let hop = 1; hop <= 31; hop += 1) {
      const next = grid.querySelector<HTMLButtonElement>(
        `button[data-day="${addDays(from, step * hop)}"]:not([disabled])`,
      );
      if (next) {
        next.focus();
        return;
      }
    }
  };

  const focusDay =
    start !== null && monthOf(start) === month ? start : null;
  let firstEnabledSeen = false;

  return (
    <div className="flex flex-col gap-8" data-testid="range-calendar">
      <div className="flex items-center justify-between gap-16">
        <button
          type="button"
          aria-label="Previous month"
          className={NAV_CLASSES}
          disabled={disabled || month <= firstMonth}
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          &lt;
        </button>
        <p className="font-display text-accent" aria-live="polite">
          {MONTHS[m - 1]} {y}
        </p>
        <button
          type="button"
          aria-label="Next month"
          className={NAV_CLASSES}
          disabled={disabled || month >= lastMonth}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          &gt;
        </button>
      </div>

      <div
        role="grid"
        aria-label={`${MONTHS[m - 1]} ${y}`}
        onKeyDown={handleKeyDown}
        className="border-2 border-ink bg-bg"
      >
        <div role="row" className="grid grid-cols-7 border-b-2 border-ink">
          {WEEKDAYS.map((name) => (
            <span
              key={name}
              role="columnheader"
              aria-label={name}
              className="py-8 text-center font-display text-muted"
            >
              {name[0]}
            </span>
          ))}
        </div>
        {weeksOf(month).map((week, row) => (
          <div key={`${month}-${row}`} role="row" className="grid grid-cols-7">
            {week.map((iso, column) => {
              if (iso === null) {
                return <span key={`pad-${column}`} role="gridcell" />;
              }
              const isStart = iso === start;
              const isEnd = iso === end;
              const inRange =
                start !== null && end !== null && iso > start && iso < end;
              const endable =
                pickingEnd && start !== null && canEnd(start, iso);
              const startable = canStart(iso);
              const enabled = !disabled && (endable || startable);
              const free = isFree(iso);

              const tone =
                isStart || isEnd
                  ? "bg-accent text-bg"
                  : inRange
                    ? "bg-primary-dark text-ink"
                    : endable
                      ? "border-2 border-dashed border-accent text-ink"
                      : free
                        ? "text-ink"
                        : "text-muted line-through";
              const role = isStart
                ? "first day"
                : isEnd
                  ? "last day"
                  : inRange
                    ? "in the trip"
                    : endable
                      ? "can be the last day"
                      : free
                        ? "free"
                        : "not free";

              const takesFocus =
                enabled && (focusDay === iso || (!focusDay && !firstEnabledSeen));
              if (enabled) firstEnabledSeen = true;

              return (
                <span key={iso} role="gridcell" className="flex">
                  <button
                    type="button"
                    data-day={iso}
                    ref={takesFocus ? focusRef : undefined}
                    disabled={!enabled}
                    tabIndex={takesFocus ? 0 : -1}
                    aria-pressed={isStart || isEnd}
                    aria-label={`${formatDay(iso)}, ${role}`}
                    onClick={() => handlePick(iso)}
                    className={`h-40 w-full font-display ${tone} enabled:cursor-pointer enabled:hover:ring-2 enabled:hover:ring-inset enabled:hover:ring-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink disabled:cursor-not-allowed`}
                  >
                    {Number(iso.slice(8))}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default RangeCalendar;
