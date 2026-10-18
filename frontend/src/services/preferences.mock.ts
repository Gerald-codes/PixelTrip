/**
 * Preferences service — mock (in-memory) implementation.
 *
 * Returns a contract-shaped {@link SavePreferencesResult} without any backend
 * call, so the UI can be developed in `NEXT_PUBLIC_SERVICE_MODE=mock`. It simply
 * echoes the submitted preferences/character back as the "saved" records and
 * reports the trip at the `preferences_collected` stage.
 */
import type { Character, TravelPreferences } from "@/types";

import type {
  PreferencesService,
  SavePreferencesInput,
  SavePreferencesResult,
} from "./preferences.contract";

export class MockPreferencesService implements PreferencesService {
  async savePreferences(
    input: SavePreferencesInput,
  ): Promise<SavePreferencesResult> {
    const travelPreferences: TravelPreferences = {
      id: `mock-prefs-${input.memberId}`,
      memberId: input.memberId,
      // The shared frontend type models availableDates as flat ISO strings; keep
      // the range boundaries as a simple string list for the mock echo.
      availableDates: input.availableDates.flatMap((r) => [r.start, r.end]),
      destinations: [...input.destinations],
      travelStyle: input.travelStyle,
      budget: input.budget,
      interests: [...input.interests],
      activities: [...input.activities],
      hardConstraints: [...input.hardConstraints],
    };

    const character: Character | null = input.character
      ? {
          id: `mock-character-${input.memberId}`,
          memberId: input.memberId,
          appearance: { ...input.character.appearance },
          spriteKey: input.character.spriteKey,
        }
      : null;

    const trip: unknown = {
      id: `mock-trip-${input.roomCode}`,
      status: "preferences_collected",
    };

    return { travelPreferences, character, trip };
  }
}
