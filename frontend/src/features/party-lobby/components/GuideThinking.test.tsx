import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RunProgress } from "@/services/run.contract";

import { GuideThinking } from "./GuideThinking";

function run(overrides: Partial<RunProgress> = {}): RunProgress {
  return {
    id: "r1",
    runType: "logistics",
    status: "running",
    phase: "checking_budget",
    elapsedSeconds: 3,
    ...overrides,
  };
}

describe("GuideThinking", () => {
  it("announces the real step and marks done / now / next", () => {
    render(<GuideThinking runType="logistics" run={run()} isOwner={false} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking dates and budget…",
    );
    const steps = screen.getByRole("list", { name: "Guide progress" });
    expect(steps).toHaveTextContent("[x]Searching for flights (done)");
    expect(steps).toHaveTextContent(
      "[>]Checking dates and budget (in progress)",
    );
    expect(steps).toHaveTextContent("[ ]Laying out the options");
  });

  it("reassures on long waits", () => {
    render(
      <GuideThinking
        runType="discovery"
        run={run({ elapsedSeconds: 50 })}
        isOwner={false}
      />,
    );
    expect(screen.getByText(/servers are busy today/)).toBeInTheDocument();
  });

  it("waits quietly before any run exists", () => {
    render(<GuideThinking runType="discovery" run={null} isOwner={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Waiting for the guide to begin…",
    );
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("explains a failed flight search and lets the owner retry", () => {
    const onRetry = vi.fn();
    render(
      <GuideThinking
        runType="logistics"
        run={run({ status: "failed", phase: "searching_flights" })}
        isOwner
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "flight search is unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "TRY AGAIN" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("tells other members the leader can retry", () => {
    render(
      <GuideThinking
        runType="discovery"
        run={run({ status: "failed", phase: "asking_guide" })}
        isOwner={false}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/party leader can ask/)).toBeInTheDocument();
  });

  it("describes a refinement failure without assuming AI downtime", () => {
    render(
      <GuideThinking
        runType="refinement"
        run={run({ runType: "refinement", status: "failed", phase: "asking_guide" })}
        isOwner={false}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("couldn't finish updating your itinerary");
    expect(screen.getByRole("alert")).not.toHaveTextContent("AI service is busy");
  });
});
