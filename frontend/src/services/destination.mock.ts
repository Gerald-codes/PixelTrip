/**
 * Destination service — mock (in-memory) implementation.
 *
 * Lets the DISCOVER screen render in `NEXT_PUBLIC_SERVICE_MODE=mock` without a
 * backend: it serves the feature-local mock destination options and an open vote,
 * and `castVote` is a no-op. The real flow (AI run + Realtime) lives in
 * `destination.api.ts`.
 */
import type { Unsubscribe } from "@/types";

import { MOCK_DESTINATION_OPTIONS } from "../features/party-lobby/lib/destinationMocks";
import type {
  BreakTieInput,
  CastDestinationVoteInput,
  DestinationService,
  DiscoverState,
  StartDiscoveryInput,
} from "./destination.contract";

const MOCK_STATE: DiscoverState = {
  loading: false,
  options: MOCK_DESTINATION_OPTIONS.map((o) => ({
    id: o.id,
    title: o.label,
    description: o.description,
  })),
  selectedDestination: null,
  vote: {
    voteSessionId: "mock-destination-vote",
    question: "Where shall the party go?",
    status: "open",
    options: MOCK_DESTINATION_OPTIONS.map((o) => ({
      id: o.id,
      label: o.label,
      count: 0,
    })),
  },
  tiePending: false,
  tiebreak: null,
};

export class MockDestinationService implements DestinationService {
  async getTripId(_roomId: string): Promise<string | null> {
    return "mock-trip";
  }

  async startDiscovery(_input: StartDiscoveryInput): Promise<void> {
    return Promise.resolve();
  }

  async castVote(_input: CastDestinationVoteInput): Promise<void> {
    return Promise.resolve();
  }

  async breakTie(_input: BreakTieInput): Promise<void> {
    return Promise.resolve();
  }

  subscribeDiscover(
    _roomId: string,
    onChange: (state: DiscoverState) => void,
  ): Unsubscribe {
    onChange(MOCK_STATE);
    return () => {
      // no-op
    };
  }
}
