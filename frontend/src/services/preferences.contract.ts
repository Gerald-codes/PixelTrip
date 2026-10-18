/**
 * Preferences service contract.
 *
 * Typed method signatures only — behaviour comes from the mock
 * (`preferences.mock.ts`) or real (`preferences.api.ts`) implementation. Shapes
 * mirror the `PUT /rooms/{roomCode}/members/{memberId}/preferences` endpoint in
 * `api-contracts.md` (the single source of truth). Wire fields are camelCase.
 *
 * This saves a member's full travel-preference set and, optionally, their pixel
 * character, in one call. Preference fields are always sent in full (anything
 * omitted is saved empty); `character` is optional (omit to leave it unchanged).
 */
import type { Character, TravelPreferences } from "@/types";

/** An inclusive date range the member can travel (`YYYY-MM-DD`, end >= start). */
export interface PreferenceDateRange {
  start: string;
  end: string;
}

/** The pixel character to save alongside preferences. */
export interface CharacterInput {
  /** Free-form choices from the character creator (up to 50 keys). */
  appearance: Record<string, unknown>;
  /** Which sprite to draw, or null for the default. */
  spriteKey: string | null;
}

/** The full request body for saving a member's preferences + character. */
export interface SavePreferencesInput {
  /** Room code (4–12 uppercase letters/digits). */
  roomCode: string;
  /** The member whose preferences are being saved. */
  memberId: string;
  availableDates: readonly PreferenceDateRange[];
  destinations: readonly string[];
  travelStyle: string | null;
  budget: number | null;
  interests: readonly string[];
  activities: readonly unknown[];
  hardConstraints: readonly string[];
  /** Departure city/IATA code. Do NOT also send it inside hardConstraints. */
  origin: string | null;
  /** Optional: replaces the member's character when present. */
  character?: CharacterInput;
}

/**
 * The saved preferences + character + the (possibly advanced) trip. The trip is
 * passed through from the backend untyped (the frontend has no `Trip` type yet
 * and the save flow does not read its fields).
 */
export interface SavePreferencesResult {
  travelPreferences: TravelPreferences;
  character: Character | null;
  trip: unknown;
}

export interface PreferencesService {
  savePreferences(input: SavePreferencesInput): Promise<SavePreferencesResult>;
}
