"use client";

import type { ReactNode } from "react";

/**
 * A single selectable option in a vote round.
 *
 * `value` is what gets persisted and broadcast (e.g. the destination name,
 * flight category, or conflict resolution option id). `label` and `description`
 * are presentational only; they may be plain strings or richer React nodes so
 * callers can compose badges, score chips, etc.
 */
export interface VoteOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
}

/**
 * Props for {@link VotePanel}.
 *
 * VotePanel is purely presentational + interactive: it knows nothing about the
 * server. The parent ({@link VotingStage}) handles polling, persistence, and
 * winner detection, and tells the panel what to show via these props.
 *
 * - `options`         — the choices the viewer can vote for.
 * - `selectedOption`  — the viewer's already-cast vote, if any. When set, all
 *                       cards become read-only (one vote per round, immutable).
 * - `onCast`          — fired when the viewer picks an option. The parent
 *                       persists it and surfaces errors.
 * - `disabled`        — disable all casting (e.g. while the round is closed
 *                       or while a cast is in flight).
 * - `tally`           — per-option vote counts. When present, vote counts are
 *                       rendered under each option.
 * - `totalVoters`     — total members eligible to vote (group size, N).
 * - `totalVotes`      — total votes cast so far (n). Together with
 *                       `totalVoters`, renders an "n/N voted" progress label.
 * - `showResults`     — when true, render winner emphasis on the top tally
 *                       option(s). The parent flips this to true only once
 *                       every member has voted.
 */
export interface VotePanelProps {
  options: VoteOption[];
  selectedOption: string | null;
  onCast: (value: string) => Promise<void>;
  disabled?: boolean;
  /** When true, the vote is finalized and cannot be changed. */
  locked?: boolean;
  tally?: Record<string, number>;
  totalVoters?: number;
  totalVotes?: number;
  showResults?: boolean;
}

/**
 * Renders a vertical list of card-like option buttons for a single vote round.
 *
 * Visual states per option:
 * - viewer's pick:       blue border + "Your vote" pill, locked.
 * - results visible +
 *   tied for the lead:   green ring + "Winner" / "Tied for the lead" pill.
 * - everything else:     neutral card, hover state when castable.
 *
 * When `selectedOption` is set, every option is locked from re-clicks — a
 * vote is immutable for the round per the design's one-vote-per-round rule.
 */
export default function VotePanel({
  options,
  selectedOption,
  onCast,
  disabled = false,
  locked = false,
  tally,
  totalVoters,
  totalVotes,
  showResults = false,
}: VotePanelProps) {
  // Compute leaders only when results are being revealed. A leader is any
  // option whose count equals the max (handles ties cleanly).
  const winningValues = (() => {
    if (!showResults || !tally) return new Set<string>();
    const counts = Object.values(tally);
    if (counts.length === 0) return new Set<string>();
    const max = Math.max(...counts);
    if (max === 0) return new Set<string>();
    return new Set(
      Object.entries(tally)
        .filter(([, n]) => n === max)
        .map(([v]) => v),
    );
  })();

  const hasMultipleWinners = winningValues.size > 1;
  const hasVoted = selectedOption !== null;
  // Interaction is blocked when: round is locked, disabled (in-flight), or
  // the round is resolved with results shown.
  const interactionBlocked = locked || disabled || showResults;

  return (
    <div className="flex flex-col gap-4">
      {typeof totalVoters === "number" && (
        <p className="text-sm font-semibold text-pt-text-primary">
          {typeof totalVotes === "number" ? (
            <>
              <span className="font-bold text-pt-text-primary">
                {totalVotes}/{totalVoters}
              </span>{" "}
              voted
            </>
          ) : (
            <>
              <span className="font-bold text-pt-text-primary">{totalVoters}</span>{" "}
              {totalVoters === 1 ? "voter" : "voters"} in this room
            </>
          )}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {options.map((option) => {
          const isSelected = option.value === selectedOption;
          const isWinner = winningValues.has(option.value);
          const optionTally = tally?.[option.value] ?? 0;
          // Users can change their vote before lock. Block clicks only when
          // the round is locked/disabled, or when clicking the already-selected option.
          const clickBlocked = interactionBlocked || (isSelected && !locked);

          // Compose border / background to make state instantly readable.
          const borderClass = isWinner
            ? "border-[#4ADE80]"
            : isSelected
              ? "border-[#38BDF8]"
              : "border-pt-text-primary border-opacity-20";
          const bgClass = isSelected
            ? "bg-[#e0f2fe]"
            : isWinner
              ? "bg-pt-card-hover"
              : "bg-[var(--pt-bg-card)]";
          const shadowClass = isWinner
            ? "shadow-[4px_4px_0px_#4ADE80]"
            : isSelected
              ? "shadow-[4px_4px_0px_#38BDF8]"
              : "shadow-pixel-card";
          const hoverClass = interactionBlocked
            ? ""
            : "hover:bg-[#fde68a] hover:shadow-[3px_3px_0px_var(--pt-bg-card)]";
          const cursorClass = interactionBlocked ? "cursor-default" : "cursor-pointer";

          return (
            <li key={option.value}>
              <button
                type="button"
                onClick={() => {
                  if (interactionBlocked) return;
                  // Allow re-selecting a different option (vote change)
                  if (isSelected) return; // clicking same option is a no-op
                  void onCast(option.value);
                }}
                disabled={interactionBlocked}
                aria-pressed={isSelected}
                className={`flex w-full min-w-0 flex-col gap-2 border-4 px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-[#38BDF8] disabled:cursor-default ${borderClass} ${bgClass} ${shadowClass} ${hoverClass} ${cursorClass}`}
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 break-words text-base font-bold text-pt-text-primary">
                    {option.label}
                  </span>
                  <span className="flex flex-none flex-wrap items-center gap-1">
                    {isSelected && (
                      <span className="border-2 border-pt-text-primary border-opacity-20 bg-[#38BDF8] px-2 py-0.5 text-xs font-bold text-pt-text-primary shadow-pixel-sm">
                        Your vote
                      </span>
                    )}
                    {isWinner && (
                      <span className="border-2 border-pt-text-primary border-opacity-20 bg-[#4ADE80] px-2 py-0.5 text-xs font-bold text-pt-text-primary shadow-pixel-sm">
                        {hasMultipleWinners ? "Tied" : "Winner"}
                      </span>
                    )}
                  </span>
                </div>

                {option.description && (
                  <div className="min-w-0 break-words text-sm font-semibold text-pt-text-primary">
                    {option.description}
                  </div>
                )}

                {tally && (
                  <p className="text-xs font-bold text-pt-text-primary">
                    {optionTally} {optionTally === 1 ? "vote" : "votes"}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {hasVoted && !locked && (
        <p className="text-xs font-semibold text-pt-text-primary">
          Tap another option to change your vote before the round closes.
        </p>
      )}
      {hasVoted && locked && (
        <p className="text-xs font-semibold text-pt-text-primary">
          Vote locked — the round is closed.
        </p>
      )}
    </div>
  );
}
