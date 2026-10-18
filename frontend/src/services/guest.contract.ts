/**
 * Guest service contract.
 *
 * Typed method signatures only — no feature or business logic. Behaviour is
 * supplied solely by the mock (`guest.mock.ts`) or real (`guest.api.ts`)
 * implementation. Shapes mirror the "Guest Identity Flow" section of
 * `api-contracts.md` (the single source of truth). No Supabase/FastAPI types
 * appear in this surface.
 *
 * Read-only: guests are created by the backend as part of
 * `RoomService.createRoom` / `RoomService.joinRoom`, never on their own.
 */
import type { Guest } from "@/types";

export interface GuestService {
  getGuest(guestId: string): Promise<Guest | null>;
}
