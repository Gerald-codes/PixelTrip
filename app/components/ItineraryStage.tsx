"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import FairnessSummary from "@/app/components/FairnessSummary";
import ItineraryDay from "@/app/components/ItineraryDay";
import type { StageProps } from "@/app/components/StageRouter";
import { createAnonSupabase } from "@/lib/supabase";
import type { Itinerary, TripRoom } from "@/lib/types";

export default function ItineraryStage({
  room,
  identity,
  members,
  onRoomUpdated,
}: StageProps) {
  const isHost = identity.userId === room.hostUserId;

  // ── Core itinerary state ──────────────────────────────────────────────────
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [allVersions, setAllVersions] = useState<Itinerary[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Agent / generation state ──────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // ── Diff summary banner ───────────────────────────────────────────────────
  const [diffSummary, setDiffSummary] = useState<string | null>(null);

  // ── Finalise state ────────────────────────────────────────────────────────
  const [finalising, setFinalising] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  /**
   * Guards against duplicate auto-generation calls. Refs (not state) are used
   * because React StrictMode double-invokes effects in development, and
   * because state updates inside the mount effect's async callback can race
   * with a second mount before the first fetch resolves. This ref persists
   * across the double-invoke and across remounts triggered by parent
   * re-renders within the same browser session tab.
   */
  const autoGenerateAttemptedRef = useRef(false);

  // ── Fetch helpers ─────────────────────────────────────────────────────────

  const fetchLatestItinerary = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(
        `/api/agents/itinerary?roomId=${encodeURIComponent(room.id)}`,
        { cache: "no-store" },
      );
      if (res.status === 404) {
        setItinerary(null);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        console.warn("[ItineraryStage] failed to load itinerary:", body?.error);
        return;
      }
      const data = (await res.json()) as Itinerary;
      setItinerary(data);
    } catch (err) {
      console.warn("[ItineraryStage] fetch error:", err);
    }
  }, [room.id]);

  const fetchAllVersions = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/itinerary/${encodeURIComponent(room.id)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as Itinerary[];
      setAllVersions(data);
    } catch (err) {
      console.warn("[ItineraryStage] fetchAllVersions error:", err);
    }
  }, [room.id]);

  // ── On mount: load latest + all versions; auto-generate if empty ─────────
  //
  // autoGenerateAttemptedRef ensures we only ever fire ONE auto-generate call
  // per component lifetime, regardless of StrictMode double-invocation or
  // rapid remounts. Without this guard, two (or more) concurrent POSTs could
  // each observe "no itinerary yet" and each insert a new version row,
  // producing several versions from what should be a single generation.
  useEffect(() => {
    setLoading(true);
    void Promise.all([fetchLatestItinerary(), fetchAllVersions()]).then(() => {
      setLoading(false);
      // Auto-generate if no itinerary exists yet (host only, once ever).
      setItinerary((current) => {
        if (!current && isHost && !autoGenerateAttemptedRef.current) {
          autoGenerateAttemptedRef.current = true;
          void handleGenerate();
        }
        return current;
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Realtime subscription ─────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${room.id}:itinerary`);
    ch.on(
      "broadcast",
      { event: "itinerary-updated" },
      ({ payload }: { payload?: { diffSummary?: string } }) => {
        void fetchLatestItinerary();
        void fetchAllVersions();
        if (payload?.diffSummary) {
          setDiffSummary(payload.diffSummary);
        }
      },
    ).subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [room.id, fetchLatestItinerary, fetchAllVersions]);

  // ── Generate itinerary (host only) ────────────────────────────────────────
  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch("/api/agents/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setGenerateError(body?.error ?? "Failed to generate itinerary");
        return;
      }
      const data = (await res.json()) as Itinerary;
      setItinerary(data);
      setGenerateError(null);
      await fetchAllVersions();
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : "Failed to generate itinerary",
      );
    } finally {
      setGenerating(false);
    }
  }

  // ── Advance stage helper ──────────────────────────────────────────────────
  async function patchStage(): Promise<TripRoom | null> {
    const res = await fetch(`/api/rooms/${room.roomCode}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestingUserId: identity.userId }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;
      throw new Error(body?.message ?? body?.error ?? "Failed to advance stage");
    }
    return (await res.json()) as TripRoom;
  }

  // ── Advance to FEEDBACK ───────────────────────────────────────────────────
  async function handleAdvanceToFeedback() {
    setAdvanceError(null);
    try {
      const updated = await patchStage();
      if (updated) {
        onRoomUpdated(updated);
        await broadcastStageChange(room.id);
      }
    } catch (err) {
      setAdvanceError(err instanceof Error ? err.message : "Failed to advance stage");
    }
  }

  // ── Finalise & advance to FINAL ───────────────────────────────────────────
  async function handleFinalise() {
    if (finalising) return;
    setFinalising(true);
    setAdvanceError(null);
    try {
      // Finalise the itinerary — the API also sets current_stage=FINAL on the room
      const finaliseRes = await fetch(
        `/api/itinerary/${encodeURIComponent(room.id)}/finalise`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestingUserId: identity.userId }),
        },
      );
      if (!finaliseRes.ok) {
        const body = (await finaliseRes.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Failed to finalise itinerary");
      }
      const finalised = (await finaliseRes.json()) as Itinerary;
      setItinerary(finalised);

      // Re-fetch the room to get updated currentStage=FINAL and finalItineraryId
      const roomRes = await fetch(`/api/rooms/${room.roomCode}`, { cache: "no-store" });
      if (roomRes.ok) {
        const updatedRoom = (await roomRes.json()) as TripRoom;
        onRoomUpdated(updatedRoom);
      }
      await broadcastStageChange(room.id);
    } catch (err) {
      setAdvanceError(err instanceof Error ? err.message : "Failed to finalise");
    } finally {
      setFinalising(false);
    }
  }

  // ── Version history: which itinerary to display ───────────────────────────
  const viewingItinerary: Itinerary | null = selectedVersionId
    ? (allVersions.find((v) => v.id === selectedVersionId) ?? itinerary)
    : itinerary;

  const isFinalised = itinerary?.status === "final";

  // ── Date formatter ────────────────────────────────────────────────────────
  function formatDate(dateStr: string): string {
    try {
      const [year, month, day] = dateStr.split("-").map(Number);
      return new Date(year, month - 1, day).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      {/* Stage header */}
      <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-6 shadow-pixel-card">
        <p className="text-sm font-bold uppercase tracking-wide text-pt-text-primary">
          Current stage
        </p>
        <h2 className="mt-1 text-2xl font-bold text-pt-text-primary">
          Group Itinerary
        </h2>
        <p className="mt-2 text-pt-text-primary">
          Your AI-crafted, persona-balanced day-by-day travel plan. Every
          activity is chosen with your group&apos;s travel styles in mind.
        </p>
      </div>

      {/* Diff summary banner */}
      {diffSummary && (
        <div
          className="flex items-start justify-between gap-4 border-2 border-[#FB923C] bg-amber-50 p-4 shadow-pixel-card"
          role="alert"
        >
          <div>
            <p className="font-bold text-pt-text-primary text-sm flex items-center gap-1">
              <span aria-hidden="true">🔄</span> What changed
            </p>
            <p className="mt-1 text-sm text-pt-text-primary">{diffSummary}</p>
          </div>
          <button
            type="button"
            onClick={() => setDiffSummary(null)}
            aria-label="Dismiss update banner"
            className="shrink-0 border-2 border-[#FB923C] px-2 py-0.5 text-xs font-bold text-[#FB923C] hover:bg-[#FB923C] hover:text-white active:translate-x-[1px] active:translate-y-[1px]"
          >
            ✕
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-6 text-sm font-semibold text-pt-text-primary shadow-pixel-card">
          Loading itinerary…
        </div>
      )}

      {/* Empty state */}
      {!loading && !itinerary && !generating && (
        <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-6 shadow-pixel-card">
          {isHost ? (
            <>
              <h3 className="text-lg font-bold text-pt-text-primary">
                No itinerary yet
              </h3>
              <p className="mt-1 text-sm text-pt-text-primary">
                Run the itinerary agent to craft a persona-balanced day-by-day
                plan for your group. This usually takes 20–30 seconds.
              </p>
              <button
                type="button"
                onClick={() => void handleGenerate()}
                className="mt-4 border-4 border-pt-text-primary border-opacity-20 bg-[#38BDF8] px-4 py-2 font-bold text-pt-text-primary shadow-pixel-card hover:bg-[#0ea5e9] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
              >
                Generate itinerary
              </button>
            </>
          ) : (
            <p className="text-sm font-semibold text-pt-text-primary">
              Waiting for the host to generate the group itinerary…
            </p>
          )}
        </div>
      )}

      {/* Generating spinner */}
      {generating && (
        <div className="border-4 border-[#38BDF8] bg-[var(--pt-bg-card)] p-6 shadow-pixel-card">
          <p className="font-bold text-pt-text-primary flex items-center gap-2">
            <span className="inline-block animate-bounce">✦</span>
            <span className="inline-block animate-bounce [animation-delay:0.15s]">✦</span>
            <span className="inline-block animate-bounce [animation-delay:0.3s]">✦</span>
            <span className="ml-1">Crafting your group itinerary…</span>
          </p>
          <p className="mt-2 text-sm text-pt-text-primary">
            Balancing each member&apos;s persona, must-have activities, pace,
            and budget. This takes about 20–30 seconds.
          </p>
        </div>
      )}

      {/* Generate error */}
      {generateError && !generating && (
        <div className="border-4 border-red-600 bg-red-50 p-4 shadow-pixel-card">
          <p className="text-sm font-bold text-red-800">
            Couldn&apos;t generate itinerary
          </p>
          <p className="mt-1 text-sm font-semibold text-red-700">
            {generateError}
          </p>
          {isHost && (
            <button
              type="button"
              onClick={() => void handleGenerate()}
              className="mt-3 border-2 border-red-600 bg-red-600 px-3 py-1.5 text-sm font-bold text-white shadow-[3px_3px_0px_#991B1B] hover:bg-red-700 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Version history dropdown */}
      {allVersions.length > 1 && (
        <div className="flex items-center gap-3 border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-4 shadow-pixel-card">
          <label
            htmlFor="version-select"
            className="text-sm font-bold text-pt-text-primary whitespace-nowrap"
          >
            Version history
          </label>
          <select
            id="version-select"
            value={selectedVersionId ?? ""}
            onChange={(e) =>
              setSelectedVersionId(e.target.value === "" ? null : e.target.value)
            }
            className="flex-1 border-2 border-pt-text-primary border-opacity-20 bg-pt-card px-3 py-1.5 text-sm font-semibold text-pt-text-primary focus:outline-none focus:ring-2 focus:ring-[#38BDF8]"
          >
            <option value="">Latest (v{itinerary?.versionNumber ?? "?"})</option>
            {allVersions.map((v) => (
              <option key={v.id} value={v.id}>
                Version {v.versionNumber} ({v.status})
              </option>
            ))}
          </select>
          {selectedVersionId && (
            <span className="border-2 border-[#FB923C] bg-amber-50 px-2 py-0.5 text-xs font-bold text-pt-text-primary">
              Read-only
            </span>
          )}
        </div>
      )}

      {/* Itinerary display */}
      {!loading && viewingItinerary && (
        <div className="flex flex-col gap-6">
          {/* Header card */}
          <div className="border-4 border-pt-text-primary border-opacity-20 bg-[#38BDF8] p-6 shadow-pixel-card">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-2xl font-bold text-pt-text-primary">
                  {viewingItinerary.destination}
                </h3>
                <p className="mt-1 text-sm font-semibold text-pt-text-primary">
                  {formatDate(viewingItinerary.startDate)} —{" "}
                  {formatDate(viewingItinerary.endDate)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                {/* Version badge */}
                <span className="border-2 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] px-3 py-1 text-xs font-bold text-pt-text-primary uppercase tracking-wide shadow-pixel-sm">
                  v{viewingItinerary.versionNumber} · {viewingItinerary.status}
                </span>
                {/* Flight option badge */}
                {room.selectedFlightOption && (
                  <span className="border-2 border-pt-text-primary border-opacity-20 bg-[#4ADE80] px-3 py-1 text-xs font-bold text-pt-text-primary uppercase tracking-wide shadow-pixel-sm">
                    ✈ {room.selectedFlightOption.replace("_", " ")}
                  </span>
                )}
                {/* Average satisfaction score */}
                {viewingItinerary.averageSatisfactionScore !== null && (
                  <span
                    className={`border-2 border-pt-text-primary border-opacity-20 px-3 py-1 text-xs font-bold text-pt-text-primary uppercase tracking-wide shadow-pixel-sm ${
                      viewingItinerary.averageSatisfactionScore >= 7
                        ? "bg-[#4ADE80]"
                        : viewingItinerary.averageSatisfactionScore >= 5
                          ? "bg-amber-200"
                          : "bg-red-200"
                    }`}
                  >
                    ★ Avg score: {viewingItinerary.averageSatisfactionScore.toFixed(1)}/10
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Fairness summary */}
          <FairnessSummary
            summary={viewingItinerary.fairnessSummary}
            members={members}
          />

          {/* Days */}
          <div className="flex flex-col gap-3">
            {viewingItinerary.days.map((day, i) => (
              <ItineraryDay key={i} day={day} dayNumber={i + 1} defaultOpen={i === 0} />
            ))}
          </div>

          {/* Host controls (only shown for the live/current view, not past versions) */}
          {isHost && !selectedVersionId && (
            <div className="flex flex-col gap-3 border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-5 shadow-pixel-card">
              <p className="text-sm font-bold uppercase tracking-wide text-pt-text-primary">
                Host controls
              </p>
              <div className="flex flex-wrap gap-3">
                {/* Regenerate — only if not finalised */}
                {!isFinalised && (
                  <button
                    type="button"
                    onClick={() => void handleGenerate()}
                    disabled={generating}
                    className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] px-3 py-1.5 text-sm font-bold text-pt-text-primary shadow-pixel-card hover:bg-[#fde68a] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {generating ? "Regenerating…" : "↺ Regenerate"}
                  </button>
                )}

                {/* Advance to Feedback */}
                {!isFinalised && (
                  <button
                    type="button"
                    onClick={() => void handleAdvanceToFeedback()}
                    className="border-4 border-pt-text-primary border-opacity-20 bg-[#38BDF8] px-4 py-1.5 font-bold text-pt-text-primary shadow-pixel-card hover:bg-[#0ea5e9] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
                  >
                    Advance to Feedback →
                  </button>
                )}

                {/* Finalise & go to Final */}
                {!isFinalised && (
                  <button
                    type="button"
                    onClick={() => void handleFinalise()}
                    disabled={finalising}
                    className="border-4 border-pt-text-primary border-opacity-20 bg-[#4ADE80] px-4 py-1.5 font-bold text-pt-text-primary shadow-pixel-card hover:bg-[#22c55e] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {finalising ? "Finalising…" : "✓ Finalise & Go to Final"}
                  </button>
                )}

                {isFinalised && (
                  <span className="border-2 border-[#4ADE80] bg-green-50 px-4 py-2 text-sm font-bold text-pt-text-primary shadow-pixel-sm">
                    ✓ Itinerary finalised
                  </span>
                )}
              </div>
              {advanceError && (
                <p className="text-sm font-semibold text-red-600">{advanceError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Non-host waiting state */}
      {!isHost && !loading && (
        <p className="text-sm font-semibold text-pt-text-primary">
          {itinerary
            ? "Waiting for the host to advance to the next stage…"
            : "Waiting for the host to generate the itinerary…"}
        </p>
      )}
    </section>
  );
}

// ── Broadcast helpers ────────────────────────────────────────────────────────

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
