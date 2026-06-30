"use client";

/**
 * RoomShell — persistent room wrapper that replaces the bare layout in page.tsx.
 *
 * Responsibilities:
 * - Renders a persistent header: room code, invite link + copy button,
 *   StageProgress pipeline dots, and a host-only "← Previous" button.
 * - Renders MemberStrip below the header.
 * - Renders the {children} slot (stage content) below MemberStrip.
 * - Owns the Supabase stage-change broadcast subscription.
 * - Owns the 3-second polling interval for GET /api/rooms/[code].
 *
 * All updates go through onRoomUpdated — no window.location.reload(),
 * no router.push(), no full page navigation.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8, 3.9, 3.10, 3.12,
 *               7.1, 7.2, 7.6, 7.9, 7.10, 8.1, 2.4
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import MemberStrip from "@/app/components/MemberStrip";
import StageProgress from "@/app/components/StageProgress";
import type { Identity } from "@/app/components/StageRouter";
import { createAnonSupabase } from "@/lib/supabase";
import { STAGE_ORDER } from "@/lib/stageOrder";
import { roomChanged } from "@/lib/roomUtils";
import type { CharacterProfile, TripRoom, User } from "@/lib/types";
import { RoomStage } from "@/lib/types";

// ─── Props ────────────────────────────────────────────────────────────────────

interface RoomShellProps {
  room: TripRoom;
  identity: Identity;
  members: User[];
  characterProfiles: CharacterProfile[];
  onRoomUpdated: (r: TripRoom) => void;
  onGoBack?: () => Promise<void>;
  children: React.ReactNode;
}

// ─── Dev flag ─────────────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV === "development";

// ─── Helper: broadcast stage-change (fire-and-forget) ────────────────────────

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
    // best-effort — other clients will catch up via polling
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RoomShell({
  room,
  identity,
  members,
  characterProfiles,
  onRoomUpdated,
  onGoBack,
  children,
}: RoomShellProps) {
  // ── Local state ─────────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [goingBack, setGoingBack] = useState(false);
  const [goBackError, setGoBackError] = useState<string | null>(null);
  const [showSyncBanner, setShowSyncBanner] = useState(false);

  // ── Consecutive polling failure counter ──────────────────────────────────────
  const consecutiveFailuresRef = useRef(0);

  // ── Derived values ───────────────────────────────────────────────────────────
  const isHost = identity.userId === room.hostUserId;
  const isLobby = room.currentStage === RoomStage.LOBBY;

  const inviteLink = useMemo(() => {
    if (typeof window === "undefined") return `/?join=${room.roomCode}`;
    return `${window.location.origin}/?join=${room.roomCode}`;
  }, [room.roomCode]);

  // ── Copy invite link ─────────────────────────────────────────────────────────
  function handleCopy() {
    void navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // ── Fetch room helper ────────────────────────────────────────────────────────
  const fetchRoom = useCallback(async (): Promise<TripRoom | null> => {
    try {
      const res = await fetch(`/api/rooms/${room.roomCode}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      return (await res.json()) as TripRoom;
    } catch {
      return null;
    }
  }, [room.roomCode]);

  // Stable ref so intervals/effects always see the latest version.
  const fetchRoomRef = useRef(fetchRoom);
  fetchRoomRef.current = fetchRoom;

  // Stable ref to the current room snapshot — used inside callbacks without
  // adding `room` to dependency arrays (which would re-register intervals
  // on every stage transition).
  const roomRef = useRef(room);
  roomRef.current = room;

  // ── applyUpdate: only propagate when something actually changed ──────────────
  const applyUpdate = useCallback(
    (updated: TripRoom) => {
      if (!roomChanged(roomRef.current, updated)) return;
      if (IS_DEV) {
        console.log(
          `[RoomShell] stage updated: ${roomRef.current.currentStage} → ${updated.currentStage}`,
        );
      }
      onRoomUpdated(updated);
    },
    [onRoomUpdated],
  );

  // ── 3-second polling fallback ────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchRoomRef.current().then((updated) => {
        if (updated) {
          // Successful poll: reset failure counter and dismiss banner
          consecutiveFailuresRef.current = 0;
          setShowSyncBanner(false);
          applyUpdate(updated);
        } else {
          // Failed poll (non-200 or fetch error): increment counter
          consecutiveFailuresRef.current += 1;
          if (consecutiveFailuresRef.current >= 3) {
            setShowSyncBanner(true);
          }
        }
      });
    }, 3000);
    return () => clearInterval(interval);
    // Re-register only when the room id or applyUpdate ref changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id, applyUpdate]);

  // ── Supabase stage-change broadcast subscription ─────────────────────────────
  useEffect(() => {
    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${room.id}:stage`);
    ch
      .on("broadcast", { event: "stage-change" }, () => {
        void fetchRoomRef.current().then((updated) => {
          if (updated) applyUpdate(updated);
        });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [room.id, applyUpdate]);

  // ── Manual sync ──────────────────────────────────────────────────────────────
  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const updated = await fetchRoomRef.current();
      if (updated) applyUpdate(updated);
    } finally {
      setSyncing(false);
    }
  }

  // ── Host go-back (Previous stage) ───────────────────────────────────────────
  // If the parent provided onGoBack, delegate to it; otherwise handle locally.
  const handleGoBack = useCallback(async () => {
    if (goingBack) return;
    setGoingBack(true);
    setGoBackError(null);
    try {
      if (onGoBack) {
        await onGoBack();
      } else {
        // Local fallback: PATCH stage backward directly.
        const res = await fetch(`/api/rooms/${room.roomCode}/stage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestingUserId: identity.userId,
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
        onRoomUpdated(updated);
        // Broadcast so other clients pick up the change immediately.
        void broadcastStageChangeFf(room.id);
      }
    } catch (err) {
      setGoBackError(
        err instanceof Error ? err.message : "Failed to go back",
      );
    } finally {
      setGoingBack(false);
    }
  }, [goingBack, onGoBack, room.roomCode, room.id, identity.userId, onRoomUpdated]);

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col">
      {/* ── Persistent header ──────────────────────────────────────────────── */}
      <header
        style={{
          background: "linear-gradient(135deg, #1E3A5F 0%, #38BDF8 100%)",
          borderBottom: "3px solid #1E3A5F",
        }}
      >
        <div
          className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4"
          style={{ fontFamily: "inherit" }}
        >
          {/* Row 1: room code + member count + sync button */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <h1
                className="font-bold text-white"
                style={{ fontSize: "1.25rem" /* text-xl = 20px ≥ 18px */ }}
              >
                Room{" "}
                <span
                  className="font-mono"
                  style={{
                    fontSize: "1.125rem" /* text-lg = 18px, per spec */,
                    letterSpacing: "0.08em",
                    background: "rgba(255,255,255,0.15)",
                    padding: "2px 8px",
                    border: "2px solid rgba(255,255,255,0.4)",
                  }}
                >
                  {room.roomCode}
                </span>
              </h1>

              <span className="text-sm text-sky-100">
                {members.length}{" "}
                {members.length === 1 ? "member" : "members"}
              </span>
            </div>

            {/* Sync button */}
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={syncing}
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "2px solid rgba(255,255,255,0.4)",
                color: "#fff",
                padding: "4px 12px",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: syncing ? "not-allowed" : "pointer",
                opacity: syncing ? 0.6 : 1,
              }}
            >
              {syncing ? "Syncing…" : "↻ Sync"}
            </button>
          </div>

          {/* Row 2: invite link + copy button */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-sky-100">Invite link:</span>
            <code
              className="truncate text-xs text-white"
              style={{
                background: "rgba(0,0,0,0.25)",
                padding: "2px 8px",
                border: "1px solid rgba(255,255,255,0.2)",
                maxWidth: 260,
              }}
            >
              {inviteLink}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy invite link"
              style={{
                background: copied ? "#4ADE80" : "#FB923C",
                border: copied
                  ? "2px solid #16A34A"
                  : "2px solid #C2410C",
                color: "#1E3A5F",
                padding: "3px 10px",
                fontSize: "0.75rem",
                fontWeight: 700,
                cursor: "pointer",
                transition: "background 0.15s",
                whiteSpace: "nowrap",
                boxShadow: "2px 2px 0px #1E3A5F",
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          {/* Row 3: StageProgress + host controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Pipeline progress dots */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-sky-100">
                Progress:
              </span>
              <StageProgress
                currentStage={room.currentStage}
                stages={STAGE_ORDER}
              />
            </div>

            {/* Host controls: Previous stage (hidden on LOBBY) */}
            <div className="flex items-center gap-2">
              {isHost && !isLobby && (
                <button
                  type="button"
                  onClick={() => void handleGoBack()}
                  disabled={goingBack}
                  aria-label="Go to previous stage"
                  style={{
                    background: "rgba(255,255,255,0.15)",
                    border: "2px solid #FB923C",
                    color: "#FEF3C7",
                    padding: "4px 12px",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    cursor: goingBack ? "not-allowed" : "pointer",
                    opacity: goingBack ? 0.6 : 1,
                    boxShadow: "2px 2px 0px #1E3A5F",
                  }}
                >
                  {goingBack ? "Going back…" : "← Previous"}
                </button>
              )}
              {goBackError && (
                <span className="text-xs text-red-300">{goBackError}</span>
              )}

              {/* Dev-only stage badge */}
              {IS_DEV && (
                <span
                  style={{
                    background: "rgba(0,0,0,0.4)",
                    color: "#FEF3C7",
                    fontFamily: "monospace",
                    fontSize: "0.7rem",
                    padding: "2px 6px",
                    border: "1px solid rgba(255,255,255,0.2)",
                  }}
                >
                  {room.currentStage}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Member strip ───────────────────────────────────────────────────── */}
      <MemberStrip
        members={members}
        hostUserId={room.hostUserId}
        characterProfiles={characterProfiles}
      />

      {/* ── Stage content slot ─────────────────────────────────────────────── */}
      <main className="flex-1">{children}</main>

      {/* ── "Having trouble syncing" banner (3+ consecutive poll failures) ─── */}
      {showSyncBanner && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 50,
            background: "#FEF3C7",
            borderTop: "2px solid #1E3A5F",
            boxShadow: "0 -2px 0px #1E3A5F",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            gap: 12,
          }}
        >
          <div className="flex items-center gap-2">
            <span
              style={{
                fontSize: "1.1rem",
                lineHeight: 1,
              }}
              aria-hidden="true"
            >
              ⚠️
            </span>
            <span
              style={{
                color: "#1E3A5F",
                fontWeight: 700,
                fontSize: "0.85rem",
                fontFamily: "inherit",
              }}
            >
              Having trouble syncing
            </span>
            <span
              style={{
                color: "#1E3A5F",
                fontSize: "0.8rem",
                opacity: 0.75,
              }}
            >
              — your connection may be unstable. Changes will sync when restored.
            </span>
          </div>
          <button
            type="button"
            aria-label="Dismiss sync warning"
            onClick={() => setShowSyncBanner(false)}
            style={{
              background: "#FB923C",
              border: "2px solid #C2410C",
              color: "#1E3A5F",
              padding: "4px 12px",
              fontSize: "0.75rem",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "2px 2px 0px #1E3A5F",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            ✕ Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
