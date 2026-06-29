"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createAnonSupabase } from "@/lib/supabase";
import type { User } from "@/lib/types";

/**
 * Reliable member list backed by the database (the `users` table) rather than
 * ephemeral Realtime presence.
 *
 * - Fetches `/api/rooms/[code]/members` on mount.
 * - Polls every 3s as a safety net.
 * - Refreshes immediately when a `member-joined` broadcast arrives on
 *   `room:{roomId}:members`.
 *
 * Returns the current member list.
 */
export function useRoomMembers(code: string, roomId: string | null): User[] {
  const [members, setMembers] = useState<User[]>([]);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${code}/members`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as User[];
      setMembers(data);
      console.log(
        `[useRoomMembers] room ${code} → ${data.length} member(s):`,
        data.map((m) => m.displayName).join(", ") || "(none)",
      );
    } catch (err) {
      console.log("[useRoomMembers] fetch failed:", err);
    }
  }, [code]);

  const fetchRef = useRef(fetchMembers);
  fetchRef.current = fetchMembers;

  // Initial fetch + 3s poll.
  useEffect(() => {
    void fetchRef.current();
    const interval = setInterval(() => void fetchRef.current(), 3000);
    return () => clearInterval(interval);
  }, [code]);

  // Refresh on member-joined broadcast.
  useEffect(() => {
    if (!roomId) return;
    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${roomId}:members`);
    ch
      .on("broadcast", { event: "member-joined" }, () => {
        void fetchRef.current();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [roomId]);

  return members;
}

/**
 * Broadcast that a member joined so other clients refetch the list immediately.
 */
export async function broadcastMemberJoined(roomId: string): Promise<void> {
  const supabase = createAnonSupabase();
  const ch = supabase.channel(`room:${roomId}:members`);
  await new Promise<void>((resolve) => {
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
  await ch.send({ type: "broadcast", event: "member-joined", payload: {} });
  void supabase.removeChannel(ch);
}
