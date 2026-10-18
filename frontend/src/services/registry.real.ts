/**
 * Real service registry builder.
 *
 * Wires the `*.api.ts` placeholder implementations into a
 * {@link ServiceRegistry}. Selected by {@link getServices} in `index.ts` when
 * `NEXT_PUBLIC_SERVICE_MODE=real`.
 *
 * Building the registry is side-effect free: constructing it does not touch
 * Supabase/FastAPI. Each service method throws `NotImplementedError` only when
 * actually invoked (Foundation phase) — so integration gaps surface as explicit
 * errors rather than silent failures. Run frontend development with
 * `NEXT_PUBLIC_SERVICE_MODE=mock`.
 */
import type { ServiceRegistry } from "./index";
import { guestApiService } from "./guest.api";
import { roomApiService } from "./room.api";
import { chatApiService } from "./chat.api";
import { voteApiService } from "./vote.api";
import { itineraryApiService } from "./itinerary.api";
import { preferencesApiService } from "./preferences.api";
import { destinationApiService } from "./destination.api";
import { budgetApiService } from "./budget.api";
import { flightApiService } from "./flight.api";
import { runApiService } from "./run.api";
import { selectionApiService } from "./selection.api";
import { tripDatesApiService } from "./tripDates.api";

export function buildRealRegistry(): ServiceRegistry {
  return {
    guest: guestApiService,
    room: roomApiService,
    chat: chatApiService,
    vote: voteApiService,
    itinerary: itineraryApiService,
    preferences: preferencesApiService,
    destination: destinationApiService,
    budget: budgetApiService,
    flight: flightApiService,
    run: runApiService,
    selection: selectionApiService,
    tripDates: tripDatesApiService,
  };
}
