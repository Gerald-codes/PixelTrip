"use client";

import { useCallback, useEffect, useState } from "react";

import ItineraryDayComponent from "@/app/components/ItineraryDay";
import type { StageProps } from "@/app/components/StageRouter";
import { createAnonSupabase } from "@/lib/supabase";
import type {
  ConflictResolution,
  Itinerary,
  TripRoom,
  User,
} from "@/lib/types";

// ─── Types ─────────────────────────────────────────────────────────────────

/** The negotiation agent returns Itinerary + diffSummary merged together. */
interface NegotiationResult extends Itinerary {
  diffSummary: string;
}

// ─── NegotiationStage ───────────────────────────────────────────────────────

export default function NegotiationStage({
  room,
  identity,
  members,
  onRoomUpdated,
  onGoBack,
}: StageProps) {
  const isHost = identity.userId === room.hostUserId;

  // ── State ────────────────────────────────────────────────────────────────
  const [conflicts, setConflicts] = useState<ConflictResolution[]>([]);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [diffSummary, setDiffSummary] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [selectedResolutions, setSelectedResolutions] = useState<
    Record<string, string>
  >({});
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Data fetchers ─────────────────────────────────────────────────────────
  const fetchConflicts = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/conflicts?roomId=${encodeURIComponent(room.id)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Failed to load conflicts");
      }
      const data = (await res.json()) as ConflictResolution[];
      setConflicts(data);
      // Pre-populate selectedResolutions from already-resolved conflicts.
      setSelectedResolutions((prev) => {
        const next = { ...prev };
        data.forEach((c) => {
          if (c.selectedResolution && !next[c.id]) {
            next[c.id] = c.selectedResolution;
          }
        });
        return next;
      });
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load conflicts",
      );
    }
  }, [room.id]);

  const fetchItinerary = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/agents/itinerary?roomId=${encodeURIComponent(room.id)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return; // 404 is fine — no itinerary yet
      const data = (await res.json()) as Itinerary;
      setItinerary(data);
    } catch {
      // Non-fatal — itinerary might not exist yet
    }
  }, [room.id]);

  // ── On mount ──────────────────────────────────────────────────────────────
  useEffect(() => {
    void fetchConflicts();
    void fetchItinerary();
  }, [fetchConflicts, fetchItinerary]);

  // ── Realtime: conflicts-updated ───────────────────────────────────────────
  useEffect(() => {
    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${room.id}:negotiation`);
    ch.on("broadcast", { event: "conflicts-updated" }, () => {
      void fetchConflicts();
    }).subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [room.id, fetchConflicts]);

  // ── Realtime: itinerary-updated ───────────────────────────────────────────
  useEffect(() => {
    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${room.id}:itinerary`);
    ch.on(
      "broadcast",
      { event: "itinerary-updated" },
      ({ payload }: { payload?: { diffSummary?: string } }) => {
        void fetchItinerary();
        if (payload?.diffSummary) {
          setDiffSummary(payload.diffSummary);
        }
      },
    ).subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [room.id, fetchItinerary]);

  // ── Option selection (any user) ───────────────────────────────────────────
  async function handleSelectOption(conflictId: string, optionId: string) {
    // Optimistically update local state immediately.
    setSelectedResolutions((prev) => ({ ...prev, [conflictId]: optionId }));
    try {
      await fetch(`/api/conflicts/${encodeURIComponent(conflictId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedResolution: optionId }),
      });
      // Re-fetch to keep in sync (non-fatal if this fails).
      void fetchConflicts();
    } catch {
      // Non-fatal — local selection is still usable
    }
  }

  // ── Host: apply resolution & revise itinerary ─────────────────────────────
  async function handleRevise(conflictId: string) {
    const selectedOption = selectedResolutions[conflictId];
    if (!selectedOption || revising) return;

    setRevising(true);
    setRevisionError(null);
    try {
      const res = await fetch("/api/agents/negotiation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: room.id,
          conflictId,
          selectedResolution: selectedOption,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Failed to revise itinerary");
      }
      const data = (await res.json()) as NegotiationResult;
      setItinerary(data);
      setDiffSummary(data.diffSummary);
    } catch (err) {
      setRevisionError(
        err instanceof Error ? err.message : "Failed to revise itinerary",
      );
    } finally {
      setRevising(false);
    }
  }

  // ── Host: go back to ITINERARY (skip FEEDBACK) ───────────────────────────
  async function handleBackToItinerary() {
    if (advancing) return;
    setAdvancing(true);
    setAdvanceError(null);
    try {
      // NEGOTIATION → FEEDBACK (backward once)
      const res1 = await fetch(`/api/rooms/${room.roomCode}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestingUserId: identity.userId,
          direction: "backward",
        }),
      });
      if (!res1.ok) {
        const b = (await res1.json().catch(() => null)) as { error?: string } | null;
        throw new Error(b?.error ?? "Failed to go back");
      }
      // FEEDBACK → ITINERARY (backward again)
      const res2 = await fetch(`/api/rooms/${room.roomCode}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestingUserId: identity.userId,
          direction: "backward",
        }),
      });
      if (!res2.ok) {
        const b = (await res2.json().catch(() => null)) as { error?: string } | null;
        throw new Error(b?.error ?? "Failed to go back to itinerary");
      }
      const updated = (await res2.json()) as TripRoom;
      onRoomUpdated(updated);
      void broadcastStageChange(room.id);
    } catch (err) {
      setAdvanceError(
        err instanceof Error ? err.message : "Failed to go back to itinerary",
      );
    } finally {
      setAdvancing(false);
    }
  }

  // ── Host: advance to FEEDBACK ──────────────────────────────────────────────
  async function handleAdvanceToFeedback() {
    setAdvancing(true);
    setAdvanceError(null);
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
          body?.message ?? body?.error ?? "Failed to advance stage",
        );
      }
      const updated = (await res.json()) as TripRoom;
      onRoomUpdated(updated);
      void broadcastStageChange(room.id);
    } catch (err) {
      setAdvanceError(
        err instanceof Error ? err.message : "Failed to advance stage",
      );
    } finally {
      setAdvancing(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function getMemberName(userId: string): string {
    const member = members.find((m: User) => m.id === userId);
    return member?.displayName ?? userId;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      {/* Stage header */}
      <div className="border-4 border-[#1E3A5F] bg-[#FEF3C7] p-6 shadow-[4px_4px_0px_#1E3A5F]">
        <p className="text-sm font-bold uppercase tracking-wide text-[#1E3A5F]">
          Current stage
        </p>
        <h2 className="mt-1 text-2xl font-bold text-[#1E3A5F]">
          ⚖️ Conflict Negotiation
        </h2>
        <p className="mt-2 text-[#1E3A5F]">
          Review each conflict, select a resolution option, and the host can
          revise the itinerary to reflect the group&apos;s decision.
        </p>
      </div>

      {/* Load error */}
      {loadError && (
        <div className="border-4 border-red-600 bg-red-50 p-4 text-sm font-semibold text-red-700 shadow-[4px_4px_0px_#1E3A5F]">
          {loadError}
        </div>
      )}

      {/* Diff summary banner (dismissible amber) */}
      {diffSummary && (
        <div className="border-2 border-[#FB923C] bg-amber-50 p-4 shadow-[4px_4px_0px_#1E3A5F]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-amber-900">
                ✏️ Itinerary revised
              </p>
              <p className="mt-1 text-sm text-amber-800">{diffSummary}</p>
            </div>
            <button
              type="button"
              onClick={() => setDiffSummary(null)}
              className="flex-none border-2 border-[#FB923C] bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900 shadow-[2px_2px_0px_#92400E] hover:bg-amber-200 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
              aria-label="Dismiss diff summary"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Revision error */}
      {revisionError && (
        <div className="border-4 border-red-600 bg-red-50 p-4 text-sm font-semibold text-red-700 shadow-[4px_4px_0px_#1E3A5F]">
          {revisionError}
        </div>
      )}

      {/* Revising loading state */}
      {revising && (
        <div className="border-4 border-[#38BDF8] bg-[#FEF3C7] p-6 shadow-[4px_4px_0px_#1E3A5F]">
          <p className="font-bold text-[#1E3A5F]">Revising itinerary…</p>
          <p className="mt-1 text-sm text-[#1E3A5F]">
            Applying the chosen resolution and updating the plan. This takes
            about 15–30 seconds.
          </p>
        </div>
      )}

      {/* Empty state */}
      {!loadError && conflicts.length === 0 && (
        <div className="border-4 border-[#1E3A5F] bg-[#FEF3C7] p-6 shadow-[4px_4px_0px_#1E3A5F]">
          <p className="text-sm font-semibold text-[#1E3A5F]">
            No conflicts to resolve — the host can advance back to the
            itinerary.
          </p>
        </div>
      )}

      {/* Conflict cards */}
      {conflicts.map((conflict) => (
        <ConflictCard
          key={conflict.id}
          conflict={conflict}
          isHost={isHost}
          revising={revising}
          selectedOptionId={selectedResolutions[conflict.id] ?? null}
          getMemberName={getMemberName}
          onSelectOption={(optionId) =>
            void handleSelectOption(conflict.id, optionId)
          }
          onRevise={() => void handleRevise(conflict.id)}
        />
      ))}

      {/* Revised itinerary inline preview */}
      {itinerary && itinerary.days.length > 0 && diffSummary && (
        <div className="flex flex-col gap-4">
          <div className="border-4 border-[#1E3A5F] bg-[#FEF3C7] px-4 py-3 shadow-[4px_4px_0px_#1E3A5F]">
            <p className="font-bold text-[#1E3A5F]">
              📅 Revised itinerary — {itinerary.destination}
            </p>
            <p className="mt-0.5 text-xs text-[#1E3A5F] opacity-70">
              {itinerary.startDate} → {itinerary.endDate} · Version{" "}
              {itinerary.versionNumber}
            </p>
          </div>
          {itinerary.days.map((day, idx) => (
            <ItineraryDayComponent
              key={day.date}
              day={day}
              dayNumber={idx + 1}
              defaultOpen={idx === 0}
            />
          ))}
        </div>
      )}

      {/* Host nav buttons */}
      {isHost ? (
        <div className="flex flex-wrap items-center gap-3 border-4 border-[#1E3A5F] bg-[#FEF3C7] p-4 shadow-[4px_4px_0px_#1E3A5F]">
          {isHost && (
            <button
              type="button"
              onClick={() => void handleBackToItinerary()}
              disabled={revising || advancing}
              className="border-4 border-[#1E3A5F] bg-[#FEF3C7] px-4 py-2 font-bold text-[#1E3A5F] shadow-[4px_4px_0px_#1E3A5F] hover:bg-[#fde68a] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              ← Back to Itinerary
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleAdvanceToFeedback()}
            disabled={revising || advancing}
            className="border-4 border-[#1E3A5F] bg-[#FB923C] px-4 py-2 font-bold text-[#1E3A5F] shadow-[4px_4px_0px_#1E3A5F] hover:bg-[#f97316] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {advancing ? "Advancing…" : "🔁 Another round of feedback"}
          </button>
          {advanceError && (
            <p className="w-full text-sm font-semibold text-red-600">
              {advanceError}
            </p>
          )}
        </div>
      ) : (
        <div className="border-4 border-[#1E3A5F] bg-[#FEF3C7] p-4 shadow-[4px_4px_0px_#1E3A5F]">
          <p className="text-sm font-semibold text-[#1E3A5F]">
            Select a resolution option above. The host will apply the chosen
            resolution and revise the itinerary.
          </p>
        </div>
      )}
    </section>
  );
}

// ─── ConflictCard sub-component ─────────────────────────────────────────────

interface ConflictCardProps {
  conflict: ConflictResolution;
  isHost: boolean;
  revising: boolean;
  selectedOptionId: string | null;
  getMemberName: (userId: string) => string;
  onSelectOption: (optionId: string) => void;
  onRevise: () => void;
}

function ConflictCard({
  conflict,
  isHost,
  revising,
  selectedOptionId,
  getMemberName,
  onSelectOption,
  onRevise,
}: ConflictCardProps) {
  const canRevise = isHost && selectedOptionId !== null && !revising;

  return (
    <article className="flex flex-col gap-4 border-4 border-[#1E3A5F] bg-[#FEF3C7] p-5 shadow-[4px_4px_0px_#1E3A5F]">
      {/* Conflict summary */}
      <div>
        <div className="flex items-center gap-2">
          <span className="border-2 border-[#1E3A5F] bg-[#A855F7] px-2 py-0.5 text-xs font-bold text-white shadow-[2px_2px_0px_#1E3A5F]">
            CONFLICT
          </span>
          {conflict.status === "resolved" && (
            <span className="border-2 border-[#4ADE80] bg-[#4ADE80] px-2 py-0.5 text-xs font-bold text-[#1E3A5F] shadow-[2px_2px_0px_#1E3A5F]">
              RESOLVED
            </span>
          )}
        </div>
        <p className="mt-2 font-bold text-[#1E3A5F]">
          {conflict.conflictSummary}
        </p>
      </div>

      {/* Affected members */}
      {conflict.affectedUsers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F] opacity-60">
            Affects:
          </span>
          {conflict.affectedUsers.map((userId) => (
            <span
              key={userId}
              className="border-2 border-[#1E3A5F] bg-[#38BDF8] px-2 py-0.5 text-xs font-bold text-[#1E3A5F] shadow-[1px_1px_0px_#1E3A5F]"
            >
              {getMemberName(userId)}
            </span>
          ))}
        </div>
      )}

      {/* Option cards */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-bold uppercase tracking-wide text-[#1E3A5F]">
          Resolution options
        </p>
        {conflict.proposedOptions.map((option) => {
          const isSelected = selectedOptionId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelectOption(option.id)}
              disabled={revising}
              className={[
                "flex flex-col gap-1 border-4 p-4 text-left transition-colors shadow-[4px_4px_0px_#1E3A5F]",
                isSelected
                  ? "border-[#4ADE80] bg-[#f0fdf4]"
                  : "border-[#1E3A5F] bg-white hover:bg-[#f5fff0]",
                revising ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              ].join(" ")}
              aria-pressed={isSelected}
            >
              <div className="flex items-center gap-2">
                {isSelected && (
                  <span className="text-[#4ADE80] font-bold">✓</span>
                )}
                <span className="font-bold text-[#1E3A5F]">
                  {option.description}
                </span>
              </div>
              {option.tradeoffs && (
                <p className="mt-1 text-xs text-[#1E3A5F] opacity-70 leading-relaxed">
                  Trade-offs: {option.tradeoffs}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {/* Host: apply resolution button */}
      {isHost && (
        <div className="flex flex-col gap-2 pt-1 border-t-2 border-dashed border-[#1E3A5F]">
          <button
            type="button"
            onClick={onRevise}
            disabled={!canRevise}
            className="self-start border-4 border-[#1E3A5F] bg-[#4ADE80] px-4 py-2 font-bold text-[#1E3A5F] shadow-[4px_4px_0px_#1E3A5F] hover:bg-[#22c55e] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {revising ? "Revising itinerary…" : "Apply resolution & revise itinerary"}
          </button>
          {!selectedOptionId && (
            <p className="text-xs font-semibold text-[#1E3A5F] opacity-70">
              Select a resolution option above to enable this button.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

// ─── Broadcast helpers ───────────────────────────────────────────────────────

async function broadcastStageChange(roomId: string): Promise<void> {
  const supabase = createAnonSupabase();
  const channel = supabase.channel(`room:${roomId}:stage`);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
  await channel.send({ type: "broadcast", event: "stage-change", payload: {} });
  void supabase.removeChannel(channel);
}
