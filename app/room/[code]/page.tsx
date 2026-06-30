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

const IS_DEV = process.env.NODE_ENV === "development";

/** Returns true when any of the mutable room fields changed. */
function roomChanged(prev: TripRoom, next: TripRoom): boolean {
  return (
    prev.currentStage !== next.currentStage ||
    prev.selectedDestination !== next.selectedDestination ||
    prev.selectedFlightOption !== next.selectedFlightOption ||
    prev.currentItineraryId !== next.currentItineraryId ||
    prev.finalItineraryId !== next.finalItineraryId
  );
}

export default function RoomPage({ params }: RoomPageProps) {
  const code = params.code.toUpperCase();

  // ── Identity ──────────────────────────────────────────────────────────────
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

  // ── Room fetch ────────────────────────────────────────────────────────────
  const [room, setRoom] = useState<TripRoom | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const fetchRoom = useCallback(async (): Promise<TripRoom | null> => {
    const res = await fetch(`/api/rooms/${code}`, { cache: "no-store" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(body?.error ?? "Failed to load room");
    }
    return (await res.json()) as TripRoom;
  }, [code]);

  // Initial load.
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

  // ── Members ───────────────────────────────────────────────────────────────
  const members = useRoomMembers(code, room?.id ?? null);

  // Ensure this user is in the room DB row.
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
        if (IS_DEV) console.log("[room] upserted user:", identity.displayName);
        await broadcastMemberJoined(room.id);
      } catch (err) {
        console.log("[room] join error:", err);
      }
    })();
  }, [room?.id, identity]);

  // ── Stage sync: broadcast + polling ──────────────────────────────────────
  // Broadcast gives instant updates for other clients.
  // Polling every 3 s catches any missed broadcast.
  // Both compare all mutable fields — not just currentStage.

  const refetchRef = useRef(fetchRoom);
  refetchRef.current = fetchRoom;
  const roomRef = useRef(room);
  roomRef.current = room;

  const applyUpdate = useCallback((updated: TripRoom) => {
    setRoom((prev) => {
      if (!prev) return updated;
      if (!roomChanged(prev, updated)) return prev;
      if (IS_DEV) {
        console.log(
          `[room] stage updated: ${prev.currentStage} → ${updated.currentStage}`,
        );
      }
      return updated;
    });
  }, []);

  // 3-second polling fallback.
  useEffect(() => {
    if (!room?.id) return;
    const interval = setInterval(() => {
      void refetchRef
        .current()
        .then((updated) => {
          if (updated) applyUpdate(updated);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
    // Re-register interval only when room id changes (not on every stage change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, applyUpdate]);

  // Supabase broadcast listener.
  useEffect(() => {
    if (!room?.id) return;
    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${room.id}:stage`);
    ch
      .on("broadcast", { event: "stage-change" }, () => {
        void refetchRef
          .current()
          .then((updated) => {
            if (updated) applyUpdate(updated);
          })
          .catch(() => {});
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [room?.id, applyUpdate]);

  // ── Manual sync (Sync room button) ────────────────────────────────────────
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const updated = await fetchRoom();
      if (updated) applyUpdate(updated);
    } catch {
      // Silent — the user can try again
    } finally {
      setSyncing(false);
    }
  }

  // ── Go back (host-only previous stage) ───────────────────────────────────
  const [goingBack, setGoingBack] = useState(false);
  const [goBackError, setGoBackError] = useState<string | null>(null);

  const handleGoBack = useCallback(async () => {
    if (goingBack || !room) return;
    setGoingBack(true);
    setGoBackError(null);
    try {
      const res = await fetch(`/api/rooms/${room.roomCode}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestingUserId: identity?.userId,
          direction: "backward",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Failed to go back");
      }
      const updated = (await res.json()) as TripRoom;
      applyUpdate(updated);
      // Fire-and-forget broadcast for other clients.
      void broadcastStageChangeFf(room.id);
    } catch (err) {
      setGoBackError(
        err instanceof Error ? err.message : "Failed to go back",
      );
    } finally {
      setGoingBack(false);
    }
  }, [goingBack, room, identity?.userId, applyUpdate]);

  // ── Invite link ───────────────────────────────────────────────────────────
  const inviteLink = useMemo(() => {
    if (typeof window === "undefined") return `/?join=${code}`;
    return `${window.location.origin}/?join=${code}`;
  }, [code]);

  const isHost = identity?.userId === room?.hostUserId;

  // ── Render ────────────────────────────────────────────────────────────────
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
      <header className="mx-auto mb-6 flex max-w-2xl flex-col gap-2">
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

        {/* Sync + dev indicator row */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "↻ Sync room"}
          </button>
          <span className="text-xs text-gray-400">
            If your screen looks stuck, sync the room state.
          </span>

          {/* Host go-back button — visible to host only */}
          {isHost && (
            <button
              type="button"
              onClick={() => void handleGoBack()}
              disabled={goingBack}
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {goingBack ? "Going back…" : "← Previous stage"}
            </button>
          )}
          {goBackError && (
            <span className="text-xs text-red-600">{goBackError}</span>
          )}

          {/* Dev-only stage badge */}
          {IS_DEV && (
            <span className="ml-auto rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-500">
              {room.currentStage}
            </span>
          )}
        </div>
      </header>

      <StageRouter
        room={room}
        identity={identity}
        members={members}
        onRoomUpdated={applyUpdate}
        onGoBack={isHost ? handleGoBack : undefined}
      />
    </main>
  );
}

/** Fire-and-forget broadcast helper for `page.tsx` — never awaited. */
async function broadcastStageChangeFf(roomId: string): Promise<void> {
  try {
    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${roomId}:stage`);
    await new Promise<void>((resolve) => {
      ch.subscribe((s) => {
        if (s === "SUBSCRIBED") resolve();
      });
    });
    await ch.send({ type: "broadcast", event: "stage-change", payload: {} });
    void supabase.removeChannel(ch);
  } catch {
    // best-effort
  }
}
