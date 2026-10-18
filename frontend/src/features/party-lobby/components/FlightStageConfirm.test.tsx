/** The flight screen's confirm step and its handling of changed dates. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LogisticsState } from "@/services/flight.contract";
import type { RunProgress } from "@/services/run.contract";
import type { TripDates } from "@/services/tripDates.contract";
import type { RoomMember, RoomSession } from "@/types";

import { FlightStageContent } from "./FlightStageContent";

const startLogistics = vi.fn();
let latestRun: RunProgress | null = null;
let logistics: LogisticsState;

const DATES: TripDates = {
  destination: "Penang, Malaysia",
  tripDays: 4,
  tripStart: "2099-03-19",
  tripEnd: "2099-03-22",
  whyThisLong: null,
  windows: [{ start: "2099-03-10", end: "2099-04-08" }],
  minDays: 2,
  maxDays: 14,
  dailyCostSgd: 32,
  budgetLimit: 1200,
  canChange: true,
  lockedReason: null,
};

vi.mock("@/services", () => ({
  getServices: () => ({
    destination: { getTripId: async () => "trip-1" },
    flight: {
      startLogistics,
      subscribeLogistics: (_room: string, onChange: (s: LogisticsState) => void) => {
        onChange(logistics);
        return () => {};
      },
    },
    run: { getLatestRun: async () => latestRun, startRun: vi.fn() },
    tripDates: {
      subscribeDates: (_room: string, onChange: (d: TripDates) => void) => {
        onChange(DATES);
        return () => {};
      },
    },
  }),
}));

const NOTHING: LogisticsState = {
  loading: true,
  options: [],
  selectedFlight: null,
  vote: null,
  tiePending: false,
  tiebreak: null,
  guideNote: null,
};

function sessionFor(role: "owner" | "member"): RoomSession {
  return {
    room: { id: "room-1", roomCode: "ABC123", name: "Trip", planningStage: "logistics" },
    member: { id: "m1", roomId: "room-1", displayName: "Gerald", role, stageReady: false },
  } as unknown as RoomSession;
}

function show(role: "owner" | "member"): void {
  const session = sessionFor(role);
  render(
    <FlightStageContent
      session={session}
      members={[session.member] as unknown as RoomMember[]}
    />,
  );
}

beforeEach(() => {
  startLogistics.mockReset().mockResolvedValue(undefined);
  latestRun = null;
  logistics = NOTHING;
});

describe("FlightStageContent confirm step", () => {
  it("shows the trip dates and waits for the leader instead of searching at once", async () => {
    show("owner");

    const step = await screen.findByTestId("confirm-dates");
    expect(step).toHaveTextContent(/4 DAYS, Thu 19 – Sun 22 Mar/);
    expect(startLogistics).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "SEARCH FLIGHTS" }));
    await waitFor(() =>
      expect(startLogistics).toHaveBeenCalledWith({
        tripId: "trip-1",
        memberId: "m1",
        retry: false,
      }),
    );
  });

  it("lets the leader open the change-dates dialog first", async () => {
    show("owner");
    fireEvent.click(await screen.findByRole("button", { name: "CHANGE DATES" }));
    expect(screen.getByRole("dialog", { name: "CHANGE TRIP DATES" })).toBeInTheDocument();
  });

  it("tells other members to wait for the leader", async () => {
    show("member");
    expect(await screen.findByTestId("confirm-dates")).toHaveTextContent(
      "Waiting for the party leader",
    );
    expect(screen.queryByRole("button", { name: "SEARCH FLIGHTS" })).not.toBeInTheDocument();
  });

  it("hides flights from a vote that was closed by a change of dates", async () => {
    logistics = {
      ...NOTHING,
      loading: false,
      options: [{ id: "f1", title: "Scoot TR808" }],
      vote: { voteSessionId: "v1", question: "Which flight?", options: [], status: "closed" },
      guideNote: "The party leader set the trip to 6 days.",
    };
    latestRun = {
      id: "run-1",
      runType: "logistics",
      status: "completed",
      phase: "posting",
      elapsedSeconds: 9,
    };
    show("owner");

    expect(await screen.findByRole("button", { name: "SEARCH AGAIN" })).toBeInTheDocument();
    expect(screen.getByText("The party leader set the trip to 6 days.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Scoot TR808" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CHANGE DATES" })).toBeInTheDocument();
  });
});
