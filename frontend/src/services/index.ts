/**
 * Service selector — the single switch point for the service layer.
 *
 * This module is the ONLY place a concrete Mock or Real implementation is
 * chosen. UI (components, hooks, features) imports the service interfaces and
 * {@link getServices} from here — never a `*.mock.ts` or `*.api.ts` file
 * directly. Flipping `NEXT_PUBLIC_SERVICE_MODE` between `"mock"` and `"real"`
 * swaps implementations with zero UI edits.
 *
 * Behaviour mirrors the design's selector pseudocode and `api-contracts.md`
 * (the single source of truth for all shapes).
 */
import type { GuestService } from "./guest.contract";
import type { RoomService } from "./room.contract";
import type { ChatService } from "./chat.contract";
import type { VoteService } from "./vote.contract";
import type { ItineraryService } from "./itinerary.contract";
import type { PreferencesService } from "./preferences.contract";
import type { DestinationService } from "./destination.contract";
import type { BudgetService } from "./budget.contract";
import type { FlightService } from "./flight.contract";
import type { RunService } from "./run.contract";
import type { SelectionService } from "./selection.contract";
import type { TripDatesService } from "./tripDates.contract";

import { ConfigError } from "@/lib/errors";

import { buildMockRegistry } from "./registry.mock";
import { buildRealRegistry } from "./registry.real";

/** Name of the environment variable that selects the service implementation. */
const SERVICE_MODE_ENV = "NEXT_PUBLIC_SERVICE_MODE";

/**
 * Supported service modes.
 * - `"mock"`: contract-shaped fixture implementations (default, no backend).
 * - `"real"`: backend-backed implementations (Supabase/FastAPI).
 */
export type ServiceMode = "mock" | "real";

/**
 * The complete set of service interfaces available to the UI. Both modes
 * populate the identical key set, so the registry is interchangeable across
 * modes from the caller's perspective.
 */
export interface ServiceRegistry {
  guest: GuestService;
  room: RoomService;
  chat: ChatService;
  vote: VoteService;
  itinerary: ItineraryService;
  preferences: PreferencesService;
  destination: DestinationService;
  budget: BudgetService;
  flight: FlightService;
  run: RunService;
  selection: SelectionService;
  tripDates: TripDatesService;
}

/** Re-exported so callers keep importing it from the service selector. */
export { ConfigError };

/**
 * Resolve the configured {@link ServiceMode}.
 *
 * - Unset, empty, or whitespace-only → defaults to `"mock"`.
 * - Exact, case-sensitive `"mock"` or `"real"` → that mode.
 * - Anything else → throws {@link ConfigError} naming the value and variable.
 *
 * `NEXT_PUBLIC_*` variables are inlined by Next.js at build time, so reading
 * `process.env.NEXT_PUBLIC_SERVICE_MODE` is the correct access pattern.
 */
function resolveServiceMode(): ServiceMode {
  const raw = process.env.NEXT_PUBLIC_SERVICE_MODE;

  if (raw == null || raw.trim() === "") {
    return "mock";
  }

  // Exact, case-sensitive comparison — no normalization/trimming of a
  // non-empty value, so `" mock "` or `"Mock"` are treated as invalid.
  if (raw === "mock") {
    return "mock";
  }
  if (raw === "real") {
    return "real";
  }

  throw new ConfigError(
    `Invalid ${SERVICE_MODE_ENV}: "${raw}". Expected "mock" or "real".`,
  );
}

/**
 * Return the fully-populated {@link ServiceRegistry} for the configured mode.
 *
 * This is the single point at which a concrete implementation is chosen.
 * Throws {@link ConfigError} (fail-fast, no registry returned) when the mode is
 * invalid.
 */
export function getServices(): ServiceRegistry {
  const mode = resolveServiceMode();

  // Both branches return the identical interface set/keys — guaranteed by the
  // `ServiceRegistry` return type shared by both builders.
  if (mode === "mock") {
    return buildMockRegistry();
  }
  return buildRealRegistry();
}
