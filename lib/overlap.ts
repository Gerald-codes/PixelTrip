/**
 * Date-range overlap utility.
 *
 * Used to compute the travel window that works for every member of a trip
 * room. Each user submits one or more `DateRange`s; the group's overlap is the
 * window during which EVERY user has at least one range that covers it.
 *
 * ISO date strings (YYYY-MM-DD) sort lexicographically, so all comparisons are
 * done as string comparisons — no `Date` parsing required.
 */

/** A single inclusive date range, ISO YYYY-MM-DD strings. */
export interface DateRange {
  startDate: string;
  endDate: string;
}

/**
 * Merge a user's ranges into a sorted list of non-overlapping intervals.
 * Overlapping or adjacent ranges (e.g. ending on the same day the next begins)
 * are collapsed into a single range.
 */
function unionRanges(ranges: DateRange[]): DateRange[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges]
    .filter((r) => r.startDate <= r.endDate)
    .sort((a, b) =>
      a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0,
    );

  if (sorted.length === 0) return [];

  const merged: DateRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = merged[merged.length - 1];
    const next = sorted[i];
    if (next.startDate <= last.endDate) {
      if (next.endDate > last.endDate) {
        last.endDate = next.endDate;
      }
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

/**
 * Pairwise intersection of two sorted, non-overlapping interval lists.
 * Returns the (sorted) list of intervals where both `a` and `b` cover the date.
 */
function intersectRanges(a: DateRange[], b: DateRange[]): DateRange[] {
  const result: DateRange[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = a[i].startDate > b[j].startDate ? a[i].startDate : b[j].startDate;
    const end = a[i].endDate < b[j].endDate ? a[i].endDate : b[j].endDate;
    if (start <= end) {
      result.push({ startDate: start, endDate: end });
    }
    // Advance whichever interval ends first.
    if (a[i].endDate < b[j].endDate) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return result;
}

/** Length of a range in whole days (inclusive). */
function rangeLengthDays(range: DateRange): number {
  const startMs = Date.parse(range.startDate);
  const endMs = Date.parse(range.endDate);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 0;
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

/**
 * Compute the longest date window that overlaps every user's availability.
 *
 * Accepts either:
 *   - `DateRange[][]` — one entry per user, each entry is that user's ranges
 *   - `Map<string, DateRange[]>` — keyed by userId
 *
 * Algorithm:
 *   1. Union each user's ranges into a sorted, non-overlapping interval list.
 *   2. Intersect those lists pairwise across all users.
 *   3. Return the longest resulting interval, or `null` if none.
 *
 * Returns `null` when any user has no ranges, or when no overlap exists.
 *
 * Pure function — no I/O, no mutation of inputs.
 */
export function calculateOverlap(
  rangesByUser: Map<string, DateRange[]> | DateRange[][],
): DateRange | null {
  const userRanges: DateRange[][] =
    rangesByUser instanceof Map
      ? Array.from(rangesByUser.values())
      : rangesByUser;

  if (userRanges.length === 0) return null;

  const unioned: DateRange[][] = [];
  for (const ranges of userRanges) {
    const u = unionRanges(ranges);
    if (u.length === 0) return null;
    unioned.push(u);
  }

  let intersection = unioned[0];
  for (let i = 1; i < unioned.length; i += 1) {
    intersection = intersectRanges(intersection, unioned[i]);
    if (intersection.length === 0) return null;
  }

  let longest: DateRange | null = null;
  let longestLen = -1;
  for (const range of intersection) {
    const len = rangeLengthDays(range);
    if (len > longestLen) {
      longestLen = len;
      longest = range;
    }
  }
  return longest;
}
