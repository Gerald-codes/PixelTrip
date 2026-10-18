"use client";

/**
 * AvailabilityPicker — a member marks when they are free to travel.
 *
 * Each free period is picked on the same pixel calendar the leader uses for the
 * trip dates: click the first day, then the last. A finished period folds down to
 * one line ("Sat 12 – Sun 27 Dec, 16 days") with CHANGE and REMOVE; one calendar
 * is open at a time. Any day from today up to a year ahead can be picked, and a
 * period may be a single day.
 */
import { useState, type ReactElement } from "react";

import { PixelButton } from "@/components/PixelButton";

import { addDays, daysBetween, formatDay, todayIso } from "../lib/tripDates";
import { RangeCalendar } from "./RangeCalendar";

/** How far ahead a member can mark themselves free. */
const HORIZON_DAYS = 365;

/** A free period as the draft stores it: ISO dates, or "" while not picked. */
export interface AvailabilityRange {
  start: string;
  end: string;
}

export interface AvailabilityPickerProps {
  ranges: readonly AvailabilityRange[];
  onChange: (index: number, range: AvailabilityRange) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  /** Today as an ISO date; injectable for tests. */
  today?: string;
}

function summary(range: AvailabilityRange): string {
  const days = daysBetween(range.start, range.end) + 1;
  return range.start === range.end
    ? `${formatDay(range.start)}, 1 day`
    : `${formatDay(range.start)} – ${formatDay(range.end)}, ${days} days`;
}

export function AvailabilityPicker({
  ranges,
  onChange,
  onAdd,
  onRemove,
  today = todayIso(),
}: AvailabilityPickerProps): ReactElement {
  const firstUnfinished = ranges.findIndex((r) => !r.start || !r.end);
  const [openIndex, setOpenIndex] = useState<number | null>(
    firstUnfinished === -1 ? null : firstUnfinished,
  );
  const horizon = addDays(today, HORIZON_DAYS);
  const inReach = (iso: string): boolean => iso >= today && iso <= horizon;
  const canRemove = ranges.length > 1;

  return (
    <div className="flex flex-col gap-16">
      <p className="font-body text-subtle">
        Select the dates you're available to travel. MILO will find the perfect trip dates that work for everyone in your party!
      </p>

      {ranges.map((range, index) => {
        const complete = Boolean(range.start && range.end);
        const open = openIndex === index;
        const name = `Free period ${index + 1}`;
        return (
          <div
            key={index}
            role="group"
            aria-label={name}
            className="flex flex-col gap-16 border-2 border-muted p-16"
          >
            <div className="flex flex-wrap items-center justify-between gap-8">
              <p className="font-body" aria-live="polite">
                {complete ? (
                  <strong className="font-display text-accent">
                    {summary(range)}
                  </strong>
                ) : range.start ? (
                  <>
                    From{" "}
                    <strong className="font-display text-accent">
                      {formatDay(range.start)}
                    </strong>
                    . Now pick the last day.
                  </>
                ) : (
                  "Pick the first day you are free."
                )}
              </p>
              <div className="flex flex-wrap gap-8">
                {complete && !open ? (
                  <PixelButton
                    variant="secondary"
                    label="Change"
                    ariaLabel={`Change ${name.toLowerCase()}`}
                    onClick={() => setOpenIndex(index)}
                  />
                ) : null}
                {canRemove ? (
                  <PixelButton
                    variant="secondary"
                    label="Remove"
                    ariaLabel={`Remove ${name.toLowerCase()}`}
                    onClick={() => {
                      onRemove(index);
                      setOpenIndex(null);
                    }}
                  />
                ) : null}
              </div>
            </div>

            {open ? (
              <RangeCalendar
                isFree={inReach}
                canStart={inReach}
                canEnd={(start, iso) => iso >= start && iso <= horizon}
                firstMonth={today.slice(0, 7)}
                lastMonth={horizon.slice(0, 7)}
                start={range.start || null}
                end={range.end || null}
                onChange={(start, end) => {
                  onChange(index, { start, end: end ?? "" });
                  // A finished period folds away so the next step is in view.
                  if (end !== null) setOpenIndex(null);
                }}
              />
            ) : null}
          </div>
        );
      })}

      <PixelButton
        variant="secondary"
        label="Add another period"
        onClick={() => {
          onAdd();
          setOpenIndex(ranges.length);
        }}
      />
    </div>
  );
}

export default AvailabilityPicker;
