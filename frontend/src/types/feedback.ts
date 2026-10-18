/**
 * Feedback & refinement shapes.
 *
 * Mirrors the "Feedback & Refinement (REFINE)" contract in
 * `api-contracts.md`. `FeedbackInput` is what the party submits; `Feedback`
 * is the persisted entry with an id and status.
 */

/** The feedback a party member submits against an itinerary version. */
export interface FeedbackInput {
  tripId: string;
  itineraryVersionId: string;
  memberId: string;
  /** At least a day or item id is required by the backend. */
  target: { day?: number; itemId?: string; section?: string };
  comment: string;
}

/** A persisted feedback entry. */
export interface Feedback extends FeedbackInput {
  id: string;
  status: "open" | "addressed";
}
