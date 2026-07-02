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

  // ── Tie-break — AI-mediated resolution panel ─────────────────────────────
  // When the round closes on a tie, we replace the dumb host-picker with a
  // full AI-generated resolution flow. The host triggers the tiebreak agent,
  // the group votes on the proposed options, and the winner is applied.

  type TiePhase = "idle" | "generating" | "voting" | "applying";

  interface TieOption {
    id: string;
    description: string;
    tradeoffs: string;
  }

  const [tiePhase, setTiePhase] = useState<TiePhase>("idle");
  const [tieSummary, setTieSummary] = useState<string | null>(null);
  const [tieOptions, setTieOptions] = useState<TieOption[]>([]);
  const [tieError, setTieError] = useState<string | null>(null);
  const [selectedTieOption, setSelectedTieOption] = useState<string | null>(null);
  const [applyingTie, setApplyingTie] = useState(false);

  // Host triggers the tiebreak agent.
  async function handleGenerateTiebreak() {
    if (tiePhase !== "idle") return;
    setTiePhase("generating");
    setTieError(null);
    try {
      const res = await fetch("/api/agents/tiebreak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: room.id,
          voteType,
          tiedOptions,
          tally: results?.tally ?? {},
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Failed to generate resolution options");
      }
      const data = (await res.json()) as {
        conflictSummary: string;
        proposedOptions: TieOption[];
      };
      setTieSummary(data.conflictSummary);
      setTieOptions(data.proposedOptions);
      setTiePhase("voting");
    } catch (err) {
      setTieError(
        err instanceof Error ? err.message : "Failed to generate resolution options",
      );
      setTiePhase("idle");
    }
  }

  // Any member can select a resolution option; host applies it.
  function handleSelectTieOption(optionId: string) {
    if (tiePhase !== "voting") return;
    setSelectedTieOption(optionId);
  }

  // Host applies the selected resolution — calls back to the parent via onWinner.
  async function handleApplyTiebreak() {
    if (!selectedTieOption || tiePhase !== "voting" || applyingTie) return;
    const chosen = tieOptions.find((o) => o.id === selectedTieOption);
    if (!chosen) return;

    setApplyingTie(true);
    setTieError(null);
    try {
      // The chosen option's id should correspond to one of the original tied
      // values (e.g. "pick_budget" resolves to "budget"). We extract the
      // original option by matching the id prefix or falling back to the first
      // tied option whose name appears in the id.
      const resolvedValue =
        tiedOptions.find((opt) =>
          selectedTieOption.toLowerCase().includes(opt.toLowerCase().replace(/[^a-z]/g, "")),
        ) ?? tiedOptions[0];

      if (onWinner) {
        await Promise.resolve(onWinner(resolvedValue));
        firedForRef.current = resolvedValue;
      }
      setTiePhase("applying");
    } catch (err) {
      setTieError(
        err instanceof Error ? err.message : "Failed to apply resolution",
      );
    } finally {
      setApplyingTie(false);
    }
  }

  // Manual host override — always available as a fallback.
  async function handleManualTiebreak(option: string) {
    if (applyingTie) return;
    setApplyingTie(true);
    setTieError(null);
    try {
      if (onWinner) {
        await Promise.resolve(onWinner(option));
        firedForRef.current = option;
      }
      setTiePhase("applying");
    } catch (err) {
      setTieError(
        err instanceof Error ? err.message : "Failed to apply resolution",
      );
    } finally {
      setApplyingTie(false);
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
      <div className="border-4 border-[#1E3A5F] bg-[#FEF3C7] p-6 shadow-[4px_4px_0px_#1E3A5F]">
        <p className="text-sm font-bold uppercase tracking-wide text-[#1E3A5F]">
          Current stage
        </p>
        <h2 className="mt-1 text-2xl font-bold text-[#1E3A5F]">{title}</h2>
        {description && <p className="mt-2 text-[#1E3A5F]">{description}</p>}
      </div>

      {loadError && !results && (
        <div className="border-4 border-red-600 bg-red-50 p-4 text-sm font-semibold text-red-700 shadow-[4px_4px_0px_#1E3A5F]">
          {loadError}
        </div>
      )}

      <div className="border-4 border-[#1E3A5F] bg-[#FEF3C7] p-6 shadow-[4px_4px_0px_#1E3A5F]">
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

      {/* ── Tie-break panel: AI-mediated resolution ───────────────────────── */}
      {isTied && tiePhase !== "applying" && (
        <div className="border-4 border-[#FB923C] bg-amber-50 p-6 shadow-[4px_4px_0px_#1E3A5F]">
          <h3 className="text-lg font-bold text-[#1E3A5F]">⚖️ It&apos;s a tie</h3>

          {/* Step 1 — generate options (host only) */}
          {tiePhase === "idle" && (
            <>
              <p className="mt-2 text-sm font-semibold text-[#1E3A5F]">
                The vote ended with{" "}
                <strong>{tiedOptions.join(" and ")}</strong> tied. Let the AI
                explain the trade-offs and suggest a way forward.
              </p>
              {isHost ? (
                <button
                  type="button"
                  onClick={() => void handleGenerateTiebreak()}
                  className="mt-4 border-4 border-[#1E3A5F] bg-[#A855F7] px-4 py-2 font-bold text-white shadow-[4px_4px_0px_#1E3A5F] hover:bg-[#9333ea] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
                >
                  Ask the AI to help decide
                </button>
              ) : (
                <p className="mt-2 text-sm text-[#1E3A5F] opacity-70">
                  Waiting for the host to start the resolution…
                </p>
              )}
            </>
          )}

          {/* Step 2 — generating */}
          {tiePhase === "generating" && (
            <p className="mt-2 text-sm font-semibold text-[#1E3A5F]">
              ⏳ Generating resolution options… (usually a few seconds)
            </p>
          )}

          {/* Step 3 — voting on options */}
          {tiePhase === "voting" && tieSummary && (
            <div className="mt-3 flex flex-col gap-4">
              {/* AI conflict summary */}
              <p className="text-sm font-semibold text-[#1E3A5F]">
                {tieSummary}
              </p>

              {/* Resolution option cards */}
              <div className="flex flex-col gap-3">
                <p className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F] opacity-60">
                  Resolution options — pick one:
                </p>
                {tieOptions.map((opt) => {
                  const isSelected = selectedTieOption === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectTieOption(opt.id)}
                      className={[
                        "flex flex-col gap-1 border-4 p-4 text-left shadow-[4px_4px_0px_#1E3A5F]",
                        isSelected
                          ? "border-[#4ADE80] bg-[#f0fdf4]"
                          : "border-[#1E3A5F] bg-[#FEF3C7] hover:bg-[#fde68a]",
                      ].join(" ")}
                      aria-pressed={isSelected}
                    >
                      <div className="flex items-center gap-2">
                        {isSelected && (
                          <span className="text-[#4ADE80] font-bold">✓</span>
                        )}
                        <span className="font-bold text-[#1E3A5F]">
                          {opt.description}
                        </span>
                      </div>
                      {opt.tradeoffs && (
                        <p className="text-xs text-[#1E3A5F] opacity-70 leading-relaxed">
                          {opt.tradeoffs}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Apply button (host only) */}
              {isHost && (
                <div className="flex flex-col gap-2 pt-1 border-t-2 border-dashed border-[#1E3A5F]">
                  <button
                    type="button"
                    onClick={() => void handleApplyTiebreak()}
                    disabled={!selectedTieOption || applyingTie}
                    className="self-start border-4 border-[#1E3A5F] bg-[#4ADE80] px-4 py-2 font-bold text-[#1E3A5F] shadow-[4px_4px_0px_#1E3A5F] hover:bg-[#22c55e] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {applyingTie ? "Applying…" : "Apply resolution"}
                  </button>
                  {!selectedTieOption && (
                    <p className="text-xs text-[#1E3A5F] opacity-60">
                      Select an option above to apply it.
                    </p>
                  )}
                  {/* Manual fallback — always available */}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-[#1E3A5F] opacity-50 hover:opacity-80">
                      Or pick manually…
                    </summary>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {tiedOptions.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => void handleManualTiebreak(opt)}
                          disabled={applyingTie}
                          className="border-2 border-[#1E3A5F] bg-[#FEF3C7] px-3 py-1 text-sm font-bold text-[#1E3A5F] shadow-[2px_2px_0px_#1E3A5F] hover:bg-[#fde68a] disabled:opacity-50"
                        >
                          Go with &ldquo;{opt}&rdquo;
                        </button>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              {!isHost && (
                <p className="text-sm text-[#1E3A5F] opacity-70">
                  Waiting for the host to apply a resolution…
                </p>
              )}
            </div>
          )}

          {tieError && (
            <p className="mt-3 text-sm font-semibold text-red-600">{tieError}</p>
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
            className="border-4 border-[#1E3A5F] bg-[#FB923C] px-4 py-2 font-bold text-[#1E3A5F] shadow-[4px_4px_0px_#1E3A5F] hover:bg-[#f97316] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {advancing ? "Advancing…" : advanceLabel}
          </button>
          {!hasClearWinner && !isTied && (
            <p className="text-xs font-semibold text-[#1E3A5F]">
              Wait for everyone to vote before advancing.
            </p>
          )}
          {advanceError && (
            <p className="text-sm font-semibold text-red-600">{advanceError}</p>
          )}
        </div>
      )}

      {!isHost && (
        <p className="text-sm font-semibold text-[#1E3A5F]">
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
