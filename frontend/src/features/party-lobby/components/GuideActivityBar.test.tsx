import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GuideActivityBar } from "./GuideActivityBar";

describe("GuideActivityBar", () => {
  it("says what MILO is doing and the real step", () => {
    render(
      <GuideActivityBar
        run={{
          id: "r1",
          runType: "itinerary",
          status: "running",
          phase: "drafting_days",
          elapsedSeconds: 4,
        }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "MILO is drafting your itinerary: Drafting the quest log…",
    );
    expect(
      screen.queryByText(/usually under a minute/),
    ).not.toBeInTheDocument();
  });

  it("reassures on a long wait and starts honestly before the first step", () => {
    render(
      <GuideActivityBar
        run={{
          id: "r1",
          runType: "refinement",
          status: "pending",
          phase: null,
          elapsedSeconds: 20,
        }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "MILO is updating the itinerary: Getting started…",
    );
    expect(screen.getByText(/usually under a minute/)).toBeInTheDocument();
  });
});
