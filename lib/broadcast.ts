/**
 * Shared Supabase Realtime broadcast helpers.
 *
 * These are the single implementations of broadcast logic used across all
 * stage components and page-level code. Import from here — do NOT copy-paste
 * these functions into individual stage components.
 */

import { createAnonSupabase } from "@/lib/supabase";

/**
 * Broadcast a `stage-change` event on the room's stage channel.
 * Every connected client listening on `room:{roomId}:stage` will re-fetch
 * the room and update their local state.
 *
 * Best-effort — errors are swallowed. Clients fall back to the 3-second
 * polling interval when the broadcast fails.
 */
export async function broadcastStageChange(roomId: string): Promise<void> {
  try {
    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${roomId}:stage`);
    await new Promise<void>((resolve) => {
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
      });
    });
    await ch.send({ type: "broadcast", event: "stage-change", payload: {} });
    void supabase.removeChannel(ch);
  } catch {
    // best-effort — 3-second polling fallback handles sync for other clients
  }
}

/**
 * Broadcast that a vote was cast so other clients refresh their vote results
 * without waiting on the 2-second poll.
 *
 * Best-effort — errors are swallowed.
 */
export async function broadcastVotesUpdated(
  roomId: string,
  voteType: string,
): Promise<void> {
  try {
    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${roomId}:votes:${voteType}`);
    await new Promise<void>((resolve) => {
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
      });
    });
    await ch.send({ type: "broadcast", event: "votes-updated", payload: {} });
    void supabase.removeChannel(ch);
  } catch {
    // best-effort
  }
}
