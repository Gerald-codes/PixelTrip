import { describe, expect, it } from "vitest";

import type { CharacterDraft } from "../types";
import { availabilityIssue, canSave, toSessionCharacter } from "./draft";

function draft(
  availableDates: CharacterDraft["availableDates"],
): CharacterDraft {
  return {
    budgetTier: "medium",
    groupRole: "leader",
    tripPriorities: [],
    destinations: [],
    activities: [],
    budgetText: "",
    availableDates,
  };
}

const FULL = { start: "2026-10-16", end: "2026-10-20" };

describe("free periods and saving", () => {
  it("blocks a period with a first day but no last day", () => {
    const halfPicked = draft([{ start: "2026-10-16", end: "" }]);
    expect(canSave(halfPicked)).toBe(false);
    expect(availabilityIssue(halfPicked)).toBe(
      "Pick the last day of your free period.",
    );
    expect(toSessionCharacter(halfPicked)).toBeNull();
  });

  it("names the half-picked period when there are several", () => {
    const second = draft([FULL, { start: "2026-11-01", end: "" }]);
    expect(canSave(second)).toBe(false);
    expect(availabilityIssue(second)).toBe(
      "Pick the last day of free period 2, or remove it.",
    );
  });

  it("needs at least one complete period", () => {
    const none = draft([{ start: "", end: "" }]);
    expect(canSave(none)).toBe(false);
    expect(availabilityIssue(none)).toBe(
      "Pick the dates you are free to travel.",
    );
  });

  it("saves complete periods and leaves blank extras out of the payload", () => {
    const withBlank = draft([FULL, { start: "", end: "" }]);
    expect(availabilityIssue(withBlank)).toBeNull();
    expect(canSave(withBlank)).toBe(true);
    expect(toSessionCharacter(withBlank)?.availableDates).toEqual([FULL]);
  });

  it("allows a single-day period", () => {
    expect(canSave(draft([{ start: "2026-10-16", end: "2026-10-16" }]))).toBe(
      true,
    );
  });
});
