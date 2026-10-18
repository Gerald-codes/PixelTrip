"use client";

/**
 * useTripBudget — the room's live trip budget for the sidebar.
 *
 * Subscribes through the budget service, which re-fetches whenever a member saves
 * preferences, a vote locks a destination or flight, or an itinerary arrives.
 * Returns `null` until there is a budget to show.
 */
import { useEffect, useState } from "react";

import { getServices } from "@/services";
import type { TripBudget } from "@/services/budget.contract";

export function useTripBudget(
  roomId: string | null | undefined,
): TripBudget | null {
  const [budget, setBudget] = useState<TripBudget | null>(null);

  useEffect(() => {
    if (!roomId) {
      setBudget(null);
      return;
    }
    return getServices().budget.subscribeBudget(roomId, setBudget);
  }, [roomId]);

  return budget;
}
