import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RoomMember, RoomSession } from "@/types";

import { FlightStageContent } from "./FlightStageContent";

const session = {
  room: {
    id: "room-1",
    roomCode: "ABC123",
    name: "Trip",
    status: "active",
    planningStage: "logistics",
  },
  member: {
    id: "m1",
    roomId: "room-1",
    guestId: "g1",
    displayName: "Gerald",
    role: "owner",
    stageReady: false,
  },
} as unknown as RoomSession;
const members = [session.member] as unknown as RoomMember[];

describe("FlightStageContent (mock services)", () => {
  it("shows the flights to vote on", async () => {
    render(<FlightStageContent session={session} members={members} />);

    expect(
      await screen.findByRole("heading", { name: "Scoot TR808" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Singapore Airlines SQ12" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "LOCK IN VOTE" })).toBeDisabled();
  });
});
