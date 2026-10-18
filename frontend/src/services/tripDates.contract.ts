/**
 * Trip dates service contract — the trip's own length and dates.
 *
 * Mirrors `GET` / `PUT /trips/{tripId}/trip-dates` (see `api-contracts.md`). These
 * are the trip's dates, not the party's availability: the AI suggests them per
 * destination and the party leader may change them until a flight is locked.
 */
import type { Unsubscribe } from "@/types";

/** An inclusive range of ISO dates (`YYYY-MM-DD`). */
export interface DateWindow {
  start: string;
  end: string;
}

export interface TripDates {
  destination: string | null;
  /** `null` until a destination is chosen (so are the dates and the reason). */
  tripDays: number | null;
  tripStart: string | null;
  tripEnd: string | null;
  whyThisLong: string | null;
  /** When the whole party is free; the trip must sit inside one of these. */
  windows: DateWindow[];
  minDays: number;
  maxDays: number;
  /** For previewing the stay cost against the hard limit; either may be `null`. */
  dailyCostSgd: number | null;
  budgetLimit: number | null;
  /** False before a destination is chosen and after a flight is locked. */
  canChange: boolean;
  lockedReason: string | null;
}

export interface ChangeTripDatesInput {
  memberId: string;
  days: number;
  /** ISO date the trip starts on. */
  start: string;
}

export interface TripDatesService {
  /** The room's trip dates, or `null` when the room has no trip yet. */
  getDates(roomId: string): Promise<TripDates | null>;

  /** Push the dates now and again whenever the room's selections change. */
  subscribeDates(
    roomId: string,
    onChange: (dates: TripDates | null) => void,
  ): Unsubscribe;

  /**
   * Leader-only: set the trip's length and start date. Closes any open flight
   * vote; the caller then starts a fresh `logistics` run for the new dates.
   */
  changeDates(roomId: string, input: ChangeTripDatesInput): Promise<TripDates>;
}
