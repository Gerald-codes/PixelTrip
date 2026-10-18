/**
 * Trip dates service — real (backend-backed) implementation.
 *
 * Reads and writes go through FastAPI (`/trips/{tripId}/trip-dates`); Supabase
 * Realtime is only a "selections changed, re-fetch" signal.
 */
import { getApiClient } from "@/lib/apiClient";
import { ApiError } from "@/lib/errors";
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { Unsubscribe } from "@/types";

import type {
  ChangeTripDatesInput,
  TripDates,
  TripDatesService,
} from "./tripDates.contract";

class TripDatesApiService implements TripDatesService {
  private async tripId(roomId: string): Promise<string | null> {
    const { data, error } = await getSupabaseClient()
      .from("trips")
      .select("id")
      .eq("room_id", roomId)
      .maybeSingle<{ id: string }>();
    if (error) return null;
    return data?.id ?? null;
  }

  async getDates(roomId: string): Promise<TripDates | null> {
    const tripId = await this.tripId(roomId);
    if (!tripId) return null;
    return getApiClient().get<TripDates>(`/trips/${tripId}/trip-dates`);
  }

  subscribeDates(
    roomId: string,
    onChange: (dates: TripDates | null) => void,
  ): Unsubscribe {
    const supabase = getSupabaseClient();

    const push = async (): Promise<void> => {
      try {
        onChange(await this.getDates(roomId));
      } catch {
        // Keep the last known dates; never throw into the UI.
      }
    };

    const channel = supabase
      .channel(`trip-dates:${roomId}`)
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
      .subscribe();

    void push();

    return () => {
      void supabase.removeChannel(channel);
    };
  }

  async changeDates(
    roomId: string,
    input: ChangeTripDatesInput,
  ): Promise<TripDates> {
    const tripId = await this.tripId(roomId);
    if (!tripId) {
      throw new ApiError("DATABASE_ERROR", "Could not find the trip.", null);
    }
    return getApiClient().put<TripDates>(`/trips/${tripId}/trip-dates`, input);
  }
}

export const tripDatesApiService: TripDatesService = new TripDatesApiService();
