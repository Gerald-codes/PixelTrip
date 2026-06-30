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

  return (
    <div className="flex flex-col gap-4">
      {typeof totalVoters === "number" && (
        <p className="text-sm font-semibold text-[#1E3A5F]">
          {typeof totalVotes === "number" ? (
            <>
              <span className="font-bold text-[#1E3A5F]">
                {totalVotes}/{totalVoters}
              </span>{" "}
              voted
            </>
          ) : (
            <>
              <span className="font-bold text-[#1E3A5F]">{totalVoters}</span>{" "}
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
          // Locked once the viewer has cast OR while disabled/in flight.
          const locked = hasVoted || disabled;

          // Compose border / background to make state instantly readable.
          const borderClass = isWinner
            ? "border-[#4ADE80]"
            : isSelected
              ? "border-[#38BDF8]"
              : "border-[#1E3A5F]";
          const bgClass = isSelected
            ? "bg-[#e0f2fe]"
            : isWinner
              ? "bg-[#f0fdf4]"
              : "bg-[#FEF3C7]";
          const shadowClass = isWinner
            ? "shadow-[4px_4px_0px_#4ADE80]"
            : isSelected
              ? "shadow-[4px_4px_0px_#38BDF8]"
              : "shadow-[4px_4px_0px_#1E3A5F]";
          const hoverClass = locked
            ? ""
            : "hover:bg-[#fde68a] hover:shadow-[3px_3px_0px_#1E3A5F]";
          const cursorClass = locked ? "cursor-default" : "cursor-pointer";

          return (
            <li key={option.value}>
              <button
                type="button"
                onClick={() => {
                  if (locked) return;
                  void onCast(option.value);
                }}
                disabled={locked}
                aria-pressed={isSelected}
                className={`flex w-full flex-col gap-2 border-4 px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-[#38BDF8] disabled:cursor-default ${borderClass} ${bgClass} ${shadowClass} ${hoverClass} ${cursorClass}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-base font-bold text-[#1E3A5F]">
                    {option.label}
                  </span>
                  <span className="flex flex-none items-center gap-2">
                    {isSelected && (
                      <span className="border-2 border-[#1E3A5F] bg-[#38BDF8] px-2 py-0.5 text-xs font-bold text-[#1E3A5F] shadow-[2px_2px_0px_#1E3A5F]">
                        Your vote
                      </span>
                    )}
                    {isWinner && (
                      <span className="border-2 border-[#1E3A5F] bg-[#4ADE80] px-2 py-0.5 text-xs font-bold text-[#1E3A5F] shadow-[2px_2px_0px_#1E3A5F]">
                        {hasMultipleWinners ? "Tied for lead" : "Winner"}
                      </span>
                    )}
                  </span>
                </div>

                {option.description && (
                  <div className="text-sm font-semibold text-[#1E3A5F]">
                    {option.description}
                  </div>
                )}

                {/* Vote counts are only rendered when the parent passes a tally.
                    The parent withholds the tally until everyone has voted so
                    the round stays anonymous in progress. */}
                {tally && (
                  <p className="text-xs font-bold text-[#1E3A5F]">
                    {optionTally} {optionTally === 1 ? "vote" : "votes"}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {hasVoted && (
        <p className="text-xs font-semibold text-[#1E3A5F]">
          Your vote is locked in. Wait for everyone else to vote to see the
          results.
        </p>
      )}
    </div>
  );
}
