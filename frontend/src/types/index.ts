/**
 * Barrel for shared data-shape types.
 *
 * All shapes mirror `api-contracts.md` (the single source of truth) and are
 * consumed by the service layer via `@/types`. Re-exported as types since the
 * project compiles with `isolatedModules`.
 */

export type { Guest } from "./guest";
export type {
  PlanningStage,
  RoomStatus,
  MemberRole,
  PartyRoom,
  RoomMember,
  RoomSession,
} from "./room";
export type { Character } from "./character";
export type { TravelPreferences } from "./preferences";
export type { SenderType, MessageKind, Message } from "./message";
export type { VoteOption, VoteSession } from "./vote";
export type {
  ItineraryItem,
  ItineraryDay,
  Itinerary,
  ItineraryVersion,
} from "./itinerary";
export type { FeedbackInput, Feedback } from "./feedback";
export type { ExportPayload } from "./export";
export type { Unsubscribe } from "./common";
