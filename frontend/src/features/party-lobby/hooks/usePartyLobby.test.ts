/**
 * Tests for usePartyLobby.
 *
 * Covers the hook's real logic against a mocked service layer: a successful
 * create, a join that maps ROOM_NOT_FOUND to a safe message, invalid input that
 * makes no service call, and the realtime roster subscription that refreshes
 * members while waiting and is torn down on leave.
 * `@/services` is mocked so no concrete mock/real implementation is exercised.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/errors";
import type { RoomMember, RoomSession } from "@/types";

import { usePartyLobby } from "./usePartyLobby";

// Service doubles shared across tests; reset per test.
const createRoom = vi.fn();
const joinRoom = vi.fn();
const listMembers = vi.fn();
const getRoom = vi.fn();

// subscribeMembers is captured per test so we can drive roster pushes manually
// and assert the returned unsubscribe is called on teardown.
let lastOnChange: ((members: RoomMember[]) => void) | undefined;
const unsubscribe = vi.fn();
const subscribeMembers = vi.fn(
  (_roomId: string, onChange: (members: RoomMember[]) => void) => {
    lastOnChange = onChange;
    return unsubscribe;
  },
);

const subscribeRoom = vi.fn(() => vi.fn());

vi.mock("@/services", () => ({
  getServices: () => ({
    room: {
      createRoom,
      joinRoom,
      listMembers,
      getRoom,
      subscribeMembers,
      subscribeRoom,
    },
  }),
}));

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

function makeSession(overrides: Partial<RoomSession> = {}): RoomSession {
  return {
    room: {
      id: "room-1",
      roomCode: "ABC123",
      name: "The Wandering Party",
      status: "active",
      planningStage: "setup",
    },
    member: makeMember(),
    guest: { id: "guest-1", displayName: "Aria", avatarUrl: null },
    character: null,
    travelPreferences: null,
    ...overrides,
  };
}

beforeEach(() => {
  createRoom.mockReset();
  joinRoom.mockReset();
  listMembers.mockReset();
  getRoom.mockReset();
  subscribeMembers.mockClear();
  unsubscribe.mockClear();
  lastOnChange = undefined;
  listMembers.mockResolvedValue([makeMember()]);
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePartyLobby", () => {
  it("walks back into the party after a refresh, and forgets it on leaving", async () => {
    const session = makeSession();
    createRoom.mockResolvedValue(session);
    joinRoom.mockResolvedValue(session);

    const first = renderHook(() => usePartyLobby());
    await act(async () => {
      await first.result.current.createParty("The Wandering Party", "Aria");
    });
    first.unmount();

    // A refresh: a new hook instance, same browser storage.
    const second = renderHook(() => usePartyLobby());
    await waitFor(() => expect(second.result.current.view).toBe("waiting"));
    expect(joinRoom).toHaveBeenCalledWith({ roomCode: "ABC123", displayName: "Aria" });

    act(() => second.result.current.leaveParty());
    second.unmount();
    joinRoom.mockClear();

    const third = renderHook(() => usePartyLobby());
    expect(third.result.current.view).toBe("entry");
    expect(joinRoom).not.toHaveBeenCalled();
  });

  it("shows the entry screen, without an error, when the remembered party is gone", async () => {
    window.localStorage.setItem(
      "pixeltrip.party",
      JSON.stringify({ roomCode: "GONE99", displayName: "Aria" }),
    );
    joinRoom.mockRejectedValue(new ApiError("ROOM_NOT_FOUND", "gone", 404));

    const { result } = renderHook(() => usePartyLobby());

    await waitFor(() => expect(result.current.view).toBe("entry"));
    expect(result.current.errorMessage).toBeUndefined();
    expect(window.localStorage.getItem("pixeltrip.party")).toBeNull();
  });

  it("creates a party and moves to the waiting view with the session", async () => {
    const session = makeSession();
    createRoom.mockResolvedValue(session);

    const { result } = renderHook(() => usePartyLobby());

    await act(async () => {
      await result.current.createParty("The Wandering Party", "Aria");
    });

    expect(createRoom).toHaveBeenCalledWith({
      name: "The Wandering Party",
      ownerDisplayName: "Aria",
    });
    expect(result.current.view).toBe("waiting");
    expect(result.current.session).toEqual(session);
    expect(result.current.errorMessage).toBeUndefined();
  });

  it("maps a ROOM_NOT_FOUND join failure to a safe message and stays on entry", async () => {
    joinRoom.mockRejectedValue(
      new ApiError("ROOM_NOT_FOUND", "Room 'ZZZ999' not found.", 404),
    );

    const { result } = renderHook(() => usePartyLobby());

    await act(async () => {
      await result.current.joinParty("ZZZ999", "Aria");
    });

    expect(joinRoom).toHaveBeenCalledOnce();
    expect(result.current.view).toBe("entry");
    expect(result.current.session).toBeUndefined();
    expect(result.current.errorMessage).toBe("No party found for that code.");
  });

  it("rejects invalid input and makes no service call", async () => {
    const { result } = renderHook(() => usePartyLobby());

    await act(async () => {
      await result.current.createParty("   ", "Aria");
    });

    expect(createRoom).not.toHaveBeenCalled();
    expect(result.current.view).toBe("entry");
    expect(result.current.validationMessage).toBeDefined();

    await act(async () => {
      await result.current.joinParty("", "Aria");
    });

    expect(joinRoom).not.toHaveBeenCalled();
  });

  it("subscribes to the roster while waiting and applies pushed updates", async () => {
    createRoom.mockResolvedValue(makeSession());

    const { result } = renderHook(() => usePartyLobby());

    await act(async () => {
      await result.current.createParty("The Wandering Party", "Aria");
    });
    expect(result.current.view).toBe("waiting");

    // The hook subscribed for the current room.
    expect(subscribeMembers).toHaveBeenCalledWith(
      "room-1",
      expect.any(Function),
    );

    // Simulate the service pushing a grown roster (owner + a new member).
    const roster = [
      makeMember(),
      makeMember({
        id: "member-2",
        guestId: "guest-2",
        displayName: "Bram",
        role: "member",
      }),
    ];
    act(() => {
      lastOnChange?.(roster);
    });

    expect(result.current.members).toHaveLength(2);
    expect(result.current.members.map((m) => m.displayName)).toContain("Bram");
  });

  it("unsubscribes from the roster when leaving the party", async () => {
    createRoom.mockResolvedValue(makeSession());

    const { result } = renderHook(() => usePartyLobby());

    await act(async () => {
      await result.current.createParty("The Wandering Party", "Aria");
    });
    expect(result.current.view).toBe("waiting");
    expect(unsubscribe).not.toHaveBeenCalled();

    act(() => {
      result.current.leaveParty();
    });

    // Leaving tears down the subscription and no further pushes are applied.
    expect(result.current.view).toBe("entry");
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    act(() => {
      lastOnChange?.([
        makeMember(),
        makeMember({ id: "member-3", displayName: "Ghost", role: "member" }),
      ]);
    });
    expect(result.current.members).toHaveLength(0);
  });
});
