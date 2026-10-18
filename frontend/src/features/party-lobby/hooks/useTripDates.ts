"use client";

/**
 * useTripDates — the room's live trip dates (length, start, end, and what they
 * may change to). `null` until the room has a trip.
 */
import { useEffect, useState } from "react";

import { getServices } from "@/services";
import type { TripDates } from "@/services/tripDates.contract";

export function useTripDates(
  roomId: string | null | undefined,
): TripDates | null {
  const [dates, setDates] = useState<TripDates | null>(null);

  useEffect(() => {
    if (!roomId) {
      setDates(null);
      return;
    }
    return getServices().tripDates.subscribeDates(roomId, setDates);
  }, [roomId]);

  return dates;
}
