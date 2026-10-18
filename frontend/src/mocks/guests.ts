/**
 * Guest fixtures.
 *
 * Contract-shaped `Guest` data (see "Guest Identity Flow" in
 * `api-contracts.md`). Consumed only by the mock service implementations,
 * never imported by the UI. IDs are UUID-format strings.
 */
import type { Guest } from "@/types";

/** The fixture room owner's guest profile. */
export const mockGuest: Guest = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Pixel Wanderer",
  avatarUrl: "sprite:explorer-01",
};

/** A second fixture guest (a regular member, no avatar). */
export const mockGuest2: Guest = {
  id: "66666666-6666-4666-8666-666666666666",
  displayName: "Map Keeper",
  avatarUrl: null,
};

/** Keyed guests for id lookups; unknown ids resolve to `null`. */
export const mockGuestsById: Readonly<Record<string, Guest>> = {
  [mockGuest.id]: mockGuest,
  [mockGuest2.id]: mockGuest2,
};
