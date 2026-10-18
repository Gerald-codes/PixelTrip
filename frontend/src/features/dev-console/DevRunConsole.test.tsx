/**
 * Render tests for the dev run console, over a mocked service module. edit for redeploy
 *
 * The service is replaced wholesale, so no network or Supabase is involved; these
 * cover the flow a developer walks: create a room, save preferences, start a run,
 * vote, see the guide's messages and the itinerary, and add feedback.
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/errors";

const service = vi.hoisted(() => ({
  createRoom: vi.fn(),
  joinRoom: vi.fn(),
  savePreferences: vi.fn(),
  startRun: vi.fn(),
  getRun: vi.fn(),
  listMessages: vi.fn(),
  listVoteSessions: vi.fn(),
  castVote: vi.fn(),
  closeVote: vi.fn(),
  listItineraryVersions: vi.fn(),
  lockTestFlight: vi.fn(),
  addTestFeedback: vi.fn(),
}));

vi.mock("@/services/devConsole.api", () => service);

import { DevRunConsole, describeMessage } from "./DevRunConsole";

const SESSION = {
  roomId: "r1",
  roomCode: "ABC123",
  roomName: "andy-test",
  planningStage: "setup",
  memberId: "m1",
  displayName: "Andy",
  tripId: "t1",
  tripStatus: "trip_created",
};

const VERSION = {
  id: "v1",
  version: 1,
  source: "build",
  status: "proposed",
  changeSummary: null,
  itinerary: {
    title: "The Kyoto Quest",
    days: [
      {
        day: 1,
        date: "2026-12-20",
        items: [
          {
            id: "d1-i1",
            title: "Fushimi Inari",
            time: "09:00",
            description: "Gates",
            location: null,
          },
        ],
      },
    ],
  },
};

async function createRoom(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Create room" }));
  await screen.findByTestId("room-code");
}

describe("DevRunConsole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.createRoom.mockResolvedValue(SESSION);
    service.listMessages.mockResolvedValue([]);
    service.listVoteSessions.mockResolvedValue([]);
    service.listItineraryVersions.mockResolvedValue([]);
  });

  it("starts with only the room forms", () => {
    render(<DevRunConsole />);

    expect(
      screen.getByRole("button", { name: "Create room" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Join room" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /discovery/i }),
    ).not.toBeInTheDocument();
  });

  it("creating a room shows its code and unlocks the rest of the console", async () => {
    render(<DevRunConsole />);

    await createRoom();

    expect(service.createRoom).toHaveBeenCalledWith("andy-test", "Andy");
    expect(screen.getByTestId("room-code")).toHaveTextContent("ABC123");
    expect(
      screen.getByRole("button", { name: /start discovery run/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save preferences" }),
    ).toBeInTheDocument();
  });

  it("shows a failed action's error in an alert", async () => {
    service.createRoom.mockRejectedValue(
      new ApiError("DATABASE_ERROR", "Database operation failed.", 503),
    );
    render(<DevRunConsole />);

    fireEvent.click(screen.getByRole("button", { name: "Create room" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "DATABASE_ERROR: Database operation failed.",
    );
  });

  it("saves the edited preferences JSON and rejects invalid JSON without calling the backend", async () => {
    service.savePreferences.mockResolvedValue({
      tripStatus: "preferences_collected",
    });
    render(<DevRunConsole />);
    await createRoom();

    fireEvent.change(screen.getByLabelText(/preferences json/i), {
      target: { value: "{not json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /not valid json/i,
    );
    expect(service.savePreferences).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/preferences json/i), {
      target: { value: '{"budget": 900}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() =>
      expect(service.savePreferences).toHaveBeenCalledWith(expect.anything(), {
        budget: 900,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "preferences_collected",
    );
  });

  it("starts a run and lists it with its status", async () => {
    service.startRun.mockResolvedValue({
      id: "run1",
      tripId: "t1",
      runType: "discovery",
      status: "pending",
      baseVersion: 0,
      resultVersionId: null,
      error: null,
    });
    service.getRun.mockResolvedValue({
      id: "run1",
      tripId: "t1",
      runType: "discovery",
      status: "completed",
      baseVersion: 0,
      resultVersionId: null,
      error: null,
    });
    render(<DevRunConsole />);
    await createRoom();

    fireEvent.click(
      screen.getByRole("button", { name: /start discovery run/i }),
    );

    const runs = await screen.findByRole("list", { name: "Runs" });
    expect(within(runs).getByText("discovery")).toBeInTheDocument();
    expect(service.startRun).toHaveBeenCalledWith(
      SESSION,
      "discovery",
      expect.stringMatching(/^discovery-/),
    );
  });

  it("lists guide messages and lets the developer vote on an open session", async () => {
    service.listMessages.mockResolvedValue([
      {
        id: "msg1",
        kind: "recommendation",
        content: {
          title: "Where shall we go?",
          items: [{ title: "Kyoto, Japan" }, { title: "Hanoi, Vietnam" }],
        },
        createdAt: "2026-10-05T10:00:00Z",
      },
    ]);
    service.listVoteSessions.mockResolvedValue([
      {
        id: "vs1",
        question: "Which destination?",
        status: "open",
        options: [{ id: "kyoto--japan", label: "Kyoto, Japan" }],
      },
    ]);
    service.castVote.mockResolvedValue({ sessionStatus: "closed" });
    render(<DevRunConsole />);
    await createRoom();

    const messages = await screen.findByRole("list", {
      name: "Guide messages",
    });
    expect(
      within(messages).getByText("Where shall we go?"),
    ).toBeInTheDocument();
    expect(within(messages).getByText("• Hanoi, Vietnam")).toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", { name: "Vote for Kyoto, Japan" }),
    );
    await waitFor(() =>
      expect(service.castVote).toHaveBeenCalledWith(
        SESSION,
        "vs1",
        "kyoto--japan",
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      /choice is locked in/i,
    );
  });

  it("locks a test flight with the entered dates", async () => {
    service.lockTestFlight.mockResolvedValue({ selectionId: "s1" });
    render(<DevRunConsole />);
    await createRoom();

    fireEvent.click(screen.getByRole("button", { name: "Lock test flight" }));

    await waitFor(() =>
      expect(service.lockTestFlight).toHaveBeenCalledWith(
        "t1",
        "2026-12-20T08:00:00",
        "2026-12-24T20:00:00",
      ),
    );
  });

  it("shows the latest itinerary and adds feedback to a chosen item", async () => {
    service.listItineraryVersions.mockResolvedValue([VERSION]);
    service.addTestFeedback.mockResolvedValue({ feedbackId: "f1" });
    render(<DevRunConsole />);
    await createRoom();

    expect(await screen.findByText(/The Kyoto Quest/)).toBeInTheDocument();
    expect(screen.getByText(/— Gates/)).toBeInTheDocument();

    const add = screen.getByRole("button", { name: "Add feedback" });
    expect(add).toBeDisabled(); // no item chosen yet
    fireEvent.change(screen.getByLabelText("Item"), {
      target: { value: "d1-i1" },
    });
    fireEvent.click(add);

    await waitFor(() =>
      expect(service.addTestFeedback).toHaveBeenCalledWith(
        SESSION,
        "v1",
        "d1-i1",
        "could we do this later in the evening instead",
      ),
    );
  });

  it("leaving the room returns to the forms", async () => {
    render(<DevRunConsole />);
    await createRoom();

    fireEvent.click(screen.getByRole("button", { name: "Leave room" }));

    expect(
      screen.getByRole("button", { name: "Create room" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("room-code")).not.toBeInTheDocument();
  });
});

describe("describeMessage", () => {
  const at = "2026-10-05T10:00:00Z";

  it("reads text, titled and itemised messages", () => {
    expect(
      describeMessage({
        id: "1",
        kind: "text",
        content: { text: "hello" },
        createdAt: at,
      }),
    ).toEqual({
      heading: "text",
      lines: ["hello"],
    });
    expect(
      describeMessage({
        id: "2",
        kind: "summary",
        content: { title: "Plan", text: "Done" },
        createdAt: at,
      }),
    ).toEqual({ heading: "Plan", lines: ["Done"] });
  });

  it("falls back to the raw content for a shape it does not know", () => {
    const result = describeMessage({
      id: "3",
      kind: "escalation",
      content: { odd: 1 },
      createdAt: at,
    });

    expect(result.lines).toEqual(['{"odd":1}']);
  });
});
