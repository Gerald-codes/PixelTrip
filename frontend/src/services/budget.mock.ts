/**
 * Budget service — mock (in-memory) implementation for `NEXT_PUBLIC_SERVICE_MODE=mock`.
 */
import type { Unsubscribe } from "@/types";

import type { BudgetService, TripBudget } from "./budget.contract";

export const MOCK_TRIP_BUDGET: TripBudget = {
  currency: "SGD",
  days: 5,
  isHardLimit: true,
  limit: 1200,
  limitSetBy: "Priya",
  level: "low",
  levelCount: 1,
  dailyRange: { low: 50, high: 120, typical: 80 },
  levelEstimate: 400,
  estimates: { stay: 250, flight: 320, activities: null, total: 570 },
  remaining: 630,
  isOverBudget: false,
  members: [],
};

export class MockBudgetService implements BudgetService {
  async getBudget(_roomId: string): Promise<TripBudget | null> {
    return MOCK_TRIP_BUDGET;
  }

  subscribeBudget(
    _roomId: string,
    onChange: (budget: TripBudget | null) => void,
  ): Unsubscribe {
    onChange(MOCK_TRIP_BUDGET);
    return () => {};
  }
}
