/** The live traveller: in the sidebar while the form is open, updating as you pick. */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RoomMember, RoomSession } from "@/types";

import type { CharacterDraft } from "../types";
import { PartyRoomShell } from "./PartyRoomShell";
import { TravellerCard, answeredCount } from "./TravellerCard";

const EMPTY: CharacterDraft = {
  budgetTier: null,
  groupRole: null,
  tripPriorities: [],
  destinations: [],
  activities: [],
  budgetText: "",
  availableDates: [{ start: "", end: "" }],
};

const member = {
  id: "member-1",
  roomId: "room-1",
  guestId: "guest-1",
  displayName: "Aria",
  role: "owner",
  stageReady: false,
} as RoomMember;

function session(stage: "setup" | "discover"): RoomSession {
  return {
    room: {
      id: "room-1",
      roomCode: "ABC123",
      name: "The Wandering Party",
      status: "active",
      planningStage: stage,
    },
    member,
    guest: { id: "guest-1", displayName: "Aria", avatarUrl: null },
    character: null,
    travelPreferences: {
      id: "p",
      memberId: "member-1",
      availableDates: [],
      destinations: [],
      travelStyle: null,
      budget: null,
      interests: [],
      activities: [],
      hardConstraints: [],
      submittedAt: stage === "setup" ? null : "2026-10-10T00:00:00Z",
    },
  } as RoomSession;
}

const show = (stage: "setup" | "discover"): void => {
  render(
    <PartyRoomShell
      session={session(stage)}
      members={[member]}
      copied={false}
      onCopyCode={vi.fn()}
      onLeave={vi.fn()}
    />,
  );
};

describe("TravellerCard", () => {
  it("counts how many of the six questions are answered", () => {
    expect(answeredCount(EMPTY)).toBe(0);
    expect(
      answeredCount({
        ...EMPTY,
        budgetTier: "low",
        groupRole: "planner",
        tripPriorities: ["food"],
        availableDates: [{ start: "2099-03-10", end: "2099-03-20" }],
      }),
    ).toBe(4);
  });

  it("shows the role, budget, badges and free dates of the draft", () => {
    render(
      <TravellerCard
        name="Aria"
        draft={{
          ...EMPTY,
          budgetTier: "low",
          groupRole: "planner",
          tripPriorities: ["food", "culture"],
          activities: ["hiking"],
          availableDates: [{ start: "2099-03-10", end: "2099-03-20" }],
        }}
      />,
    );
    const card = screen.getByTestId("traveller-card");

    expect(card).toHaveTextContent("Planner, low budget");
    expect(
      within(card)
        .getAllByRole("img")
        .map((icon) => icon.getAttribute("aria-label")),
    ).toEqual(["Food", "Culture", "Hiking"]);
    expect(card).toHaveTextContent("Free Tue 10 Mar to Fri 20 Mar");
    expect(card).toHaveTextContent("5 of 6 answered");
  });
});

describe("the traveller in the sidebar", () => {
  it("stands in the sidebar while the form is open and follows each choice", () => {
    show("setup");
    const sidebar = screen.getByRole("complementary", { name: "Your adventure" });
    const card = within(sidebar).getByTestId("traveller-card");

    expect(card).toHaveTextContent("Pick a role to dress your traveller");
    expect(card).toHaveTextContent("0 of 6 answered");

    fireEvent.click(screen.getByRole("button", { name: "Planner" }));
    fireEvent.click(screen.getByRole("button", { name: "Low Budget" }));

    expect(card).toHaveTextContent("Planner, low budget");
    expect(card).toHaveTextContent("2 of 6 answered");
    expect(card.querySelector('[data-sprite-key="preview"]')).not.toBeNull();
  });

  it("is gone once the traveller is saved and the party has moved on", () => {
    show("discover");
    expect(screen.queryByTestId("traveller-card")).not.toBeInTheDocument();
  });
});
