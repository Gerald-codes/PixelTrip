/**
 * Render tests for PartyRoomShell (the room screen).
 *
 * The shell is a chatbot-style stage column on the left plus the persistent
 * adventure sidebar on the right. There is no separate top stepper and no
 * bottom party chat. These tests verify: SETUP renders the room code + character
 * creator and the sidebar's six-stage quest progress; DISCOVER swaps the left
 * column to the destination flow while the sidebar stays; the Leave action is
 * always present.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PlanningStage, RoomMember, RoomSession } from "@/types";

import { PartyRoomShell } from "./PartyRoomShell";

function makeMember(overrides: Partial<RoomMember> = {}): RoomMember {
  return {
    id: "member-1",
    roomId: "room-1",
    guestId: "guest-1",
    displayName: "Aria",
    role: "owner",
    stageReady: false,
    ...overrides,
  };
}

function makeSession(
  planningStage: PlanningStage,
  submittedAt: string | null = planningStage === "setup"
    ? null
    : "2026-10-10T00:00:00Z",
): RoomSession {
  return {
    room: {
      id: "room-1",
      roomCode: "ABC123",
      name: "The Wandering Party",
      status: "active",
      planningStage,
    },
    member: makeMember(),
    guest: { id: "guest-1", displayName: "Aria", avatarUrl: null },
    character: null,
    travelPreferences: {
      id: "prefs-1",
      memberId: "member-1",
      availableDates: [],
      destinations: [],
      travelStyle: null,
      budget: null,
      interests: [],
      activities: [],
      hardConstraints: [],
      submittedAt,
    },
  };
}

describe("PartyRoomShell", () => {
  it("renders SETUP content plus the persistent sidebar quest progress", () => {
    render(
      <PartyRoomShell
        session={makeSession("setup")}
        members={[makeMember()]}
        copied={false}
        onCopyCode={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    // Room code + character creator are the SETUP content.
    expect(screen.getByTestId("room-code")).toHaveTextContent("ABC123");
    expect(
      screen.getByRole("button", { name: /save character/i }),
    ).toBeInTheDocument();

    // The sidebar quest progress is the only six-stage list (no top stepper).
    const sidebar = screen.getByRole("list", { name: "Quest progress" });
    expect(within(sidebar).getAllByRole("listitem")).toHaveLength(6);
    expect(
      within(sidebar).getByText("Gather the party").closest("li"),
    ).toHaveAttribute("aria-current", "step");
    expect(
      screen.queryByRole("list", { name: "Planning stages" }),
    ).not.toBeInTheDocument();

    // Leave action present.
    expect(
      screen.getByRole("button", { name: /leave party/i }),
    ).toBeInTheDocument();
  });

  it("swaps the left column to the destination flow in DISCOVER, sidebar stays", () => {
    render(
      <PartyRoomShell
        session={makeSession("discover")}
        members={[makeMember()]}
        copied={false}
        onCopyCode={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    // SETUP content is gone.
    expect(screen.queryByTestId("room-code")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save character/i }),
    ).not.toBeInTheDocument();

    // The sidebar's quest progress still renders, with DISCOVER current.
    const sidebar = screen.getByRole("list", { name: "Quest progress" });
    expect(
      within(sidebar).getByText("Choose the destination").closest("li"),
    ).toHaveAttribute("aria-current", "step");
  });

  it("asks a member who joined after SETUP to create a character first", () => {
    render(
      <PartyRoomShell
        session={makeSession("discover", null)}
        members={[makeMember({ role: "member" })]}
        copied={false}
        onCopyCode={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    expect(screen.getByText(/party has already set off/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save character/i }),
    ).toBeInTheDocument();
    // The sidebar still shows where the party is.
    const sidebar = screen.getByRole("list", { name: "Quest progress" });
    expect(
      within(sidebar).getByText("Choose the destination").closest("li"),
    ).toHaveAttribute("aria-current", "step");
  });
});
