"use client";

import { useCallback, useEffect, useState } from "react";

import DestinationCard from "@/app/components/DestinationCard";
import type { StageProps } from "@/app/components/StageRouter";
import { createAnonSupabase } from "@/lib/supabase";
import type { DestinationSuggestion, TripRoom } from "@/lib/types";

/**
 * DestinationsStage — the visible payoff for Demo Moment 1 ("Why this place?").
 *
 * Flow:
 * 1. On mount, GET /api/agents/destinations?roomId=... to read the most
 *    recently persisted suggestions (no agent call). The API sorts by
 *    `fitScore` descending; we render them in that order.
 * 2. If the list is empty AND the viewer is the host, surface a button that
 *    POSTs to the same route to actually run the destination research agent
 *    (Bedrock — typically 10–20s).
 * 3. If the list is empty AND the viewer is not the host, show a waiting
 *    message; suggestions appear automatically once the host generates them
 *    and a `destinations-updated` broadcast lands.
 * 4. POST may return 412 when the group profile hasn't been generated yet.
 *    That is a clear, actionable error — direct the host back to the group
 *    profile stage rather than retrying blindly.
 * 5. Agent failures may set `retryable: true|false`. Only render the Retry
 *    button when retryable.
 * 6. Host-only "Advance stage" control is enabled once suggestions exist
 *    (same PATCH + broadcast pattern as the other stages).
 *
 * State machine for the agent call:
 *   idle → loading → suggestions | error → (host) loading | idle
 */
export default function DestinationsStage({
  room,
  identity,
  members: _members,
  onRoomUpdated,
  onGoBack,
}: StageProps) {
  const isHost = identity.userId === room.hostUserId;

  // ── Suggestions list (GET on mount) ──────────────────────────────────────
  const [suggestions, setSuggestions] = useState<DestinationSuggestion[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchSuggestions = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(
        `/api/agents/destinations?roomId=${encodeURIComponent(room.id)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Failed to load destinations");
      }
      const data = (await res.json()) as DestinationSuggestion[];
      // Defensive sort — the API already orders by fit_score desc, but the
      // contract is clear so we re-assert it here.
      const sorted = [...data].sort((a, b) => b.fitScore - a.fitScore);
      setSuggestions(sorted);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load destinations",
      );
      setSuggestions([]);
    }
  }, [room.id]);

  useEffect(() => {
    void fetchSuggestions();
  }, [fetchSuggestions]);

  // Pick up live updates: when the host kicks off generation on another tab,
  // the POST handler broadcasts `destinations-updated` so non-host clients
  // refresh without needing to poll.
  useEffect(() => {
    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${room.id}:destinations`);
    ch.on("broadcast", { event: "destinations-updated" }, () => {
      void fetchSuggestions();
    }).subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [room.id, fetchSuggestions]);

  // ── Generate / regenerate (host only) ────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [agentError, setAgentError] = useState<{
    message: string;
    retryable: boolean;
    needsGroupProfile: boolean;
  } | null>(null);

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    setAgentError(null);
    try {
      const res = await fetch("/api/agents/destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; retryable?: boolean }
          | null;
        const message = body?.error ?? "Failed to generate destinations";
        setAgentError({
          message,
          retryable: body?.retryable ?? false,
          needsGroupProfile: res.status === 412,
        });
        return;
      }
      const data = (await res.json()) as DestinationSuggestion[];
      const sorted = [...data].sort((a, b) => b.fitScore - a.fitScore);
      setSuggestions(sorted);
      // Let every other client know to refresh.
      await broadcastDestinationsUpdated(room.id);
    } catch (err) {
      setAgentError({
        message:
          err instanceof Error
            ? err.message
            : "Failed to generate destinations",
        retryable: true,
        needsGroupProfile: false,
      });
    } finally {
      setGenerating(false);
    }
  }

  // ── Host advance ─────────────────────────────────────────────────────────
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const hasSuggestions = (suggestions?.length ?? 0) > 0;

  async function handleAdvance() {
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
        throw new Error(body?.message ?? body?.error ?? "Failed to advance stage");
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

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-6 shadow-pixel-card">
        <p className="text-sm font-bold uppercase tracking-wide text-pt-text-primary">
          Current stage
        </p>
        <h2 className="mt-1 text-2xl font-bold text-pt-text-primary">Destination ideas</h2>
        <p className="mt-2 text-pt-text-primary">
          Real reasoning, not just popularity picks. Each suggestion explains
          why it fits your group&apos;s dates, budget, and travel styles —
          and where it doesn&apos;t.
        </p>
      </div>

      {/* Initial loading */}
      {suggestions === null && !loadError && (
        <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-6 text-sm font-semibold text-pt-text-primary shadow-pixel-card">
          Loading suggestions…
        </div>
      )}

      {/* Load error (separate from agent failure) */}
      {loadError && (
        <div className="border-4 border-red-600 bg-red-50 p-4 text-sm font-semibold text-red-700 shadow-pixel-card">
          {loadError}
        </div>
      )}

      {/* Empty state — host can generate, members wait */}
      {suggestions !== null && suggestions.length === 0 && !generating && (
        <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-6 shadow-pixel-card">
          {isHost ? (
            <>
              <h3 className="text-lg font-bold text-pt-text-primary">No suggestions yet</h3>
              <p className="mt-1 text-sm text-pt-text-primary">
                Run the destination research agent to generate 3–5
                recommendations tailored to this group and travel window.
                This usually takes 10–20 seconds.
              </p>
              <button
                type="button"
                onClick={() => void handleGenerate()}
                className="mt-4 border-4 border-pt-text-primary border-opacity-20 bg-[#38BDF8] px-4 py-2 font-bold text-pt-text-primary shadow-pixel-card hover:bg-[#0ea5e9] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
              >
                Generate destination suggestions
              </button>
            </>
          ) : (
            <p className="text-sm font-semibold text-pt-text-primary">
              Waiting for the host to generate destinations…
            </p>
          )}
        </div>
      )}

      {/* Researching (host-triggered) */}
      {generating && (
        <div className="border-4 border-[#38BDF8] bg-[var(--pt-bg-card)] p-6 shadow-pixel-card">
          <p className="font-bold text-pt-text-primary">
            Researching destinations…
          </p>
          <p className="mt-1 text-sm text-pt-text-primary">
            Weighing seasonality, weather, crowds, prices, and persona fit for
            your group. This takes about 10–20 seconds.
          </p>
        </div>
      )}

      {/* Agent error */}
      {agentError && !generating && (
        <div className="border-4 border-red-600 bg-red-50 p-4 shadow-pixel-card">
          <p className="text-sm font-bold text-red-800">
            {agentError.needsGroupProfile
              ? "Group profile missing"
              : "Couldn't generate destinations"}
          </p>
          <p className="mt-1 text-sm font-semibold text-red-700">{agentError.message}</p>

      {agentError.needsGroupProfile && isHost && (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-sm font-semibold text-red-700">
                The group profile must be generated before destinations can be
                researched. Go back and generate it first.
              </p>
              {onGoBack && (
                <button
                  type="button"
                  onClick={() => void onGoBack()}
                  className="self-start border-2 border-red-600 bg-red-50 px-3 py-1.5 text-sm font-bold text-red-700 shadow-[3px_3px_0px_#991B1B] hover:bg-red-100 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                >
                  ← Back to Group Profile
                </button>
              )}
            </div>
          )}

          {agentError.needsGroupProfile && !isHost && (
            <p className="mt-2 text-sm font-semibold text-red-700">
              Waiting for the host to go back and generate the group profile.
            </p>
          )}

          {!agentError.needsGroupProfile && isHost && agentError.retryable && (
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

      {/* Suggestions list */}
      {suggestions && suggestions.length > 0 && (
        <div className="flex flex-col gap-4">
          {suggestions.map((s) => (
            <DestinationCard key={s.id} suggestion={s} />
          ))}

          {isHost && (
            <div className="flex flex-col items-start gap-2 border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-4 shadow-pixel-card">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={generating}
                className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] px-3 py-1.5 text-sm font-bold text-pt-text-primary shadow-pixel-card hover:bg-[#fde68a] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                Regenerate suggestions
              </button>
              <p className="text-xs font-semibold text-pt-text-primary">
                Re-runs the agent and replaces the list.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Host advance control */}
      {isHost ? (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => void handleAdvance()}
            disabled={advancing || !hasSuggestions}
            className="border-4 border-pt-text-primary border-opacity-20 bg-[#FB923C] px-4 py-2 font-bold text-pt-text-primary shadow-pixel-card hover:bg-[#f97316] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {advancing ? "Advancing…" : "Advance stage"}
          </button>
          {!hasSuggestions && !advanceError && (
            <p className="text-xs font-semibold text-pt-text-primary">
              Generate destinations before advancing.
            </p>
          )}
          {advanceError && (
            <p className="text-sm font-semibold text-red-600">{advanceError}</p>
          )}
        </div>
      ) : (
        <p className="text-sm font-semibold text-pt-text-primary">
          Waiting for the host to advance to the next stage…
        </p>
      )}
    </section>
  );
}

/**
 * Broadcast a `stage-change` event so every connected client re-fetches the
 * room. Mirrors the helper in `LobbyStage` / `AvailabilityStage`.
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

/**
 * Broadcast that destination suggestions have been (re)generated so every
 * other client refreshes its list.
 */
async function broadcastDestinationsUpdated(roomId: string): Promise<void> {
  const supabase = createAnonSupabase();
  const channel = supabase.channel(`room:${roomId}:destinations`);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
  await channel.send({
    type: "broadcast",
    event: "destinations-updated",
    payload: {},
  });
  void supabase.removeChannel(channel);
}
