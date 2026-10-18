/**
 * Budget service — real (backend-backed) implementation.
 *
 * Reads go through FastAPI (`GET /trips/{tripId}/budget`), because the budget is
 * worked out from backend-only data (travel preferences). Supabase Realtime is
 * only used as a "something changed, re-fetch" signal.
 */
import { getApiClient } from "@/lib/apiClient";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { Unsubscribe } from "@/types";

import type { BudgetService, TripBudget } from "./budget.contract";

class BudgetApiService implements BudgetService {
  private async tripId(roomId: string): Promise<string | null> {
    const { data, error } = await getSupabaseClient()
      .from("trips")
      .select("id")
      .eq("room_id", roomId)
      .maybeSingle<{ id: string }>();
    if (error) return null;
    return data?.id ?? null;
  }

  async getBudget(roomId: string): Promise<TripBudget | null> {
    const tripId = await this.tripId(roomId);
    if (!tripId) return null;
    return getApiClient().get<TripBudget>(`/trips/${tripId}/budget`);
  }

  subscribeBudget(
    roomId: string,
    onChange: (budget: TripBudget | null) => void,
  ): Unsubscribe {
    const supabase = getSupabaseClient();
    let tripId: string | null = null;

    const push = async (): Promise<void> => {
      try {
        tripId = tripId ?? (await this.tripId(roomId));
        onChange(
          tripId
            ? await getApiClient().get<TripBudget>(`/trips/${tripId}/budget`)
            : null,
        );
      } catch {
        // Keep the last known budget; never throw into the UI.
      }
    };

    // Saving preferences flips room_members.stage_ready; votes lock selections;
    // BUILD/REFINE add itinerary versions (keyed by trip). Any of these re-fetches.
    const channel = supabase
      .channel(`budget:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_members",
          filter: `room_id=eq.${roomId}`,
        },
        () => void push(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "selections",
          filter: `room_id=eq.${roomId}`,
        },
        () => void push(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "itinerary_versions" },
        (change) => {
          const row = (change.new ?? change.old) as { trip_id?: string } | null;
          if (!tripId || row?.trip_id === tripId) void push();
        },
      )
      .subscribe();

    void push();

    return () => {
      void supabase.removeChannel(channel);
    };
  }
}

export const budgetApiService: BudgetService = new BudgetApiService();
