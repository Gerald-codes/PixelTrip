/**
 * Mock service registry builder.
 *
 * Wires the in-memory `*.mock.ts` implementations into a fully-populated
 * {@link ServiceRegistry}. Selected exclusively by {@link getServices} in
 * `index.ts` when `NEXT_PUBLIC_SERVICE_MODE` resolves to `"mock"` (the
 * default). Every service returns contract-shaped fixture data backed by
 * `src/mocks`; no Supabase/FastAPI access occurs here.
 */
import type { ServiceRegistry } from "./index";

import { MockGuestService } from "./guest.mock";
import { MockRoomService } from "./room.mock";
import { MockChatService } from "./chat.mock";
import { MockVoteService } from "./vote.mock";
import { MockItineraryService } from "./itinerary.mock";
import { MockPreferencesService } from "./preferences.mock";
import { MockDestinationService } from "./destination.mock";
import { MockBudgetService } from "./budget.mock";
import { MockFlightService } from "./flight.mock";
import { MockRunService } from "./run.mock";
import { MockSelectionService } from "./selection.mock";
import { MockTripDatesService } from "./tripDates.mock";

export function buildMockRegistry(): ServiceRegistry {
  return {
    guest: new MockGuestService(),
    room: new MockRoomService(),
    chat: new MockChatService(),
    vote: new MockVoteService(),
    itinerary: new MockItineraryService(),
    preferences: new MockPreferencesService(),
    destination: new MockDestinationService(),
    budget: new MockBudgetService(),
    flight: new MockFlightService(),
    run: new MockRunService(),
    selection: new MockSelectionService(),
    tripDates: new MockTripDatesService(),
  };
}
