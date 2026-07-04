"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { StageProps } from "@/app/components/StageRouter";
import FeedbackForm from "@/app/components/FeedbackForm";
import { createAnonSupabase } from "@/lib/supabase";
import type {
  Itinerary,
  ItineraryFeedback,
  ConflictResolution,
  TripRoom,
} from "@/lib/types";

/**
 * FeedbackStage — each user scores the current itinerary and submits change
 * requests. The host sees a live dashboard (submission progress, average score,
 * per-member warnings) and can trigger the feedback-analysis agent which
 * decides whether to advance to FINAL or NEGOTIATION.
 *
 * Realtime: subscribes to `room:{roomId}:feedback` → on `feedback-submitted`
 * re-fetches aggregate counts so every member's dashboard updates live.
 */
export default function FeedbackStage({
  room,
  identity,
  members,
  onRoomUpdated,
}: StageProps) {
  const isHost = identity.userId === room.hostUserId;

  // ── Itinerary ──────────────────────────────────────────────────────────────
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [itineraryLoading, setItineraryLoading] = useState(true);
  const [itineraryError, setItineraryError] = useState<string | null>(null);

  // ── Feedback data (aggregate + own) ───────────────────────────────────────
  const [feedbackData, setFeedbackData] = useState<{
    feedback: ItineraryFeedback[];
    averageScore: number | null;
    submittedCount: number;
    totalMembers: number;
  } | null>(null);
  const [myFeedback, setMyFeedback] = useState<ItineraryFeedback | null>(null);

  // ── Editing state: show form when editing ─────────────────────────────────
  const [editing, setEditing] = useState(false);

  // ── Analysis ──────────────────────────────────────────────────────────────
  const [analysisResult, setAnalysisResult] = useState<{
    analysisText: string;
    requiresNegotiation: boolean;
    conflicts: ConflictResolution[];
  } | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // ── Stage advance ─────────────────────────────────────────────────────────
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  // ── Fetch feedback aggregate ───────────────────────────────────────────────
  const fetchFeedbackData = useCallback(
    async (itineraryId: string): Promise<void> => {
      try {
        const res = await fetch(`/api/feedback/${encodeURIComponent(itineraryId)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          feedback: ItineraryFeedback[];
          averageScore: number | null;
          submittedCount: number;
          totalMembers: number;
        };
        setFeedbackData(data);
        const own = data.feedback.find((f) => f.userId === identity.userId) ?? null;
        setMyFeedback(own);
      } catch {
        // Non-fatal — silently skip
      }
    },
    [identity.userId],
  );

  const fetchFeedbackDataRef = useRef(fetchFeedbackData);
  fetchFeedbackDataRef.current = fetchFeedbackData;

  // ── On mount: load itinerary then feedback ─────────────────────────────────
  useEffect(() => {
    async function init() {
      setItineraryLoading(true);
      setItineraryError(null);
      try {
        const res = await fetch(
          `/api/agents/itinerary?roomId=${encodeURIComponent(room.id)}`,
          { cache: "no-store" },
        );
        if (res.status === 404) {
          setItineraryError("No itinerary found for this room.");
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Failed to load itinerary");
        }
        const itin = (await res.json()) as Itinerary;
        setItinerary(itin);
        await fetchFeedbackDataRef.current(itin.id);
      } catch (err) {
        setItineraryError(
          err instanceof Error ? err.message : "Failed to load itinerary",
        );
      } finally {
        setItineraryLoading(false);
      }
    }
    void init();
  }, [room.id]);

  // ── Realtime: re-fetch aggregate when any member submits feedback ──────────
  const itineraryRef = useRef<Itinerary | null>(null);
  itineraryRef.current = itinerary;

  useEffect(() => {
    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${room.id}:feedback`);
    ch.on("broadcast", { event: "feedback-submitted" }, () => {
      const itin = itineraryRef.current;
      if (itin) void fetchFeedbackDataRef.current(itin.id);
    }).subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [room.id]);

  // ── Handle feedback submission / edit ─────────────────────────────────────
  function handleFeedbackSubmitted(f: ItineraryFeedback) {
    setMyFeedback(f);
    setEditing(false);
    // Re-fetch aggregate so host panel updates immediately
    if (itinerary) void fetchFeedbackData(itinerary.id);
  }

  // ── Analyse feedback (host only) ──────────────────────────────────────────
  async function handleAnalyse() {
    if (analysing) return;
    setAnalysing(true);
    setAnalysisError(null);
    try {
      const res = await fetch("/api/agents/feedback-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Analysis failed");
      }
      const data = (await res.json()) as {
        analysisText: string;
        requiresNegotiation: boolean;
        conflicts: ConflictResolution[];
      };
      setAnalysisResult(data);
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : "Failed to analyse feedback",
      );
    } finally {
      setAnalysing(false);
    }
  }

  // ── Stage advance helper ───────────────────────────────────────────────────
  async function handleAdvance(targetStage?: string) {
    if (advancing) return;
    setAdvancing(true);
    setAdvanceError(null);
    try {
      const body: Record<string, string> = {
        requestingUserId: identity.userId,
      };
      if (targetStage) body.targetStage = targetStage;

      const res = await fetch(`/api/rooms/${room.roomCode}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        throw new Error(b?.message ?? b?.error ?? "Failed to advance stage");
      }
      const updated = (await res.json()) as TripRoom;
      onRoomUpdated(updated);
      await broadcastStageChange(room.id);
    } catch (err) {
      setAdvanceError(
        err instanceof Error ? err.message : "Failed to advance stage",
      );
    } finally {
      setAdvancing(false);
    }
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const averageScore = feedbackData?.averageScore ?? null;
  const submittedCount = feedbackData?.submittedCount ?? 0;
  const totalMembers = feedbackData?.totalMembers ?? members.length;
  const hasSubmitted = myFeedback !== null;
  const showForm = !hasSubmitted || editing;

  // ── Render ─────────────────────────────────────────────────────────────────
  if (itineraryLoading) {
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-6 shadow-pixel-card">
          <p className="text-sm font-semibold text-pt-text-primary">Loading itinerary…</p>
        </div>
      </section>
    );
  }

  if (itineraryError) {
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-6">
        <div
          className="p-6 shadow-pixel-card"
          style={{ border: "4px solid #B91C1C", backgroundColor: "#1A0000" }}
        >
          <p className="text-sm font-semibold" style={{ color: "#FCA5A5" }}>{itineraryError}</p>
        </div>
      </section>
    );
  }

  if (!itinerary) return null;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      {/* ── Stage header ── */}
      <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-6 shadow-pixel-card">
        <p className="text-sm font-bold uppercase tracking-wide text-pt-text-primary">
          Current stage
        </p>
        <h2 className="mt-1 text-2xl font-bold text-pt-text-primary">Feedback</h2>
        <p className="mt-2 text-pt-text-primary">
          Rate the itinerary and let the AI know what you&apos;d like changed.
        </p>
        <p className="mt-2 text-xs font-semibold text-pt-text-primary">
          📍 {itinerary.destination} &nbsp;·&nbsp;
          <span className="font-mono">{itinerary.startDate}</span> →{" "}
          <span className="font-mono">{itinerary.endDate}</span> &nbsp;·&nbsp;
          v{itinerary.versionNumber} &nbsp;·&nbsp;
          {itinerary.days.length} day{itinerary.days.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* ── Host dashboard ── */}
      {isHost && (
        <HostDashboard
          feedbackData={feedbackData}
          submittedCount={submittedCount}
          totalMembers={totalMembers}
          averageScore={averageScore}
          members={members}
        />
      )}

      {/* ── Feedback form / submitted view ── */}
      <div className="border-4 border-pt-text-primary border-opacity-20 bg-pt-card p-6 shadow-pixel-card">
        {hasSubmitted && !editing ? (
          <>
            <div className="mb-4 border-2 border-[#4ADE80] px-4 py-3 shadow-pixel-sm" style={{ backgroundColor: "#0A2A1A" }}>
              <p className="font-bold" style={{ color: "#4ADE80" }}>✅ Feedback submitted!</p>
              <p className="mt-1 text-sm" style={{ color: "#86EFAC" }}>
                Score: <span className="font-black">{myFeedback!.score} / 10</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="border-2 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] px-4 py-2 text-sm font-bold text-pt-text-primary shadow-pixel-sm hover:bg-[#FDE68A] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
            >
              ✏️ Edit feedback
            </button>
          </>
        ) : (
          <>
            <h3 className="mb-4 text-lg font-bold text-pt-text-primary">
              {editing ? "Edit your feedback" : "Submit your feedback"}
            </h3>
            <FeedbackForm
              itinerary={itinerary}
              userId={identity.userId}
              existing={myFeedback}
              onSubmitted={handleFeedbackSubmitted}
            />
            {editing && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="mt-3 border-2 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] px-3 py-1 text-sm font-bold text-pt-text-primary shadow-pixel-sm hover:bg-[#FDE68A] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
              >
                Cancel
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Non-host waiting message ── */}
      {!isHost && hasSubmitted && !editing && (
        <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-4 shadow-pixel-card">
          <p className="text-sm font-semibold text-pt-text-primary">
            ⏳ Waiting for the host to analyse feedback…
          </p>
        </div>
      )}

      {/* ── Host: Analyse feedback button + result ── */}
      {isHost && (
        <div className="flex flex-col gap-4">
          {/* Analyse button */}
          {!analysisResult && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void handleAnalyse()}
                disabled={analysing}
                className="self-start border-4 border-pt-text-primary border-opacity-20 bg-[#38BDF8] px-5 py-2 font-bold text-pt-text-primary shadow-pixel-card hover:bg-[#7dd3fc] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {analysing ? "🔍 Analysing group feedback…" : "🔍 Analyse feedback"}
              </button>
              {analysisError && (
                <p className="text-sm font-semibold text-red-600">{analysisError}</p>
              )}
            </div>
          )}

          {/* Analysis result */}
          {analysisResult && (
            <AnalysisPanel
              analysisResult={analysisResult}
              advancing={advancing}
              advanceError={advanceError}
              onAdvanceFinal={() => void handleAdvance()}
              onAdvanceNegotiation={() => void handleAdvance("NEGOTIATION")}
            />
          )}
        </div>
      )}
    </section>
  );
}

// ─── HostDashboard ────────────────────────────────────────────────────────────

interface HostDashboardProps {
  feedbackData: {
    feedback: ItineraryFeedback[];
    averageScore: number | null;
    submittedCount: number;
    totalMembers: number;
  } | null;
  submittedCount: number;
  totalMembers: number;
  averageScore: number | null;
  members: { id: string; displayName: string }[];
}

function HostDashboard({
  feedbackData,
  submittedCount,
  totalMembers,
  averageScore,
  members,
}: HostDashboardProps) {
  const scoreColorClass =
    averageScore === null
      ? "text-pt-text-primary"
      : averageScore >= 7
        ? "text-[#16a34a]"
        : averageScore >= 5
          ? "text-[#FB923C]"
          : "text-red-600";

  const progressPct = totalMembers > 0 ? (submittedCount / totalMembers) * 100 : 0;

  // Build lookup: userId → score for per-member warning
  const scoreByUser = new Map<string, number>();
  if (feedbackData) {
    for (const f of feedbackData.feedback) {
      scoreByUser.set(f.userId, f.score);
    }
  }

  return (
    <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-6 shadow-pixel-card">
      <h3 className="mb-4 text-lg font-bold text-pt-text-primary">📊 Host dashboard</h3>

      {/* Submission progress */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-bold text-pt-text-primary">Submissions</span>
          <span className="text-sm font-black text-pt-text-primary">
            {submittedCount} / {totalMembers} members
          </span>
        </div>
        <div className="relative h-4 border-2 border-pt-text-primary border-opacity-20">
          <div
            className="h-full bg-[#4ADE80] transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Average score */}
      {averageScore !== null && (
        <div className="mb-4 flex items-center gap-3">
          <span className="text-sm font-bold text-pt-text-primary">Average score:</span>
          <span className={`text-2xl font-black tabular-nums ${scoreColorClass}`}>
            {averageScore.toFixed(1)} / 10
          </span>
        </div>
      )}

      {/* Low satisfaction warning */}
      {averageScore !== null && averageScore < 6 && (
        <div
          role="alert"
          className="mb-3 px-4 py-3 shadow-pixel-sm"
          style={{ border: "2px solid #92400E", backgroundColor: "#1C0F00" }}
        >
          <p className="text-sm font-bold" style={{ color: "#FDE68A" }}>
            ⚠️ Low satisfaction — consider triggering a revision
          </p>
        </div>
      )}

      {/* Per-member score warnings (score < 4) */}
      {members.map((m) => {
        const score = scoreByUser.get(m.id);
        if (score === undefined || score >= 4) return null;
        return (
          <div
            key={m.id}
            role="alert"
            className="mb-2 px-4 py-2 shadow-pixel-sm"
            style={{ border: "2px solid #B91C1C", backgroundColor: "#1A0000" }}
          >
            <p className="text-sm font-bold" style={{ color: "#FCA5A5" }}>
              ⚠️ {m.displayName} rated this below 4
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ─── AnalysisPanel ────────────────────────────────────────────────────────────

interface AnalysisPanelProps {
  analysisResult: {
    analysisText: string;
    requiresNegotiation: boolean;
    conflicts: ConflictResolution[];
  };
  advancing: boolean;
  advanceError: string | null;
  onAdvanceFinal: () => void;
  onAdvanceNegotiation: () => void;
}

function AnalysisPanel({
  analysisResult,
  advancing,
  advanceError,
  onAdvanceFinal,
  onAdvanceNegotiation,
}: AnalysisPanelProps) {
  const { analysisText, requiresNegotiation, conflicts } = analysisResult;

  return (
    <div className="flex flex-col gap-4">
      {/* Analysis summary */}
      <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-6 shadow-pixel-card">
        <h3 className="mb-2 text-lg font-bold text-pt-text-primary">🤖 AI Analysis</h3>
        <p className="text-sm text-pt-text-primary">{analysisText}</p>
      </div>

      {!requiresNegotiation ? (
        /* ── Happy path ── */
        <div
          className="p-6 shadow-pixel-card"
          style={{ border: "4px solid #4ADE80", backgroundColor: "#0A2A1A" }}
        >
          <p className="mb-4 font-bold" style={{ color: "#4ADE80" }}>
            🎉 The group is satisfied!
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onAdvanceFinal}
              disabled={advancing}
              className="border-4 border-pt-text-primary border-opacity-20 bg-[#4ADE80] px-5 py-2 font-bold text-pt-text-primary shadow-pixel-card hover:bg-[#86efac] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {advancing ? "Advancing…" : "✅ Advance to Final"}
            </button>
            <button
              type="button"
              onClick={onAdvanceNegotiation}
              disabled={advancing}
              className="border-4 border-pt-text-primary border-opacity-20 bg-[#FB923C] px-5 py-2 font-bold text-pt-text-primary shadow-pixel-card hover:bg-[#fdba74] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {advancing ? "Advancing…" : "🔄 Trigger revision anyway"}
            </button>
          </div>
          {advanceError && (
            <p className="mt-2 text-sm font-semibold text-red-600">{advanceError}</p>
          )}
        </div>
      ) : (
        /* ── Negotiation path ── */
        <div className="flex flex-col gap-4">
          <div
            role="alert"
            className="p-4 shadow-pixel-card"
            style={{ border: "4px solid #92400E", backgroundColor: "#1C0F00" }}
          >
            <p className="font-bold" style={{ color: "#FDE68A" }}>
              ⚠️ Conflicts detected — negotiation needed
            </p>
            <p className="mt-1 text-sm" style={{ color: "#FEF3C7" }}>
              The AI found {conflicts.length} conflict
              {conflicts.length !== 1 ? "s" : ""} that need resolution before
              finalising.
            </p>
          </div>

          {/* Conflict preview cards */}
          {conflicts.map((conflict, i) => (
            <ConflictPreviewCard key={conflict.id} conflict={conflict} index={i + 1} />
          ))}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onAdvanceNegotiation}
              disabled={advancing}
              className="self-start border-4 border-pt-text-primary border-opacity-20 bg-[#FB923C] px-5 py-2 font-bold text-pt-text-primary shadow-pixel-card hover:bg-[#fdba74] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {advancing ? "Advancing…" : "🤝 Go to Negotiation"}
            </button>
            {advanceError && (
              <p className="text-sm font-semibold text-red-600">{advanceError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ConflictPreviewCard ──────────────────────────────────────────────────────

function ConflictPreviewCard({
  conflict,
  index,
}: {
  conflict: ConflictResolution;
  index: number;
}) {
  return (
    <div className="border-2 border-pt-text-primary border-opacity-20 bg-pt-card p-4 shadow-pixel-sm">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-pt-text-primary opacity-60">
        Conflict {index}
      </p>
      <p className="mb-3 font-semibold text-pt-text-primary">{conflict.conflictSummary}</p>
      <div className="flex flex-col gap-2">
        {conflict.proposedOptions.map((opt) => (
          <div
            key={opt.id}
            className="border border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] px-3 py-2"
          >
            <p className="text-sm font-bold text-pt-text-primary">{opt.description}</p>
            <p className="mt-1 text-xs text-pt-text-primary opacity-70">{opt.tradeoffs}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Broadcast helper ─────────────────────────────────────────────────────────

/**
 * Broadcast a `stage-change` event so every connected client re-fetches the
 * room. Mirrors the helper in GroupProfileStage.
 */
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
