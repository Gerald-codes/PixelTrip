"use client";

import { useCallback, useEffect, useState } from "react";

import type { StageProps } from "@/app/components/StageRouter";
import type { VoteOption } from "@/app/components/VotePanel";
import VotingStage from "@/app/components/VotingStage";
import { createAnonSupabase } from "@/lib/supabase";
import type { DestinationSuggestion, TripRoom } from "@/lib/types";

/**
 * DestinationVoteStage — wraps {@link VotingStage} for the destination round.
 *
 * Responsibilities:
 * 1. Load the persisted destination suggestions for this room (produced by
 *    the destination research agent in task 6.1) and transform them into
 *    {@link VoteOption}s. The card label exposes the fit-score badge so
 *    voters carry the agent's reasoning with them into the vote.
 * 2. Hand those options to {@link VotingStage} with `voteType="destination"`.
 * 3. On a winner being decided (single winner OR host-resolved tie), persist
 *    `selected_destination` to the room and auto-advance the stage to
 *    `FLIGHTS`. Only the host actually performs the side effects; other
 *    clients re-render automatically off the `stage-change` broadcast.
 */
export default function DestinationVoteStage({
  room,
  identity,
  members,
  onRoomUpdated,
}: StageProps) {
  const isHost = identity.userId === room.hostUserId;

  const [suggestions, setSuggestions] = useState<DestinationSuggestion[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [winnerError, setWinnerError] = useState<string | null>(null);

  // ── Load destination suggestions for this room ───────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
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
        if (cancelled) return;
        const sorted = [...data].sort((a, b) => b.fitScore - a.fitScore);
        setSuggestions(sorted);
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Failed to load destinations",
        );
        setSuggestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room.id]);

  // Build VoteOption[] from suggestions. Label = name + fit-score badge;
  // description = the recommendation reason (truncated so cards stay scannable).
  const options: VoteOption[] = (suggestions ?? []).map((s) => ({
    value: s.destinationName,
    label: (
      <span className="flex flex-wrap items-center gap-2">
        <span>{s.destinationName}</span>
        <FitScorePill score={s.fitScore} />
      </span>
    ),
    description: (
      <p className="text-sm text-pt-text-primary">
        {truncate(s.recommendationReason, 220)}
      </p>
    ),
  }));

  // ── Winner handler: host persists destination + advances to FLIGHTS ──────
  const handleWinner = useCallback(
    async (winner: string) => {
      // Every client fires this; only the host performs side effects. Other
      // clients will re-render off the broadcast that the host emits.
      if (!isHost) return;

      try {
        const destRes = await fetch(
          `/api/rooms/${room.roomCode}/destination`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              selectedDestination: winner,
              requestingUserId: identity.userId,
            }),
          },
        );
        if (!destRes.ok) {
          const body = (await destRes.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(
            body?.error ?? "Failed to save the selected destination",
          );
        }

        const stageRes = await fetch(`/api/rooms/${room.roomCode}/stage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestingUserId: identity.userId }),
        });
        if (!stageRes.ok) {
          const body = (await stageRes.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error ?? "Failed to advance to flights");
        }
        const updated = (await stageRes.json()) as TripRoom;
        onRoomUpdated(updated);
        void broadcastStageChange(room.id);
        setWinnerError(null);
      } catch (err) {
        setWinnerError(
          err instanceof Error
            ? err.message
            : "Failed to lock in the destination",
        );
      }
    },
    [isHost, room.roomCode, room.id, identity.userId],
  );

  // ── Render ───────────────────────────────────────────────────────────────
  if (suggestions === null) {
    return (
      <section className="mx-auto max-w-3xl rounded-lg border border-pt-text-primary border-opacity-10 p-6 text-sm text-gray-500">
        Loading destinations…
      </section>
    );
  }

  if (suggestions.length === 0) {
    return (
      <section className="mx-auto max-w-3xl rounded-lg border border-pt-text-primary border-opacity-10 p-6">
        <h2 className="text-2xl font-bold">Vote for a destination</h2>
        <p className="mt-2 text-sm text-pt-text-muted">
          {loadError ?? "No destination suggestions are available yet."} Ask
          the host to regenerate destinations in the previous stage.
        </p>
      </section>
    );
  }

  return (
    <>
      <VotingStage
        room={room}
        identity={identity}
        members={members}
        voteType="destination"
        options={options}
        title="Vote for a destination"
        description="One vote per person. Vote is locked once cast. When everyone has voted, the winner is locked in and we move on to flights."
        onWinner={handleWinner}
      />
      {winnerError && (
        <p className="mx-auto mt-4 max-w-3xl text-sm text-red-600">
          {winnerError}
        </p>
      )}
    </>
  );
}

// ── Small presentational helpers ─────────────────────────────────────────

function FitScorePill({ score }: { score: number }) {
  const rounded = Math.round(score);
  const tone =
    rounded >= 80
      ? "bg-green-100 text-green-800 border-green-200"
      : rounded >= 60
        ? "bg-blue-100 text-blue-800 border-blue-200"
        : rounded >= 40
          ? "bg-amber-100 text-amber-800 border-amber-200"
          : "bg-red-100 text-red-800 border-red-200";
  return (
    <span
      aria-label={`Fit score ${rounded} out of 100`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}
    >
      <span className="opacity-70">Fit</span>
      <span>{rounded}</span>
    </span>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Broadcast a `stage-change` event so every connected client re-fetches the
 * room. Mirrors the helper used elsewhere.
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
