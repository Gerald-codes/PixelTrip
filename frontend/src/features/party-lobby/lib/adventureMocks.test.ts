import { describe, expect, it } from "vitest";

import type { RoomMember } from "@/types";

import { buildAdventureView, groupRoleOf } from "./adventureMocks";

describe("party member view", () => {
  it("reads the party role from a saved character's sprite key", () => {
    expect(groupRoleOf("role-planner")).toBe("planner");
    expect(groupRoleOf("role-traveller")).toBeNull(); // not a party role
    expect(groupRoleOf("guest-123")).toBeNull();
    expect(groupRoleOf(null)).toBeNull();
  });

  it("carries the role, the leader flag and readiness to the sidebar", () => {
    const member = {
      id: "m1",
      roomId: "r1",
      guestId: "g1",
      displayName: "Gerald",
      role: "owner",
      stageReady: true,
      spriteKey: "role-chill",
    } as RoomMember;

    expect(buildAdventureView([member]).members[0]).toMatchObject({
      displayName: "Gerald",
      groupRole: "chill",
      isHost: true,
      ready: true,
    });
  });
});
