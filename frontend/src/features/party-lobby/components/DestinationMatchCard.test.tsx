import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DestinationMatchCard, formatTripDates } from "./DestinationMatchCard";

describe("DestinationMatchCard", () => {
  it("shows the suggested trip length, dates and why", () => {
    render(
      <DestinationMatchCard
        option={{
          id: "penang",
          title: "Penang, Malaysia",
          meta: {
            score: 88,
            tripDays: 4,
            tripStart: "2026-10-15",
            tripEnd: "2026-10-18",
            whyThisLong: "Four days covers George Town and a hike.",
          },
        }}
        selected={false}
        onToggle={() => {}}
      />,
    );

    expect(screen.getByText("SUGGESTED TRIP")).toBeInTheDocument();
    expect(screen.getByText(/4 DAYS/)).toHaveTextContent(
      "4 DAYS · Thu 15 – Sun 18 Oct",
    );
    expect(
      screen.getByText("Four days covers George Town and a hike."),
    ).toBeInTheDocument();
  });

  it("leaves the trip block out for cards without a plan", () => {
    render(
      <DestinationMatchCard
        option={{ id: "x", title: "Old card", meta: { score: 70 } }}
        selected={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.queryByText("SUGGESTED TRIP")).not.toBeInTheDocument();
  });

  it("formats date ranges across months", () => {
    expect(formatTripDates("2026-10-30", "2026-11-02")).toBe(
      "Fri 30 Oct – Mon 2 Nov",
    );
    expect(formatTripDates(null, "2026-11-02")).toBeNull();
  });
});
