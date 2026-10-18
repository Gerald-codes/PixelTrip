import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TripBudget } from "@/services/budget.contract";
import { MOCK_TRIP_BUDGET } from "@/services/budget.mock";

import { BudgetPanel } from "./BudgetPanel";

const NOTHING_YET = {
  stay: null,
  flight: null,
  activities: null,
  total: null,
};

describe("BudgetPanel", () => {
  it("shows 'Not set yet' without a budget", () => {
    render(<BudgetPanel />);
    expect(screen.getByTestId("budget-panel")).toHaveTextContent("Not set yet");
  });

  it("shows the hard limit, who set it, the spend so far and what is left", () => {
    render(<BudgetPanel budget={MOCK_TRIP_BUDGET} />);
    const panel = screen.getByTestId("budget-panel");
    expect(panel).toHaveTextContent("SGD 1,200");
    expect(panel).toHaveTextContent("(lowest: Priya)");
    expect(panel).toHaveTextContent("Style: Low · ~SGD 50–120/day");
    expect(panel).toHaveTextContent("Stay & food (est.)~SGD 250");
    expect(panel).toHaveTextContent("FlightSGD 320");
    expect(panel).toHaveTextContent("RemainingSGD 630");
    // 570 of 1,200 is just under half: five of the ten blocks are filled.
    const bar = screen.getByTestId("budget-bar");
    expect(bar).toHaveAccessibleName("SGD 570 of SGD 1,200 used");
    expect(bar.querySelectorAll(".bg-success")).toHaveLength(5);
  });

  it("shows the level as a guide when nobody typed an amount", () => {
    const guide: TripBudget = {
      ...MOCK_TRIP_BUDGET,
      isHardLimit: false,
      limit: null,
      limitSetBy: null,
      remaining: null,
      estimates: NOTHING_YET,
    };
    render(<BudgetPanel budget={guide} />);
    const panel = screen.getByTestId("budget-panel");
    expect(panel).toHaveTextContent("Guide only");
    expect(panel).toHaveTextContent("~SGD 400 for 5 days, excluding flights");
    expect(panel).not.toHaveTextContent("Remaining");
  });

  it("flags going over the limit", () => {
    const over: TripBudget = {
      ...MOCK_TRIP_BUDGET,
      estimates: { stay: 1400, flight: 320, activities: null, total: 1720 },
      remaining: -520,
      isOverBudget: true,
    };
    render(<BudgetPanel budget={over} />);
    expect(screen.getByText("Over budget")).toBeInTheDocument();
    expect(screen.getByText("SGD 520")).toHaveClass("text-alert");
  });
});
