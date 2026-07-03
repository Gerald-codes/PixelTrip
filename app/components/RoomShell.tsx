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

  // Stage label for header
  const STAGE_LABEL: Record<string, string> = {
    LOBBY: "LOBBY", PERSONA: "PERSONA", AVAILABILITY: "AVAILABILITY",
    GROUP_PROFILE: "GROUP PROFILE", DESTINATIONS: "DESTINATIONS",
    DESTINATION_VOTE: "DESTINATION VOTE", FLIGHTS: "FLIGHTS",
    FLIGHT_VOTE: "FLIGHT VOTE", ACTIVITIES: "ACTIVITIES",
    ITINERARY: "ITINERARY", FEEDBACK: "FEEDBACK",
    NEGOTIATION: "NEGOTIATION", FINAL: "FINAL",
  };

  return (
    <div className="flex min-h-screen flex-col" style={{ backgroundColor: "var(--pt-bg-deep)" }}>
      {/* ── Slim top navigation bar ─────────────────────────────────────────── */}
      <header
        style={{
          backgroundColor: "#081A33",
          borderBottom: "1px solid #335F91",
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexShrink: 0,
        }}
      >
        {/* Left: brand + room code */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontFamily: "var(--pt-font-pixel)",
              fontSize: 11,
              color: "#F4F8FF",
              letterSpacing: "0.04em",
            }}
          >
            PixelTrip
          </span>
          <span
            style={{
              fontFamily: "var(--pt-font-pixel)",
              fontSize: 10,
              color: "#F4F8FF",
              backgroundColor: "rgba(56, 217, 200, 0.15)",
              border: "1px solid #38D9C8",
              padding: "3px 8px",
              letterSpacing: "0.1em",
            }}
          >
            {room.roomCode}
          </span>
        </div>

        {/* Center: phase indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontFamily: "var(--pt-font-pixel)",
              fontSize: 8,
              color: "#8FA9C8",
              letterSpacing: "0.06em",
            }}
          >
            Progress
          </span>
          <span style={{ color: "#6B8AA8", fontSize: 12 }}>—</span>
          <StageProgress currentStage={room.currentStage} stages={STAGE_ORDER} />
        </div>

        {/* Right: stage badge + controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isHost && !isLobby && (
            <button
              type="button"
              onClick={() => void handleGoBack()}
              disabled={goingBack}
              aria-label="Go to previous stage"
              style={{
                background: "#102B4F",
                border: "1px solid #335F91",
                color: "#F4F8FF",
                padding: "3px 10px",
                fontSize: 10,
                fontFamily: "var(--pt-font-pixel)",
                cursor: goingBack ? "not-allowed" : "pointer",
                opacity: goingBack ? 0.5 : 1,
              }}
            >
              ←
            </button>
          )}
          {goBackError && (
            <span style={{ fontSize: 10, color: "#F87171" }}>{goBackError}</span>
          )}

          <span
            style={{
              fontFamily: "var(--pt-font-pixel)",
              fontSize: 8,
              color: "#081A33",
              backgroundColor: "#FF9F43",
              padding: "4px 10px",
              letterSpacing: "0.04em",
              fontWeight: 700,
            }}
          >
            {STAGE_LABEL[room.currentStage] ?? room.currentStage}
          </span>

          {/* Sync button */}
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            aria-label="Sync room"
            style={{
              background: "#102B4F",
              border: "1px solid #335F91",
              color: "#F4F8FF",
              padding: "3px 8px",
              fontSize: 12,
              cursor: syncing ? "not-allowed" : "pointer",
              opacity: syncing ? 0.5 : 1,
              lineHeight: 1,
            }}
          >
            ↻
          </button>
        </div>
      </header>

      {/* ── Two-column main layout ────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col lg:flex-row min-h-0" style={{ backgroundColor: "var(--pt-bg-deep)" }}>
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

        {/* ── Right column: TripContextPanel ─────────────────────────────── */}
        <div
          className={
            isMobileContextOpen
              ? "fixed inset-0 z-50 flex flex-col"
              : "hidden lg:flex lg:flex-col lg:min-w-0"
          }
          style={
            !isMobileContextOpen
              ? {
                  position: "sticky",
                  top: 0,
                  height: "100vh",
                  overflowY: "auto",
                  flexShrink: 0,
                  width: 320,
                  minWidth: 320,
                }
              : {}
          }
        >
          {/* Close button — mobile overlay only */}
          {isMobileContextOpen && (
            <div
              className="lg:hidden"
              style={{
                display: "flex",
                justifyContent: "flex-end",
                padding: "10px 12px",
                backgroundColor: "var(--pt-bg-deep)",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                aria-label="Close trip context panel"
                onClick={() => setIsMobileContextOpen(false)}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "var(--pt-text-muted)",
                  padding: "4px 12px",
                  fontSize: 11,
                  fontFamily: "var(--pt-font-body)",
                  cursor: "pointer",
                }}
              >
                ✕ Close
              </button>
            </div>
          )}

          {/* Full TripContextPanel component */}
          <TripContextPanel
            room={room}
            members={members}
            characterProfiles={characterProfiles}
            currentStage={room.currentStage}
            submittedUserIds={submittedUserIds}
            budgetEstimate={budgetEstimate}
            runningSpend={runningSpend}
            isOpen={isMobileContextOpen}
            travelDates={travelDates}
            travelVibes={travelVibes}
            destinationShortlist={destinationShortlist}
          />
        </div>
      </main>

      {/* ── Mobile toggle button (fixed, bottom-right, < 1024px only) ────── */}
      <button
        type="button"
        className="fixed bottom-4 right-4 z-40 lg:hidden"
        aria-label={
          isMobileContextOpen
            ? "Close trip info panel"
            : "Open trip info panel"
        }
        onClick={() => setIsMobileContextOpen((prev) => !prev)}
        style={{
          background: "var(--pt-agent-atlas)",
          border: "none",
          color: "#fff",
          padding: "10px 16px",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "var(--pt-font-body)",
          borderRadius: 8,
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span aria-hidden="true">ℹ️</span>
        <span>Trip Info</span>
      </button>

      {/* ── Sync trouble banner ─── */}
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
            background: "var(--pt-bg-card)",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            gap: 12,
          }}
        >
          <span style={{ color: "var(--pt-warn)", fontSize: 13, fontFamily: "var(--pt-font-body)" }}>
            ⚠ Having trouble syncing — changes will sync when connection restores.
          </span>
          <button
            type="button"
            aria-label="Dismiss sync warning"
            onClick={() => setShowSyncBanner(false)}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "var(--pt-text-muted)",
              padding: "4px 10px",
              fontSize: 11,
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
