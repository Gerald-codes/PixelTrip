import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TiebreakAdvice } from "@/services/destination.contract";

import { TiebreakPanel } from "./TiebreakPanel";

const pendingTie: TiebreakAdvice = {
  voteSessionId: "vs-1",
  category: "destination",
  advice: "",
  recommendedOptionId: null,
  pending: true,
  options: [
    { id: "penang", title: "Penang, Malaysia", votes: ["testing"] },
    { id: "da-nang", title: "Da Nang, Vietnam", votes: ["GERALD"] },
  ],
};

describe("TiebreakPanel", () => {
  it("shows the tie at once and lets the leader choose before the advice arrives", () => {
    const onBreakTie = vi.fn();
    render(
      <TiebreakPanel
        tiebreak={pendingTie}
        isOwner
        deciding={false}
        error={null}
        onBreakTie={onBreakTie}
        thinking={<p>Weighing the tied options…</p>}
      />,
    );

    expect(screen.getByText("IT'S A TIE")).toBeInTheDocument();
    expect(screen.getByText("Weighing the tied options…")).toBeInTheDocument();
    expect(
      screen.getByText(/Choose now, or wait for the guide's advice/),
    ).toBeInTheDocument();
    expect(screen.getByText("Voted by: testing")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Choose Da Nang, Vietnam" }),
    );
    expect(onBreakTie).toHaveBeenCalledWith("da-nang");
  });

  it("shows the advice instead of the thinking slot once it arrives", () => {
    render(
      <TiebreakPanel
        tiebreak={{
          ...pendingTie,
          pending: false,
          advice: "Penang suits more of you.",
        }}
        isOwner={false}
        deciding={false}
        error={null}
        onBreakTie={vi.fn()}
        thinking={<p>Weighing the tied options…</p>}
      />,
    );

    expect(screen.getByText("Penang suits more of you.")).toBeInTheDocument();
    expect(
      screen.queryByText("Weighing the tied options…"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Waiting for the party leader/),
    ).toBeInTheDocument();
  });
});
