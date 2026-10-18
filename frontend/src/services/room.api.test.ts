/**
 * Tests for the real room/guest services and the FastAPI client.
 *
 * `fetch` and the Supabase client are faked, so no network calls are made. These
 * pin the request shapes from "HTTP API" in `api-contracts.md`, the error-envelope
 * handling, and the snake_case → camelCase mapping of direct Supabase reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/errors";

const supabaseQuery = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown },
  calls: [] as Array<[string, ...unknown[]]>,
}));

vi.mock("@/lib/supabaseClient", () => {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) {
    builder[method] = (...args: unknown[]) => {
      supabaseQuery.calls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => supabaseQuery.result;
  builder.returns = async () => supabaseQuery.result;
  return {
    getSupabaseClient: () => ({
      from: (table: string) => {
        supabaseQuery.calls.push(["from", table]);
        return builder;
      },
    }),
  };
});

// Imported after the mock so the services use the fake Supabase client.
const { roomApiService } = await import("./room.api");
const { guestApiService } = await import("./guest.api");

const SESSION = {
  room: {
    id: "r1",
    roomCode: "ABC123",
    name: "Trip",
    status: "active",
    planningStage: "setup",
  },
  member: {
    id: "m1",
    roomId: "r1",
    guestId: "g1",
    displayName: "Gerald",
    role: "owner",
    stageReady: false,
  },
  guest: { id: "g1", displayName: "Gerald", avatarUrl: null },
  character: null,
  travelPreferences: null,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("RoomApiService (FastAPI)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test/");
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("createRoom posts the contract body and returns the session", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, SESSION));

    const session = await roomApiService.createRoom({
      name: "Trip",
      ownerDisplayName: "Gerald",
    });

    expect(session).toEqual(SESSION);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/rooms");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      name: "Trip",
      ownerDisplayName: "Gerald",
    });
  });

  it("joinRoom uppercases and trims the room code", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, SESSION));

    await roomApiService.joinRoom({
      roomCode: " abc123 ",
      displayName: "gerald",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/rooms/ABC123/join");
    expect(JSON.parse(init.body)).toEqual({ displayName: "gerald" });
  });

  it("turns the backend error envelope into an ApiError with its code", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, {
        error: { code: "ROOM_NOT_FOUND", message: "Room 'ZZZZ99' not found." },
      }),
    );

    const error = await roomApiService
      .joinRoom({ roomCode: "ZZZZ99", displayName: "Gerald" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "ROOM_NOT_FOUND",
      status: 404,
      message: "Room 'ZZZZ99' not found.",
    });
  });

  it("reports a non-envelope error body as UNEXPECTED_RESPONSE", async () => {
    fetchMock.mockResolvedValue(new Response("Bad Gateway", { status: 502 }));

    await expect(
      roomApiService.createRoom({ name: "Trip", ownerDisplayName: "Gerald" }),
    ).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE", status: 502 });
  });

  it("reports a failed request as NETWORK_ERROR", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      roomApiService.createRoom({ name: "Trip", ownerDisplayName: "Gerald" }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR", status: null });
  });
});

describe("Direct Supabase reads", () => {
  beforeEach(() => {
    supabaseQuery.calls.length = 0;
    supabaseQuery.result = { data: null, error: null };
  });

  it("getRoom maps the row to a PartyRoom", async () => {
    supabaseQuery.result = {
      data: {
        id: "r1",
        room_code: "ABC123",
        name: "Trip",
        status: "active",
        planning_stage: "setup",
      },
      error: null,
    };

    await expect(roomApiService.getRoom("r1")).resolves.toEqual(SESSION.room);
    expect(supabaseQuery.calls).toContainEqual(["from", "party_rooms"]);
    expect(supabaseQuery.calls).toContainEqual(["eq", "id", "r1"]);
  });

  it("getRoom resolves null when no row exists", async () => {
    await expect(roomApiService.getRoom("missing")).resolves.toBeNull();
  });

  it("listMembers maps rows to RoomMembers in join order", async () => {
    supabaseQuery.result = {
      data: [
        {
          id: "m1",
          room_id: "r1",
          guest_id: "g1",
          display_name: "Gerald",
          role: "owner",
          stage_ready: false,
        },
      ],
      error: null,
    };

    await expect(roomApiService.listMembers("r1")).resolves.toEqual([
      SESSION.member,
    ]);
    expect(supabaseQuery.calls).toContainEqual([
      "order",
      "created_at",
      { ascending: true },
    ]);
  });

  it("listMembers carries each member's saved character look", async () => {
    const row = {
      id: "m1",
      room_id: "r1",
      guest_id: "g1",
      display_name: "Gerald",
      role: "owner",
      stage_ready: true,
    };
    supabaseQuery.result = {
      data: [
        { ...row, characters: { sprite_key: "role-planner" } },
        { ...row, id: "m2", characters: [] },
      ],
      error: null,
    };

    const members = await roomApiService.listMembers("r1");

    expect(members.map((m) => m.spriteKey)).toEqual(["role-planner", null]);
    expect(supabaseQuery.calls).toContainEqual([
      "select",
      "id, room_id, guest_id, display_name, role, stage_ready, characters(sprite_key)",
    ]);
  });

  it("getGuest maps the row to a Guest", async () => {
    supabaseQuery.result = {
      data: { id: "g1", display_name: "Gerald", avatar_url: null },
      error: null,
    };

    await expect(guestApiService.getGuest("g1")).resolves.toEqual(
      SESSION.guest,
    );
  });

  it("turns a Supabase error into DATABASE_ERROR", async () => {
    supabaseQuery.result = { data: null, error: { message: "boom" } };

    await expect(roomApiService.listMembers("r1")).rejects.toMatchObject({
      code: "DATABASE_ERROR",
    });
  });
});
