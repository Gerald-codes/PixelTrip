/** Run progress — real implementation (`GET /trips/{tripId}/runs/latest`). */
import { getApiClient } from "@/lib/apiClient";
import { getSupabaseClient } from "@/lib/supabaseClient";

import type { RunProgress, RunService, RunType } from "./run.contract";

class RunApiService implements RunService {
  private tripIds = new Map<string, string>();

  private async tripId(roomId: string): Promise<string | null> {
    const cached = this.tripIds.get(roomId);
    if (cached) return cached;
    const { data, error } = await getSupabaseClient()
      .from("trips")
      .select("id")
      .eq("room_id", roomId)
      .maybeSingle<{ id: string }>();
    if (error || !data) return null;
    this.tripIds.set(roomId, data.id);
    return data.id;
  }

  async getLatestRun(roomId: string, runType?: RunType): Promise<RunProgress | null> {
    const tripId = await this.tripId(roomId);
    if (!tripId) return null;
    const query = runType ? `?runType=${runType}` : "";
    return getApiClient().get<RunProgress | null>(`/trips/${tripId}/runs/latest${query}`);
  }

  async startRun(roomId: string, memberId: string, runType: RunType): Promise<void> {
    const tripId = await this.tripId(roomId);
    if (!tripId) return;
    // Always a fresh key: the backend returns the earlier run for a known key.
    await getApiClient().post(`/trips/${tripId}/runs`, {
      runType,
      memberId,
      idempotencyKey: `${runType}-${tripId}-retry-${Date.now()}`,
    });
  }
}

export const runApiService: RunService = new RunApiService();
