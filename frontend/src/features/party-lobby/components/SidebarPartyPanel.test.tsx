import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarPartyPanel, inviteLink } from "./SidebarPartyPanel";

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
});

const show = (roomCode: string | null = "TVJ49F"): void => {
  render(<SidebarPartyPanel members={[]} roomCode={roomCode} />);
};

describe("SidebarPartyPanel roster", () => {
  const MEMBERS = [
    {
      id: "m1",
      displayName: "Gerald",
      archetypeLabel: "Host",
      spriteKey: "role-leader",
      groupRole: "leader" as const,
      isHost: true,
      ready: true,
    },
    {
      id: "m2",
      displayName: "Priya",
      archetypeLabel: "Member",
      spriteKey: "g2",
      groupRole: null,
      isHost: false,
      ready: false,
    },
  ];

  it("shows each member's saved character, role, readiness and the leader", () => {
    render(<SidebarPartyPanel members={MEMBERS} roomCode="TVJ49F" />);
    const [gerald, priya, open] = screen.getAllByRole("listitem");

    expect(gerald).toHaveTextContent("Gerald");
    expect(gerald).toHaveTextContent("Leader");
    expect(gerald).toHaveTextContent("Ready");
    expect(gerald.querySelector('[data-sprite-key="role-leader"]')).not.toBeNull();
    expect(screen.getAllByRole("img", { name: "Party leader" })).toHaveLength(1);

    // No character saved yet: the plain traveller, and no ready mark.
    expect(priya).toHaveTextContent("Choosing a character");
    expect(priya).not.toHaveTextContent("Ready");

    // The party stays open, with no number: there is no size limit.
    expect(open).toHaveTextContent("Room for more");
  });

  it("says it is waiting while the leader is alone", () => {
    render(<SidebarPartyPanel members={MEMBERS.slice(0, 1)} roomCode="TVJ49F" />);
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent(
      "Waiting for others to join…",
    );
  });
});

describe("SidebarPartyPanel leaving", () => {
  it("asks before leaving, and Stay backs out", () => {
    const onLeave = vi.fn();
    render(<SidebarPartyPanel members={[]} roomCode="TVJ49F" onLeave={onLeave} />);

    fireEvent.click(screen.getByRole("button", { name: "Leave party" }));
    expect(onLeave).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Leave this party?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByRole("button", { name: "Leave party" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Leave party" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("offers no leave link when leaving is not wired", () => {
    render(<SidebarPartyPanel members={[]} roomCode="TVJ49F" />);
    expect(screen.queryByRole("button", { name: "Leave party" })).not.toBeInTheDocument();
  });
});

describe("SidebarPartyPanel invite", () => {
  it("builds a link that carries the room code", () => {
    expect(inviteLink("TVJ49F", "https://trip.example")).toBe(
      "https://trip.example/?code=TVJ49F",
    );
  });

  it("copies the invite link and confirms it on the button", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "COPY INVITE LINK" }));

    expect(await screen.findByRole("button", { name: "LINK COPIED!" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?code=TVJ49F`);
  });

  it("shows the room code to read out, with one copy action only", () => {
    show();
    expect(screen.getByText("TVJ49F")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("says so when the browser refuses the clipboard", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    show();
    fireEvent.click(screen.getByRole("button", { name: "COPY INVITE LINK" }));

    expect(
      await screen.findByText("Could not copy. Share the room code instead."),
    ).toBeInTheDocument();
  });

  it("offers nothing to copy before there is a room code", () => {
    show(null);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("No room code yet")).toBeInTheDocument();
  });
});
