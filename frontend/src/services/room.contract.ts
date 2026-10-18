/**
 * Room service contract.
 *
 * Typed method signatures only — no feature or business logic. Behaviour is
 * supplied solely by the mock (`room.mock.ts`) or real (`room.api.ts`)
 * implementation. Shapes mirror the "Guest Identity Flow" and "HTTP API"
 * sections of `api-contracts.md` (the single source of truth). No
 * Supabase/FastAPI types appear in this surface.
 *
 * Creating or joining a room is the only way a guest/member comes into
 * existence; both return the full {@link RoomSession}.
 */
import type { PartyRoom, RoomMember, RoomSession, Unsubscribe } from "@/types";

/** Input for {@link RoomService.createRoom}. The caller becomes the owner. */
export interface CreateRoomInput {
  /** 1–100 characters, not blank. */
  name: string;
  /** 1–50 characters, not blank. */
  ownerDisplayName: string;
}

/** Input for {@link RoomService.joinRoom}. */
export interface JoinRoomInput {
  /** 4–12 uppercase letters or digits; implementations uppercase and trim it. */
  roomCode: string;
  /** 1–50 characters, not blank. Matched case-insensitively to resume a member. */
  displayName: string;
}

export interface RoomService {
  createRoom(input: CreateRoomInput): Promise<RoomSession>;
  /** Resume the member with this name (any casing) or create a new member. */
  joinRoom(input: JoinRoomInput): Promise<RoomSession>;
  getRoom(roomId: string): Promise<PartyRoom | null>;
  listMembers(roomId: string): Promise<RoomMember[]>;
  /**
   * Live roster updates for a room. Calls `onChange` with the full
   * {@link RoomMember} list whenever the roster changes, and once immediately to
   * prime it. Returns an {@link Unsubscribe} that stops all further callbacks.
   *
   * The mock implementation polls on an interval; the real implementation uses a
   * Supabase Realtime channel on `room_members`. Roster-refresh failures are
   * swallowed (the last known roster is kept) — this never throws into the UI.
   */
  subscribeMembers(
    roomId: string,
    onChange: (members: RoomMember[]) => void,
  ): Unsubscribe;
  /**
   * Live updates to the room row itself (notably `planningStage`). Calls
   * `onChange` with the full {@link PartyRoom} whenever it changes, and once
   * immediately to prime it. Returns an {@link Unsubscribe}.
   *
   * The mock polls on an interval; the real implementation uses a Supabase
   * Realtime channel on `party_rooms`. Read failures are swallowed (the last
   * known room is kept) — this never throws into the UI.
   */
  subscribeRoom(
    roomId: string,
    onChange: (room: PartyRoom) => void,
  ): Unsubscribe;
}
