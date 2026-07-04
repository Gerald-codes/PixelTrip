"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import VotePanel, {
  type VoteOption,
  type VotePanelProps,
} from "@/app/components/VotePanel";
import TiebreakPanel from "@/app/components/TiebreakPanel";
import type { Identity } from "@/app/components/StageRouter";
import { createAnonSupabase } from "@/lib/supabase";
import type { TripRoom, User, Vote } from "@/lib/types";

/**
 * Server contract for {@link VotingStage}.
 *
 * Mirrors what GET /api/votes/[roomId]/[voteType] returns (task 7.1). The
 * server is the source of truth for `tally`, `totalVoters`, `totalVotes`,
 * `winner`, and `tiedOptions`; this stage only polls and renders.
 */
interface VoteResultsResponse {
  votes: Vote[];
  tally: Record<string, number>;
  totalVoters: number;
  totalVotes: number;
  winner: string | null;
  tiedOptions: string[];
}

/**
 * Props for {@link VotingStage}.
 *
 * VotingStage is intentionally generic: the same component drives destination
 * voting (task 7.2), flight category voting (task 9.2), and conflict
 * resolution voting (task 14.3). The caller supplies the `voteType`, the
 * options to vote on, and an `onWinner` callback to wire any stage-specific
 * side effects (e.g. persist the selected destination and advance the stage).
 *
 * - `room` / `identity` / `members` are threaded down from `StageRouter`.
 * - `voteType`        — selects which round we're voting in. Matched by the
 *                       DB unique constraint `(room_id, user_id, vote_type)`.
 * - `options`         — the choices presented to every voter.
 * - `title` / `description` — header copy rendered above the panel.
 * - `onWinner`        — fired exactly once on each client when the round
 *                       closes with a single winner. Guarded by a ref so
 *                       polling re-renders don't re-fire it.
 * - `advanceLabel` / `onAdvance` — optional host-only "advance" UI rendered
 *                       at the bottom. Defaults to a PATCH against the stage
 *                       endpoint + a `stage-change` broadcast, matching the
 *                       other stages.
 */
export interface VotingStageProps {
  room: TripRoom;
  identity: Identity;
  members: User[];
  voteType: "destination" | "flight" | "conflict_resolution";
  options: VoteOption[];
  title: string;
  description?: string;
  onWinner?: (winner: string) => Promise<void> | void;
  advanceLabel?: string;
  onAdvance?: () => Promise<void> | void;
}

/**
 * The reusable voting stage.
 *
 * Behaviour:
 *   1. Poll `GET /api/votes/[roomId]/[voteType]` every 2s.
 *   2. While the round is open (not everyone has voted), hide the per-option
 *      tally — only an "n/N voted" progress label is shown. This honours the
 *      design's "show live results when all have voted" rule.
 *   3. Once `totalVotes === totalVoters` (and > 0):
 *      - If a single `winner` is set, reveal the tally with winner emphasis
 *        and fire `onWinner` exactly once.
 *      - If `tiedOptions.length > 0`, render a tie-break panel. The host can
 *        pick one of the tied options to declare the winner (see note below).
 *
 * MVP tiebreaker limitation:
 *   The DB unique constraint on `(room_id, user_id, vote_type)` means a true
 *   second voting round would need either a new `voteType` or a `round_number`
 *   column. For the MVP demo, we instead let the host choose between the tied
 *   options on behalf of the group. A future iteration should add round
 *   support to the votes schema and let the group re-vote on tied options.
 */
export default function VotingStage({
  room,
  identity,
  members,
  voteType,
  options,
  title,
  description,
  onWinner,
  advanceLabel = "Advance stage",
  onAdvance,
}: VotingStageProps) {
  const isHost = identity.userId === room.hostUserId;

  // ── Results polling ──────────────────────────────────────────────────────
  const [results, setResults] = useState<VoteResultsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchResults = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(
        `/api/votes/${encodeURIComponent(room.id)}/${encodeURIComponent(voteType)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Failed to load vote results");
      }
      const data = (await res.json()) as VoteResultsResponse;
      setResults(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load vote results",
      );
    }
  }, [room.id, voteType]);

  const fetchRef = useRef(fetchResults);
  fetchRef.current = fetchResults;

  useEffect(() => {
    void fetchRef.current();
    const interval = setInterval(() => void fetchRef.current(), 2000);
    return () => clearInterval(interval);
  }, [voteType, room.id]);

  // ── Cast vote ────────────────────────────────────────────────────────────
  const [casting, setCasting] = useState(false);
  const [castError, setCastError] = useState<string | null>(null);

  const myVote =
    results?.votes.find((v) => v.userId === identity.userId) ?? null;
  const selectedOption = myVote?.selectedOption ?? null;

  // ── Derived round state (computed before handleCast so it can be a dep) ──
  const totalVoters = results?.totalVoters ?? members.length;
  const totalVotes = results?.totalVotes ?? 0;
  const roundClosed =
    totalVoters > 0 && totalVotes >= totalVoters && totalVotes > 0;
  const hasClearWinner = roundClosed && !!results?.winner;
  const tiedOptions = results?.tiedOptions ?? [];
  const isTied = roundClosed && tiedOptions.length > 0;

  const handleCast = useCallback(
    async (value: string) => {
      if (casting) return;
      // Block vote changes once the round is closed (all voted).
      if (roundClosed) return;
      // No-op if clicking the same option already selected.
      if (value === selectedOption) return;
      setCasting(true);
      setCastError(null);
      try {
        const res = await fetch("/api/votes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId: room.id,
            userId: identity.userId,
            voteType,
            selectedOption: value,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error ?? "Failed to record vote");
        }
        // Pull fresh server state so tally/progress reflect this cast.
        await fetchRef.current();
        // Nudge other clients (best-effort) — the 2s poll picks it up anyway.
        await broadcastVotesUpdated(room.id, voteType);
      } catch (err) {
        setCastError(
          err instanceof Error ? err.message : "Failed to record vote",
        );
      } finally {
        setCasting(false);
      }
    },
    [casting, selectedOption, room.id, identity.userId, voteType, roundClosed],
  );

  // Pick up live updates from peers' casts. Mirrors the destinations channel.
  useEffect(() => {
    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${room.id}:votes:${voteType}`);
    ch.on("broadcast", { event: "votes-updated" }, () => {
      void fetchRef.current();
    }).subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [room.id, voteType]);

  // ── Tally for panel (hide breakdown until round closes) ───────────────
  // Until the round closes, hide the per-option breakdown so the round stays
  // anonymous in progress.
  const tallyForPanel: VotePanelProps["tally"] = roundClosed
    ? results?.tally
    : undefined;

  // ── Fire onWinner exactly once when a single winner is decided ───────────
  const firedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasClearWinner) return;
    const winner = results?.winner;
    if (!winner) return;
    if (firedForRef.current === winner) return;
    firedForRef.current = winner;
    if (onWinner) {
      void Promise.resolve(onWinner(winner)).catch((err) => {
        console.log(
          `[VotingStage] onWinner threw for ${voteType} → ${winner}:`,
          err,
        );
      });
    }
  }, [hasClearWinner, results?.winner, onWinner, voteType]);

  // ── Tie-break — delegate to TiebreakPanel ───────────────────────────────
  // TiebreakPanel owns all tie state (generate, vote, apply, resolved).
  // We pass onApply which calls onWinner with the resolved value.

  // ── Host advance ─────────────────────────────────────────────────────────
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  async function handleAdvance() {
    if (advancing) return;
    setAdvancing(true);
    setAdvanceError(null);
    try {
      if (onAdvance) {
        await Promise.resolve(onAdvance());
      } else {
        await defaultAdvance(room, identity.userId);
      }
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
        <h2 className="mt-1 text-2xl font-bold text-pt-text-primary">{title}</h2>
        {description && <p className="mt-2 text-pt-text-primary">{description}</p>}
      </div>

      {loadError && !results && (
        <div
          className="p-4 shadow-pixel-card"
          style={{ border: "4px solid #B91C1C", backgroundColor: "#1A0000" }}
        >
          <p className="text-sm font-semibold" style={{ color: "#FCA5A5" }}>{loadError}</p>
        </div>
      )}

      <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-6 shadow-pixel-card">
        <VotePanel
          options={options}
          selectedOption={selectedOption}
          onCast={handleCast}
          disabled={casting}
          locked={roundClosed}
          tally={tallyForPanel}
          totalVoters={totalVoters}
          totalVotes={totalVotes}
          showResults={roundClosed && hasClearWinner}
        />

        {castError && (
          <p className="mt-3 text-sm font-semibold text-red-600">{castError}</p>
        )}
      </div>

      {/* ── Tie-break panel ──────────────────────────────────────────────── */}
      {isTied && (
        <TiebreakPanel
          roomId={room.id}
          voteType={voteType}
          tiedOptions={tiedOptions}
          tally={results?.tally ?? {}}
          isHost={isHost}
          onApply={async (resolvedValue) => {
            if (onWinner) {
              await Promise.resolve(onWinner(resolvedValue));
              firedForRef.current = resolvedValue;
            }
          }}
        />
      )}

      {/* Host advance — only relevant when no onWinner has wired automatic
          advancement. For the destination vote, onWinner handles the advance
          itself, but other reuses (e.g. flight vote, conflict resolution) may
          want a manual advance button. */}
      {isHost && onAdvance !== undefined && (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => void handleAdvance()}
            disabled={advancing || (!hasClearWinner && !isTied)}
            className="border-4 border-pt-text-primary border-opacity-20 bg-[#FB923C] px-4 py-2 font-bold text-pt-text-primary shadow-pixel-card hover:bg-[#f97316] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {advancing ? "Advancing…" : advanceLabel}
          </button>
          {!hasClearWinner && !isTied && (
            <p className="text-xs font-semibold text-pt-text-primary">
              Wait for everyone to vote before advancing.
            </p>
          )}
          {advanceError && (
            <p className="text-sm font-semibold text-red-600">{advanceError}</p>
          )}
        </div>
      )}

      {!isHost && (
        <p className="text-sm font-semibold text-pt-text-primary">
          Waiting for the host to advance to the next stage…
        </p>
      )}
    </section>
  );
}

/**
 * Default advance: PATCH the stage endpoint as the host and broadcast a
 * `stage-change` event so every client refetches the room. Mirrors the helper
 * used in `LobbyStage` / `AvailabilityStage` / `GroupProfileStage`.
 */
async function defaultAdvance(
  room: TripRoom,
  requestingUserId: string,
): Promise<void> {
  const res = await fetch(`/api/rooms/${room.roomCode}/stage`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestingUserId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(body?.error ?? "Failed to advance stage");
  }
  await broadcastStageChange(room.id);
}

/**
 * Broadcast a `stage-change` event so every connected client refetches the
 * room.
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
 * Broadcast that a vote was cast so other clients refresh their results
 * without waiting on the 2s poll.
 */
async function broadcastVotesUpdated(
  roomId: string,
  voteType: string,
): Promise<void> {
  const supabase = createAnonSupabase();
  const channel = supabase.channel(`room:${roomId}:votes:${voteType}`);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
  await channel.send({ type: "broadcast", event: "votes-updated", payload: {} });
  void supabase.removeChannel(channel);
}
