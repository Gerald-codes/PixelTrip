/**
 * Render test for PartyLobby (entry screen).
 *
 * Verifies the entry screen presents the name field and both ways in (a new
 * party, or a code), that submitting raises the callbacks with the entered
 * values, and that problems are reported inside the form. Purely presentational.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PartyLobby } from "./PartyLobby";

const show = (props: Partial<Parameters<typeof PartyLobby>[0]> = {}) =>
  render(
    <PartyLobby view="entry" onCreateParty={vi.fn()} onJoinParty={vi.fn()} {...props} />,
  );

describe("PartyLobby", () => {
  it("renders the name field and both ways in", () => {
    show();

    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "New party" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Have a code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create party" })).toBeInTheDocument();
  });

  it("raises onCreateParty with the party and player names", () => {
    const onCreateParty = vi.fn();
    show({ onCreateParty });

    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Aria" },
    });
    fireEvent.change(screen.getByLabelText("Party name"), {
      target: { value: "The Wandering Party" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create party" }));

    expect(onCreateParty).toHaveBeenCalledWith("The Wandering Party", "Aria");
  });

  it("raises onJoinParty with the code and player name", () => {
    const onJoinParty = vi.fn();
    show({ onJoinParty });

    fireEvent.click(screen.getByRole("tab", { name: "Have a code" }));
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Aria" },
    });
    fireEvent.change(screen.getByLabelText("Party code"), {
      target: { value: "ABC123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join party" }));

    expect(onJoinParty).toHaveBeenCalledWith("ABC123", "Aria");
  });

  it("reports a problem inside the form, next to the button", () => {
    show({ errorMessage: "No party has that code." });
    expect(screen.getByRole("alert")).toHaveTextContent("No party has that code.");
  });
});
