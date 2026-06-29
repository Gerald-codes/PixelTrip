"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import VotePanel, {
  type VoteOption,
  type VotePanelProps,
} from "@/app/components/VotePanel";
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

  const handleCast = useCallback(
    async (value: string) => {
      if (casting || selectedOption) return;
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
    [casting, selectedOption, room.id, identity.userId, voteType],
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

  // ── Derived round state ──────────────────────────────────────────────────
  const totalVoters = results?.totalVoters ?? members.length;
  const totalVotes = results?.totalVotes ?? 0;
  const roundClosed =
    totalVoters > 0 && totalVotes >= totalVoters && totalVotes > 0;
  const hasClearWinner = roundClosed && !!results?.winner;
  const tiedOptions = results?.tiedOptions ?? [];
  const isTied = roundClosed && tiedOptions.length > 0;

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

  // ── Tie-break (host only, MVP-style) ─────────────────────────────────────
  const [resolvingTie, setResolvingTie] = useState(false);
  const [tieError, setTieError] = useState<string | null>(null);

  async function resolveTie(option: string) {
    if (resolvingTie) return;
    setResolvingTie(true);
    setTieError(null);
    try {
      if (onWinner) {
        await Promise.resolve(onWinner(option));
        firedForRef.current = option;
      }
    } catch (err) {
      setTieError(
        err instanceof Error ? err.message : "Failed to resolve tie",
      );
    } finally {
      setResolvingTie(false);
    }
  }

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
      <div className="rounded-lg border border-gray-200 p-6">
        <p className="text-sm uppercase tracking-wide text-gray-500">
          Current stage
        </p>
        <h2 className="mt-1 text-2xl font-bold">{title}</h2>
        {description && <p className="mt-2 text-gray-600">{description}</p>}
      </div>

      {loadError && !results && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {loadError}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 p-6">
        <VotePanel
          options={options}
          selectedOption={selectedOption}
          onCast={handleCast}
          disabled={casting}
          tally={tallyForPanel}
          totalVoters={totalVoters}
          totalVotes={totalVotes}
          showResults={roundClosed && hasClearWinner}
        />

        {castError && (
          <p className="mt-3 text-sm text-red-600">{castError}</p>
        )}
      </div>

      {/* Tie-break panel: rendered only when the round closes on a tie. */}
      {isTied && (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-6">
          <h3 className="text-lg font-semibold text-amber-900">
            It&apos;s a tie
          </h3>
          <p className="mt-1 text-sm text-amber-900">
            {tiedOptions.length} options are tied for the lead.
            {isHost ? (
              <> As the host, pick one to move the group forward.</>
            ) : (
              <> Waiting for the host to break the tie…</>
            )}
          </p>

          {isHost && (
            <div className="mt-4 flex flex-col gap-2">
              {tiedOptions.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => void resolveTie(opt)}
                  disabled={resolvingTie}
                  className="rounded-md border border-amber-500 bg-white px-3 py-2 text-left text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Go with &ldquo;{opt}&rdquo;
                </button>
              ))}
              {tieError && (
                <p className="text-sm text-red-600">{tieError}</p>
              )}
            </div>
          )}
        </div>
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
            className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {advancing ? "Advancing…" : advanceLabel}
          </button>
          {!hasClearWinner && !isTied && (
            <p className="text-xs text-gray-500">
              Wait for everyone to vote before advancing.
            </p>
          )}
          {advanceError && (
            <p className="text-sm text-red-600">{advanceError}</p>
          )}
        </div>
      )}

      {!isHost && (
        <p className="text-sm text-gray-500">
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
