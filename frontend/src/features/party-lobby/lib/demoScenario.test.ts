import { describe, expect, it } from "vitest";
import { demoDraft, DEMO_CHANGES } from "./demoScenario";
import { toSessionCharacter } from "./draft";
import { toPartyRoom } from "@/services/supabaseRows";
import type { RoomSession } from "@/types";

function session(name: string, demo = true): RoomSession {
  return {
    room: {
      id: "room",
      roomCode: "DEMO12",
      name: "Demo",
      status: "active",
      planningStage: "setup",
      ...(demo
        ? { demoScenario: "vietnam-five-days", demoStart: "2026-12-29" }
        : {}),
    },
    member: {
      id: "member",
      roomId: "room",
      guestId: "guest",
      displayName: name,
      role: "owner",
      stageReady: false,
    },
    guest: { id: "guest", displayName: name, avatarUrl: null },
    character: null,
    travelPreferences: null,
  };
}

describe("shared prepared demo", () => {
  it("uses the server date for both users even across year boundaries", () => {
    const alice = demoDraft(session(" DemoAlice "))!;
    const bob = demoDraft(session("demobob"))!;
    expect(alice.availableDates).toEqual([
      { start: "2026-12-29", end: "2027-01-02" },
    ]);
    expect(bob.availableDates).toEqual(alice.availableDates);
    expect(alice.groupRole).toBe("leader");
    expect(bob.groupRole).toBe("adventurer");
    expect(toSessionCharacter(alice)?.budget).toBe(2000);
    expect(toSessionCharacter(bob)?.character.spriteKey).toBe(
      "role-adventurer",
    );
  });

  it("does not enable the demo just because a normal room contains a matching name", () => {
    expect(demoDraft(session("DemoAlice", false))).toBeUndefined();
  });

  it("preserves demo metadata on a realtime room refresh", () => {
    const room = toPartyRoom({
      id: "room",
      room_code: "DEMO12",
      name: "Demo",
      status: "active",
      planning_stage: "refine",
      demo_scenario: "vietnam-five-days",
      demo_start: "2026-12-29",
    });
    expect(room.demoScenario).toBe("vietnam-five-days");
    expect(room.demoStart).toBe("2026-12-29");
  });

  it("provides exactly one distinct supported review choice per prepared day", () => {
    expect(Object.keys(DEMO_CHANGES)).toEqual(["1", "2", "3", "4", "5"]);
    expect(new Set(Object.values(DEMO_CHANGES)).size).toBe(5);
    expect(DEMO_CHANGES[1]).toContain("separate club");
  });
});
