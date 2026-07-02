"use client";

/**
 * TripAgentChat — the primary chatbot-first Trip Agent panel.
 *
 * Owns the append-only `AgentMessage[]` thread state and drives all
 * stage-level interactive content. Rendered inside the left column of
 * RoomShell's two-column layout.
 *
 * Core responsibilities (task 11.1 + 11.2):
 *   - Accept room, identity, members, characterProfiles, onRoomUpdated, onGoBack props
 *   - Maintain messages[], submittedStages, pendingSlotSave internal state
 *   - Detect stage transitions via prevStageRef; append intro AgentMessage on each transition
 *   - Smooth-scroll to bottomRef whenever the messages array grows
 *   - Render each AgentMessage as <TripAgentMessage> inside aria-live="polite"
 *   - Wrap everything in <main>; thread is vertically scrollable
 *   - renderSlotContent() routes the current stage to the correct interactive component
 *
 * Stage-to-slot routing (task 11.2):
 *   - LOBBY/PERSONA → <CharacterCreator chatMode={true} />
 *   - AVAILABILITY   → <AvailabilityStage /> embedded directly
 *   - DESTINATIONS/DESTINATION_VOTE → <VoteableDestinationCard /> list
 *   - FLIGHTS/FLIGHT_VOTE → <VoteableFlightCard /> list
 *   - All other stages → <StageRouter {...stageProps} />
 *
 * Visual rules (pixel-art style, Req 12.5):
 *   - Deep navy (#1E3A5F) background for the chat area
 *   - Zero border-radius throughout
 *   - Monospace font
 *   - No white surfaces — palette colours only
 *
 * Message thread invariants (Req 14.3, 14.4):
 *   - messages[] is append-only — never cleared, never spliced
 *   - timestamp values are non-decreasing
 *   - Stage messages appear in stage-order
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AgentMessage,
  CharacterProfile,
  DestinationSuggestion,
  Identity,
  RoomStage,
  TripRoom,
  User,
  Vote,
} from "@/lib/types";
import { STAGE_INTRO_MESSAGES } from "@/lib/agentMessages";
import TripAgentMessage from "@/app/components/TripAgentMessage";
import InteractiveSlot from "@/app/components/InteractiveSlot";
import CharacterCreator from "@/app/components/CharacterCreator";
import AvailabilityStage from "@/app/components/AvailabilityStage";
import VoteableDestinationCard from "@/app/components/VoteableDestinationCard";
import VoteableFlightCard from "@/app/components/VoteableFlightCard";
import StageRouter, { type StageProps } from "@/app/components/StageRouter";
import { MOCK_FLIGHT_OPTIONS } from "@/app/components/FlightStage";
import { createAnonSupabase } from "@/lib/supabase";
import WaitingState from "@/app/components/WaitingState";

// ─── Palette ─────────────────────────────────────────────────────────────────

const DEEP_NAVY = "#1E3A5F";
const SAND_CREAM = "#FEF3C7";
const SUNSET_ORANGE = "#FB923C";
const SKY_BLUE = "#38BDF8";

// ─── Helper: build submitted-selections ReactNode for WaitingState ───────────
//
// Produces a human-readable summary of what the current user submitted.
// For PERSONA/LOBBY stages we know the CharacterProfile fields; for all other
// stages we show a generic confirmation line. Shown in WaitingState's
// "Your selections" section. (Task 11.3 — Req 4.6)

function buildSubmittedSelections(
  stage: RoomStage,
  identity: Identity,
  characterProfiles: CharacterProfile[],
  availabilitySummaryText?: string
): React.ReactNode {
  const myProfile = characterProfiles.find((p) => p.userId === identity.userId);

  if (
    (stage === RoomStage.PERSONA || stage === RoomStage.LOBBY) &&
    myProfile
  ) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 13,
          fontFamily: "'Courier New', Courier, monospace",
          color: SAND_CREAM,
        }}
      >
        <div>
          <span style={{ opacity: 0.7 }}>Character: </span>
          <strong>
            {myProfile.generatedPersonaName || myProfile.displayName}
          </strong>
        </div>
        <div>
          <span style={{ opacity: 0.7 }}>Budget: </span>
          <strong style={{ textTransform: "capitalize" }}>
            {myProfile.budgetLevel}
          </strong>
        </div>
        <div>
          <span style={{ opacity: 0.7 }}>Travel style: </span>
          <strong style={{ textTransform: "capitalize" }}>
            {myProfile.travelStyle}
          </strong>
        </div>
        {myProfile.tripInterests.length > 0 && (
          <div>
            <span style={{ opacity: 0.7 }}>Interests: </span>
            <strong>{myProfile.tripInterests.join(", ")}</strong>
          </div>
        )}
      </div>
    );
  }

  // Generic confirmation for all other stages
  return (
    <div
      style={{
        fontSize: 13,
        fontFamily: "'Courier New', Courier, monospace",
        color: SAND_CREAM,
      }}
    >
      {stage === RoomStage.AVAILABILITY && availabilitySummaryText
        ? availabilitySummaryText
        : "Preferences submitted ✔"}
    </div>
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface TripAgentChatProps {
  room: TripRoom;
  identity: Identity;
  members: User[];
  characterProfiles: CharacterProfile[];
  onRoomUpdated: (r: TripRoom) => void;
  onGoBack?: () => Promise<void>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TripAgentChat({
  room,
  identity,
  members,
  characterProfiles,
  onRoomUpdated,
  onGoBack,
}: TripAgentChatProps) {
  // ── Internal state ──────────────────────────────────────────────────────────

  /**
   * Append-only message thread. Never use setMessages([]) or splice().
   * All secondary messages (waiting updates, errors, confirmations) are also
   * appended — never mutate existing entries in place.
   */
  const [messages, setMessages] = useState<AgentMessage[]>([]);

  /**
   * Tracks which stages the current user has already submitted.
   * Used by task 11.3 to gate the WaitingState vs InteractiveSlot display.
   */
  const [submittedStages, setSubmittedStages] = useState<Set<RoomStage>>(
    () => new Set<RoomStage>()
  );

  /**
   * True while a server save is in flight (set by task 11.4 save lifecycle).
   * Passed to InteractiveSlot as `isSaving` to render the disabled overlay.
   */
  const [pendingSlotSave, setPendingSlotSave] = useState<boolean>(false);

  // ── Destination suggestions + votes state ────────────────────────────────────
  const [destinationSuggestions, setDestinationSuggestions] = useState<DestinationSuggestion[]>([]);
  const [destinationVotes, setDestinationVotes] = useState<Vote[]>([]);
  const [destinationsLoading, setDestinationsLoading] = useState<boolean>(false);

  // ── Destination multi-select vote state ──────────────────────────────────────
  // Tracks which destination IDs the current user has toggled (not yet submitted).
  const [selectedDestinationIds, setSelectedDestinationIds] = useState<string[]>([]);
  const [submittingVotes, setSubmittingVotes] = useState(false);
  const [voteSubmitError, setVoteSubmitError] = useState<string | null>(null);
  // Tracks userIds who have submitted destination votes (polled separately).
  const [destVoteSubmittedUserIds, setDestVoteSubmittedUserIds] = useState<string[]>([]);
  // Tiebreaker state — set when the server reports a tie
  const [tiedDestinationIds, setTiedDestinationIds] = useState<string[] | null>(null);
  const [breakingTie, setBreakingTie] = useState(false);
  // ── Flight votes state ─────────────────────────────────────────────────────
  const [flightVotes, setFlightVotes] = useState<Vote[]>([]);

  // ── Availability submitted user IDs (task 11.8) ──────────────────────────────
  //
  // For AVAILABILITY stage we derive submitted users by polling the actual
  // availability API rather than using characterProfiles as a proxy.
  // Updated by the 4-second poll when in AVAILABILITY stage. (Req 6.8, 6.9)
  const [availabilitySubmittedUserIds, setAvailabilitySubmittedUserIds] = useState<string[]>([]);

  // Snapshot of this user's submitted availability prefs — used in summary msg
  const [availabilitySummary, setAvailabilitySummary] = useState<{
    dateRanges: Array<{ startDate: string; endDate: string }>;
    vibes: string[];
    destinations: string[];
  } | null>(null);

  // ── Host controls state (task 11.5) ─────────────────────────────────────────

  /** True while the PATCH /api/rooms/[code]/stage request is in flight. */
  const [advancingStage, setAdvancingStage] = useState<boolean>(false);

  /** True while POST /api/agents/destinations is in flight (regenerate). */
  const [regenerating, setRegenerating] = useState<boolean>(false);

  // ── Refs ────────────────────────────────────────────────────────────────────

  /**
   * Tracks the stage we have already appended an intro message for.
   * Compared against room.currentStage on every render; when they differ we
   * know a stage transition has occurred and append a new intro message.
   */
  const prevStageRef = useRef<RoomStage | null>(null);

  /**
   * A zero-height sentinel div at the bottom of the message thread.
   * Calling bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) after
   * appending a message satisfies Req 2.4.
   */
  const bottomRef = useRef<HTMLDivElement | null>(null);

  /**
   * Tracks how many members had submitted the last time the waiting-update
   * effect ran. Used to detect when submittedUserIds.length increases so we
   * can append a new waiting AgentMessage without mutating the old one.
   * (Task 11.3 — Req 14.3)
   */
  const prevSubmittedCountRef = useRef<number>(0);

  /**
   * Guards the "everyone's ready" system message — once appended we must not
   * append it again even if the effect re-fires. Reset on stage change and
   * on "Edit my response" so the message can re-fire after a re-submit.
   * (Task 11.3 — Req 3.3, 3.5)
   */
  const everyoneReadyAppendedRef = useRef<boolean>(false);

  /**
   * Tracks which flight category we've already appended a plurality
   * confirmation message for. Stores the winning category string (e.g.
   * "budget") or null when no confirmation has been appended yet.
   * Reset to null on every stage change so a fresh vote cycle in a future
   * FLIGHT_VOTE stage can fire again.
   * (Task 11.6 — Req 8.6)
   */
  const flightPluralityAppendedRef = useRef<string | null>(null);

  // ── Helper: append an intro message for a given stage ───────────────────────

  const appendIntroMessage = useCallback((stage: RoomStage) => {
    const newMessage: AgentMessage = {
      id: crypto.randomUUID(),
      stage,
      text: STAGE_INTRO_MESSAGES[stage],
      timestamp: Date.now(),
      type: "intro",
    };
    setMessages((prev) => [...prev, newMessage]);
  }, []);

  // ── Helper: append an error AgentMessage to the thread ──────────────────────
  //
  // Used by advanceStage, regenerateDestinations, and future save-lifecycle
  // tasks (11.4, 11.7). Always appends — never mutates existing entries.

  const appendErrorMessage = useCallback(
    (text: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          stage: room.currentStage,
          text,
          timestamp: Date.now(),
          type: "error" as const,
        },
      ]);
    },
    [room.currentStage]
  );

  // ── Helper: append a system AgentMessage to the thread ──────────────────────

  const appendSystemMessage = useCallback(
    (text: string, type: AgentMessage["type"] = "system") => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          stage: room.currentStage,
          text,
          timestamp: Date.now(),
          type,
        },
      ]);
    },
    [room.currentStage]
  );

  // ── Helper: 10-second save with AbortController timeout (Req 4.3, 4.4, 4.5) ──
  //
  // Wraps any fetch-based slot save with a 10-second abort timeout.
  //   - Sets pendingSlotSave=true before the fetch, false after.
  //   - On timeout: aborts the fetch, re-enables the slot (pendingSlotSave=false),
  //     and appends an inline error AgentMessage — no full-page error view (Req 3.7).
  //   - On network error or non-ok response: appends inline error AgentMessage.
  //   - Returns the parsed JSON body on success, throws on failure.
  //
  // Usage:
  //   const result = await saveWithTimeout<MyType>("/api/some-endpoint", options);
  //
  // Requirements: 4.3, 4.4, 4.5, 3.7

  const saveWithTimeout = useCallback(
    async <T,>(url: string, options: RequestInit): Promise<T> => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => {
        controller.abort();
      }, 10_000);

      setPendingSlotSave(true);
      try {
        const res = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string; message?: string }
            | null;
          throw new Error(
            body?.message ?? body?.error ?? `HTTP ${res.status}`
          );
        }

        const data = (await res.json()) as T;
        return data;
      } catch (err) {
        clearTimeout(timeoutId);

        if (err instanceof DOMException && err.name === "AbortError") {
          // Network timeout — append inline error, re-enable slot
          appendErrorMessage(
            "Save timed out — your connection may be slow. Please try again."
          );
        } else {
          appendErrorMessage(
            err instanceof Error
              ? `Save failed — ${err.message}`
              : "Save failed — please try again."
          );
        }
        throw err; // Re-throw so callers can react (e.g. re-enable a button)
      } finally {
        setPendingSlotSave(false);
      }
    },
    [appendErrorMessage]
  );

  // ── Broadcast stage-change (fire-and-forget) ─────────────────────────────────
  //
  // Mirrors the helper in RoomShell. If broadcast fails, other clients will
  // catch up via the 3-second polling fallback — no rollback.

  async function broadcastStageChange(): Promise<void> {
    try {
      const supabase = createAnonSupabase();
      const ch = supabase.channel(`room:${room.id}:stage`);
      await new Promise<void>((resolve) => {
        ch.subscribe((s) => {
          if (s === "SUBSCRIBED") resolve();
        });
      });
      await ch.send({ type: "broadcast", event: "stage-change", payload: {} });
      void supabase.removeChannel(ch);
    } catch {
      // best-effort — 3-second polling fallback handles sync for other clients
    }
  }

  // ── Derived: is current user the host? ──────────────────────────────────────
  const isHost = identity.userId === room.hostUserId;

  // ── Derived: submitted user IDs for the current stage ────────────────────────
  //
  // For PERSONA/LOBBY: a user is "submitted" when a CharacterProfile exists.
  // For AVAILABILITY: use the polled availability API submitted user IDs.
  // For other stages: use characterProfiles as a proxy (MVP simplification).
  const submittedUserIds =
    room.currentStage === RoomStage.AVAILABILITY
      ? availabilitySubmittedUserIds
      : characterProfiles.map((p) => p.userId);

  /**
   * Per-member submission status array passed to WaitingState / ReadyBadge.
   * Re-derived on every render so ReadyBadge states update reactively as
   * the 3-second polling loop returns fresh characterProfiles data.
   * (Task 11.3 — Req 11.1)
   */
  const memberStatuses = members.map((m) => ({
    userId: m.id,
    displayName: m.displayName,
    submitted: submittedUserIds.includes(m.id),
  }));

  /**
   * True when the current user has submitted for the current stage.
   * When true, WaitingState replaces the InteractiveSlot in the last message.
   * (Task 11.3 — Req 4.6)
   */
  const currentUserSubmitted = submittedStages.has(room.currentStage);

  // ── Callback: edit response — remove stage from submittedStages ──────────────
  //
  // Called when the user clicks "← Edit my response" inside WaitingState.
  // Removes the current stage from submittedStages so the InteractiveSlot
  // is revealed again. Resets the everyoneReady guard so the message can
  // re-fire if they re-submit after editing.
  // (Task 11.3 — Req 4.7, 11.2)

  const handleEditResponse = useCallback(() => {
    setSubmittedStages((prev) => {
      const next = new Set(prev);
      next.delete(room.currentStage);
      return next;
    });
    everyoneReadyAppendedRef.current = false;
  }, [room.currentStage]);

  //
  // Requirements 13.1, 13.2
  function canAdvanceStage(): boolean {
    switch (room.currentStage) {
      case RoomStage.AVAILABILITY:
        // All members must have submitted availability
        return (
          submittedUserIds.length >= members.length && members.length > 0
        );
      case RoomStage.DESTINATIONS:
        // At least one suggestion must have been generated
        return destinationSuggestions.length > 0;
      case RoomStage.DESTINATION_VOTE:
        // At least one vote must have been cast
        return destinationVotes.length > 0;
      case RoomStage.FLIGHTS:
        // Flight options must be loaded (MOCK_FLIGHT_OPTIONS always available)
        return MOCK_FLIGHT_OPTIONS.length > 0;
      case RoomStage.FLIGHT_VOTE:
        // At least one flight vote must have been cast
        return flightVotes.length > 0;
      default:
        // No blocking condition for other stages
        return true;
    }
  }

  // ── Host action: advance to next stage ──────────────────────────────────────
  //
  // PATCH /api/rooms/[code]/stage → on success, update local state + broadcast.
  // Broadcast failures are swallowed — 3-second poll will sync other clients.
  // Requirements: 13.1, 13.2, 13.3

  const advanceStage = useCallback(async () => {
    if (advancingStage || !canAdvanceStage()) return;
    setAdvancingStage(true);
    try {
      const res = await fetch(`/api/rooms/${room.roomCode}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestingUserId: identity.userId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        throw new Error(
          body?.message ?? body?.error ?? `HTTP ${res.status}`
        );
      }
      const updatedRoom = (await res.json()) as TripRoom;
      onRoomUpdated(updatedRoom);
      // Broadcast stage-change so other clients update immediately.
      // If broadcast fails, 3-second polling fallback handles sync.
      void broadcastStageChange();
    } catch (err) {
      appendErrorMessage(
        err instanceof Error
          ? `Failed to advance stage — ${err.message}`
          : "Failed to advance stage — please try again."
      );
    } finally {
      setAdvancingStage(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    advancingStage,
    room.roomCode,
    room.id,
    identity.userId,
    onRoomUpdated,
    appendErrorMessage,
    // Note: canAdvanceStage reads state synchronously; dependencies tracked
    // via submittedUserIds.length, destinationSuggestions.length, etc.
    submittedUserIds.length,
    destinationSuggestions.length,
    destinationVotes.length,
    flightVotes.length,
    members.length,
    room.currentStage,
  ]);

  // ── Host action: regenerate destinations ────────────────────────────────────
  //
  // Shows inline loading message in thread, dismisses when POST completes.
  // On failure: appends inline error AgentMessage with retry affordance.
  // Requirements: 13.4, 13.5, 7.8, 7.9

  const regenerateDestinations = useCallback(async () => {
    if (regenerating) return;
    setRegenerating(true);
    // Append loading message to thread (appended, never mutated)
    appendSystemMessage("Finding the best destinations for your group…");
    try {
      const res = await fetch("/api/agents/destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      // Refresh the destinations list
      const data = (await res.json()) as DestinationSuggestion[];
      const sorted = Array.isArray(data)
        ? [...data].sort((a, b) => b.fitScore - a.fitScore)
        : [];
      setDestinationSuggestions(sorted);
    } catch (err) {
      appendErrorMessage(
        err instanceof Error
          ? `Destination generation failed — ${err.message}`
          : "Destination generation failed — please try again."
      );
    } finally {
      setRegenerating(false);
    }
  }, [
    regenerating,
    room.id,
    appendSystemMessage,
    appendErrorMessage,
  ]);

  // ── Effect: detect stage transitions and append intro message ────────────────
  //
  // Also resets the per-stage submission tracking refs so the waiting-update
  // and everyone's-ready effects start fresh for the new stage.

  useEffect(() => {
    if (prevStageRef.current === room.currentStage) return;
    prevStageRef.current = room.currentStage;
    // Reset per-stage tracking on every stage change (task 11.3)
    prevSubmittedCountRef.current = 0;
    everyoneReadyAppendedRef.current = false;
    // Reset flight plurality guard so a new stage cycle can fire again (task 11.6)
    flightPluralityAppendedRef.current = null;
    // Reset availability submitted IDs when leaving/entering AVAILABILITY stage
    if (room.currentStage !== RoomStage.AVAILABILITY) {
      setAvailabilitySubmittedUserIds([]);
    }
    appendIntroMessage(room.currentStage);
  }, [room.currentStage, appendIntroMessage]);

  // ── Effect: smooth-scroll to bottom whenever messages array grows ────────────

  useEffect(() => {
    if (messages.length === 0) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // ── Effect: append waiting-update message when more members submit ───────────
  //
  // Fires whenever submittedUserIds.length changes. If the count has grown AND
  // the current user has already submitted (waiting state is shown), append a
  // new "waiting" AgentMessage listing who is still pending.
  //
  // Key invariant: NEVER mutate existing messages — append only (Req 14.3).
  // Requirements: 3.4, 11.1, 14.3

  useEffect(() => {
    const currentCount = submittedUserIds.length;

    if (
      currentCount > prevSubmittedCountRef.current &&
      submittedStages.has(room.currentStage) &&
      members.length > 0 &&
      currentCount < members.length // not everyone yet — that's handled below
    ) {
      const pending = members
        .filter((m) => !submittedUserIds.includes(m.id))
        .map((m) => m.displayName);

      const pendingText =
        pending.length === 0
          ? "Everyone has submitted!"
          : `Still waiting for: ${pending.join(", ")}.`;

      const waitingMsg: AgentMessage = {
        id: crypto.randomUUID(),
        stage: room.currentStage,
        text: pendingText,
        timestamp: Date.now(),
        type: "waiting",
      };
      setMessages((prev) => [...prev, waitingMsg]);
    }

    prevSubmittedCountRef.current = currentCount;
    // We intentionally use .length as the trigger, not the full array, to
    // avoid firing on every render when membership itself hasn't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submittedUserIds.length]);

  // ── Effect: append "everyone's ready" system message when all submitted ──────
  //
  // Fires when every room member has submitted for the current stage AND the
  // current user is also in the waiting state. A ref guard prevents duplicate
  // appends across re-renders. Message text is ≤ 40 words (Req 3.5).
  // Requirements: 3.3, 3.5, 4.6, 11.2

  useEffect(() => {
    if (
      members.length > 0 &&
      submittedUserIds.length === members.length &&
      submittedStages.has(room.currentStage) &&
      !everyoneReadyAppendedRef.current
    ) {
      everyoneReadyAppendedRef.current = true;
      const systemMsg: AgentMessage = {
        id: crypto.randomUUID(),
        stage: room.currentStage,
        text: "Everyone's ready! The host can now move to the next step.",
        timestamp: Date.now(),
        type: "system",
      };
      setMessages((prev) => [...prev, systemMsg]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submittedUserIds.length, members.length]);

  // ── Fetch destination suggestions ────────────────────────────────────────────
  //
  // Fetch on mount and whenever the stage becomes DESTINATIONS or DESTINATION_VOTE.
  // Also sets up a 4s poll while in those stages.

  const fetchDestinations = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/agents/destinations?roomId=${encodeURIComponent(room.id)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as DestinationSuggestion[];
      const sorted = [...data].sort((a, b) => b.fitScore - a.fitScore);
      setDestinationSuggestions(sorted);
    } catch {
      // Silent — placeholder message already shown
    }
  }, [room.id]);

  // ── Fetch destination votes ────────────────────────────────────────────────

  const fetchDestinationVotes = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/votes/${encodeURIComponent(room.id)}/destination`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { votes: Vote[] };
      setDestinationVotes(data.votes ?? []);
    } catch {
      // Silent
    }
  }, [room.id]);

  // ── Fetch flight votes ─────────────────────────────────────────────────────

  const fetchFlightVotes = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/votes/${encodeURIComponent(room.id)}/flight`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { votes: Vote[] };
      setFlightVotes(data.votes ?? []);
    } catch {
      // Silent
    }
  }, [room.id]);

  // ── Effects: run fetches when in relevant stages ──────────────────────────

  const isDestinationStage =
    room.currentStage === RoomStage.DESTINATIONS ||
    room.currentStage === RoomStage.DESTINATION_VOTE;

  const isFlightStage =
    room.currentStage === RoomStage.FLIGHTS ||
    room.currentStage === RoomStage.FLIGHT_VOTE;

  useEffect(() => {
    if (!isDestinationStage) return;
    setDestinationsLoading(true);
    void fetchDestinations().finally(() => setDestinationsLoading(false));
    void fetchDestinationVotes();

    const interval = setInterval(() => {
      void fetchDestinations();
      void fetchDestinationVotes();
    }, 4000);
    return () => clearInterval(interval);
  }, [isDestinationStage, fetchDestinations, fetchDestinationVotes]);

  useEffect(() => {
    if (!isFlightStage) return;
    void fetchFlightVotes();
    const interval = setInterval(() => void fetchFlightVotes(), 4000);
    return () => clearInterval(interval);
  }, [isFlightStage, fetchFlightVotes]);

  // ── Fetch availability submissions (for AVAILABILITY stage submitted tracking) ─
  //
  // Polls /api/availability every 4s while in AVAILABILITY stage to derive
  // per-member submission status (Req 6.8, 6.9). On success, updates
  // availabilitySubmittedUserIds so ReadyBadge + WaitingState reflect real data.

  const fetchAvailabilitySubmissions = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/availability?roomId=${encodeURIComponent(room.id)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        availability: Array<{ userId: string; startDate: string; endDate: string }>;
        destinationPreferences: Array<{ userId: string; countryOrCity: string }>;
      };
      const userIds = [...new Set(data.availability.map((a) => a.userId))];
      setAvailabilitySubmittedUserIds(userIds);
    } catch {
      // Silent — polling fallback handles sync
    }
  }, [room.id]);

  const isAvailabilityStage = room.currentStage === RoomStage.AVAILABILITY;

  useEffect(() => {
    if (!isAvailabilityStage) return;
    void fetchAvailabilitySubmissions();
    const interval = setInterval(() => void fetchAvailabilitySubmissions(), 4000);
    return () => clearInterval(interval);
  }, [isAvailabilityStage, fetchAvailabilitySubmissions]);

  // ── Effect: append flight vote plurality confirmation message ─────────────
  //
  // Runs after each poll cycle while in FLIGHT_VOTE stage. Counts votes per
  // category, finds the category with the most votes, and appends a
  // "confirmation" AgentMessage when there is a clear winner (no tie).
  //
  // A ref guard (`flightPluralityAppendedRef`) prevents duplicate messages if
  // the same winner persists across multiple poll cycles. The ref is reset on
  // every stage change so a future FLIGHT_VOTE stage works correctly.
  //
  // Requirements: 8.6

  useEffect(() => {
    if (room.currentStage !== RoomStage.FLIGHT_VOTE) return;
    if (flightVotes.length === 0) return;

    // Count votes per category
    const counts: Record<string, number> = {};
    for (const vote of flightVotes) {
      counts[vote.selectedOption] = (counts[vote.selectedOption] ?? 0) + 1;
    }

    // Find the category with the most votes; detect ties
    let maxCount = 0;
    let winner: string | null = null;
    let tied = false;
    for (const [category, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        winner = category;
        tied = false;
      } else if (count === maxCount) {
        tied = true;
      }
    }

    // Only append confirmation if there is a clear winner and we haven't already
    if (winner && !tied && flightPluralityAppendedRef.current !== winner) {
      flightPluralityAppendedRef.current = winner;
      const labelMap: Record<string, string> = {
        budget: "Budget Flights",
        best_value: "Best Value",
        comfort: "Comfort",
      };
      const label = labelMap[winner] ?? winner;
      const confirmMsg: AgentMessage = {
        id: crypto.randomUUID(),
        stage: room.currentStage,
        text: `The group is leaning towards ${label}. The host can confirm and move forward.`,
        timestamp: Date.now(),
        type: "confirmation",
      };
      setMessages((prev) => [...prev, confirmMsg]);
    }
  }, [flightVotes, room.currentStage]);

  // ── Vote handlers ──────────────────────────────────────────────────────────

  /**
   * Called by VoteableDestinationCard. POSTs /api/votes with voteType "destination".
   * Throws on 5xx so the card can revert its optimistic state.
   */
  async function handleDestinationVote(destinationId: string): Promise<void> {
    const res = await fetch("/api/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: room.id,
        userId: identity.userId,
        voteType: "destination",
        selectedOption: destinationId,
      }),
    });
    if (!res.ok) {
      throw new Error(String(res.status));
    }
    // Refresh vote counts after a successful cast
    void fetchDestinationVotes();
  }

  /**
   * Called by VoteableFlightCard. POSTs /api/votes with voteType "flight".
   * Throws on 5xx so the card can revert its optimistic state.
   */
  async function handleFlightVote(category: string): Promise<void> {
    const res = await fetch("/api/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: room.id,
        userId: identity.userId,
        voteType: "flight",
        selectedOption: category,
      }),
    });
    if (!res.ok) {
      throw new Error(String(res.status));
    }
    // Refresh vote counts after a successful cast
    void fetchFlightVotes();
  }

  /**
   * Submit all selected destination votes at once.
   * POSTs to /api/votes/submit which handles multi-vote, tallying, and
   * auto-advancing the stage when all members have voted.
   */
  async function handleSubmitDestinationVotes(): Promise<void> {
    if (submittingVotes || selectedDestinationIds.length === 0) return;
    setVoteSubmitError(null);
    setSubmittingVotes(true);
    try {
      const res = await fetch("/api/votes/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: room.id,
          userId: identity.userId,
          voteType: "destination",
          selectedOptions: selectedDestinationIds,
        }),
      });
      const data = (await res.json()) as {
        allVoted?: boolean;
        tied?: boolean;
        tiedOptions?: string[];
        winner?: string;
        roomAdvanced?: boolean;
        updatedRoom?: TripRoom;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      // Mark as submitted
      setSubmittedStages((prev) => new Set([...prev, room.currentStage]));
      // Update local vote submitted tracking
      setDestVoteSubmittedUserIds((prev) =>
        prev.includes(identity.userId) ? prev : [...prev, identity.userId]
      );
      void fetchDestinationVotes();

      if (data.roomAdvanced && data.updatedRoom) {
        // Clear winner — stage advanced automatically
        appendSystemMessage(
          `🗳 Votes are in! "${data.winner ?? "a destination"}" won. Moving to the next step…`,
          "confirmation"
        );
        void broadcastStageChange();
        onRoomUpdated(data.updatedRoom);
      } else if (data.tied && data.tiedOptions && data.tiedOptions.length > 0) {
        // Tie — show tiebreaker UI; host must pick the winner
        setTiedDestinationIds(data.tiedOptions);
        const tiedNames = data.tiedOptions
          .map((id) => destinationSuggestions.find((s) => s.id === id)?.destinationName ?? id)
          .join(", ");
        appendSystemMessage(
          `⚖️ It's a tie between: ${tiedNames}. ${isHost ? "Pick the winner below." : "Waiting for the host to break the tie…"}`,
          "system"
        );
      } else if (data.allVoted) {
        appendSystemMessage("Everyone has voted! Tallying results…", "system");
      }
    } catch (err) {
      setVoteSubmitError(
        err instanceof Error ? err.message : "Failed to submit votes. Please try again."
      );
    } finally {
      setSubmittingVotes(false);
    }
  }

  // ── Host tiebreaker: pick winning destination and advance stage ─────────────
  async function handleBreakTie(winnerId: string): Promise<void> {
    if (breakingTie) return;
    setBreakingTie(true);
    const winnerName = destinationSuggestions.find((s) => s.id === winnerId)?.destinationName ?? winnerId;
    try {
      // 1. Set the selected destination on the room (expects the name string)
      const setRes = await fetch(`/api/rooms/${room.roomCode}/destination`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestingUserId: identity.userId,
          selectedDestination: winnerName,
        }),
      });
      if (setRes.ok) {
        const updatedRoomFromDest = (await setRes.json()) as TripRoom;
        onRoomUpdated(updatedRoomFromDest);
      }

      // 2. Advance the stage
      const stageRes = await fetch(`/api/rooms/${room.roomCode}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestingUserId: identity.userId }),
      });
      if (!stageRes.ok) {
        const body = (await stageRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${stageRes.status}`);
      }
      const updatedRoom = (await stageRes.json()) as TripRoom;
      appendSystemMessage(
        `🗳 Tiebreaker: "${winnerName}" selected. Moving to the next step…`,
        "confirmation"
      );
      setTiedDestinationIds(null);
      void broadcastStageChange();
      onRoomUpdated(updatedRoom);
    } catch (err) {
      appendErrorMessage(
        err instanceof Error ? `Tiebreaker failed — ${err.message}` : "Tiebreaker failed. Please try again."
      );
    } finally {
      setBreakingTie(false);
    }
  }

  // ── stageProps: passed unchanged to StageRouter and direct stage components ──

  const stageProps: StageProps = {
    room,
    identity,
    members,
    onRoomUpdated,
    onGoBack,
    characterProfiles,
  };

  // ── renderSlotContent: maps current stage to its interactive content ──────────
  //
  // Requirements: 4.1, 4.2, 14.1, 15.1, 15.2, 15.3

  function renderSlotContent(): React.ReactNode {
    const stage = room.currentStage;

    // LOBBY / PERSONA → CharacterCreator in chatMode
    //
    // Req 5.11 — character profile POST failure is handled entirely inside
    // CharacterCreator: on a non-2xx response or network error, `saveError`
    // state is set and an inline `role="alert"` error block is rendered below
    // the confirm button. All character selections are retained (setSaving=false,
    // setSaveError set), the confirm button is re-enabled, and no full-page
    // error view is shown. This satisfies Req 5.11 and Req 3.7.
    if (stage === RoomStage.LOBBY || stage === RoomStage.PERSONA) {
      return (
        <CharacterCreator
          identity={identity}
          roomId={room.id}
          chatMode={true}
          onConfirmed={(profile) => {
            // Mark PERSONA/LOBBY stage as submitted so task 11.3 can show WaitingState
            setSubmittedStages((prev) => new Set([...prev, stage]));
            // Notify parent with updated room if needed (profile is the saved result)
            // The room itself doesn't change here; parent polling will catch any stage advance
            onRoomUpdated({ ...room });
            void profile; // profile available for future use (11.3 WaitingState)
          }}
        />
      );
    }

    // AVAILABILITY → AvailabilityStage embedded directly
    if (stage === RoomStage.AVAILABILITY) {
      return (
        <AvailabilityStage
          {...stageProps}
          onRoomUpdated={(updatedRoom) => {
            // Intercept successful save: mark AVAILABILITY as submitted and
            // append a summary confirmation AgentMessage (Req 6.6, 6.8).
            setSubmittedStages((prev) => new Set([...prev, RoomStage.AVAILABILITY]));

            // Build summary text from the latest availability summary snapshot.
            // The snapshot is updated by fetchAvailabilitySubmissions + the
            // availability polling, but for the immediate summary we use what
            // AvailabilityStage's onRoomUpdated call conveys (the save just succeeded).
            // We fetch fresh availability data to compose the summary.
            void (async () => {
              try {
                const res = await fetch(
                  `/api/availability?roomId=${encodeURIComponent(room.id)}`,
                  { cache: "no-store" }
                );
                if (!res.ok) return;
                const data = (await res.json()) as {
                  availability: Array<{ userId: string; startDate: string; endDate: string }>;
                  destinationPreferences: Array<{ userId: string; countryOrCity: string }>;
                };
                // Update submitted user IDs immediately (don't wait for next poll)
                const userIds = [...new Set(data.availability.map((a) => a.userId))];
                setAvailabilitySubmittedUserIds(userIds);

                // Build summary for this user's submission
                const myRanges = data.availability
                  .filter((a) => a.userId === identity.userId)
                  .map((a) => `${a.startDate} → ${a.endDate}`);
                const myDests = data.destinationPreferences
                  .filter((p) => p.userId === identity.userId)
                  .map((p) => p.countryOrCity);

                const datesText = myRanges.length > 0
                  ? myRanges.join(", ")
                  : "dates saved";
                const destsText = myDests.length > 0
                  ? myDests.slice(0, 3).join(", ") + (myDests.length > 3 ? ` +${myDests.length - 3} more` : "")
                  : "no destinations";

                const summaryText = `Got it! Dates: ${datesText}. Destinations: ${destsText}.`;
                setMessages((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    stage: RoomStage.AVAILABILITY,
                    text: summaryText,
                    timestamp: Date.now(),
                    type: "confirmation" as const,
                  },
                ]);
              } catch {
                // If fetch fails, still mark submitted — the save already succeeded
              }
            })();

            onRoomUpdated(updatedRoom);
          }}
        />
      );
    }

    // DESTINATIONS / DESTINATION_VOTE → multi-select with Submit votes button
    if (stage === RoomStage.DESTINATIONS || stage === RoomStage.DESTINATION_VOTE) {
      if (destinationsLoading && destinationSuggestions.length === 0) {
        return (
          <div
            style={{
              padding: "16px",
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: 13,
              color: SAND_CREAM,
              opacity: 0.8,
            }}
          >
            Loading destinations…
          </div>
        );
      }

      if (destinationSuggestions.length === 0) {
        return (
          <div
            style={{
              padding: "16px",
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: 13,
              color: SAND_CREAM,
              border: `2px dashed ${SAND_CREAM}`,
              opacity: 0.7,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <span>No destinations generated yet</span>
            {isHost && (
              <button
                type="button"
                onClick={() => void regenerateDestinations()}
                disabled={regenerating}
                aria-label="Retry generating destinations"
                style={{
                  alignSelf: "flex-start",
                  background: regenerating ? DEEP_NAVY : SUNSET_ORANGE,
                  border: `2px solid ${DEEP_NAVY}`,
                  boxShadow: regenerating ? "none" : `4px 4px 0 ${DEEP_NAVY}`,
                  color: DEEP_NAVY,
                  padding: "7px 14px",
                  fontSize: 12,
                  fontFamily: "'Courier New', Courier, monospace",
                  fontWeight: 700,
                  cursor: regenerating ? "not-allowed" : "pointer",
                  opacity: regenerating ? 0.65 : 1,
                  borderRadius: 0,
                  outline: "none",
                }}
              >
                {regenerating ? "🔄 Generating…" : "🔄 Retry"}
              </button>
            )}
          </div>
        );
      }

      // Check if current user has already submitted votes
      const myVotedIds = destinationVotes
        .filter((v) => v.userId === identity.userId)
        .map((v) => v.selectedOption);
      const hasSubmittedVotes = submittedStages.has(stage) || myVotedIds.length > 0;

      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{
            margin: 0,
            fontSize: 12,
            fontFamily: "'Courier New', Courier, monospace",
            color: SAND_CREAM,
            opacity: 0.8,
          }}>
            Select one or more destinations you'd like, then click Submit.
          </p>

          {destinationSuggestions.map((suggestion) => {
            const voteCount = destinationVotes.filter(
              (v) => v.selectedOption === suggestion.id
            ).length;
            const isSelected = hasSubmittedVotes
              ? myVotedIds.includes(suggestion.id)
              : selectedDestinationIds.includes(suggestion.id);

            return (
              <VoteableDestinationCard
                key={suggestion.id}
                suggestion={suggestion}
                currentUserId={identity.userId}
                hasVoted={isSelected}
                voteCount={voteCount}
                onVote={async (id) => {
                  if (hasSubmittedVotes) return;
                  // Toggle selection instead of immediate submit
                  setSelectedDestinationIds((prev) =>
                    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                  );
                }}
              />
            );
          })}

          {/* Submit votes button */}
          {!hasSubmittedVotes && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start", marginTop: 4 }}>
              <button
                type="button"
                onClick={() => void handleSubmitDestinationVotes()}
                disabled={submittingVotes || selectedDestinationIds.length === 0}
                aria-label="Submit your destination votes"
                style={{
                  border: `3px solid ${DEEP_NAVY}`,
                  borderRadius: 0,
                  backgroundColor: (submittingVotes || selectedDestinationIds.length === 0) ? "#9CA3AF" : "#4ADE80",
                  color: DEEP_NAVY,
                  padding: "10px 24px",
                  fontFamily: "'Courier New', Courier, monospace",
                  fontWeight: 700,
                  fontSize: "0.9rem",
                  cursor: (submittingVotes || selectedDestinationIds.length === 0) ? "not-allowed" : "pointer",
                  opacity: (submittingVotes || selectedDestinationIds.length === 0) ? 0.6 : 1,
                  boxShadow: (submittingVotes || selectedDestinationIds.length === 0) ? "none" : `4px 4px 0 ${DEEP_NAVY}`,
                }}
              >
                {submittingVotes
                  ? "Submitting…"
                  : selectedDestinationIds.length === 0
                    ? "🗳 Select destinations to vote"
                    : `🗳 Submit votes (${selectedDestinationIds.length} selected)`
                }
              </button>
              {voteSubmitError && (
                <p style={{
                  fontSize: "0.8rem",
                  color: "#FB923C",
                  fontFamily: "'Courier New', Courier, monospace",
                  fontWeight: 700,
                  border: `2px solid #FB923C`,
                  padding: "6px 10px",
                  backgroundColor: "#FEF3C7",
                }}>
                  ⚠ {voteSubmitError}
                </p>
              )}
            </div>
          )}

          {hasSubmittedVotes && (
            <div style={{
              border: `2px solid #4ADE80`,
              backgroundColor: "#FEF3C7",
              padding: "10px 16px",
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: 13,
              fontWeight: 700,
              color: DEEP_NAVY,
            }}>
              ✓ Votes submitted! Waiting for others…
            </div>
          )}

          {/* ── Tiebreaker UI (host only, shown after tie is detected) ── */}
          {tiedDestinationIds && tiedDestinationIds.length > 0 && (
            <div style={{
              border: `3px solid ${SUNSET_ORANGE}`,
              boxShadow: `4px 4px 0 ${DEEP_NAVY}`,
              backgroundColor: "#FEF3C7",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              fontFamily: "'Courier New', Courier, monospace",
            }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: DEEP_NAVY }}>
                ⚖️ Tiebreaker needed
              </p>
              {isHost ? (
                <>
                  <p style={{ margin: 0, fontSize: 12, color: DEEP_NAVY, opacity: 0.8 }}>
                    These destinations are tied. As host, pick the winner:
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {tiedDestinationIds.map((id) => {
                      const dest = destinationSuggestions.find((s) => s.id === id);
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => void handleBreakTie(id)}
                          disabled={breakingTie}
                          style={{
                            border: `3px solid ${DEEP_NAVY}`,
                            borderRadius: 0,
                            backgroundColor: breakingTie ? "#9CA3AF" : SUNSET_ORANGE,
                            color: DEEP_NAVY,
                            padding: "10px 16px",
                            fontFamily: "'Courier New', Courier, monospace",
                            fontWeight: 700,
                            fontSize: 13,
                            cursor: breakingTie ? "not-allowed" : "pointer",
                            opacity: breakingTie ? 0.6 : 1,
                            boxShadow: breakingTie ? "none" : `3px 3px 0 ${DEEP_NAVY}`,
                            textAlign: "left" as const,
                          }}
                        >
                          {breakingTie ? "Selecting…" : `▶ Pick "${dest?.destinationName ?? id}"`}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: DEEP_NAVY, opacity: 0.8 }}>
                  Waiting for the host to break the tie…
                </p>
              )}
            </div>
          )}
        </div>
      );
    }

    // FLIGHTS / FLIGHT_VOTE → VoteableFlightCard list
    if (stage === RoomStage.FLIGHTS || stage === RoomStage.FLIGHT_VOTE) {
      if (MOCK_FLIGHT_OPTIONS.length === 0) {
        return (
          <div
            style={{
              padding: "16px",
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: 13,
              color: SAND_CREAM,
              border: `2px dashed ${SAND_CREAM}`,
              opacity: 0.7,
            }}
          >
            No flight options loaded yet
          </div>
        );
      }

      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {MOCK_FLIGHT_OPTIONS.map((option) => {
            const myVote = flightVotes.find(
              (v) => v.userId === identity.userId && v.selectedOption === option.value
            );
            const voteCount = flightVotes.filter(
              (v) => v.selectedOption === option.value
            ).length;

            return (
              <VoteableFlightCard
                key={option.value}
                category={option.value}
                priceRange={option.priceRange}
                estimatedDuration={option.duration}
                stops={option.stops}
                budgetImpact={null}
                itineraryComfort={option.itineraryImpact}
                hasVoted={!!myVote}
                voteCount={voteCount}
                onVote={handleFlightVote}
              />
            );
          })}
        </div>
      );
    }

    // ACTIVITIES, ITINERARY, FEEDBACK, NEGOTIATION, FINAL → StageRouter
    return <StageRouter {...stageProps} />;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        backgroundColor: DEEP_NAVY,
        fontFamily: "'Courier New', Courier, monospace",
        overflow: "hidden",
      }}
    >
      {/* ── Agent label bar ─────────────────────────────────────────────────── */}
      <div
        style={{
          backgroundColor: DEEP_NAVY,
          borderBottom: `3px solid ${SAND_CREAM}`,
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 22,
            imageRendering: "pixelated",
          }}
          aria-hidden="true"
        >
          🤖
        </span>
        <span
          style={{
            color: SAND_CREAM,
            fontSize: 13,
            fontFamily: "'Courier New', Courier, monospace",
            letterSpacing: 1,
            textTransform: "uppercase",
            fontWeight: "bold",
          }}
        >
          Trip Agent
        </span>
        <span
          style={{
            marginLeft: "auto",
            color: SAND_CREAM,
            fontSize: 11,
            opacity: 0.6,
            fontFamily: "'Courier New', Courier, monospace",
          }}
        >
          {room.currentStage}
        </span>
      </div>

      {/* ── Vertically scrollable message thread ────────────────────────────── */}
      {/*
        aria-live="polite" satisfies Req 14.1 — screen readers announce each
        new message as it is appended without interrupting the user.
      */}
      <div
        aria-live="polite"
        aria-label="Trip Agent conversation"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          scrollbarColor: `${SAND_CREAM} ${DEEP_NAVY}`,
        }}
      >
        {/* Render each message as a TripAgentMessage article */}
        {messages.map((msg, index) => {
          const isLastMessage = index === messages.length - 1;

          return (
            <TripAgentMessage
              key={msg.id}
              text={msg.text}
              isSystem={msg.type === "system" || msg.type === "error"}
            >
              {/*
                For the LAST message only:
                - When the current user has NOT yet submitted → show InteractiveSlot
                  with the stage-routed content (task 11.2).
                - When the current user HAS submitted → show WaitingState with
                  their confirmed selections and per-member ReadyBadge status.
                  (Task 11.3 — Req 4.6, 11.1)
              */}
              {isLastMessage && (
                currentUserSubmitted ? (
                  /*
                   * ── WaitingState ────────────────────────────────────────
                   * memberStatuses is re-derived on every render so ReadyBadge
                   * states update reactively as the 3-second polling loop
                   * returns fresh characterProfiles data.
                   * onEditResponse removes the current stage from submittedStages
                   * so the InteractiveSlot is revealed again.
                   */
                  <WaitingState
                    submittedSelections={buildSubmittedSelections(
                      room.currentStage,
                      identity,
                      characterProfiles,
                      // For AVAILABILITY: pass the summary text derived from the
                      // confirmation AgentMessage appended on successful save (task 11.8)
                      room.currentStage === RoomStage.AVAILABILITY
                        ? messages
                            .filter((m) => m.stage === RoomStage.AVAILABILITY && m.type === "confirmation")
                            .at(-1)?.text
                        : undefined
                    )}
                    memberStatuses={memberStatuses}
                    onEditResponse={handleEditResponse}
                  />
                ) : (
                  /*
                   * ── InteractiveSlot with stage routing ───────────────────
                   * renderSlotContent() maps the current stage to the
                   * appropriate interactive component (task 11.2).
                   */
                  <InteractiveSlot isSaving={pendingSlotSave}>
                    {renderSlotContent()}
                  </InteractiveSlot>
                )
              )}
            </TripAgentMessage>
          );
        })}

        {/* Zero-height sentinel — bottomRef target for smooth-scroll */}
        <div
          ref={bottomRef}
          style={{ height: 0, flexShrink: 0 }}
          aria-hidden="true"
        />
      </div>

      {/* ── Host controls bar (task 11.5) ───────────────────────────────────── */}
      {/*
        Rendered OUTSIDE the aria-live region so screen readers don't
        announce the buttons on every re-render. Only visible to the host.
        Requirements: 13.1, 13.2, 13.3, 13.4, 13.5
      */}
      {isHost && (
        <div
          style={{
            flexShrink: 0,
            padding: "12px 16px",
            borderTop: `2px solid ${SAND_CREAM}`,
            backgroundColor: DEEP_NAVY,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
          }}
        >
          {/* Regenerate destinations button — DESTINATIONS stage only (Req 13.4, 13.5) */}
          {room.currentStage === RoomStage.DESTINATIONS && (
            <button
              type="button"
              onClick={() => void regenerateDestinations()}
              disabled={regenerating}
              aria-label="Regenerate destination suggestions"
              style={{
                background: regenerating ? DEEP_NAVY : SKY_BLUE,
                border: `2px solid ${DEEP_NAVY}`,
                boxShadow: regenerating ? "none" : `4px 4px 0 ${DEEP_NAVY}`,
                color: regenerating ? SAND_CREAM : DEEP_NAVY,
                padding: "7px 14px",
                fontSize: 12,
                fontFamily: "'Courier New', Courier, monospace",
                fontWeight: 700,
                cursor: regenerating ? "not-allowed" : "pointer",
                opacity: regenerating ? 0.65 : 1,
                borderRadius: 0,
                outline: "none",
                transition: "box-shadow 0.1s, opacity 0.1s",
              }}
              onFocus={(e) => {
                e.currentTarget.style.outline = "3px solid #A855F7";
                e.currentTarget.style.outlineOffset = "2px";
              }}
              onBlur={(e) => {
                e.currentTarget.style.outline = "none";
              }}
            >
              {regenerating ? "🔄 Generating…" : "🔄 Regenerate destinations"}
            </button>
          )}

          {/* Advance stage button — all stages, host only (Req 13.1, 13.2, 13.3) */}
          <button
            type="button"
            onClick={() => void advanceStage()}
            disabled={!canAdvanceStage() || advancingStage}
            aria-label="Move to next step"
            aria-disabled={!canAdvanceStage() || advancingStage}
            style={{
              background:
                !canAdvanceStage() || advancingStage
                  ? DEEP_NAVY
                  : SUNSET_ORANGE,
              border:
                !canAdvanceStage() || advancingStage
                  ? `2px solid ${SAND_CREAM}`
                  : `2px solid #C2410C`,
              boxShadow:
                !canAdvanceStage() || advancingStage
                  ? "none"
                  : `4px 4px 0 ${DEEP_NAVY}`,
              color:
                !canAdvanceStage() || advancingStage
                  ? SAND_CREAM
                  : DEEP_NAVY,
              padding: "7px 14px",
              fontSize: 12,
              fontFamily: "'Courier New', Courier, monospace",
              fontWeight: 700,
              cursor:
                !canAdvanceStage() || advancingStage
                  ? "not-allowed"
                  : "pointer",
              opacity: !canAdvanceStage() || advancingStage ? 0.55 : 1,
              borderRadius: 0,
              outline: "none",
              transition: "box-shadow 0.1s, opacity 0.1s",
              marginLeft: "auto",
            }}
            onFocus={(e) => {
              e.currentTarget.style.outline = "3px solid #A855F7";
              e.currentTarget.style.outlineOffset = "2px";
            }}
            onBlur={(e) => {
              e.currentTarget.style.outline = "none";
            }}
          >
            {advancingStage ? "▶ Advancing…" : "▶ Move to next step"}
          </button>
        </div>
      )}
    </main>
  );
}

// ─── Stable setter exports for tasks 11.3–11.8 ───────────────────────────────
//
// Child components and later task extensions that need to mutate
// submittedStages or pendingSlotSave should receive these setters via props
// or through a context provider added in a later task. They are not exported
// directly from this module (React state setters cannot be exported as module
// constants), but the state shapes and their mutation rules are documented
// here for clarity:
//
//   setSubmittedStages: React.Dispatch<React.SetStateAction<Set<RoomStage>>>
//     - Only ever add to the set (never clear): prev => new Set([...prev, stage])
//     - Called when the current user's save to a stage endpoint succeeds
//
//   setPendingSlotSave: React.Dispatch<React.SetStateAction<boolean>>
//     - Set true when a slot save starts, false when it finishes or times out
//     - Managed automatically by saveWithTimeout() — do not set manually
//
//   saveWithTimeout<T>(url, options): Promise<T>
//     - Wraps any fetch-based slot save with a 10-second AbortController timeout
//     - Sets pendingSlotSave=true before fetch, false in finally block
//     - On timeout: appends inline error AgentMessage (type: "error"), re-enables slot
//     - On network/server error: appends inline error AgentMessage (type: "error")
//     - Never shows a full-page error view (Req 3.7)
//     - Requirements: 4.3, 4.4, 4.5, 3.7, 7.8, 7.9
