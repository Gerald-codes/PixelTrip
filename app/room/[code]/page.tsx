"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import StageRouter, { type Identity } from "@/app/components/StageRouter";
import { broadcastMemberJoined, useRoomMembers } from "@/app/hooks/useRoomMembers";
import {
  getDisplayName,
  getOrCreateUserId,
  setDisplayName as persistDisplayName,
} from "@/lib/identity";
import { createAnonSupabase } from "@/lib/supabase";
import type { TripRoom } from "@/lib/types";

interface RoomPageProps {
  params: { code: string };
}

type LoadState = "loading" | "ready" | "error";

/**
 * Room shell.
 *
 * Reads ?name= from window.location.search directly in useEffect — this avoids
 * useSearchParams() which requires a Suspense boundary in Next.js 14 App Router
 * and causes a 404 page without one.
 */
export default function RoomPage({ params }: RoomPageProps) {
  const code = params.code.toUpperCase();

  // ── Identity ─────────────────────────────────────────────────────────────────
  const [userId, setUserId] = useState<string>("");
  const [userDisplayName, setUserDisplayName] = useState<string>("");

  useEffect(() => {
    const id = getOrCreateUserId();
    const urlParams = new URLSearchParams(window.location.search);
    const nameFromUrl = urlParams.get("name") ?? "";
    const name = nameFromUrl || getDisplayName();
    if (nameFromUrl) persistDisplayName(nameFromUrl);
    setUserId(id);
    setUserDisplayName(name);
  }, []);

  const identity = useMemo<Identity | null>(() => {
    if (!userId) return null;
    return { userId, displayName: userDisplayName };
  }, [userId, userDisplayName]);

  // ── Room fetch ────────────────────────────────────────────────────────────────
  const [room, setRoom] = useState<TripRoom | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const fetchRoom = useCallback(async (): Promise<TripRoom | null> => {
    const res = await fetch(`/api/rooms/${code}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(body?.error ?? "Failed to load room");
    }
    return (await res.json()) as TripRoom;
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await fetchRoom();
        if (!cancelled) {
          setRoom(loaded);
          setLoadState("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(
            err instanceof Error ? err.message : "Failed to load room",
          );
          setLoadState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchRoom]);

  // ── Members (DB-backed, reliable) ─────────────────────────────────────────────
  const members = useRoomMembers(code, room?.id ?? null);

  // Ensure THIS user is recorded in the room, then announce arrival so other
  // clients refetch. The room page upserts the user itself so anyone who lands
  // here is recorded regardless of how they arrived (invite link, history, etc.).
  const joinedRef = useRef(false);
  useEffect(() => {
    if (!room?.id || !identity || joinedRef.current) return;
    joinedRef.current = true;

    void (async () => {
      try {
        const res = await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: identity.userId,
            displayName: identity.displayName || "Traveller",
            roomId: room.id,
          }),
        });
        if (!res.ok) {
          console.log("[room] failed to upsert user:", await res.text());
          return;
        }
        console.log("[room] upserted user:", identity.displayName, identity.userId);
        await broadcastMemberJoined(room.id);
      } catch (err) {
        console.log("[room] join error:", err);
      }
    })();
  }, [room?.id, identity]);

  // ── Stage-change listener ─────────────────────────────────────────────────────
  const refetchRef = useRef(fetchRoom);
  refetchRef.current = fetchRoom;

  useEffect(() => {
    if (!room?.id) return;
    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${room.id}:stage`);
    ch
      .on("broadcast", { event: "stage-change" }, () => {
        refetchRef
          .current()
          .then((updated) => {
            if (updated) setRoom(updated);
          })
          .catch(() => {});
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [room?.id]);

  // ── Invite link ───────────────────────────────────────────────────────────────
  const inviteLink = useMemo(() => {
    if (typeof window === "undefined") return `/?join=${code}`;
    return `${window.location.origin}/?join=${code}`;
  }, [code]);

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loadState === "loading" || !identity) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <p className="text-gray-600">Loading room {code}…</p>
      </main>
    );
  }

  if (loadState === "error" || !room) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-2xl font-bold">Room {code}</h1>
        <p className="text-red-600">{errorMessage}</p>
        <a className="text-blue-600 underline" href="/">
          Back to home
        </a>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8">
      <header className="mx-auto mb-8 flex max-w-2xl flex-col gap-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            Room <span className="font-mono">{room.roomCode}</span>
          </h1>
          <span className="text-sm text-gray-500">
            {members.length}{" "}
            {members.length === 1 ? "member" : "members"} online
          </span>
        </div>
        <p className="text-sm text-gray-500">Invite: {inviteLink}</p>
      </header>

      <StageRouter room={room} identity={identity} members={members} />
    </main>
  );
}
