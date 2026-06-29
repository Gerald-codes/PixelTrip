"use client";

import { useEffect, useRef, useState } from "react";

import type { Identity } from "@/app/components/StageRouter";
import { createAnonSupabase } from "@/lib/supabase";

export interface PresenceMember {
  userId: string;
  displayName: string;
  online: boolean;
}

interface TrackedPresence {
  userId: string;
  displayName: string;
}

/**
 * Subscribe to a room's presence channel.
 *
 * The channel is created once per roomId. When identity changes (display name
 * update, etc.) we re-track in place rather than tearing the channel down —
 * this prevents the subscribe/close loop caused by React Strict Mode double-
 * invoking effects and by identity object reference changes.
 */
export function usePresence(
  roomId: string | null,
  identity: Identity | null,
): PresenceMember[] {
  const [members, setMembers] = useState<PresenceMember[]>([]);

  // Keep latest identity in a ref so the channel callback always has it
  // without needing to be in the effect dependency array.
  const identityRef = useRef<Identity | null>(identity);
  identityRef.current = identity;

  // The channel ref lets us re-track without recreating the subscription.
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createAnonSupabase>["channel"]
  > | null>(null);

  // ── Channel lifecycle — keyed only on roomId ──────────────────────────────
  useEffect(() => {
    if (!roomId) return;

    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${roomId}:presence`, {
      config: { presence: { key: identityRef.current?.userId ?? "anon" } },
    });
    channelRef.current = ch;

    ch
      .on("presence", { event: "sync" }, () => {
        const state = ch.presenceState<TrackedPresence>();
        const next = Object.entries(state).map(([key, entries]) => {
          const first = entries[0];
          return {
            userId: first?.userId ?? key,
            displayName: first?.displayName ?? "Traveller",
            online: true,
          } satisfies PresenceMember;
        });
        next.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setMembers(next);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED" && identityRef.current) {
          await ch.track({
            userId: identityRef.current.userId,
            displayName: identityRef.current.displayName,
          });
        }
      });

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(ch);
    };
  // Only re-run when roomId changes — identity changes are handled below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ── Re-track when identity changes without recreating the channel ─────────
  useEffect(() => {
    if (!identity || !channelRef.current) return;
    // Only re-track if the channel is already subscribed.
    void channelRef.current.track({
      userId: identity.userId,
      displayName: identity.displayName,
    });
  }, [identity]);

  return members;
}
