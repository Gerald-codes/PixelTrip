/**
 * Party room, membership, and room-session shapes plus the planning-stage enum.
 *
 * Mirrors the "Guest Identity Flow", "HTTP API", and "Stage & State" sections of
 * `api-contracts.md`. Identity is room-scoped: a member is found by room code plus
 * display name (case-insensitive); all ids come from the backend.
 */
import type { Character } from "./character";
import type { Guest } from "./guest";
import type { TravelPreferences } from "./preferences";

/** The six in-world planning stages of the adventure. */
export type PlanningStage =
  | "setup"
  | "discover"
  | "logistics"
  | "build"
  | "refine"
  | "wrap";

/** Lifecycle of a party room. */
export type RoomStatus = "active" | "finalised" | "cancelled";

/** A member's role in a room. The room creator is the single owner. */
export type MemberRole = "owner" | "member";

/** A shared party room the group plans in. */
export interface PartyRoom {
  id: string;
  /** Shareable join code, 4–12 uppercase letters or digits (e.g. "ABC123"). */
  roomCode: string;
  name: string;
  status: RoomStatus;
  planningStage: PlanningStage;
  /** Shared, server-assigned scenario; absent for ordinary rooms. */
  demoScenario?: "vietnam-five-days" | null;
  /** Fixed demo departure date in YYYY-MM-DD, shared by both devices. */
  demoStart?: string | null;
}

/** A member participating in a party room. */
export interface RoomMember {
  id: string;
  roomId: string;
  guestId: string;
  /** The name as first entered, even when resumed with different casing. */
  displayName: string;
  role: MemberRole;
  /**
   * Whether this member has completed the party's current planning stage (saved
   * their character in SETUP, picked a destination in DISCOVER, ...). Mirrored by
   * the backend onto this anon-readable row so readiness streams live over
   * Realtime. Defaults to false.
   */
  stageReady: boolean;
  /**
   * The saved character's sprite key (e.g. `role-planner`), when the roster read
   * includes it. Absent or null until the member has created a character.
   */
  spriteKey?: string | null;
}

/**
 * Everything returned when creating or joining a room: the room plus the acting
 * member and their records. `character` / `travelPreferences` are `null` only when
 * a resumed member has no such record.
 */
export interface RoomSession {
  room: PartyRoom;
  member: RoomMember;
  guest: Guest;
  character: Character | null;
  travelPreferences: TravelPreferences | null;
}
