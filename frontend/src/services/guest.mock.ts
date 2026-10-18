/**
 * Mock guest service.
 *
 * In-memory implementation of {@link GuestService} returning contract-shaped
 * fixture data (no Supabase/FastAPI access). Read-only, like the real service:
 * guests are created through `RoomService.createRoom` / `joinRoom`.
 */
import { mockGuestsById } from "@/mocks";
import type { Guest } from "@/types";

import type { GuestService } from "./guest.contract";

export class MockGuestService implements GuestService {
  async getGuest(guestId: string): Promise<Guest | null> {
    return mockGuestsById[guestId] ?? null;
  }
}
