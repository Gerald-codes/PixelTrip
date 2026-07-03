"use client";

/**
 * RoomShell — persistent room wrapper that replaces the bare layout in page.tsx.
 *
 * Responsibilities:
 * - Renders a persistent header: room code, invite link + copy button,
 *   StageProgress pipeline dots, and a host-only "← Previous" button.
 * - Renders MemberStrip below the header.
 * - Renders the {children} slot (stage content) in the left column.
 * - Renders TripContextPanel in the right column (sticky on desktop,
 *   full-height overlay on mobile when isMobileContextOpen is true).
 * - Owns the Supabase stage-change broadcast subscription.
 * - Owns the 3-second polling interval for GET /api/rooms/[code].
 *
 * Two-column layout (task 12.1):
 * - ≥ 1024px: side-by-side flex row; left col min-width 65%, right col fills rest.
 * - < 1024px: single column; TripContextPanel hidden by default; toggle button
 *   (fixed, bottom-right) opens it as a full-height fixed overlay.
 *
 * All updates go through onRoomUpdated — no window.location.reload(),
 * no router.push(), no full page navigation.
 *
 * Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 9.7, 11.3, 11.4,
 *               3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8, 3.9, 3.10, 3.12,
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
import TripContextPanel from "@/app/components/TripContextPanel";
import TripAgentChat from "@/app/components/TripAgentChat";
import type { Identity } from "@/app/components/StageRouter";
import { createAnonSupabase } from "@/lib/supabase";
import { STAGE_ORDER } from "@/lib/stageOrder";
import { roomChanged } from "@/lib/roomUtils";
import { computeBudgetEstimate, computeRunningBudgetEstimate, FLIGHT_COSTS, type RunningBudgetEstimate } from "@/lib/budgetEstimate";
import type { BudgetEstimate, BudgetLevel, CharacterProfile, DestinationSuggestion, TripRoom, User } from "@/lib/types";
import { RoomStage } from "@/lib/types";

// ─── Props ────────────────────────────────────────────────────────────────────

interface RoomShellProps {
  room: TripRoom;
  identity: Identity;
  members: User[];
  characterProfiles: CharacterProfile[];
  onRoomUpdated: (r: TripRoom) => void;
  onGoBack?: () => Promise<void>;
  /**
   * Optional legacy children slot — preserved for backward compatibility.
   * When provided and TripAgentChat is not yet wired, children are rendered
   * as a fallback in the left column. In the chatbot-first layout (task 12.2),
   * the left column is owned by TripAgentChat and children is ignored.
   */
  children?: React.ReactNode;
  /**
   * Optional travel dates for TripContextPanel.
   * Derived from overlapping availability, passed down by parent when available.
   */
  travelDates?: { startDate: string; endDate: string } | null;
  /**
   * Optional travel vibes for TripContextPanel.
   */
  travelVibes?: string[] | null;
  /**
   * Optional destination shortlist for TripContextPanel.
   */
  destinationShortlist?: string[] | null;
  /**
   * Optional selected destination suggestion (used to derive budget estimate).
   * Only `priceLevel` is required by computeBudgetEstimate — callers may pass
   * a partial object containing just that field.
   */
  selectedDestinationSuggestion?: Pick<DestinationSuggestion, "priceLevel"> | null;
  /**
   * Trip length in days (inclusive). Used for budget estimate computation.
   * Defaults to 7 when not provided.
   */
  tripLengthDays?: number;
  /**
   * Per-person cost estimates from activity_preferences.estimatedCost across
   * the room (null/missing values already filtered out by the caller).
   * Feeds the progressive running-spend budget bar.
   */
  activityCosts?: number[];
  /**
   * Per-person cost estimates from every ItineraryItem.estimatedCost in the
   * current itinerary version. Feeds the progressive running-spend budget bar.
   */
  itineraryCosts?: number[];
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
  // children is accepted but ignored — TripAgentChat owns the left column
  children: _children,
  travelDates = null,
  travelVibes = null,
  destinationShortlist = null,
  selectedDestinationSuggestion = null,
  tripLengthDays = 7,
  activityCosts = [],
  itineraryCosts = [],
}: RoomShellProps) {
  // ── Local state ─────────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [goingBack, setGoingBack] = useState(false);
  const [goBackError, setGoBackError] = useState<string | null>(null);
  const [showSyncBanner, setShowSyncBanner] = useState(false);

  /**
   * Internal mobile context panel drawer state.
   * No new public props — entirely managed inside RoomShell.
   * Requirements: 2.2, 9.7
   */
  const [isMobileContextOpen, setIsMobileContextOpen] = useState(false);

  // ── Consecutive polling failure counter ──────────────────────────────────────
  const consecutiveFailuresRef = useRef(0);

  // ── Derived values ───────────────────────────────────────────────────────────
  const isHost = identity.userId === room.hostUserId;
  const isLobby = room.currentStage === RoomStage.LOBBY;

  /**
   * Derive submitted user IDs from characterProfiles for TripContextPanel.
   * For the PERSONA/LOBBY stage a profile existing = submitted.
   * For all other stages this serves as a reasonable proxy at the RoomShell level.
   * TripAgentChat has its own more precise derivation per-stage.
   * Requirements: 11.3, 11.4
   */
  const submittedUserIds = useMemo(
    () => characterProfiles.map((p) => p.userId),
    [characterProfiles],
  );

  /**
   * Compute budget estimate for TripContextPanel.
   * Only computed when both selectedFlightOption and a destination with
   * priceLevel are available. Otherwise null (badge not shown).
   * Requirements: 10.2, 10.3, 10.6
   */
  const budgetEstimate = useMemo((): BudgetEstimate | null => {
    if (!room.selectedFlightOption) return null;
    if (!selectedDestinationSuggestion?.priceLevel) return null;
    // Use the MOST CONSERVATIVE (lowest) budget level across all character profiles.
    // This ensures the estimate respects the most budget-sensitive traveller.
    const ORDER: BudgetLevel[] = ["low", "medium", "high"];
    const levels = characterProfiles.map((cp) => cp.budgetLevel);
    const conservativeBudgetLevel: BudgetLevel =
      levels.length > 0
        ? ORDER[Math.min(...levels.map((l) => ORDER.indexOf(l)))]
        : "medium";
    return computeBudgetEstimate(
      room.selectedFlightOption,
      selectedDestinationSuggestion.priceLevel,
      tripLengthDays,
      conservativeBudgetLevel,
    );
  }, [
    room.selectedFlightOption,
    selectedDestinationSuggestion,
    characterProfiles,
    tripLengthDays,
  ]);

  /**
   * Progressive "money committed so far" running spend. Unlike budgetEstimate
   * (a forecast that only appears once destination + flight are both known),
   * this starts at $0 and fills incrementally:
   *   - flight cost is added the moment room.selectedFlightOption is set
   *   - activity costs are added as members fill in estimatedCost on wishlist items
   *   - itinerary costs are added once the AI assigns per-item estimatedCost
   * Always computed (never null) so the bar is visible from the start of the trip.
   */
  const runningSpend = useMemo((): RunningBudgetEstimate => {
    const ORDER: BudgetLevel[] = ["low", "medium", "high"];
    const levels = characterProfiles.map((cp) => cp.budgetLevel);
    const conservativeBudgetLevel: BudgetLevel =
      levels.length > 0
        ? ORDER[Math.min(...levels.map((l) => ORDER.indexOf(l)))]
        : "medium";
    const flightCost = room.selectedFlightOption
      ? FLIGHT_COSTS[room.selectedFlightOption]
      : 0;
    return computeRunningBudgetEstimate(
      conservativeBudgetLevel,
      tripLengthDays,
      flightCost,
      activityCosts,
      itineraryCosts,
    );
  }, [room.selectedFlightOption, characterProfiles, activityCosts, itineraryCosts, tripLengthDays]);

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
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="shrink-0 text-xs text-sky-100">Invite:</span>
            <code
              className="min-w-0 flex-1 truncate text-xs text-white"
              style={{
                background: "rgba(0,0,0,0.25)",
                padding: "2px 8px",
                border: "1px solid rgba(255,255,255,0.2)",
                maxWidth: "100%",
              }}
              title={inviteLink}
            >
              {inviteLink}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy invite link"
              style={{
                flexShrink: 0,
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

      {/* ── Two-column main layout ────────────────────────────────────────── */}
      {/*
       * ≥ 1024px: flex-row, left col grows to fill ~65% via flex-[3], right
       *           col fills ~35% via flex-[1]. Both columns have min-w-0 so
       *           content cannot force overflow.
       * < 1024px: single column, TripContextPanel hidden.
       *   Requirements: 2.1, 2.2
       */}
      <main className="flex flex-1 flex-col lg:flex-row min-h-0">
        {/* ── Left column: TripAgentChat ─────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col lg:flex-[3]">
          <TripAgentChat
            room={room}
            identity={identity}
            members={members}
            characterProfiles={characterProfiles}
            onRoomUpdated={onRoomUpdated}
            onGoBack={onGoBack}
          />
        </div>

        {/* ── Right column: TripContextPanel ──────────────────────────────── */}
        {/*
         * Desktop: sticky to viewport top, scrolls internally.
         * The column is position:sticky + height:100vh so it stays in view
         * while the left column (TripAgentChat) scrolls freely.
         * Mobile: full-height fixed overlay when isMobileContextOpen=true.
         * Requirements: 2.1, 2.2, 9.7
         */}
        <div
          className={
            isMobileContextOpen
              ? "fixed inset-0 z-50 flex flex-col"
              : "hidden lg:flex lg:flex-[1] lg:flex-col lg:min-w-0"
          }
          style={
            !isMobileContextOpen
              ? {
                  position: "sticky",
                  top: 0,
                  height: "100vh",
                  overflowY: "auto",
                  flexShrink: 0,
                }
              : undefined
          }
        >
          {/* Close button inside the overlay — only rendered on mobile overlay */}
          {isMobileContextOpen && (
            <div
              className="lg:hidden"
              style={{
                display: "flex",
                justifyContent: "flex-end",
                padding: "10px 12px 0",
                backgroundColor: "#1E3A5F",
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                aria-label="Close trip context panel"
                onClick={() => setIsMobileContextOpen(false)}
                style={{
                  background: "rgba(255,255,255,0.12)",
                  border: "2px solid #FB923C",
                  color: "#FEF3C7",
                  padding: "4px 12px",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "'Courier New', Courier, monospace",
                  boxShadow: "2px 2px 0 #1E3A5F",
                }}
              >
                ✕ Close
              </button>
            </div>
          )}
          <TripContextPanel
            room={room}
            runningSpend={runningSpend}
            members={members}
            characterProfiles={characterProfiles}
            currentStage={room.currentStage}
            submittedUserIds={submittedUserIds}
            budgetEstimate={budgetEstimate}
            isOpen={isMobileContextOpen}
            travelDates={travelDates}
            travelVibes={travelVibes}
            destinationShortlist={destinationShortlist}
          />
        </div>
      </main>

      {/* ── Mobile toggle button (fixed, bottom-right, < 1024px only) ────── */}
      {/*
       * Renders a fixed "📋 Trip Info" button at the bottom-right corner on
       * screens narrower than 1024px. Clicking toggles the TripContextPanel
       * drawer overlay. Hidden on desktop via `lg:hidden`.
       * Requirements: 2.2, 9.7
       */}
      <button
        type="button"
        className="fixed bottom-4 right-4 z-40 lg:hidden"
        aria-label={
          isMobileContextOpen
            ? "Close trip context panel"
            : "Open trip context panel"
        }
        onClick={() => setIsMobileContextOpen((prev) => !prev)}
        style={{
          background: "#A855F7",
          border: "2px solid #1E3A5F",
          color: "#FEF3C7",
          padding: "10px 16px",
          fontSize: "0.85rem",
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "'Courier New', Courier, monospace",
          boxShadow: "4px 4px 0 #1E3A5F",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span aria-hidden="true">📋</span>
        <span>Trip Info</span>
      </button>

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
