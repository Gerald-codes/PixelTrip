import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ItineraryVersion, RoomSession } from "@/types";
import { BuildStageContent } from "./BuildStageContent";

const { services } = vi.hoisted(() => ({
  services: {
    destination: { getTripId: vi.fn().mockResolvedValue("trip") },
    itinerary: {
      getCurrent: vi.fn(),
      submitFeedback: vi.fn().mockResolvedValue({}),
      review: vi
        .fn()
        .mockResolvedValue({ allReady: false, needsRefinement: false }),
    },
    run: { startRun: vi.fn().mockResolvedValue(undefined) },
  },
}));
vi.mock("@/services", () => ({ getServices: () => services }));
vi.mock("../hooks/useGuideRun", () => ({
  useGuideRun: () => ({ run: null, refresh: () => {} }),
}));

function session(): RoomSession {
  return {
    room: {
      id: "room",
      roomCode: "DEMO12",
      name: "Demo",
      status: "active",
      planningStage: "refine",
      demoScenario: "vietnam-five-days",
      demoStart: "2026-12-29",
    },
    member: {
      id: "alice",
      roomId: "room",
      guestId: "guest",
      displayName: "DemoAlice",
      role: "owner",
      stageReady: false,
    },
    guest: { id: "guest", displayName: "DemoAlice", avatarUrl: null },
    character: null,
    travelPreferences: null,
  };
}

function version(n: number): ItineraryVersion {
  return {
    id: `version-${n}`,
    version: n,
    source: n === 1 ? "build" : "refine",
    isCurrent: true,
    itinerary: {
      tripId: "trip",
      roomId: "room",
      title: "Demo Quest",
      summary: "Prepared",
      destination: { name: "Da Nang" },
      days: [
        {
          day: 1,
          items: [
            {
              id: "d1-i1",
              title: "Dinner",
              time: "19:00",
              description: "Dinner only.",
            },
            ...(n > 1
              ? [
                  {
                    id: "club",
                    title: "Separate Club Visit",
                    time: "21:00",
                    description: "Club only.",
                  },
                ]
              : []),
          ],
        },
      ],
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("prepared itinerary reviews", () => {
  it("shows a prepared selector and submits the supported change", async () => {
    services.itinerary.getCurrent.mockResolvedValue(version(1));
    const s = session();
    render(<BuildStageContent session={s} members={[s.member]} />);
    const select = await screen.findByRole("combobox", {
      name: "Prepared change for day 1",
    });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.change(select, {
      target: { value: "Add a separate club visit after dinner" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "REQUEST CHANGES TO THIS DAY" }),
    );
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "LOCK IN MY REVIEW" }),
      ),
    );
    expect(services.itinerary.submitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        comment: "Add a separate club visit after dinner",
        target: { day: 1 },
      }),
    );
  });

  it("unlocks a new version even when the fast demo finishes between run polls", async () => {
    vi.useFakeTimers();
    let current = version(1);
    services.itinerary.getCurrent.mockImplementation(async () => current);
    const s = session();
    render(<BuildStageContent session={s} members={[s.member]} />);
    await act(async () => {});
    fireEvent.click(
      screen.getByRole("button", { name: "LOOKS GOOD — KEEP THIS DAY" }),
    );
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "LOCK IN MY REVIEW" }),
      ),
    );
    expect(screen.getByText(/waiting for/i)).toBeInTheDocument();
    current = version(2);
    await act(async () => vi.advanceTimersByTimeAsync(2100));
    expect(screen.getByText("Separate Club Visit")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "LOCK IN MY REVIEW" }),
    ).toBeEnabled();
  });
});
