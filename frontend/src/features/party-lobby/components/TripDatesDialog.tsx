"use client";

/**
 * TripDatesDialog — the party leader changes how long the trip is and when it
 * starts. Opened from the sidebar TRIP DATES card and from the flight screen.
 *
 * The leader picks the first and last day on a calendar (TripCalendar), which
 * sets the dates and the length in one go. Only days the whole party is free can
 * be picked, and the trip must be an allowed length. The trip's dates, its
 * length, the stay's estimated cost and what that leaves of the budget update as
 * they go. Saving stores the dates and starts a fresh flight search, since
 * flights found so far were for the old dates.
 *
 * A modal dialog: focus moves in on open and back on close, Tab stays inside,
 * and Esc or CANCEL closes it without saving.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";

import { PixelButton } from "@/components/PixelButton";
import { ApiError } from "@/lib/errors";
import { getServices } from "@/services";
import type { TripDates } from "@/services/tripDates.contract";

import {
  daysBetween,
  formatDay,
  formatWindows,
  stayPreview,
  todayIso,
  tripDatesProblem,
} from "../lib/tripDates";
import { TripCalendar } from "./TripCalendar";

const FOCUSABLE = "button:not([disabled])";

function money(amount: number): string {
  return `SGD ${Math.abs(amount).toLocaleString("en-SG")}`;
}

export interface TripDatesDialogProps {
  roomId: string;
  memberId: string;
  dates: TripDates;
  onClose: () => void;
  /** Called after the dates are saved (the new flight search has been asked for). */
  onSaved?: () => void;
}

export function TripDatesDialog({
  roomId,
  memberId,
  dates,
  onClose,
  onSaved,
}: TripDatesDialogProps): ReactElement {
  const titleId = useId();
  const helpId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const firstDayRef = useRef<HTMLButtonElement | null>(null);

  const today = todayIso();
  const [start, setStart] = useState<string | null>(dates.tripStart);
  const [end, setEnd] = useState<string | null>(dates.tripEnd);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Move focus in on open; hand it back to whatever opened the dialog on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    firstDayRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const days = start !== null && end !== null ? daysBetween(start, end) + 1 : null;
  const problem =
    start !== null && days !== null
      ? tripDatesProblem(dates, days, start, today)
      : null;
  const preview = days !== null ? stayPreview(dates, days) : null;
  const unchanged = start === dates.tripStart && end === dates.tripEnd;
  const lengthRule =
    dates.minDays === dates.maxDays
      ? `${dates.minDays} days`
      : `${dates.minDays} to ${dates.maxDays} days`;

  const handleSave = async (): Promise<void> => {
    if (start === null || days === null || problem !== null || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await getServices().tripDates.changeDates(roomId, {
        memberId,
        days,
        start,
      });
    } catch (err) {
      setSaveError(
        err instanceof ApiError &&
          (err.code === "INVALID_TRIP_DATES" || err.code === "TRIP_DATES_LOCKED")
          ? err.message
          : "Could not save the dates. Please try again.",
      );
      setSaving(false);
      return;
    }
    try {
      await getServices().run.startRun(roomId, memberId, "logistics");
    } catch {
      // The dates are saved; the flight screen offers SEARCH AGAIN.
    }
    setSaving(false);
    onSaved?.();
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape" && !saving) {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!items || items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-bg/80 p-16">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className="flex w-full max-w-lg flex-col gap-16 border-4 border-ink bg-bg-alt p-24 text-ink"
      >
        <div className="flex flex-col gap-8">
          <h2 id={titleId} className="font-title text-pixel-md text-accent">
            CHANGE TRIP DATES
          </h2>
          {dates.destination ? (
            <p className="font-body text-subtle">{dates.destination}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-8">
          <TripCalendar
            dates={dates}
            start={start}
            end={end}
            today={today}
            disabled={saving}
            focusRef={(element) => {
              firstDayRef.current = element;
            }}
            onChange={(nextStart, nextEnd) => {
              setStart(nextStart);
              setEnd(nextEnd);
              setSaveError(null);
            }}
          />
          <p id={helpId} className="font-body text-subtle">
            {dates.windows.length > 0
              ? `The whole party is free ${formatWindows(dates.windows)}. A trip is ${lengthRule}.`
              : "The party has no shared free dates yet."}
          </p>
        </div>

        <div
          className="flex flex-col gap-8 border-2 border-ink bg-bg p-16 font-body"
          data-testid="trip-dates-preview"
        >
          <p role="status" aria-live="polite">
            {start === null ? (
              "Pick the first day of the trip."
            ) : end === null || days === null ? (
              <>
                Starts{" "}
                <strong className="font-display text-accent">
                  {formatDay(start)}
                </strong>
                . Now pick the last day.
              </>
            ) : (
              <>
                <strong className="font-display text-accent">
                  {formatDay(start)} – {formatDay(end)}
                </strong>
                , {days} days
              </>
            )}
          </p>
          {problem !== null ? (
            <p role="alert" className="text-alert">
              {problem}
            </p>
          ) : null}
          {preview !== null ? (
            <p className={preview.tight ? "text-warning" : "text-subtle"}>
              Stay and food about {money(preview.stay)} per person
              {preview.left === null
                ? "."
                : preview.left >= 0
                  ? `, leaving about ${money(preview.left)} for flights and activities.`
                  : `, which is ${money(preview.left)} over the party's budget.`}
              {preview.tight && preview.left !== null && preview.left >= 0
                ? " That is tight: flights may come out over budget."
                : ""}
            </p>
          ) : null}
        </div>

        <p className="font-body text-subtle">
          Saving starts a new flight search for these dates. Flights and votes
          from the old dates are cleared.
        </p>

        {saveError !== null ? (
          <p role="alert" className="font-body text-alert">
            {saveError}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-16">
          <PixelButton
            variant="primary"
            label={saving ? "SAVING…" : "SAVE AND SEARCH FLIGHTS"}
            disabled={saving || unchanged || days === null || problem !== null}
            onClick={() => {
              void handleSave();
            }}
          />
          <PixelButton
            variant="secondary"
            label="CANCEL"
            disabled={saving}
            onClick={onClose}
          />
        </div>
      </div>
    </div>
  );
}

export default TripDatesDialog;
