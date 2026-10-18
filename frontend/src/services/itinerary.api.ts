/** Itinerary service — real (backend-backed) implementation. */
import { getApiClient } from "@/lib/apiClient";
import type {
  ExportPayload,
  Feedback,
  FeedbackInput,
  ItineraryVersion,
} from "@/types";
import type {
  ApproveInput,
  ItineraryService,
  ReviewInput,
  ReviewResult,
} from "./itinerary.contract";

interface ApiItineraryVersion {
  id?: string;
  trip_id?: string;
  tripId?: string;
  version: number;
  source: "build" | "refine";
  status: "proposed" | "approved" | "rejected" | "superseded";
  itinerary: ItineraryVersion["itinerary"];
  change_summary?: string | null;
  changeSummary?: string | null;
}

function mapVersion(version: ApiItineraryVersion): ItineraryVersion {
  return {
    id: version.id,
    version: version.version,
    source: version.source,
    isCurrent: version.status === "proposed" || version.status === "approved",
    status: version.status,
    itinerary: version.itinerary,
    changeSummary: version.change_summary ?? version.changeSummary ?? undefined,
  };
}

class ItineraryApiService implements ItineraryService {
  async getCurrent(tripId: string): Promise<ItineraryVersion | null> {
    const versions = await this.listVersions(tripId);
    return (
      versions
        .filter((version) => version.isCurrent)
        .sort((left, right) => right.version - left.version)[0] ??
      versions.sort((left, right) => right.version - left.version)[0] ??
      null
    );
  }

  async listVersions(tripId: string): Promise<ItineraryVersion[]> {
    const versions = await getApiClient().get<ApiItineraryVersion[]>(
      `/trips/${encodeURIComponent(tripId)}/itinerary/versions`,
    );
    return versions.map(mapVersion);
  }

  async submitFeedback(input: FeedbackInput): Promise<Feedback> {
    const response = await getApiClient().post<{ feedback: Feedback }>(
      `/trips/${encodeURIComponent(input.tripId)}/feedback`,
      {
        memberId: input.memberId,
        itineraryVersionId: input.itineraryVersionId,
        target: input.target,
        comment: input.comment,
      },
    );
    return response.feedback;
  }

  async review(input: ReviewInput): Promise<ReviewResult> {
    const response = await getApiClient().post<{
      version: ApiItineraryVersion;
      all_ready?: boolean;
      allReady?: boolean;
      needs_refinement?: boolean;
      needsRefinement?: boolean;
    }>(
      `/trips/${encodeURIComponent(input.tripId)}/itinerary/versions/${encodeURIComponent(input.versionId)}/review`,
      { memberId: input.memberId, decision: input.decision },
    );
    return {
      version: mapVersion(response.version),
      allReady: response.all_ready ?? response.allReady === true,
      needsRefinement: response.needs_refinement ?? response.needsRefinement === true,
    };
  }

  async approve(input: ApproveInput): Promise<void> {
    await this.review({ ...input, decision: "approve" });
  }

  export(_tripId: string): Promise<ExportPayload> {
    throw new Error("Export is not part of the BUILD stage yet.");
  }
}

/** Singleton real Itinerary service. */
export const itineraryApiService: ItineraryService = new ItineraryApiService();
