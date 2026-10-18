/**
 * Travel preferences shape.
 *
 * Mirrors the "Travel preferences" shape in `api-contracts.md`. Preferences
 * belong to a room member (so the same person can differ per trip). List fields
 * are empty arrays for a new member. Element shapes are not fixed by the
 * contract yet, so they are typed as `unknown` (never `any`).
 */
export interface TravelPreferences {
  id: string;
  memberId: string;
  /** ISO 8601 date strings. */
  availableDates: string[];
  destinations: unknown[];
  travelStyle: string | null;
  /** Non-negative amount, or `null` when not set. */
  budget: number | null;
  interests: unknown[];
  activities: unknown[];
  hardConstraints: unknown[];
  /** When the member first saved; `null`/absent until then. */
  submittedAt?: string | null;
}
