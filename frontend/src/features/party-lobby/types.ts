/**
 * Feature-local type definitions for the Lobby / Character Creation screen.
 *
 * Scoped to the `party-lobby` feature; MUST NOT modify the shared contract types
 * in `src/types`. `SessionCharacter` mirrors the backend request payload so a
 * future service can pass it straight through. The feature is frontend-only and
 * session-only: nothing here is persisted or sent while it remains in-memory.
 *
 * The character creation experience is an RPG-style questionnaire: the user picks
 * a budget tier, a group-trip ROLE (which drives the 8-bit character's identity),
 * trip priorities, destinations, activities, adventure funds, and
 * availability. Origin is always Singapore and is never requested from the user.
 */

// ---------------------------------------------------------------------------
// Composable layered avatar (simplified: base + role only)
// ---------------------------------------------------------------------------

/** The named slots that make up the composable 8-bit character, back to front. */
export type SpriteLayerSlot = "base" | "role";

/** A single stacked visual layer for the composable avatar. */
export interface SpriteLayer {
  slot: SpriteLayerSlot;
  /** Z-order; lower renders behind higher. */
  order: number;
  /** Asset key resolved to a pixel visual by the renderer. */
  assetKey: string;
}

/** A single entry in the data-driven layer map (selection id -> contributed layer). */
export interface LayerMapEntry {
  slot: SpriteLayerSlot;
  order: number;
  assetKey: string;
}

/** Data-driven mapping: for each slot, selection id -> the layer it contributes. */
export type LayerMap = Readonly<
  Record<SpriteLayerSlot, Readonly<Record<string, LayerMapEntry>>>
>;

// ---------------------------------------------------------------------------
// Preference enums
// ---------------------------------------------------------------------------

/** Budget tier chosen in step 1 (coarse preference, not an exact amount). */
export type BudgetTier = "low" | "medium" | "high";

/** The group-trip role chosen in step 2; drives the character's visual identity. */
export type GroupRole =
  | "leader"
  | "planner"
  | "follower"
  | "chill"
  | "adventurer";

// ---------------------------------------------------------------------------
// Character draft (in-memory, not-yet-saved selection set)
// ---------------------------------------------------------------------------

/** A single availability range as ISO 8601 date strings. */
export interface DateRange {
  start: string; // ISO 8601 (YYYY-MM-DD)
  end: string; // ISO 8601 (YYYY-MM-DD)
}

/** The in-memory, not-yet-saved selection set driving the left panel. */
export interface CharacterDraft {
  /** Step 1 — coarse budget tier. */
  budgetTier: BudgetTier | null;
  /** Step 2 — group-trip role; the primary personality/archetype input. */
  groupRole: GroupRole | null;
  /** Step 3 — what the user wants most from the trip (multi-select). */
  tripPriorities: readonly string[];
  /** Destination preferences (multi-select). */
  destinations: readonly string[];
  /** Activities (multi-select tags). */
  activities: readonly string[];
  /** Raw adventure-funds input text; parsed to a number for the model. */
  budgetText: string;
  /** One or more availability ranges; UI starts with a single range. */
  availableDates: readonly DateRange[];
}

// ---------------------------------------------------------------------------
// Session character (saved, session-only; payload-shaped)
// ---------------------------------------------------------------------------

/** The fixed departure origin for every user (never requested). */
export const FIXED_ORIGIN = "SIN";

/**
 * The saved, session-only character. Shaped for the trip-planning backend. The
 * character's visual identity is captured by `groupRole` + a derived `spriteKey`;
 * travel preferences are structured data, not encoded on the sprite.
 */
export interface SessionCharacter {
  /** Always "SIN" — all users depart from Singapore. */
  origin: string;
  budgetTier: BudgetTier;
  groupRole: GroupRole;
  tripPriorities: readonly string[];
  destinations: readonly string[];
  activities: readonly string[];
  budget: number | null;
  availableDates: readonly DateRange[];
  character: {
    /** Sprite key derived from the group role (e.g. "role-leader"). */
    spriteKey: string;
  };
}

// ---------------------------------------------------------------------------
// Sidebar view models
// ---------------------------------------------------------------------------

/** A single party member as shown in the adventure sidebar. */
export interface PartyMemberView {
  id: string;
  displayName: string;
  /** A short role/label line under the name. */
  archetypeLabel: string;
  spriteKey: string;
  /** The party role the member chose for their character, when they have one. */
  groupRole?: GroupRole | null;
  /** True for the member who started the party. */
  isHost?: boolean;
  /** True once the member has finished the party's current step. */
  ready?: boolean;
}

/** The derived budget readout for the budget panel. */
export interface BudgetView {
  limit: number;
  estimated: number;
  remaining: number; // limit - estimated (may be negative)
  isOverBudget: boolean; // estimated > limit
  overageAmount: number; // max(0, estimated - limit)
}

/** The full adventure sidebar view model. */
export interface AdventureView {
  tripName: string;
  dateRangeLabel: string;
  members: readonly PartyMemberView[];
  capacity: number;
  budget: BudgetView;
}
