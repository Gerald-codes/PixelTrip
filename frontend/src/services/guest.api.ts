/**
 * Guest service — real (backend-backed) implementation.
 *
 * Read-only: guests are created by the backend when a room is created or
 * joined. `getGuest` is an approved direct anon-key Supabase read (see
 * `docs/SUPABASE_ACCESS_BOUNDARY.md`). Failures surface as `ApiError`.
 */
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { Guest } from "@/types";

import type { GuestService } from "./guest.contract";
import {
  GUEST_COLUMNS,
  type GuestRow,
  supabaseReadError,
  toGuest,
} from "./supabaseRows";

class GuestApiService implements GuestService {
  // Direct Supabase access (approved: read-only).
  // Table: guests — display name and avatar for a party member; no side effects.
  // Shape: { id, display_name, avatar_url } → Guest.
  async getGuest(guestId: string): Promise<Guest | null> {
    const { data, error } = await getSupabaseClient()
      .from("guests")
      .select(GUEST_COLUMNS)
      .eq("id", guestId)
      .maybeSingle<GuestRow>();
    if (error) {
      throw supabaseReadError("guests");
    }
    return data ? toGuest(data) : null;
  }
}

/** Singleton real Guest service. */
export const guestApiService: GuestService = new GuestApiService();
