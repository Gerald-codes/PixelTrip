/**
 * Trip dates service — mock (in-memory) implementation for `NEXT_PUBLIC_SERVICE_MODE=mock`.
 */
import type { Unsubscribe } from "@/types";

import type {
  ChangeTripDatesInput,
  TripDates,
  TripDatesService,
} from "./tripDates.contract";

export const MOCK_TRIP_DATES: TripDates = {
  destination: "Kyoto, Japan",
  tripDays: 6,
  tripStart: "2027-03-17",
  tripEnd: "2027-03-22",
  whyThisLong: "Six days covers the temples, Arashiyama and a day trip to Nara.",
  windows: [{ start: "2027-03-10", end: "2027-04-08" }],
  minDays: 2,
  maxDays: 14,
  dailyCostSgd: 140,
  budgetLimit: 2400,
  canChange: true,
  lockedReason: null,
};

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export class MockTripDatesService implements TripDatesService {
  private dates: TripDates = MOCK_TRIP_DATES;
  private listeners = new Set<(dates: TripDates | null) => void>();

  async getDates(_roomId: string): Promise<TripDates | null> {
    return this.dates;
  }

  subscribeDates(
    _roomId: string,
    onChange: (dates: TripDates | null) => void,
  ): Unsubscribe {
    this.listeners.add(onChange);
    onChange(this.dates);
    return () => {
      this.listeners.delete(onChange);
    };
  }

  async changeDates(
    _roomId: string,
    input: ChangeTripDatesInput,
  ): Promise<TripDates> {
    this.dates = {
      ...this.dates,
      tripDays: input.days,
      tripStart: input.start,
      tripEnd: addDays(input.start, input.days - 1),
      whyThisLong: "Set by the party leader.",
    };
    this.listeners.forEach((listener) => listener(this.dates));
    return this.dates;
  }
}
