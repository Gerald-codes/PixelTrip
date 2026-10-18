/** Selection service — real implementation (anon read of `selections` + Realtime). */
import { getSupabaseClient } from "@/lib/supabaseClient";
import type { Unsubscribe } from "@/types";

import type {
  LockedChoice,
  RoomSelections,
  SelectionService,
} from "./selection.contract";

interface SelectionRow {
  kind: "destination" | "flight";
  data: Record<string, unknown>;
}

function toChoice(
  data: Record<string, unknown> | undefined,
): LockedChoice | null {
  if (!data) return null;
  const id = data.id ?? data.option_id;
  const title = data.title ?? data.label;
  return typeof id === "string" && typeof title === "string"
    ? { id, title, data }
    : null;
}

class SelectionApiService implements SelectionService {
  subscribeSelections(
    roomId: string,
    onChange: (selections: RoomSelections) => void,
  ): Unsubscribe {
    const supabase = getSupabaseClient();

    const push = async (): Promise<void> => {
      const { data, error } = await supabase
        .from("selections")
        .select("kind,data")
        .eq("room_id", roomId)
        .returns<SelectionRow[]>();
      if (error) return; // keep the last known selections
      const byKind = new Map((data ?? []).map((row) => [row.kind, row.data]));
      onChange({
        destination: toChoice(byKind.get("destination")),
        flight: toChoice(byKind.get("flight")),
      });
    };

    void push();

    const channel = supabase
      .channel(`selections:${roomId}`)
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

    return () => {
      void supabase.removeChannel(channel);
    };
  }
}

export const selectionApiService: SelectionService = new SelectionApiService();
