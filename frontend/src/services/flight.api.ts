/**
 * Flight service — real (backend-backed) implementation (LOGISTICS stage).
 *
 * Same boundary as the destination service: writes through FastAPI, reads and
 * live updates through `stage.shared.ts` for the "flight" category.
 */
import { getApiClient } from "@/lib/apiClient";
import type { Unsubscribe } from "@/types";

import type { BreakTieInput } from "./destination.contract";
import type {
  CastFlightVoteInput,
  FlightService,
  LogisticsState,
  StartLogisticsInput,
} from "./flight.contract";
import { subscribeStage, type StageSnapshot } from "./stage.shared";

/** Map the shared stage snapshot onto the LOGISTICS screen's state. */
export function toLogisticsState(snapshot: StageSnapshot): LogisticsState {
  return {
    loading: snapshot.loading,
    options: snapshot.options,
    selectedFlight: snapshot.selected
      ? { id: snapshot.selected.id, title: snapshot.selected.title }
      : null,
    vote: snapshot.vote,
    tiePending: snapshot.tiePending,
    tiebreak: snapshot.tiebreak,
    guideNote: snapshot.guideNote,
  };
}

class FlightApiService implements FlightService {
  async startLogistics(input: StartLogisticsInput): Promise<void> {
    await getApiClient().post(`/trips/${input.tripId}/runs`, {
      runType: "logistics",
      memberId: input.memberId,
      // Stable key reuses the run on reload; a retry needs a fresh key.
      idempotencyKey: input.retry
        ? `logistics-${input.tripId}-retry-${Date.now()}`
        : `logistics-${input.tripId}`,
    });
  }

  subscribeLogistics(
    roomId: string,
    onChange: (state: LogisticsState) => void,
  ): Unsubscribe {
    return subscribeStage(roomId, "flight", (snapshot) =>
      onChange(toLogisticsState(snapshot)),
    );
  }

  async castVote(input: CastFlightVoteInput): Promise<void> {
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
}

export const flightApiService: FlightService = new FlightApiService();
