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
  /**
   * User's own rough per-person cost estimate in USD for this item, if they
   * provided one. Optional — null when not supplied. Feeds the running
   * budget bar in TripContextPanel alongside flight + itinerary item costs.
   */
  estimatedCost: number | null;
}

/** A single item scheduled within a part of a day. */
export interface ItineraryItem {
  title: string;
  description: string;
  type: string;
  personaBenefits: string[]; // persona names who benefit
  reason: string;
  /**
   * Estimated per-person cost in USD for this item, as assigned by the
   * itinerary agent. 0 for free items (e.g. a scenic walk). Required so the
   * running budget bar can sum costs across the whole itinerary.
   */
  estimatedCost: number;
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
  type: "intro" | "confirmation" | "waiting" | "error" | "system";
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
  budgetLimitPerPerson: number; // BUDGET_THRESHOLDS for the most conservative budget level
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
