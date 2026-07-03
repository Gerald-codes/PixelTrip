/**
 * Shared data models for PixelTrip.
 *
 * This is the single source of truth for every model shape in the app and is
 * imported by both client and server. Do not redefine these shapes inline
 * elsewhere — import from here (`lib/types.ts`).
 *
 * Field names, union types, and nested shapes mirror the Data Models section of
 * the design document.
 */

/**
 * Room stage state machine.
 *
 * `TripRoom.currentStage` is the single source of truth for pipeline position:
 *
 *   LOBBY → PERSONA → AVAILABILITY → GROUP_PROFILE → DESTINATIONS →
 *   DESTINATION_VOTE → FLIGHTS → FLIGHT_VOTE → ACTIVITIES → ITINERARY →
 *   FEEDBACK → NEGOTIATION → FINAL
 *
 * NEGOTIATION may loop back to ITINERARY → FEEDBACK repeatedly until the host
 * finalises.
 */
export enum RoomStage {
  LOBBY = "LOBBY",
  PERSONA = "PERSONA",
  AVAILABILITY = "AVAILABILITY",
  GROUP_PROFILE = "GROUP_PROFILE",
  DESTINATIONS = "DESTINATIONS",
  DESTINATION_VOTE = "DESTINATION_VOTE",
  FLIGHTS = "FLIGHTS",
  FLIGHT_VOTE = "FLIGHT_VOTE",
  ACTIVITIES = "ACTIVITIES",
  ITINERARY = "ITINERARY",
  FEEDBACK = "FEEDBACK",
  NEGOTIATION = "NEGOTIATION",
  FINAL = "FINAL",
}

/** A participant in a trip room. Identity is a client-generated UUID (no auth). */
export interface User {
  id: string; // UUID generated client-side, stored in localStorage
  displayName: string;
  roomId: string;
  selectedPersonaId: string | null;
}

/** An 8-bit travel-style character a user can adopt. */
export interface Persona {
  id: string;
  name: string; // e.g. "Foodie Boss"
  avatarImage: string; // path to pixel art PNG
  budgetLevel: "low" | "medium" | "high";
  travelPace: "slow" | "moderate" | "fast";
  interests: string[]; // e.g. ["food", "nightlife", "cafes"]
  flexibility: "rigid" | "moderate" | "flexible";
  decisionStyle: string; // e.g. "Opinionated", "Easygoing"
  description: string;
  planningWeight: Record<string, number>; // e.g. { food: 0.8, scenery: 0.2 }
}

/** A trip room; `currentStage` drives the entire UI and agent pipeline. */
export interface TripRoom {
  id: string;
  roomCode: string; // 6-char uppercase alphanumeric
  hostUserId: string;
  currentStage: RoomStage; // enum, see state machine above
  selectedDestination: string | null;
  selectedFlightOption: "budget" | "comfort" | "best_value" | null;
  currentItineraryId: string | null;
  finalItineraryId: string | null;
  createdAt: string;
  // ── additive optional fields (Conversational Multiplayer UX) ──
  /** Shared party goal selected during onboarding; broadcast via room:{id}:goal. */
  partyGoal?: PartyGoal;
  /** Adaptive planning mode derived from the selected entry point. */
  planningMode?: PlanningMode;
  /**
   * The explicit ordered subset of stages this room walks through, derived once
   * from `planningMode` via `computeActiveStages(mode)` and persisted on the
   * room (`trip_rooms.active_stages`). `currentStage` remains the single source
   * of truth for the live position.
   */
  activeStages?: RoomStage[];
}

/** A single date range a user is available to travel. */
export interface Availability {
  id: string;
  userId: string;
  roomId: string;
  startDate: string; // ISO date
  endDate: string; // ISO date
}

/** A country or city a user is interested in visiting. */
export interface DestinationPreference {
  id: string;
  userId: string;
  roomId: string;
  countryOrCity: string;
}

/**
 * AI-generated summary of the group's combined travel profile.
 *
 * Produced by the group-profile agent (`POST /api/agents/group-profile`) and
 * displayed to all members in `GroupProfileStage` before destinations are
 * surfaced. Persisted to `room_profiles.profile` (one row per room, upsert on
 * `room_id`) so the UI can fetch the most recently generated profile without
 * re-running the agent.
 *
 * `travelWindow` mirrors the shape returned by `calculateOverlap()` and is
 * `null` when no group-wide overlap exists yet.
 */
export interface GroupProfile {
  budgetRange: string;
  dominantPace: "slow" | "moderate" | "fast";
  commonInterests: string[];
  travelWindow: { startDate: string; endDate: string } | null;
  tensionPoints: string[];
  dominantPersonaTraits: string[];
}

/** An AI-generated destination recommendation with reasoning. */
export interface DestinationSuggestion {
  id: string;
  roomId: string;
  destinationName: string;
  fitScore: number; // 0–100
  weatherSummary: string;
  seasonalitySummary: string;
  crowdLevel: "low" | "moderate" | "high";
  priceLevel: "budget" | "moderate" | "premium";
  bestActivities: string[];
  downsides: string[];
  personaFitSummary: string;
  recommendationReason: string;
}

/** A single vote cast in a destination, flight, or conflict-resolution round. */
export interface Vote {
  id: string;
  roomId: string;
  userId: string;
  voteType: "destination" | "flight" | "conflict_resolution";
  selectedOption: string;
  createdAt: string;
}

/** A user-submitted activity, food, sight, experience, or avoid item. */
export interface ActivityPreference {
  id: string;
  roomId: string;
  userId: string;
  title: string;
  type: "activity" | "food" | "sight" | "experience" | "avoid";
  priority: "must_have" | "optional";
  notes: string | null;
}

/** A single item scheduled within a part of a day. */
export interface ItineraryItem {
  title: string;
  description: string;
  type: string;
  personaBenefits: string[]; // persona names who benefit
  reason: string;
}

/** A single day of the itinerary, split into parts of the day. */
export interface ItineraryDay {
  date: string;
  morning: ItineraryItem[];
  afternoon: ItineraryItem[];
  evening: ItineraryItem[];
  night?: ItineraryItem[];
}

/** Per-persona fairness assessment for an itinerary. */
export interface FairnessSummary {
  perPersona: Record<string, string>; // personaName → summary text
  warnings: string[];
  recommendations: string[];
}

/** A versioned itinerary for a room. */
export interface Itinerary {
  id: string;
  roomId: string;
  versionNumber: number;
  destination: string;
  startDate: string;
  endDate: string;
  days: ItineraryDay[];
  fairnessSummary: FairnessSummary;
  averageSatisfactionScore: number | null;
  status: "draft" | "final";
}

/** A user's feedback on a generated itinerary. */
export interface ItineraryFeedback {
  id: string;
  itineraryId: string;
  userId: string;
  score: number; // 1–10
  likedItems: string[];
  dislikedItems: string[];
  requestedAdditions: string[];
  requestedRemovals: string[];
  importantRequests: string[]; // up to 3 high-priority items
  createdAt: string;
}

/** A single AI-proposed option for resolving a conflict. */
export interface ConflictOption {
  id: string;
  description: string;
  tradeoffs: string;
}

/** A conflict surfaced from feedback that the group must resolve. */
export interface ConflictResolution {
  id: string;
  roomId: string;
  itineraryId: string;
  conflictSummary: string;
  affectedUsers: string[];
  proposedOptions: ConflictOption[];
  selectedResolution: string | null;
  status: "open" | "voting" | "resolved";
}

// ─── Character Creator types (additive — do not modify above) ────────────────

/** How much a user is willing to spend on the trip. */
export type BudgetLevel = "low" | "medium" | "high";

/** The role a user tends to take when travelling with a group. */
export type TravelStyle =
  | "leader"
  | "planner"
  | "follower"
  | "chill"
  | "adventurer";

/** What a user most wants to get out of the trip. */
export type TripInterest =
  | "food"
  | "scenery"
  | "adventure"
  | "shopping"
  | "nightlife"
  | "culture"
  | "relaxation"
  | "hidden_gems"
  | "flexible";

/** High-level travel vibe used to drive guided destination discovery. */
export type TravelVibe =
  | "asia"
  | "western_cities"
  | "beach_escape"
  | "nature_scenery"
  | "food_trip"
  | "culture_trip"
  | "adventure_trip"
  | "shopping_city"
  | "hidden_gems"
  | "anywhere";

/**
 * Layered pixel-avatar configuration derived from a user's character choices.
 * Each field is a key that maps to a specific inline SVG layer component.
 */
export interface AvatarConfig {
  baseBody: string;      // always "default" for MVP
  outfit: string;        // e.g. "backpacker", "casual", "luxury"
  headwear: string;      // e.g. "captain_hat", "beanie"
  handheldItem: string;  // e.g. "bubble_tea", "camera"
  accessory?: string;    // optional future layer
}

/**
 * A user's full character profile for a specific room.
 * Created via CharacterCreator and persisted to `character_profiles`.
 */
export interface CharacterProfile {
  id: string;
  userId: string;
  roomId: string;
  displayName: string;
  budgetLevel: BudgetLevel;
  travelStyle: TravelStyle;
  tripInterests: TripInterest[];
  avatarConfig: AvatarConfig;
  generatedPersonaName: string;
  planningWeights: Record<string, number>; // e.g. { food: 0.8, scenery: 0.2 }
  travelVibes?: string[];                  // destination preference vibes (JSONB)
  createdAt: string;
  updatedAt: string;
}

/** Minimal identity record derived from localStorage on the client. */
export interface Identity {
  userId: string;
  displayName: string;
}

// ─── Chatbot-first refactor types (additive — do not modify above) ───────────

/**
 * A single message in the Trip Agent conversation thread.
 *
 * Messages are append-only and session-scoped (React state only — not
 * persisted to Supabase). The thread is never cleared during a session.
 */
export interface AgentMessage {
  id: string;          // nanoid or crypto.randomUUID()
  stage: RoomStage;    // stage that produced this message
  text: string;        // ≤40 words, ≤2 sentences
  timestamp: number;   // Date.now() when appended
  type:
    | "intro"
    | "confirmation"
    | "waiting"
    | "error"
    | "system"
    // ── additive union members (Conversational Multiplayer UX) ──
    | "agent"        // authored by a named visible agent
    | "user"         // a member's own selection/message (Req 6.7)
    | "negotiation"  // Harmony facilitation surface
    | "skipped"      // adaptive-pipeline skip note (Req 7.9, 25.4)
    | "celebration"; // celebration moment note (Req 23)
  // ── additive optional fields (backward-compatible) ──
  /** Which named agent authored an "agent" message. */
  agentId?: AgentId;
  /** userId for "user" messages (Req 6.7). */
  senderId?: string;
  /** Display name for "user" messages. */
  senderName?: string;
  /** The stage that was bypassed, for "skipped" notes (Req 7.9, 25.4). */
  skippedStage?: RoomStage;
  /** The celebration kind, for "celebration" notes (Req 23). */
  celebration?: CelebrationMomentKind;
}

/**
 * Computed per-person budget estimate for the trip.
 *
 * Pure, local computation — no API calls. Produced by `computeBudgetEstimate()`
 * in `lib/budgetEstimate.ts` and passed to `TripContextPanel` / `BudgetStatusBadge`.
 * Only available when `room.selectedFlightOption` and a selected destination with
 * a `priceLevel` are both non-null.
 */
export interface BudgetEstimate {
  flightCost: number;        // flat lookup by flight category (FLIGHT_COSTS[category])
  dailyCost: number;         // destinationMultiplier × tripLengthDays × dailyCostByBudgetLevel
  totalPerPerson: number;    // flightCost + dailyCost
  status: "within" | "near" | "over";
  costDriverLine: string;    // ≤80 chars — identifies the dominant cost component
  tripLengthDays: number;    // inclusive day count (endDate − startDate + 1)
}

/**
 * Stage submission tracking for a single user in the current stage.
 *
 * Used by `WaitingState` and per-member `ReadyBadge` to distinguish between
 * users who have completed the current stage and those who have not yet submitted.
 */
export type StageSubmissionStatus = "submitted" | "pending";

// ─── Conversational Multiplayer UX types (additive — do not modify above) ────

// ── Agent identity, personality, and activity ──

/**
 * The five named agents. Only the four core ids are ever shown in the roster;
 * `feedback` (Echo) runs in the background and is excluded from the roster.
 */
export type AgentId =
  | "guide"        // Milo — guild host / onboarding / narration
  | "destination"  // Compass — explorer
  | "itinerary"    // Atlas — planner
  | "mediator"     // Harmony — facilitator
  | "feedback";    // Echo — analyst (BACKGROUND ONLY, not in roster)

/**
 * The four always-visible agents rendered in the roster (Req 2.1).
 * Echo (`feedback`) is intentionally excluded (Req 2.2).
 */
export const CORE_VISIBLE_AGENTS: AgentId[] = [
  "guide",
  "destination",
  "itinerary",
  "mediator",
];

/** Visual/working state of a single agent avatar. */
export type AgentActivityState = "idle" | "thinking" | "working" | "completed";

/** Per-character avatar animation style (Req 3.9). */
export type AgentAnimation = "wave" | "bounce" | "organize" | "nod" | "think";

/** Documented personality/appearance config for a named agent. */
export interface AgentPersonality {
  id: AgentId;
  name: string;              // "Milo" | "Compass" | "Atlas" | "Harmony" | "Echo" (Req 3.1–3.5)
  role: string;              // role description (Req 3.6)
  personality: string;       // personality descriptor (Req 3.6)
  colorHex: string;          // character color(s) (Req 3.1–3.5)
  avatarIcon: string;        // guide | compass | calendar | handshake | chart (Req 3.1–3.5)
  speakingStyle: string;     // Speaking_Style / tone (Req 3.6)
  animation: AgentAnimation; // Req 3.9
}

/**
 * Broadcast payload on room:{id}:agents; also held in client state.
 * Represents what a single agent is currently doing.
 */
export interface AgentActivity {
  agentId: AgentId;
  state: AgentActivityState;
  taskLabel: string;         // e.g. "Compass is finding destinations…"
  progressPercent?: number;  // Req 2.9 (destination generation progress)
  updatedAt: number;         // Date.now()
}

// ── Party goal ──

/** Shared trip objective selected during onboarding (Req 8.2). */
export type PartyGoal =
  | "adventure"
  | "relaxation"
  | "food"
  | "culture"
  | "luxury"
  | "mixed";

// ── Planning mode & adaptive pipeline ──

/** The onboarding quick-action the group picks as its starting point (Req 7.1). */
export type PlanningEntryPoint =
  | "unknown_destination"   // 🌍 We don't know where to go
  | "known_destination"     // 📍 We already have a destination
  | "known_dates"           // 📅 We already know our travel dates
  | "need_budget_help"      // 💰 We need help deciding our budget
  | "flights_booked"        // ✈️ We already booked flights
  | "itinerary_only"        // 🗺️ We only need itinerary planning
  | "surprise";             // 🎲 Surprise us

/**
 * The adaptive planning mode derived from the entry point (Req 7.2). Each mode
 * selects an explicit ordered subset of the existing `RoomStage` values via
 * `MODE_ACTIVE_STAGES` / `computeActiveStages(mode)`.
 */
export type PlanningMode =
  | "explore"            // Lobby → Persona → Destinations → Vote → Itinerary → Feedback
  | "destination"        // Lobby → Persona → Itinerary → Feedback
  | "trip_optimization"  // Lobby → Persona → Activities → Itinerary → Feedback
  | "group_decision";    // Lobby → Destinations → Negotiation → Vote → Itinerary

/**
 * Each mode's explicit ordered stage list (reuses existing `RoomStage` values).
 * `computeActiveStages(mode)` returns exactly the list for that mode, in this
 * order. Group Decision Mode intentionally orders Negotiation before the final
 * Vote, so the stored order follows each mode's explicit definition rather than
 * canonical `STAGE_ORDER` sequencing (Req 7.2, 7.3).
 */
export const MODE_ACTIVE_STAGES: Record<PlanningMode, RoomStage[]> = {
  explore: [
    RoomStage.LOBBY,
    RoomStage.PERSONA,
    RoomStage.DESTINATIONS,
    RoomStage.DESTINATION_VOTE,
    RoomStage.ITINERARY,
    RoomStage.FEEDBACK,
  ],
  destination: [
    RoomStage.LOBBY,
    RoomStage.PERSONA,
    RoomStage.ITINERARY,
    RoomStage.FEEDBACK,
  ],
  trip_optimization: [
    RoomStage.LOBBY,
    RoomStage.PERSONA,
    RoomStage.ACTIVITIES,
    RoomStage.ITINERARY,
    RoomStage.FEEDBACK,
  ],
  group_decision: [
    RoomStage.LOBBY,
    RoomStage.DESTINATIONS,
    RoomStage.NEGOTIATION,
    RoomStage.DESTINATION_VOTE,
    RoomStage.ITINERARY,
  ],
};

// ── Travel class, compatibility, harmony, composition ──

/** Derived persona archetype (not stored) from the three character choices. */
export type TravelClass =
  | "Foodie Boss"
  | "Scenic Wanderer"
  | "Master Planner"
  | "Chill Explorer"
  | "Luxury Traveller"
  | "Adventurer"
  | "Culture Seeker"
  | "Balanced Traveller"; // fallback

/** A pairwise compatibility score between two members. */
export interface CompatibilityScore {
  userIdA: string;
  userIdB: string;
  score: number;             // 0..100
}

/** Color band for the harmony meter (Req 10.5, 10.6). */
export type HarmonyBand = "neutral" | "red" | "yellow" | "green";

/** Overall group harmony, `null`/neutral until personas exist (Req 10.6). */
export interface HarmonyScore {
  score: number | null;      // null when no personas defined yet
  band: HarmonyBand;         // neutral when score === null
}

/** Breakdown of the party by derived travel class (Req 12). */
export interface PartyComposition {
  classCounts: Partial<Record<TravelClass, number>>;
  missingClasses: TravelClass[];       // underrepresented / essential roles absent (Req 12.1, 12.5)
  recommendations: string[];           // deterministic, positively framed (Req 12.2, 12.4)
}

// ── Travel tradeoffs (party-level; internal detection, positive user framing) ──

/** Internal tradeoff category names (never surfaced verbatim). */
export type PartyTradeoffType = "budget" | "interest" | "scheduling";

/** Lifecycle status of a detected tradeoff. */
export type PartyTradeoffStatus = "open" | "discussing" | "resolved" | "dismissed";

/**
 * Internal record produced by detectTradeoffs(); surfaced to users only as
 * positive "Travel Tradeoff" language (Req 13.4, 13.5, 13.6).
 */
export interface PartyTradeoff {
  id: string;
  roomId: string;
  tradeoffType: PartyTradeoffType;   // Req 13.4
  involvedUserIds: string[];         // ≥2 (Req 13.4)
  description: string;               // neutral internal description (Req 13.4)
  source: "auto" | "manual";         // manual host flag when detection fails (Req 13.9)
  status: PartyTradeoffStatus;
  createdAt: string;
}

/** A bounded AI-facilitated discussion over a PartyTradeoff (Req 14). */
export interface NegotiationSession {
  id: string;
  tradeoffId: string;
  roomId: string;
  round: number;                     // 1..3, escalates to group vote after 3 (Req 14.5)
  proposals: NegotiationProposal[];
  status: "active" | "escalated_to_vote" | "resolved";
}

/** A single compromise proposal within a negotiation session. */
export interface NegotiationProposal {
  id: string;
  description: string;
  tradeoffs: string;                 // Req 14.2 — explicit trade-offs, positive framing
  responses: Record<string, "accept" | "reject" | "counter">; // per involved user (Req 14.4)
}

// ── Badges (positive-only, permanent) ──

/**
 * Positive-only union — no negative badge exists (Req 15.1). ≥8 distinct
 * types (Req 15.9).
 */
export type BadgeId =
  | "early_bird"       // first to submit availability (Req 15.3)
  | "planner"          // completed persona creation (Req 15.2)
  | "peacemaker"       // helped reach a compromise (Req 15.4)
  | "flexible_friend"  // accepted a compromise reducing own preference (Req 15.5)
  | "foodie"           // foodie participation
  | "adventurer"       // adventurer participation
  | "budget_guru"      // budget participation
  | "dream_trip"       // satisfaction >90 & planning complete, no open tradeoffs (Req 15.6)
  | "host";            // room creator

/** A permanently awarded positive badge (Req 15.7). */
export interface Badge {
  id: string;
  roomId: string;
  userId: string;
  badgeId: BadgeId;
  awardedAt: string;                 // permanent once set (Req 15.7)
}

// ── Satisfaction ──

/**
 * Per-user satisfaction with a generated itinerary. Computed by Echo in the
 * background; factors in the room's partyGoal (Req 9.5, 19.1, 19.2).
 */
export interface SatisfactionScore {
  itineraryId: string;
  userId: string;
  score: number;                     // 0..100
}

// ── Internal fit scores (hidden) & destination card view ──

/**
 * Internal-only; used for ranking/reasoning, never displayed as a number
 * (Req 11.1, 11.2).
 */
export interface InternalFitScore {
  destinationFit: number;
  personaFit: number;
  confidence: number;
}

/**
 * The shape sent to the client for rendering a destination card. It
 * deliberately contains NO numeric fit score (Req 11.2, 18.4).
 */
export interface DestinationCardView {
  name: string;
  imageUrl: string;
  weather: string;
  crowdLevel: string;
  fitReasoning: string;   // qualitative prose only (Req 11.3, 18.5)
}

// ── Celebration moments ──

/** The milestone a celebration marks (Req 23.1–23.4). */
export type CelebrationMomentKind =
  | "party_ready"        // 🎉 all members ready (Req 23.1)
  | "compromise_found"   // 🏆 compromise reached (Req 23.2)
  | "destination_chosen" // ✈️ destination chosen (Req 23.3)
  | "itinerary_complete" // 🗺️ itinerary complete (Req 23.4)
  | "assembly";          // 🎊 group assembly transition (Req 5.6)

/** A non-blocking celebration overlay trigger (Req 23). */
export interface CelebrationMoment {
  kind: CelebrationMomentKind;
  durationMs: number;                // 500..2000, non-blocking (Req 23.7)
  awardBadgeId?: BadgeId;            // optional associated badge (Req 23.6)
}

// ─── ConversationTurn — chat-first UI (additive) ──────────────────────────────

/** Which named agent is speaking in this turn. */
export type SpeakingAgentId = "milo" | "compass" | "atlas" | "harmony" | "echo";

/** A widget kind that can be embedded in an agent turn. */
export type WidgetKind =
  | "character-creator"   // LOBBY / PERSONA
  | "availability"        // AVAILABILITY
  | "group-profile"       // GROUP_PROFILE — auto-generates profile then allows advance
  | "destinations"        // DESTINATIONS / DESTINATION_VOTE
  | "flights"             // FLIGHTS / FLIGHT_VOTE
  | "activities"          // ACTIVITIES
  | "itinerary"           // ITINERARY
  | "feedback"            // FEEDBACK
  | "negotiation"         // NEGOTIATION
  | "final"               // FINAL
  | "none";               // no widget — message only

export interface AgentTurn {
  id: string;
  kind: "agent";
  agentId: SpeakingAgentId;
  text: string;
  widget: WidgetKind;
  /** True once the user has interacted with this widget and it has collapsed */
  widgetDone: boolean;
  timestamp: number;
  status: "idle" | "thinking" | "streaming" | "done";
}

export interface UserTurn {
  id: string;
  kind: "user";
  userId: string;
  displayName: string;
  text: string;
  timestamp: number;
  status: "sent";
}

export interface SystemTurn {
  id: string;
  kind: "system";
  text: string;
  variant: "info" | "success" | "error" | "celebration";
  timestamp: number;
  status: "done";
}

export type ConversationTurn = AgentTurn | UserTurn | SystemTurn;

// ─── Personal & Group Phase Flow types (additive — do not modify above) ──────

/** The six personal stages users complete independently before group planning. */
export type PersonalStage =
  | "CHARACTER"
  | "BUDGET"
  | "TRAVEL_STYLE"
  | "INTERESTS"
  | "AVAILABILITY"
  | "VIBES";

/** Fixed ordering of personal stages — used to enforce sequential completion. */
export const PERSONAL_STAGE_ORDER: PersonalStage[] = [
  "CHARACTER",
  "BUDGET",
  "TRAVEL_STYLE",
  "INTERESTS",
  "AVAILABILITY",
  "VIBES",
];

/** Per-user personal progress record tracking stage completion within a room. */
export interface PersonalProgress {
  id: string;
  userId: string;
  roomId: string;
  completedStages: PersonalStage[];
  currentStage: PersonalStage;       // derived: first uncompleted stage in PERSONAL_STAGE_ORDER
  isComplete: boolean;               // true when all 6 stages are done
  updatedAt: string;
}

/** Phase the room is currently in — personal (async per-user) or group (host-controlled). */
export type RoomPhase = "personal" | "group";

/** Realtime broadcast payload for personal progress updates on room:{id} channel. */
export interface PersonalProgressEvent {
  userId: string;
  displayName: string;
  completedStage: PersonalStage;
  completedStages: PersonalStage[];
  isComplete: boolean;
}
