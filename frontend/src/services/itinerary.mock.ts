/**
 * Mock itinerary service.
 *
 * In-memory implementation of {@link ItineraryService} returning
 * contract-shaped fixture data (no Supabase/FastAPI access). Lookups resolve
 * from fixtures or `null`; `submitFeedback` echoes the input into a persisted
 * `Feedback` fixture; `approve` resolves with no value; `export` returns a
 * shareable payload fixture.
 */
import type {
  ExportPayload,
  Feedback,
  FeedbackInput,
  ItineraryVersion,
} from "@/types";
import {
  mockCurrentVersionByTripId,
  mockCurrentVersion,
  mockExportPayload,
  mockFeedback,
  mockItineraryVersions,
} from "@/mocks";
import type {
  ApproveInput,
  ItineraryService,
  ReviewInput,
} from "./itinerary.contract";

export class MockItineraryService implements ItineraryService {
  async getCurrent(tripId: string): Promise<ItineraryVersion | null> {
    return Promise.resolve(mockCurrentVersionByTripId[tripId] ?? null);
  }

  async listVersions(tripId: string): Promise<ItineraryVersion[]> {
    return Promise.resolve(
      mockItineraryVersions.filter(
        (version) => version.itinerary.tripId === tripId,
      ),
    );
  }

  async submitFeedback(input: FeedbackInput): Promise<Feedback> {
    const feedback: Feedback = {
      id: crypto.randomUUID(),
      tripId: input.tripId,
      itineraryVersionId: input.itineraryVersionId,
      memberId: input.memberId,
      target: input.target,
      comment: input.comment,
      status: mockFeedback.status,
    };
    return Promise.resolve(feedback);
  }

  async review(input: ReviewInput) {
    const version = await this.getCurrent(input.tripId);
    return {
      version: version ?? mockCurrentVersion,
      allReady: input.decision === "approve",
      needsRefinement: false,
    };
  }

  async approve(_input: ApproveInput): Promise<void> {
    // Contract-shaped no-op: a real implementation locks the version and
    // advances toward WRAP. The mock simply acknowledges.
    return Promise.resolve();
  }

  async export(tripId: string): Promise<ExportPayload> {
    return Promise.resolve({ ...mockExportPayload, tripId });
  }
}
