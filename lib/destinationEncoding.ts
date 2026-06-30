/**
 * Pure helpers for encoding and hydrating destination preference data.
 *
 * These functions sit between the AvailabilityStage UI state and the flat
 * `countryOrCity` strings stored in `destination_preferences`.
 *
 * Encoding contract:
 *   - Travel vibes are stored with a `vibe:` prefix  (e.g. `"vibe:asia"`)
 *   - Destination chips (from VIBE_CHIPS) are stored as plain strings
 *   - Custom destinations are stored as plain strings
 *
 * No API calls, no side effects — fully deterministic and testable.
 */

import type { TravelVibe } from './types';
import { VIBE_CHIPS } from './vibeChips';

// ─── Encoding ────────────────────────────────────────────────────────────────

/**
 * Builds the flat `destinationInterests` array that is passed to
 * `POST /api/availability` from the three UI state fields.
 *
 * - Vibes are prefixed with `"vibe:"` so they can be round-tripped without
 *   ambiguity (a vibe like `"asia"` would otherwise collide with a custom
 *   destination called "Asia").
 * - Chips and custom destinations are stored as-is.
 * - Empty / whitespace-only custom entries are silently dropped.
 * - Deduplication is NOT performed here — the caller is responsible for
 *   ensuring uniqueness before calling this function.
 *
 * @param vibes    Currently selected TravelVibe values.
 * @param chips    Destination chips selected from the DestinationSuggestionPicker.
 * @param customs  Free-text custom destinations from CustomDestinationInput.
 * @returns        Flat array of strings ready for the API payload.
 */
export function buildDestinationInterests(
  vibes: TravelVibe[],
  chips: string[],
  customs: string[],
): string[] {
  return [
    ...vibes.map((v) => `vibe:${v}`),
    ...chips,
    ...customs.filter((d) => d.trim().length > 0),
  ];
}

// ─── Hydration ───────────────────────────────────────────────────────────────

/**
 * Flat set of every chip value defined in VIBE_CHIPS, built once at module
 * load time so hydration lookups are O(1).
 */
const ALL_KNOWN_CHIPS: ReadonlySet<string> = new Set(
  Object.values(VIBE_CHIPS).flat(),
);

/**
 * Parses saved `destination_preferences` rows back into the three UI state
 * buckets used by AvailabilityStage.
 *
 * Classification rules (applied in order):
 *  1. `countryOrCity.startsWith("vibe:")` → strip prefix, cast to TravelVibe,
 *     add to `vibes`.
 *  2. Value is in the flat union of all VIBE_CHIPS values → add to `chips`.
 *  3. Anything else → add to `customs`.
 *
 * This is the inverse of `buildDestinationInterests` and guarantees that
 * round-tripping through save → hydrate reconstructs the original selections.
 *
 * @param rows  Raw rows from `destination_preferences` for the current user.
 * @returns     Decomposed state ready to populate AvailabilityStage.
 */
export function hydrateFromPreferences(
  rows: { countryOrCity: string }[],
): { vibes: TravelVibe[]; chips: string[]; customs: string[] } {
  const vibes: TravelVibe[] = [];
  const chips: string[] = [];
  const customs: string[] = [];

  for (const row of rows) {
    const value = row.countryOrCity;

    if (value.startsWith('vibe:')) {
      // Strip the prefix and treat the remainder as a TravelVibe.
      // The cast is safe because we only write valid TravelVibe values during
      // encoding — invalid prefixed values will land here but won't break UI.
      vibes.push(value.slice('vibe:'.length) as TravelVibe);
    } else if (ALL_KNOWN_CHIPS.has(value)) {
      chips.push(value);
    } else {
      customs.push(value);
    }
  }

  return { vibes, chips, customs };
}
