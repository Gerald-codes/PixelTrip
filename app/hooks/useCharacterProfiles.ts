"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createAnonSupabase } from "@/lib/supabase";
import type { CharacterProfile } from "@/lib/types";

/**
 * Reliable character profile list backed by the database (`character_profiles`
 * table) rather than ephemeral Realtime presence.
 *
 * - Returns `[]` immediately when `roomId` is `null`.
 * - Fetches `GET /api/character-profile?roomId={roomId}` on mount.
 * - Polls every 3s as a safety net.
 * - Refreshes immediately when a `member-joined` broadcast arrives on
 *   `room:{roomId}:members` (same channel as `useRoomMembers`).
 *
 * Returns the current `CharacterProfile[]` for all members in the room.
 *
 * Requirements: 3.8, 7.3, 7.8
 */
export function useCharacterProfiles(roomId: string | null): CharacterProfile[] {
  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);

  const fetchProfiles = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await fetch(
        `/api/character-profile?roomId=${encodeURIComponent(roomId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as CharacterProfile[];
      setProfiles(data);
      console.log(
        `[useCharacterProfiles] room ${roomId} → ${data.length} profile(s):`,
        data.map((p) => p.displayName).join(", ") || "(none)",
      );
    } catch (err) {
      console.log("[useCharacterProfiles] fetch failed:", err);
    }
  }, [roomId]);

  const fetchRef = useRef(fetchProfiles);
  fetchRef.current = fetchProfiles;

  // Initial fetch + 3s poll. Reset when roomId changes.
  useEffect(() => {
    if (!roomId) {
      setProfiles([]);
      return;
    }
    void fetchRef.current();
    const interval = setInterval(() => void fetchRef.current(), 3000);
    return () => clearInterval(interval);
  }, [roomId]);

  // Refresh immediately on member-joined broadcast (same channel as useRoomMembers).
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

  return profiles;
}
