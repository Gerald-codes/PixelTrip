/**
 * Tests for the dev console service.
 *
 * `fetch` and the Supabase client are faked, so no network calls are made. These pin
 * the request shapes the backend expects (including the PUT for preferences and the
 * `/dev` helper routes) and the snake_case → camelCase mapping of direct reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/errors";

const supabase = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown },
  calls: [] as Array<[string, ...unknown[]]>,
}));

vi.mock("@/lib/supabaseClient", () => {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) {
    builder[method] = (...args: unknown[]) => {
      supabase.calls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => supabase.result;
  builder.returns = async () => supabase.result;
  return {
    getSupabaseClient: () => ({
      from: (table: string) => {
        supabase.calls.push(["from", table]);
        return builder;
      },
    }),
  };
});

const api = await import("./devConsole.api");

const ROOM_PAYLOAD = {
  room: {
    id: "r1",
    roomCode: "ABC123",
    name: "Trip",
    planningStage: "setup",
  },
  member: { id: "m1", displayName: "Andy" },
  trip: { id: "t1", status: "trip_created" },
};

const SESSION: Awaited<ReturnType<typeof api.createRoom>> = {
  roomId: "r1",
  roomCode: "ABC123",
  roomName: "Trip",
  planningStage: "setup",
  memberId: "m1",
  displayName: "Andy",
  tripId: "t1",
  tripStatus: "trip_created",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("dev console service", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test");
    supabase.calls.length = 0;
    supabase.result = { data: null, error: null };
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function lastRequest(): { url: string; method: string; body: unknown } {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    return {
      url,
      method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
  }

  it("createRoom posts the name and owner and flattens the response", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, ROOM_PAYLOAD));

    const session = await api.createRoom("Trip", "Andy");

    expect(session).toEqual(SESSION);
    expect(lastRequest()).toEqual({
      url: "http://api.test/rooms",
      method: "POST",
      body: { name: "Trip", ownerDisplayName: "Andy" },
    });
  });

  it("joinRoom trims and uppercases the code", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, ROOM_PAYLOAD));

    await api.joinRoom(" abc123 ", "Andy");

    expect(lastRequest().url).toBe("http://api.test/rooms/ABC123/join");
    expect(lastRequest().body).toEqual({ displayName: "Andy" });
  });

  it("looks up the trip when a join response does not carry one", async () => {
    const { trip: _omitted, ...withoutTrip } = ROOM_PAYLOAD;
    fetchMock.mockResolvedValue(jsonResponse(200, withoutTrip));
    supabase.result = {
      data: { id: "t9", status: "trip_created" },
      error: null,
    };

    const session = await api.joinRoom("ABC123", "Andy");

    expect(session.tripId).toBe("t9");
    expect(supabase.calls).toContainEqual(["from", "trips"]);
    expect(supabase.calls).toContainEqual(["eq", "room_id", "r1"]);
  });

  it("surfaces a backend error envelope as an ApiError", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(404, {
        error: { code: "ROOM_NOT_FOUND", message: "Room 'X' not found." },
      }),
    );

    const failure = await api
      .joinRoom("ZZZZ", "Andy")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      code: "ROOM_NOT_FOUND",
      message: "Room 'X' not found.",
    });
  });

  it("savePreferences uses PUT on the member's preferences path", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { trip: { status: "preferences_collected" } }),
    );

    const saved = await api.savePreferences(SESSION, { budget: 1500 });

    expect(saved).toEqual({ tripStatus: "preferences_collected" });
    expect(lastRequest()).toEqual({
      url: "http://api.test/rooms/ABC123/members/m1/preferences",
      method: "PUT",
      body: { budget: 1500 },
    });
  });

  it("startRun posts the run type, member and idempotency key to the trip", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(202, { id: "run1", status: "pending" }),
    );

    await api.startRun(SESSION, "discovery", "key-1");

    expect(lastRequest()).toEqual({
      url: "http://api.test/trips/t1/runs",
      method: "POST",
      body: { runType: "discovery", memberId: "m1", idempotencyKey: "key-1" },
    });
  });

  it("getRun and listItineraryVersions read the right paths", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, []));

    await api.getRun("run1");
    expect(lastRequest()).toMatchObject({
      url: "http://api.test/runs/run1",
      method: "GET",
    });

    await api.listItineraryVersions("t1");
    expect(lastRequest().url).toBe(
      "http://api.test/trips/t1/itinerary/versions",
    );
  });

  it("castVote and closeVote send the member", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { sessionStatus: "closed" }),
    );

    await api.castVote(SESSION, "vs1", "kyoto--japan");
    expect(lastRequest()).toEqual({
      url: "http://api.test/votes/vs1/cast",
      method: "POST",
      body: { memberId: "m1", optionId: "kyoto--japan" },
    });

    await api.closeVote(SESSION, "vs1");
    expect(lastRequest()).toEqual({
      url: "http://api.test/votes/vs1/close",
      method: "POST",
      body: { memberId: "m1" },
    });
  });

  it("the testing helpers call the backend /dev routes", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { selectionId: "s1", feedbackId: "f1" }),
    );

    await api.lockTestFlight(
      "t1",
      "2026-12-20T08:00:00",
      "2026-12-24T20:00:00",
    );
    expect(lastRequest()).toEqual({
      url: "http://api.test/dev/trips/t1/test-flight",
      method: "POST",
      body: {
        departAt: "2026-12-20T08:00:00",
        returnAt: "2026-12-24T20:00:00",
      },
    });

    await api.addTestFeedback(SESSION, "v1", "d2-i1", "later please");
    expect(lastRequest()).toEqual({
      url: "http://api.test/dev/trips/t1/feedback",
      method: "POST",
      body: {
        memberId: "m1",
        itineraryVersionId: "v1",
        itemId: "d2-i1",
        comment: "later please",
      },
    });
  });

  it("listMessages reads the room's messages and maps snake_case rows", async () => {
    supabase.result = {
      data: [
        {
          id: "a",
          kind: "text",
          content: { text: "hi" },
          created_at: "2026-10-05T10:00:00Z",
        },
      ],
      error: null,
    };

    const messages = await api.listMessages("r1");

    expect(messages).toEqual([
      {
        id: "a",
        kind: "text",
        content: { text: "hi" },
        createdAt: "2026-10-05T10:00:00Z",
      },
    ]);
    expect(supabase.calls).toContainEqual(["from", "messages"]);
    expect(supabase.calls).toContainEqual(["eq", "room_id", "r1"]);
  });

  it("a failed Supabase read becomes an ApiError that names no internals", async () => {
    supabase.result = { data: null, error: { message: "secret detail" } };

    const failure = await api
      .listVoteSessions("r1")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(String((failure as ApiError).message)).not.toContain(
      "secret detail",
    );
  });
});
