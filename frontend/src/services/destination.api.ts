/**
 * Destination service — real (backend-backed) implementation (DISCOVER stage).
 *
 * Follows the Supabase access boundary: writes (start run, cast vote, break tie)
 * go through FastAPI; the reads of `messages`, `vote_sessions`, `votes` and
 * `selections` are anon-key reads with Realtime for live updates, shared with the
 * flight stage through `stage.shared.ts`. Failures surface as `ApiError`.
 */
import { getApiClient } from "@/lib/apiClient";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { Unsubscribe } from "@/types";

import type {
  BreakTieInput,
  CastDestinationVoteInput,
  DestinationService,
  DiscoverState,
  StartDiscoveryInput,
} from "./destination.contract";
import { readError, subscribeStage, type StageSnapshot } from "./stage.shared";

/** Map the shared stage snapshot onto the DISCOVER screen's state. */
export function toDiscoverState(snapshot: StageSnapshot): DiscoverState {
  return {
    loading: snapshot.loading,
    options: snapshot.options,
    selectedDestination: snapshot.selected
      ? { id: snapshot.selected.id, title: snapshot.selected.title }
      : null,
    vote: snapshot.vote,
    tiePending: snapshot.tiePending,
    tiebreak: snapshot.tiebreak,
    guideNote: snapshot.guideNote,
  };
}

class DestinationApiService implements DestinationService {
  async getTripId(roomId: string): Promise<string | null> {
    const { data, error } = await getSupabaseClient()
      .from("trips")
      .select("id")
      .eq("room_id", roomId)
      .maybeSingle<{ id: string }>();
    if (error) throw readError("trips");
    return data?.id ?? null;
  }

  async startDiscovery(input: StartDiscoveryInput): Promise<void> {
    await getApiClient().post(`/trips/${input.tripId}/runs`, {
      runType: "discovery",
      memberId: input.memberId,
      // A stable key so repeated page loads reuse the same run; a retry needs a
      // fresh key, because the backend returns the earlier (failed) run for a
      // key it has already seen.
      idempotencyKey: input.retry
        ? `discovery-${input.tripId}-retry-${Date.now()}`
        : `discovery-${input.tripId}`,
    });
  }

  async castVote(input: CastDestinationVoteInput): Promise<void> {
    await getApiClient().post(`/votes/${input.voteSessionId}/cast`, {
      memberId: input.memberId,
      optionId: input.optionId,
    });
  }

  async breakTie(input: BreakTieInput): Promise<void> {
    await getApiClient().post(`/votes/${input.voteSessionId}/break-tie`, {
      memberId: input.memberId,
      optionId: input.optionId,
    });
  }

  subscribeDiscover(
    roomId: string,
    onChange: (state: DiscoverState) => void,
  ): Unsubscribe {
    return subscribeStage(roomId, "destination", (snapshot) =>
      onChange(toDiscoverState(snapshot)),
    );
  }
}

export const destinationApiService: DestinationService =
  new DestinationApiService();
