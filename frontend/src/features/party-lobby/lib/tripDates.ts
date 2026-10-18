/**
 * Trip-date helpers for the change-dates dialog. Dates are ISO `YYYY-MM-DD`
 * strings and all arithmetic is on calendar days (no time zones involved).
 */
import type { DateWindow, TripDates } from "@/services/tripDates.contract";

/** Above this share of the budget, the stay leaves little for flights. */
export const STAY_BUDGET_SHARE = 0.6;

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** "Mon 12 Oct" */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d)
    .toLocaleDateString("en-SG", {
      weekday: "short",
      day: "numeric",
      month: "short",
    })
    .replace(/,/g, "");
}

export function formatWindows(windows: readonly DateWindow[]): string {
  return windows
    .map((w) => `${formatDay(w.start)} – ${formatDay(w.end)}`)
    .join(", ");
}

/**
 * Why a trip of `days` starting on `start` cannot be saved, or `null` when it
 * can. Mirrors the backend's checks so the leader sees the problem before saving.
 */
export function tripDatesProblem(
  dates: TripDates,
  days: number,
  start: string,
  today: string = todayIso(),
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return "Pick a start date.";
  if (days < dates.minDays || days > dates.maxDays) {
    return `The trip must be ${dates.minDays} to ${dates.maxDays} days long.`;
  }
  if (start < today) return "The trip cannot start in the past.";
  const end = addDays(start, days - 1);
  const fits = dates.windows.some((w) => w.start <= start && end <= w.end);
  if (!fits) {
    return dates.windows.length > 0
      ? `Those dates run outside when the whole party is free (${formatWindows(dates.windows)}).`
      : "The party has no shared free dates yet.";
  }
  return null;
}

export interface StayPreview {
  stay: number;
  /** What the hard limit leaves after the stay; `null` without a limit. */
  left: number | null;
  /** True when the stay uses more of the limit than {@link STAY_BUDGET_SHARE}. */
  tight: boolean;
}

/** The stay's estimated cost for `days`, or `null` without a daily estimate. */
export function stayPreview(dates: TripDates, days: number): StayPreview | null {
  if (dates.dailyCostSgd === null) return null;
  const stay = Math.round(dates.dailyCostSgd * days);
  if (dates.budgetLimit === null) return { stay, left: null, tight: false };
  return {
    stay,
    left: Math.round(dates.budgetLimit - stay),
    tight: stay > dates.budgetLimit * STAY_BUDGET_SHARE,
  };
}

/** Whole days from `from` to `to` (0 when equal, negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const utc = (iso: string): number => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** The shared window a day falls in, if any. */
export function windowOf(
  windows: readonly DateWindow[],
  iso: string,
): DateWindow | null {
  return windows.find((w) => w.start <= iso && iso <= w.end) ?? null;
}

/**
 * Can a trip start on `iso`? It must be today or later, inside a shared window,
 * with room left in that window for the shortest allowed trip.
 */
export function canStartOn(dates: TripDates, iso: string, today: string): boolean {
  const window = windowOf(dates.windows, iso);
  if (!window || iso < today) return false;
  return addDays(iso, dates.minDays - 1) <= window.end;
}

/**
 * Can a trip that starts on `start` end on `iso`? Same shared window, and a
 * length inside the allowed range.
 */
export function canEndOn(dates: TripDates, start: string, iso: string): boolean {
  const window = windowOf(dates.windows, start);
  if (!window || iso > window.end) return false;
  const length = daysBetween(start, iso) + 1;
  return length >= dates.minDays && length <= dates.maxDays;
}
