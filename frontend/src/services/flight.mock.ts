/**
 * Flight service — mock (in-memory) implementation for `NEXT_PUBLIC_SERVICE_MODE=mock`.
 * Serves two stand-in flights and an open vote; actions are no-ops.
 */
import type { Unsubscribe } from "@/types";

import type {
  FlightOption,
  FlightService,
  LogisticsState,
} from "./flight.contract";

export const MOCK_FLIGHTS: FlightOption[] = [
  {
    id: "f1",
    title: "Scoot TR808",
    description: "SIN to NRT, 1 stop, 8h 00m, SGD 600.",
    meta: {
      carrier: "Scoot",
      flight_number: "TR808",
      origin: "SIN",
      destination: "NRT",
      depart_at: "2026-12-20T01:00:00",
      arrive_at: "2026-12-20T09:00:00",
      return_at: "2026-12-27T10:30:00",
      price: 600,
      duration_minutes: 480,
      stops: 1,
      score: 72,
      whyThisFits: "The cheapest option for the party.",
      tags: ["SGD 600", "Scoot", "8h 00m", "1 stop"],
      tradeOff: "1 stop where other options fly with fewer.",
      details:
        "Scoot TR808, SIN to NRT. Departs 2026-12-20T01:00:00. SGD 600 per person, round trip.",
    },
  },
  {
    id: "f2",
    title: "Singapore Airlines SQ12",
    description: "SIN to NRT, direct, 6h 45m, SGD 980.",
    meta: {
      carrier: "Singapore Airlines",
      flight_number: "SQ12",
      origin: "SIN",
      destination: "NRT",
      depart_at: "2026-12-20T09:05:00",
      arrive_at: "2026-12-20T17:05:00",
      return_at: "2026-12-27T10:30:00",
      price: 980,
      duration_minutes: 405,
      stops: 0,
      score: 65,
      whyThisFits: "The quickest journey and a direct flight for the party.",
      tags: ["SGD 980", "Singapore Airlines", "6h 45m", "Direct"],
      tradeOff: "SGD 380 more than the cheapest option.",
    },
  },
];

const MOCK_STATE: LogisticsState = {
  loading: false,
  options: MOCK_FLIGHTS,
  selectedFlight: null,
  vote: {
    voteSessionId: "mock-flight-vote",
    question: "Which flight suits the party best?",
    status: "open",
    options: MOCK_FLIGHTS.map((f) => ({ id: f.id, label: f.title, count: 0 })),
  },
  tiePending: false,
  tiebreak: null,
  guideNote: null,
};

export class MockFlightService implements FlightService {
  async startLogistics(): Promise<void> {}

  subscribeLogistics(
    _roomId: string,
    onChange: (state: LogisticsState) => void,
  ): Unsubscribe {
    onChange(MOCK_STATE);
    return () => {};
  }

  async castVote(): Promise<void> {}

  async breakTie(): Promise<void> {}
}
