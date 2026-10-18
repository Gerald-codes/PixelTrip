/**
 * Pure draft-projection logic for the Lobby / Character Creation screen.
 *
 * Frontend-only and session-only: no I/O, no persistence, no network. Every
 * function is a pure, deterministic projection over the in-memory
 * {@link CharacterDraft}.
 *
 * - {@link canSave} decides whether the draft is complete enough to save.
 * - {@link availabilityIssue} says what is wrong with the free periods, if anything.
 * - {@link deriveSpriteKey} derives the character's sprite key from its role.
 * - {@link toSessionCharacter} projects a complete draft into the payload-shaped
 *   {@link SessionCharacter} (the single projection seam `save()` relies on).
 */
import {
  FIXED_ORIGIN,
  type CharacterDraft,
  type GroupRole,
  type SessionCharacter,
} from "@/features/party-lobby/types";

/**
 * What is wrong with the draft's free periods, as a message for the member, or
 * `null` when they can be saved.
 *
 * A period with a first day but no last day is half-picked and blocks the save:
 * sending it would fail the backend's date validation. Periods left entirely
 * blank are ignored, but at least one must be complete, because the guide picks
 * trip dates from where the party's free periods overlap.
 */
export function availabilityIssue(draft: CharacterDraft): string | null {
  const halfPicked = draft.availableDates.findIndex(
    (range) => Boolean(range.start) !== Boolean(range.end),
  );
  if (halfPicked !== -1) {
    return draft.availableDates.length > 1
      ? `Pick the last day of free period ${halfPicked + 1}, or remove it.`
      : "Pick the last day of your free period.";
  }
  if (!draft.availableDates.some((range) => range.start && range.end)) {
    return "Pick the dates you are free to travel.";
  }
  return null;
}

/**
 * Whether the draft holds the minimum selections required to save.
 *
 * A character is saveable once the two identity-defining single-selects are made
 * (a budget tier and a group role) and its free periods are complete (see
 * {@link availabilityIssue}). Multi-select preferences are optional.
 */
export function canSave(draft: CharacterDraft): boolean {
  return (
    draft.budgetTier !== null &&
    draft.groupRole !== null &&
    availabilityIssue(draft) === null
  );
}

/**
 * Derive the deterministic sprite key from the group role, e.g. "role-leader".
 * Falls back to "role-traveller" when no role is set.
 */
export function deriveSpriteKey(role: GroupRole | null): string {
  return role ? `role-${role}` : "role-traveller";
}

/**
 * Parse raw adventure-funds text into a non-negative number, or `null`.
 * Empty / whitespace / non-finite / negative inputs resolve to `null`.
 */
function parseBudget(budgetText: string): number | null {
  const trimmed = budgetText.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Project a complete draft into the payload-shaped {@link SessionCharacter}.
 * Returns `null` when the draft is not saveable (see {@link canSave}). Origin is
 * always Singapore. Pure: no I/O, no storage, no fetch.
 */
export function toSessionCharacter(
  draft: CharacterDraft,
): SessionCharacter | null {
  if (!canSave(draft)) {
    return null;
  }

  // Guaranteed non-null by `canSave`.
  const budgetTier = draft.budgetTier!;
  const groupRole = draft.groupRole!;

  return {
    origin: FIXED_ORIGIN,
    budgetTier,
    groupRole,
    tripPriorities: draft.tripPriorities,
    destinations: draft.destinations,
    activities: draft.activities,
    budget: parseBudget(draft.budgetText),
    // Blank periods (an unused extra period) are not sent.
    availableDates: draft.availableDates.filter((range) => range.start && range.end),
    character: {
      spriteKey: deriveSpriteKey(groupRole),
    },
  };
}
