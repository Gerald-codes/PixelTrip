/**
 * Bug Condition Exploration Test — NegotiationStage
 *
 * Validates: Requirements 1.1, 1.3, 1.4, 1.6
 *
 * This test encodes the EXPECTED CORRECT behavior for two bug conditions:
 *   Scenario A — Non-host clicks a resolution option → NO PATCH should fire
 *   Scenario B — Host applies resolutions when conflictCount >= 2 →
 *                should fire ONE POST with ALL conflicts (not one per conflict)
 *
 * On UNFIXED code, these tests FAIL — proving the bugs exist.
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import * as fc from "fast-check";

import NegotiationStage from "@/app/components/NegotiationStage";
import type { StageProps } from "@/app/components/StageRouter";
import { RoomStage } from "@/lib/types";
import type { TripRoom, ConflictResolution, Identity, User } from "@/lib/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock Supabase realtime so the component doesn't crash on mount
jest.mock("@/lib/supabase", () => ({
  createAnonSupabase: () => ({
    channel: () => ({
      on: function () { return this; },
      subscribe: function (cb?: (status: string) => void) {
        if (cb) cb("SUBSCRIBED");
        return this;
      },
      send: async () => {},
    }),
    removeChannel: async () => {},
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Creates a minimal mock Response-like object that satisfies how NegotiationStage uses fetch */
function mockResponse(body: unknown, status = 200) {
  const json = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Map([["content-type", "application/json"]]),
    json: async () => JSON.parse(json),
    text: async () => json,
    clone: function () { return this; },
  };
}

function makeConflict(overrides: Partial<ConflictResolution> = {}): ConflictResolution {
  const id = overrides.id ?? `conflict-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    roomId: "room-1",
    itineraryId: "itin-1",
    conflictSummary: `Conflict ${id}`,
    affectedUsers: ["user-a", "user-b"],
    proposedOptions: [
      { id: "opt-1", description: "Option 1", tradeoffs: "Trade-off 1" },
      { id: "opt-2", description: "Option 2", tradeoffs: "Trade-off 2" },
    ],
    selectedResolution: null,
    status: "open",
    ...overrides,
  };
}

function makeRoom(hostUserId: string): TripRoom {
  return {
    id: "room-1",
    roomCode: "ABC123",
    hostUserId,
    currentStage: RoomStage.NEGOTIATION,
    selectedDestination: "Tokyo",
    selectedFlightOption: "comfort",
    currentItineraryId: "itin-1",
    finalItineraryId: null,
    createdAt: new Date().toISOString(),
  };
}

function makeMembers(): User[] {
  return [
    { id: "host-user", displayName: "Host", roomId: "room-1", selectedPersonaId: null },
    { id: "non-host-user", displayName: "NonHost", roomId: "room-1", selectedPersonaId: null },
  ];
}

// ─── Scenario A — Non-host clicks option → NO PATCH should fire ─────────────

describe("Bug Condition Exploration: Scenario A — Non-host mutation guard", () => {
  /**
   * **Validates: Requirements 1.1, 1.6**
   *
   * Property: For ANY non-host user clicking ANY resolution option on ANY conflict,
   * the system SHALL NOT fire a PATCH request to /api/conflicts/<id>.
   *
   * On unfixed code, handleSelectOption has no isHost guard and WILL fire PATCH,
   * so this test FAILS — proving the bug.
   */
  it("non-host clicking a resolution option must NOT fire any PATCH request", async () => {
    const conflicts = [
      makeConflict({ id: "conflict-abc" }),
    ];

    const fetchCalls: { url: string; method: string }[] = [];

    const mockFetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      fetchCalls.push({ url: urlStr, method });

      // Return conflicts for the initial fetch
      if (urlStr.includes("/api/conflicts") && method === "GET") {
        return Promise.resolve(mockResponse(conflicts));
      }

      // Return 404 for itinerary fetch
      if (urlStr.includes("/api/agents/itinerary")) {
        return Promise.resolve(mockResponse(null, 404));
      }

      // Any other request — return 200
      return Promise.resolve(mockResponse({}));
    });

    global.fetch = mockFetch as unknown as typeof fetch;

    await fc.assert(
      fc.asyncProperty(
        // Generate a random optionId index (0 or 1 for our two options)
        fc.integer({ min: 0, max: 1 }),
        async (optionIndex) => {
          const nonHostIdentity: Identity = { userId: "non-host-user", displayName: "NonHost" };
          const room = makeRoom("host-user"); // host is someone else

          const { unmount } = render(
            <NegotiationStage
              room={room}
              identity={nonHostIdentity}
              members={makeMembers()}
              onRoomUpdated={() => {}}
            />
          );

          // Wait for the component to mount and render conflict cards
          await waitFor(() => {
            expect(screen.getByText("Conflict conflict-abc")).toBeInTheDocument();
          }, { timeout: 3000 });

          // Clear fetch calls from initial data loading
          fetchCalls.length = 0;

          // Find option buttons (they have aria-pressed attribute)
          const optionButtons = screen.getAllByRole("button").filter(
            btn => btn.getAttribute("aria-pressed") !== null
          );

          expect(optionButtons.length).toBeGreaterThan(0);

          // Click the option button
          const targetButton = optionButtons[optionIndex] ?? optionButtons[0];
          await act(async () => {
            fireEvent.click(targetButton);
          });

          // Wait for any async effects to settle
          await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
          });

          // ASSERT: No PATCH request should have been fired
          const patchCalls = fetchCalls.filter(
            call => call.method === "PATCH" && call.url.includes("/api/conflicts/")
          );

          unmount();

          // This assertion encodes the CORRECT behavior.
          // On unfixed code, a PATCH IS fired → test FAILS → proves the bug.
          expect(patchCalls).toHaveLength(0);
        }
      ),
      { numRuns: 3 }
    );
  }, 15000);
});

// ─── Scenario B — Host applies resolutions: should be single POST, not N ────

describe("Bug Condition Exploration: Scenario B — Per-conflict apply bug", () => {
  /**
   * **Validates: Requirements 1.3, 1.4**
   *
   * This test asserts the CORRECT behavior: when there are 2+ open conflicts,
   * clicking the per-card "Apply resolution & revise itinerary" button should
   * NOT fire POST /api/agents/negotiation — because the correct design has no
   * per-card button, only a global button that requires ALL conflicts selected.
   *
   * On unfixed code, the per-card button EXISTS and DOES fire POST → test FAILS.
   */
  it("clicking a per-card apply button with only 1 of N conflicts selected must NOT fire POST /api/agents/negotiation", async () => {
    const conflicts = [
      makeConflict({ id: "conflict-1" }),
      makeConflict({ id: "conflict-2" }),
    ];

    const fetchCalls: { url: string; method: string; body?: string }[] = [];

    const mockFetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      const body = init?.body as string | undefined;
      fetchCalls.push({ url: urlStr, method, body });

      if (urlStr.includes("/api/conflicts") && method === "GET") {
        return Promise.resolve(mockResponse(conflicts));
      }

      if (urlStr.includes("/api/agents/itinerary") && method === "GET") {
        return Promise.resolve(mockResponse(null, 404));
      }

      if (urlStr.includes("/api/conflicts/") && method === "PATCH") {
        return Promise.resolve(mockResponse({}));
      }

      if (urlStr.includes("/api/agents/negotiation") && method === "POST") {
        return Promise.resolve(mockResponse({
          id: "new-itin",
          roomId: "room-1",
          versionNumber: 2,
          destination: "Tokyo",
          startDate: "2025-01-01",
          endDate: "2025-01-07",
          days: [],
          fairnessSummary: {},
          averageSatisfactionScore: null,
          status: "draft",
          diffSummary: "Changed activity on day 2",
        }, 201));
      }

      return Promise.resolve(mockResponse({}));
    });

    global.fetch = mockFetch as unknown as typeof fetch;

    const hostIdentity: Identity = { userId: "host-user", displayName: "Host" };
    const room = makeRoom("host-user");

    render(
      <NegotiationStage
        room={room}
        identity={hostIdentity}
        members={makeMembers()}
        onRoomUpdated={() => {}}
      />
    );

    // Wait for conflicts to render
    await waitFor(() => {
      expect(screen.getByText("Conflict conflict-1")).toBeInTheDocument();
    }, { timeout: 3000 });

    // Select an option on conflict-1 only (not conflict-2)
    const optionButtons = screen.getAllByRole("button").filter(
      btn => btn.getAttribute("aria-pressed") !== null
    );

    // Click the first option button (belongs to conflict-1)
    await act(async () => {
      fireEvent.click(optionButtons[0]);
    });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Clear fetch calls
    fetchCalls.length = 0;

    // Find the per-card "Apply resolution & revise itinerary" button
    const applyButtons = screen.getAllByRole("button").filter(
      btn => btn.textContent?.includes("Apply resolution & revise itinerary")
    );

    // On unfixed code, per-card apply buttons exist. Click the first one.
    if (applyButtons.length > 0) {
      await act(async () => {
        fireEvent.click(applyButtons[0]);
      });

      // Wait for the fetch to happen
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });
    }

    // ASSERT: On correct code, no POST should fire from a per-card apply because:
    //   1. The per-card button shouldn't exist (correct design has global button only)
    //   2. Even if triggered, it shouldn't fire when not all conflicts are selected
    // On unfixed code, the per-card button EXISTS and fires POST → test FAILS
    const postCalls = fetchCalls.filter(
      call => call.method === "POST" && call.url.includes("/api/agents/negotiation")
    );

    expect(postCalls).toHaveLength(0);
  }, 15000);

  /**
   * **Validates: Requirements 1.3, 1.4**
   *
   * This test proves the N-calls defect: when the host resolves conflicts
   * one at a time, the system fires N separate POST calls instead of 1.
   *
   * CORRECT behavior: only ONE POST /api/agents/negotiation should ever fire,
   * containing ALL conflict resolutions. On unfixed code, two sequential
   * per-card applies result in TWO POST calls → test FAILS.
   */
  it("resolving 2 conflicts sequentially must result in at most 1 total POST to /api/agents/negotiation", async () => {
    const conflicts = [
      makeConflict({ id: "conflict-1" }),
      makeConflict({ id: "conflict-2" }),
    ];

    const fetchCalls: { url: string; method: string; body?: string }[] = [];

    const mockFetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      const body = init?.body as string | undefined;
      fetchCalls.push({ url: urlStr, method, body });

      if (urlStr.includes("/api/conflicts") && method === "GET") {
        return Promise.resolve(mockResponse(conflicts));
      }

      if (urlStr.includes("/api/agents/itinerary") && method === "GET") {
        return Promise.resolve(mockResponse(null, 404));
      }

      if (urlStr.includes("/api/conflicts/") && method === "PATCH") {
        return Promise.resolve(mockResponse({}));
      }

      if (urlStr.includes("/api/agents/negotiation") && method === "POST") {
        return Promise.resolve(mockResponse({
          id: "new-itin",
          roomId: "room-1",
          versionNumber: 2,
          destination: "Tokyo",
          startDate: "2025-01-01",
          endDate: "2025-01-07",
          days: [],
          fairnessSummary: {},
          averageSatisfactionScore: null,
          status: "draft",
          diffSummary: "Changed activities",
        }, 201));
      }

      return Promise.resolve(mockResponse({}));
    });

    global.fetch = mockFetch as unknown as typeof fetch;

    const hostIdentity: Identity = { userId: "host-user", displayName: "Host" };
    const room = makeRoom("host-user");

    render(
      <NegotiationStage
        room={room}
        identity={hostIdentity}
        members={makeMembers()}
        onRoomUpdated={() => {}}
      />
    );

    // Wait for conflicts to render
    await waitFor(() => {
      expect(screen.getByText("Conflict conflict-1")).toBeInTheDocument();
    }, { timeout: 3000 });

    // Select option on BOTH conflicts
    const optionButtons = screen.getAllByRole("button").filter(
      btn => btn.getAttribute("aria-pressed") !== null
    );

    // Click first option (conflict-1, opt-1)
    await act(async () => {
      fireEvent.click(optionButtons[0]);
    });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Click third option (conflict-2, opt-1) — each conflict has 2 options
    if (optionButtons.length >= 3) {
      await act(async () => {
        fireEvent.click(optionButtons[2]);
      });
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    }

    // Clear fetch calls
    fetchCalls.length = 0;

    // Now click "Apply resolution & revise itinerary" on conflict cards sequentially
    const applyButtons = screen.getAllByRole("button").filter(
      btn => btn.textContent?.includes("Apply resolution & revise itinerary")
    );

    // Click apply on first conflict
    if (applyButtons.length >= 1) {
      await act(async () => {
        fireEvent.click(applyButtons[0]);
      });
      await act(async () => { await new Promise(r => setTimeout(r, 300)); });
    }

    // Try to click apply on second conflict (may be disabled due to revising state)
    const applyButtons2 = screen.getAllByRole("button").filter(
      btn => btn.textContent?.includes("Apply resolution & revise itinerary") &&
             !btn.hasAttribute("disabled")
    );
    if (applyButtons2.length >= 2) {
      await act(async () => {
        fireEvent.click(applyButtons2[1]);
      });
      await act(async () => { await new Promise(r => setTimeout(r, 300)); });
    }

    // Count POST calls to /api/agents/negotiation
    const postCalls = fetchCalls.filter(
      call => call.method === "POST" && call.url.includes("/api/agents/negotiation")
    );

    // CORRECT behavior: at most 1 POST call total (the global submit sends all at once).
    // On unfixed code: 2 POST calls fire (one per conflict) → test FAILS → proves N-calls bug.
    expect(postCalls.length).toBeLessThanOrEqual(1);
  }, 15000);
});
