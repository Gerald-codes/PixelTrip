/**
 * Preferences service — real (backend-backed) implementation.
 *
 * `savePreferences` is a mutation, so it goes through FastAPI:
 * `PUT /rooms/{roomCode}/members/{memberId}/preferences` (see "HTTP API" in
 * `api-contracts.md`). The request/response bodies are camelCase JSON. Failures
 * surface as `ApiError`.
 */
import { getApiClient } from "@/lib/apiClient";

import type {
  PreferencesService,
  SavePreferencesInput,
  SavePreferencesResult,
} from "./preferences.contract";

class PreferencesApiService implements PreferencesService {
  savePreferences(input: SavePreferencesInput): Promise<SavePreferencesResult> {
    const roomCode = input.roomCode.trim().toUpperCase();
    const path = `/rooms/${encodeURIComponent(roomCode)}/members/${encodeURIComponent(
      input.memberId,
    )}/preferences`;

    // Send the full preference set (anything omitted saves empty server-side).
    const body: Record<string, unknown> = {
      availableDates: input.availableDates,
      destinations: input.destinations,
      travelStyle: input.travelStyle,
      budget: input.budget,
      interests: input.interests,
      activities: input.activities,
      hardConstraints: input.hardConstraints,
      origin: input.origin,
    };
    if (input.character !== undefined) {
      body.character = {
        appearance: input.character.appearance,
        spriteKey: input.character.spriteKey,
      };
    }

    return getApiClient().put<SavePreferencesResult>(path, body);
  }
}

/** Singleton real Preferences service. */
export const preferencesApiService: PreferencesService =
  new PreferencesApiService();
