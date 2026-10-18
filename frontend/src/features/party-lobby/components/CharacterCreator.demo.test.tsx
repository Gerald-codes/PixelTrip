import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RoomSession } from "@/types";
import { CharacterCreator } from "./CharacterCreator";

const { savePreferences } = vi.hoisted(() => ({
  savePreferences: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/services", () => ({
  getServices: () => ({ preferences: { savePreferences } }),
}));
vi.mock("../hooks/useTravellerPreview", () => ({
  useSetTravellerPreview: () => () => {},
}));

describe("demo character setup", () => {
  it("allows editing prepared choices and still requires a save action on this device", async () => {
    const session: RoomSession = {
      room: {
        id: "room",
        name: "Demo",
        roomCode: "DEMO12",
        status: "active",
        planningStage: "setup",
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
    render(<CharacterCreator session={session} />);
    expect(
      screen.getByText(/Your demo traveller is ready/),
    ).toBeInTheDocument();
    expect(savePreferences).not.toHaveBeenCalled();
    const chill = screen.getByRole("button", { name: "Chill" });
    expect(chill).toBeEnabled();
    fireEvent.click(chill);
    expect(chill).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/prepared destinations, flights and itinerary stay the same/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "SAVE CHARACTER" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(savePreferences).toHaveBeenCalledOnce());
    expect(savePreferences.mock.calls[0][0]).toMatchObject({
      roomCode: "DEMO12",
      memberId: "alice",
      origin: "SIN",
      budget: 2000,
      availableDates: [{ start: "2026-12-29", end: "2027-01-02" }],
      travelStyle: "chill",
    });
  });
});
