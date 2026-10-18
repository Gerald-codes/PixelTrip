/**
 * Party room, membership, character, and preference fixtures.
 *
 * Contract-shaped data (see "Guest Identity Flow" and "HTTP API" in
 * `api-contracts.md`). Consumed only by the mock service implementations. IDs
 * are UUID-format strings.
 */
import type {
  Character,
  PartyRoom,
  RoomMember,
  TravelPreferences,
} from "@/types";

import { mockGuest, mockGuest2 } from "./guests";

/** A stable fixture room. Join it in mock mode with room code "PIXEL1". */
export const mockRoom: PartyRoom = {
  id: "22222222-2222-4222-8222-222222222222",
  roomCode: "PIXEL1",
  name: "The Wandering Party",
  status: "active",
  planningStage: "setup",
};

/** Fixture members belonging to {@link mockRoom}. */
export const mockRoomMembers: readonly RoomMember[] = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    roomId: mockRoom.id,
    guestId: mockGuest.id,
    displayName: mockGuest.displayName,
    role: "owner",
    stageReady: false,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    roomId: mockRoom.id,
    guestId: mockGuest2.id,
    displayName: mockGuest2.displayName,
    role: "member",
    stageReady: false,
  },
];

/** The owner's character. The second fixture member has none (resume returns null). */
export const mockCharacter: Character = {
  id: "44444444-4444-4444-8444-444444444444",
  memberId: mockRoomMembers[0].id,
  appearance: { outfit: "explorer", palette: "forest" },
  spriteKey: "sprite:explorer-01",
};

/** The owner's travel preferences. */
export const mockTravelPreferences: TravelPreferences = {
  id: "77777777-7777-4777-8777-777777777777",
  memberId: mockRoomMembers[0].id,
  availableDates: ["2025-12-20", "2025-12-27"],
  destinations: ["Tokyo"],
  travelStyle: "relaxed",
  budget: 1500,
  interests: ["food", "museums"],
  activities: ["hiking"],
  hardConstraints: [],
};

/** Keyed rooms for id lookups; unknown ids resolve to `null`. */
export const mockRoomsById: Readonly<Record<string, PartyRoom>> = {
  [mockRoom.id]: mockRoom,
};
