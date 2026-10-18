/**
 * Compile-time contract-shape guards (Task 6.2).
 *
 * These assertions are derived from `api-contracts.md` (the single source of
 * truth) and exist purely to make `tsc` fail if a shared type in `src/types`
 * drifts from the agreed contract field lists. There is NO runtime test
 * runner here — Task 15 owns the Vitest setup. This file is type-only: it has
 * no runtime side effects beyond trivial `const` bindings prefixed with `_`.
 *
 * How it works:
 * - `satisfies` literals prove each interface accepts an object with exactly
 *   its required fields (and that contract-optional fields may be omitted).
 * - `Equal`/`Expect` type utilities pin field-level types (ids/timestamps are
 *   `string`, kind-dependent content is `unknown`, unions match the contract).
 *
 * If a field is renamed/removed/retyped in a way that contradicts the
 * contract, one of the checks below stops compiling.
 *
 * No `any`. Adjust only in lockstep with `api-contracts.md`.
 */

import type {
  Guest,
  PlanningStage,
  PartyRoom,
  RoomStatus,
  MemberRole,
  RoomMember,
  RoomSession,
  Character,
  TravelPreferences,
  SenderType,
  MessageKind,
  Message,
  VoteOption,
  VoteSession,
  ItineraryItem,
  ItineraryDay,
  Itinerary,
  ItineraryVersion,
  FeedbackInput,
  Feedback,
  ExportPayload,
} from "./index";

/* ------------------------------------------------------------------ *
 * Type-level assertion utilities (no runtime footprint).
 * ------------------------------------------------------------------ */

/** Exact structural equality between two types. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/** Compiles only when the argument type is exactly `true`. */
type Expect<T extends true> = T;

/* ------------------------------------------------------------------ *
 * Guest — { id, displayName, avatarUrl (string | null) }
 * ------------------------------------------------------------------ */

const _guest = { id: "", displayName: "", avatarUrl: null } satisfies Guest;
const _guestWithAvatar = {
  id: "",
  displayName: "",
  avatarUrl: "",
} satisfies Guest;
type _GuestId = Expect<Equal<Guest["id"], string>>;
type _GuestDisplayName = Expect<Equal<Guest["displayName"], string>>;
type _GuestAvatar = Expect<Equal<Guest["avatarUrl"], string | null>>;

/* ------------------------------------------------------------------ *
 * Stage & State — PlanningStage union
 * ------------------------------------------------------------------ */

type _PlanningStage = Expect<
  Equal<
    PlanningStage,
    "setup" | "discover" | "logistics" | "build" | "refine" | "wrap"
  >
>;

/* ------------------------------------------------------------------ *
 * PartyRoom — { id, roomCode, name, status, planningStage }
 * ------------------------------------------------------------------ */

const _partyRoom = {
  id: "",
  roomCode: "",
  name: "",
  status: "active",
  planningStage: "setup",
} satisfies PartyRoom;
type _PartyRoomId = Expect<Equal<PartyRoom["id"], string>>;
type _PartyRoomCode = Expect<Equal<PartyRoom["roomCode"], string>>;
type _RoomStatus = Expect<
  Equal<RoomStatus, "active" | "finalised" | "cancelled">
>;
type _PartyRoomStage = Expect<Equal<PartyRoom["planningStage"], PlanningStage>>;

/* ------------------------------------------------------------------ *
 * RoomMember — { id, roomId, guestId, displayName, role }
 * ------------------------------------------------------------------ */

const _roomMember = {
  id: "",
  roomId: "",
  guestId: "",
  displayName: "",
  role: "member",
  stageReady: false,
} satisfies RoomMember;
type _MemberRole = Expect<Equal<MemberRole, "owner" | "member">>;

/* ------------------------------------------------------------------ *
 * Character — { id, memberId, appearance, spriteKey (string | null) }
 * ------------------------------------------------------------------ */

const _character = {
  id: "",
  memberId: "",
  appearance: {},
  spriteKey: null,
} satisfies Character;
type _CharacterAppearance = Expect<
  Equal<Character["appearance"], Record<string, unknown>>
>;

/* ------------------------------------------------------------------ *
 * TravelPreferences — list fields are arrays; optional values are null
 * ------------------------------------------------------------------ */

const _travelPreferences = {
  id: "",
  memberId: "",
  availableDates: [],
  destinations: [],
  travelStyle: null,
  budget: null,
  interests: [],
  activities: [],
  hardConstraints: [],
} satisfies TravelPreferences;
type _Budget = Expect<Equal<TravelPreferences["budget"], number | null>>;

/* ------------------------------------------------------------------ *
 * RoomSession — create/join result; character/prefs may be null on resume
 * ------------------------------------------------------------------ */

const _roomSession = {
  room: _partyRoom,
  member: _roomMember,
  guest: _guest,
  character: null,
  travelPreferences: null,
} satisfies RoomSession;
type _SessionCharacter = Expect<
  Equal<RoomSession["character"], Character | null>
>;

/* ------------------------------------------------------------------ *
 * Message — envelope + kind-dependent unknown content
 * ------------------------------------------------------------------ */

type _SenderType = Expect<Equal<SenderType, "user" | "ai">>;
type _MessageKind = Expect<
  Equal<MessageKind, "text" | "recommendation" | "vote" | "summary">
>;

// senderId is `string | null` (null for AI).
const _messageUser = {
  id: "",
  roomId: "",
  createdAt: "",
  senderType: "user",
  senderId: "",
  kind: "text",
  content: undefined as unknown,
} satisfies Message;
const _messageAi = {
  id: "",
  roomId: "",
  createdAt: "",
  senderType: "ai",
  senderId: null,
  kind: "recommendation",
  content: undefined as unknown,
} satisfies Message;
type _MessageCreatedAt = Expect<Equal<Message["createdAt"], string>>;
type _MessageSenderId = Expect<Equal<Message["senderId"], string | null>>;
type _MessageContent = Expect<Equal<Message["content"], unknown>>;

/* ------------------------------------------------------------------ *
 * Voting — VoteOption / VoteSession
 * ------------------------------------------------------------------ */

const _voteOption = { id: "", label: "", count: 0 } satisfies VoteOption;
const _voteSession = {
  voteSessionId: "",
  roomId: "",
  question: "",
  options: [],
  status: "open",
} satisfies VoteSession;
type _VoteSessionStatus = Expect<
  Equal<VoteSession["status"], "open" | "closed">
>;
type _VoteSessionOptions = Expect<Equal<VoteSession["options"], VoteOption[]>>;

/* ------------------------------------------------------------------ *
 * Itinerary — item / day / itinerary / version
 * ------------------------------------------------------------------ */

// ItineraryItem: only `title` required; time/description/location/tags optional.
const _itineraryItem = { title: "" } satisfies ItineraryItem;
// ItineraryDay: day + items required; date optional.
const _itineraryDay = { day: 1, items: [] } satisfies ItineraryDay;
// Itinerary: dates and map optional.
const _itinerary = {
  tripId: "",
  roomId: "",
  title: "",
  summary: "",
  destination: { name: "" },
  days: [],
} satisfies Itinerary;
type _ItineraryDays = Expect<Equal<Itinerary["days"], ItineraryDay[]>>;

// ItineraryVersion: changeSummary optional (REFINE only).
const _itineraryVersion = {
  version: 1,
  source: "build",
  isCurrent: true,
  itinerary: _itinerary,
} satisfies ItineraryVersion;
type _ItineraryVersionSource = Expect<
  Equal<ItineraryVersion["source"], "build" | "refine">
>;

/* ------------------------------------------------------------------ *
 * Feedback — FeedbackInput and persisted Feedback
 * ------------------------------------------------------------------ */

const _feedbackInput = {
  tripId: "",
  itineraryVersionId: "",
  memberId: "",
  target: { day: 1 },
  comment: "",
} satisfies FeedbackInput;
const _feedback = {
  id: "",
  tripId: "",
  itineraryVersionId: "",
  memberId: "",
  target: { day: 1 },
  comment: "",
  status: "open",
} satisfies Feedback;
type _FeedbackStatus = Expect<Equal<Feedback["status"], "open" | "addressed">>;

/* ------------------------------------------------------------------ *
 * Export (WRAP) — { tripId, shareable: unknown }
 * ------------------------------------------------------------------ */

const _exportPayload = {
  tripId: "",
  shareable: undefined as unknown,
} satisfies ExportPayload;
type _ExportShareable = Expect<Equal<ExportPayload["shareable"], unknown>>;

/* ------------------------------------------------------------------ *
 * Reference the bindings so `noUnusedLocals`-style lint stays quiet and
 * the file has a single trivial export (no meaningful runtime side effect).
 * ------------------------------------------------------------------ */

export const __contractShapeGuards = [
  _guest,
  _guestWithAvatar,
  _partyRoom,
  _roomMember,
  _character,
  _travelPreferences,
  _roomSession,
  _messageUser,
  _messageAi,
  _voteOption,
  _voteSession,
  _itineraryItem,
  _itineraryDay,
  _itinerary,
  _itineraryVersion,
  _feedbackInput,
  _feedback,
  _exportPayload,
] as const;
