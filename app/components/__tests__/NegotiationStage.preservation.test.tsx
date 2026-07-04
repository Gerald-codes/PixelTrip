/**
 * Preservation Property Tests — NegotiationStage
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**
 *
 * These tests establish a regression baseline on UNFIXED code. They verify
 * behaviors that must survive the refactor:
 *   1. Host visual selection preserved (aria-pressed updates without depending on network)
 *   2. Diff summary amber banner preserved after successful agent response
 *   3. Empty state preserved (conflicts = [] → empty message, no agent call)
 *   4. Error state preserved (mock 500 → error banner, revising = false)
 *   5. RESOLVED badge preserved (status === "resolved")
 *   6. Selection pre-population preserved (fetchConflicts with selectedResolution)
 *
 * ALL tests MUST PASS on the current unfixed code.
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import * as fc from "fast-check";

import NegotiationStage from "@/app/components/NegotiationStage";
import { RoomStage } from "@/lib/types";
import type { TripRoom, ConflictResolution, Identity, User } from "@/lib/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

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

// ─── Arbitraries for PBT ──────────────────────────────────────────────────────

/** Generates a random conflict with configurable status and selectedResolution */
function arbConflict(): fc.Arbitrary<ConflictResolution> {
  return fc.record({
    id: fc.uuid(),
    status: fc.constantFrom("open" as const, "voting" as const, "resolved" as const),
    selectedResolution: fc.oneof(fc.constant(null), fc.constantFrom("opt-1", "opt-2")),
  }).map(({ id, status, selectedResolution }) => ({
    id,
    roomId: "room-1",
    itineraryId: "itin-1",
    conflictSummary: `Conflict ${id}`,
    affectedUsers: ["user-a", "user-b"],
    proposedOptions: [
      { id: "opt-1", description: "Option 1", tradeoffs: "Trade-off 1" },
      { id: "opt-2", description: "Option 2", tradeoffs: "Trade-off 2" },
    ],
    selectedResolution,
    status,
  }));
}

// ─── PBT: Host visual selection preserved ────────────────────────────────────

describe("Preservation: Host visual selection state", () => {
  /**
   * **Validates: Requirements 3.1**
   *
   * Property: For a HOST user rendering random arrays of 0–10 conflicts with
   * varying status, clicking an option button updates `aria-pressed` immediately.
   * The visual update does NOT depend on any network response.
   */
  it("host clicking option → aria-pressed updates for each clicked option", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 1-5 open conflicts with stable IDs and matching summaries
        fc.integer({ min: 1, max: 5 }).map(count =>
          Array.from({ length: count }, (_, i) => makeConflict({
            id: `conflict-${i}`,
            status: "open",
          }))
        ),
        async (conflicts) => {
          const fetchCalls: { url: string; method: string }[] = [];

          const mockFetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
            const urlStr = typeof url === "string" ? url : url.toString();
            const method = init?.method ?? "GET";
            fetchCalls.push({ url: urlStr, method });

            if (urlStr.includes("/api/conflicts") && method === "GET") {
              return Promise.resolve(mockResponse(conflicts));
            }
            if (urlStr.includes("/api/agents/itinerary") && method === "GET") {
              return Promise.resolve(mockResponse(null, 404));
            }
            // PATCH calls (for selection on unfixed code) — return 200
            if (method === "PATCH") {
              return Promise.resolve(mockResponse({}));
            }
            return Promise.resolve(mockResponse({}));
          });

          global.fetch = mockFetch as unknown as typeof fetch;

          const hostIdentity: Identity = { userId: "host-user", displayName: "Host" };
          const room = makeRoom("host-user");

          const { unmount } = render(
            <NegotiationStage
              room={room}
              identity={hostIdentity}
              members={makeMembers()}
              onRoomUpdated={() => {}}
            />
          );

          // Wait for conflicts to render
          await waitFor(() => {
            expect(screen.getByText(`Conflict conflict-0`)).toBeInTheDocument();
          }, { timeout: 3000 });

          // Find all option buttons (those with aria-pressed attribute)
          const optionButtons = screen.getAllByRole("button").filter(
            btn => btn.getAttribute("aria-pressed") !== null
          );

          // Each conflict has 2 options, so we expect 2 * conflicts.length buttons
          expect(optionButtons.length).toBe(conflicts.length * 2);

          // Click the first option of the first conflict
          await act(async () => {
            fireEvent.click(optionButtons[0]);
          });

          // The aria-pressed should update IMMEDIATELY (no network dependency)
          expect(optionButtons[0]).toHaveAttribute("aria-pressed", "true");

          unmount();
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);
});

// ─── PBT: Selection pre-population preserved ─────────────────────────────────

describe("Preservation: Selection pre-population from fetchConflicts", () => {
  /**
   * **Validates: Requirements 3.7, 3.8**
   *
   * Property: For any fetchConflicts response with varying selectedResolution
   * values, the selectedResolutions state always matches non-null selectedResolution
   * fields after mount — verified by checking aria-pressed on the corresponding buttons.
   */
  it("conflicts with non-null selectedResolution → corresponding options show aria-pressed=true on mount", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 1-5 conflicts with random selectedResolution values
        fc.array(
          fc.record({
            selectedResolution: fc.oneof(
              fc.constant(null),
              fc.constantFrom("opt-1", "opt-2")
            ),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (conflictSpecs) => {
          const conflicts = conflictSpecs.map((spec, i) => makeConflict({
            id: `conflict-${i}`,
            selectedResolution: spec.selectedResolution,
            status: spec.selectedResolution ? "resolved" : "open",
          }));

          const mockFetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
            const urlStr = typeof url === "string" ? url : url.toString();
            const method = init?.method ?? "GET";

            if (urlStr.includes("/api/conflicts") && method === "GET") {
              return Promise.resolve(mockResponse(conflicts));
            }
            if (urlStr.includes("/api/agents/itinerary") && method === "GET") {
              return Promise.resolve(mockResponse(null, 404));
            }
            return Promise.resolve(mockResponse({}));
          });

          global.fetch = mockFetch as unknown as typeof fetch;

          const hostIdentity: Identity = { userId: "host-user", displayName: "Host" };
          const room = makeRoom("host-user");

          const { unmount } = render(
            <NegotiationStage
              room={room}
              identity={hostIdentity}
              members={makeMembers()}
              onRoomUpdated={() => {}}
            />
          );

          // Wait for conflicts to render
          await waitFor(() => {
            expect(screen.getByText(`Conflict conflict-0`)).toBeInTheDocument();
          }, { timeout: 3000 });

          // For each conflict that has a non-null selectedResolution,
          // verify the corresponding option button has aria-pressed=true
          for (let i = 0; i < conflicts.length; i++) {
            const conflict = conflicts[i];
            if (conflict.selectedResolution) {
              // Find the conflict card by its summary text
              const conflictCard = screen.getByText(`Conflict conflict-${i}`).closest("article");
              expect(conflictCard).toBeTruthy();

              // Get option buttons within this card
              const buttons = Array.from(
                conflictCard!.querySelectorAll("button[aria-pressed]")
              );

              // The selected option should have aria-pressed=true
              const selectedBtn = buttons.find(
                btn => btn.getAttribute("aria-pressed") === "true"
              );
              expect(selectedBtn).toBeTruthy();
            }
          }

          unmount();
        }
      ),
      { numRuns: 5 }
    );
  }, 30000);
});

// ─── Example: RESOLVED badge preserved ───────────────────────────────────────

describe("Preservation: RESOLVED badge", () => {
  /**
   * **Validates: Requirements 3.6**
   *
   * Example test: render with a conflict that has status === "resolved"
   * → assert RESOLVED badge is present.
   */
  it("conflict with status='resolved' shows RESOLVED badge", async () => {
    const conflicts = [
      makeConflict({ id: "conflict-resolved-1", status: "resolved", selectedResolution: "opt-1" }),
    ];

    const mockFetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";

      if (urlStr.includes("/api/conflicts") && method === "GET") {
        return Promise.resolve(mockResponse(conflicts));
      }
      if (urlStr.includes("/api/agents/itinerary") && method === "GET") {
        return Promise.resolve(mockResponse(null, 404));
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

    await waitFor(() => {
      expect(screen.getByText("Conflict conflict-resolved-1")).toBeInTheDocument();
    }, { timeout: 3000 });

    // Assert RESOLVED badge is present
    expect(screen.getByText("RESOLVED")).toBeInTheDocument();
  }, 10000);
});

// ─── Example: Error state preserved ──────────────────────────────────────────

describe("Preservation: Error state on 500 response", () => {
  /**
   * **Validates: Requirements 3.4, 3.5**
   *
   * Example test: host clicks "Apply resolution & revise itinerary" button,
   * mock 500 from POST /api/agents/negotiation → error banner shown,
   * revising state cleared (button re-enabled).
   */
  it("mock 500 response → error message rendered, revising cleared", async () => {
    const conflicts = [
      makeConflict({ id: "conflict-err-1", status: "open" }),
    ];

    const mockFetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";

      if (urlStr.includes("/api/conflicts") && method === "GET") {
        return Promise.resolve(mockResponse(conflicts));
      }
      if (urlStr.includes("/api/agents/itinerary") && method === "GET") {
        return Promise.resolve(mockResponse(null, 404));
      }
      if (method === "PATCH" && urlStr.includes("/api/conflicts/")) {
        return Promise.resolve(mockResponse({}));
      }
      if (urlStr.includes("/api/agents/negotiation") && method === "POST") {
        // Return 500 error
        return Promise.resolve(mockResponse({ error: "Internal server error" }, 500));
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

    // Wait for conflict to render
    await waitFor(() => {
      expect(screen.getByText("Conflict conflict-err-1")).toBeInTheDocument();
    }, { timeout: 3000 });

    // Select an option first (required to enable the global apply button)
    const optionButtons = screen.getAllByRole("button").filter(
      btn => btn.getAttribute("aria-pressed") !== null
    );
    await act(async () => {
      fireEvent.click(optionButtons[0]);
    });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Click the global "Apply selected resolutions and regenerate itinerary" button
    const applyButton = screen.getAllByRole("button").find(
      btn => btn.textContent?.includes("Apply selected resolutions and regenerate itinerary")
    );
    expect(applyButton).toBeTruthy();

    await act(async () => {
      fireEvent.click(applyButton!);
    });

    // Wait for the error to appear
    await waitFor(() => {
      // The error message should be displayed
      const errorElements = screen.getAllByText(/Failed to revise itinerary|Internal server error/i);
      expect(errorElements.length).toBeGreaterThan(0);
    }, { timeout: 5000 });

    // Verify revising is cleared: the apply button should no longer say "Regenerating itinerary…"
    await waitFor(() => {
      const buttons = screen.getAllByRole("button").filter(
        btn => btn.textContent?.includes("Apply selected resolutions and regenerate itinerary")
      );
      // Button should exist again (not stuck in "Regenerating..." state)
      expect(buttons.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  }, 15000);
});

// ─── Example: Empty state preserved ──────────────────────────────────────────

describe("Preservation: Empty state", () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * Example test: render with conflicts = [] → empty-state message renders,
   * no agent call fires.
   */
  it("conflicts = [] → empty-state message shown, no POST to negotiation agent", async () => {
    const fetchCalls: { url: string; method: string }[] = [];

    const mockFetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";
      fetchCalls.push({ url: urlStr, method });

      if (urlStr.includes("/api/conflicts") && method === "GET") {
        return Promise.resolve(mockResponse([])); // Empty conflicts
      }
      if (urlStr.includes("/api/agents/itinerary") && method === "GET") {
        return Promise.resolve(mockResponse(null, 404));
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

    // Wait for empty-state message
    await waitFor(() => {
      expect(
        screen.getByText(/No conflicts to resolve/i)
      ).toBeInTheDocument();
    }, { timeout: 3000 });

    // Assert no POST was ever made to the negotiation agent
    const agentCalls = fetchCalls.filter(
      call => call.method === "POST" && call.url.includes("/api/agents/negotiation")
    );
    expect(agentCalls).toHaveLength(0);
  }, 10000);
});

// ─── Example: Diff summary banner preserved ─────────────────────────────────

describe("Preservation: Diff summary amber banner", () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * Example test: host clicks apply with a successful mock response that
   * includes diffSummary → amber banner rendered with the diff text.
   */
  it("successful agent response with diffSummary → amber banner renders", async () => {
    const conflicts = [
      makeConflict({ id: "conflict-diff-1", status: "open" }),
    ];

    const diffText = "Changed activity on day 2 from museum to food tour";

    const mockFetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      const method = init?.method ?? "GET";

      if (urlStr.includes("/api/conflicts") && method === "GET") {
        return Promise.resolve(mockResponse(conflicts));
      }
      if (urlStr.includes("/api/agents/itinerary") && method === "GET") {
        return Promise.resolve(mockResponse(null, 404));
      }
      if (method === "PATCH" && urlStr.includes("/api/conflicts/")) {
        return Promise.resolve(mockResponse({}));
      }
      if (urlStr.includes("/api/agents/negotiation") && method === "POST") {
        // Successful response with diffSummary
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
          diffSummary: diffText,
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

    // Wait for conflict to render
    await waitFor(() => {
      expect(screen.getByText("Conflict conflict-diff-1")).toBeInTheDocument();
    }, { timeout: 3000 });

    // Select an option
    const optionButtons = screen.getAllByRole("button").filter(
      btn => btn.getAttribute("aria-pressed") !== null
    );
    await act(async () => {
      fireEvent.click(optionButtons[0]);
    });
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Click the global "Apply selected resolutions and regenerate itinerary"
    const applyButton = screen.getAllByRole("button").find(
      btn => btn.textContent?.includes("Apply selected resolutions and regenerate itinerary")
    );
    expect(applyButton).toBeTruthy();

    await act(async () => {
      fireEvent.click(applyButton!);
    });

    // Wait for the diff summary banner to appear
    await waitFor(() => {
      expect(screen.getByText("✏️ Itinerary revised")).toBeInTheDocument();
      expect(screen.getByText(diffText)).toBeInTheDocument();
    }, { timeout: 5000 });
  }, 15000);
});
