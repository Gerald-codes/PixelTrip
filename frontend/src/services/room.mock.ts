/**
 * Mock room service.
 *
 * In-memory implementation of {@link RoomService} that behaves like the real
 * backend (no Supabase/FastAPI access):
 * - `createRoom` generates a room code and makes the caller the owner.
 * - `joinRoom` resumes a member whose name matches ignoring case and extra spaces,
 *   otherwise creates a new member; an unknown code throws `ROOM_NOT_FOUND`.
 * - `subscribeMembers` simulates Supabase Realtime with a local interval timer,
 *   priming once immediately then re-reading via `listMembers`.
 * State is seeded from `src/mocks` and lives for the lifetime of the instance.
 * Join the fixture room with code "PIXEL1".
 */
import { ApiError } from "@/lib/errors";
import {
  mockCharacter,
  mockGuestsById,
  mockRoom,
  mockRoomMembers,
  mockTravelPreferences,
} from "@/mocks";
import type {
  Character,
  Guest,
  PartyRoom,
  RoomMember,
  RoomSession,
  TravelPreferences,
  Unsubscribe,
} from "@/types";

import type {
  CreateRoomInput,
  JoinRoomInput,
  RoomService,
} from "./room.contract";

const ROOM_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Interval between simulated realtime roster emissions, in milliseconds. */
const ROSTER_EMIT_INTERVAL_MS = 2000;

/** Same rule as the backend: trim, collapse inner whitespace, lower-case. */
function normalizeDisplayName(name: string): string {
  return name.trim().split(/\s+/).join(" ").toLowerCase();
}

function generateRoomCode(): string {
  return Array.from(
    { length: 6 },
    () =>
      ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)],
  ).join("");
}

function newCharacter(memberId: string): Character {
  return { id: crypto.randomUUID(), memberId, appearance: {}, spriteKey: null };
}

function newPreferences(memberId: string): TravelPreferences {
  return {
    id: crypto.randomUUID(),
    memberId,
    availableDates: [],
    destinations: [],
    travelStyle: null,
    budget: null,
    interests: [],
    activities: [],
    hardConstraints: [],
  };
}

export class MockRoomService implements RoomService {
  private readonly rooms = new Map<string, PartyRoom>([
    [mockRoom.id, mockRoom],
  ]);
  private readonly members: RoomMember[] = [...mockRoomMembers];
  private readonly guests = new Map<string, Guest>(
    Object.entries(mockGuestsById),
  );
  private readonly characters = new Map<string, Character>([
    [mockCharacter.memberId, mockCharacter],
  ]);
  private readonly preferences = new Map<string, TravelPreferences>([
    [mockTravelPreferences.memberId, mockTravelPreferences],
  ]);

  async createRoom(input: CreateRoomInput): Promise<RoomSession> {
    const room: PartyRoom = {
      id: crypto.randomUUID(),
      roomCode: generateRoomCode(),
      name: input.name,
      status: "active",
      planningStage: "setup",
    };
    this.rooms.set(room.id, room);
    return this.addMember(room, input.ownerDisplayName, "owner");
  }

  async joinRoom(input: JoinRoomInput): Promise<RoomSession> {
    const roomCode = input.roomCode.trim().toUpperCase();
    const room = [...this.rooms.values()].find((r) => r.roomCode === roomCode);
    if (!room) {
      throw new ApiError(
        "ROOM_NOT_FOUND",
        `Room '${roomCode}' not found.`,
        404,
      );
    }

    const wanted = normalizeDisplayName(input.displayName);
    const existing = this.members.find(
      (m) =>
        m.roomId === room.id && normalizeDisplayName(m.displayName) === wanted,
    );
    if (existing) {
      return {
        room,
        member: existing,
        guest: this.guests.get(existing.guestId) as Guest,
        character: this.characters.get(existing.id) ?? null,
        travelPreferences: this.preferences.get(existing.id) ?? null,
      };
    }
    return this.addMember(room, input.displayName, "member");
  }

  async getRoom(roomId: string): Promise<PartyRoom | null> {
    return this.rooms.get(roomId) ?? null;
  }

  async listMembers(roomId: string): Promise<RoomMember[]> {
    return this.members.filter((member) => member.roomId === roomId);
  }

  // Simulates Supabase Realtime with a local timer: primes the roster once
  // immediately, then re-reads via listMembers on an interval. The returned
  // Unsubscribe clears the timer so ZERO further callbacks fire after it runs.
  subscribeMembers(
    roomId: string,
    onChange: (members: RoomMember[]) => void,
  ): Unsubscribe {
    let active = true;

    const push = (): void => {
      if (!active) return;
      void this.listMembers(roomId).then((members) => {
        if (active) onChange(members);
      });
    };

    // Prime immediately.
    push();

    const timer = setInterval(push, ROSTER_EMIT_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }

  // Minimal stub: emits the fixture room once (mock mode has no live stage
  // changes). The real implementation subscribes to party_rooms over Realtime.
  subscribeRoom(
    roomId: string,
    onChange: (room: PartyRoom) => void,
  ): Unsubscribe {
    const room = this.rooms.get(roomId);
    if (room) onChange(room);
    return () => {
      // no-op
    };
  }

  private addMember(
    room: PartyRoom,
    displayName: string,
    role: RoomMember["role"],
  ): RoomSession {
    const guest: Guest = {
      id: crypto.randomUUID(),
      displayName,
      avatarUrl: null,
    };
    const member: RoomMember = {
      id: crypto.randomUUID(),
      roomId: room.id,
      guestId: guest.id,
      displayName,
      role,
      stageReady: false,
    };
    const character = newCharacter(member.id);
    const travelPreferences = newPreferences(member.id);

    this.guests.set(guest.id, guest);
    this.members.push(member);
    this.characters.set(member.id, character);
    this.preferences.set(member.id, travelPreferences);
    return { room, member, guest, character, travelPreferences };
  }
}
