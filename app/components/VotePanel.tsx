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
        <p className="text-sm text-gray-600">
          {typeof totalVotes === "number" ? (
            <>
              <span className="font-semibold text-gray-900">
                {totalVotes}/{totalVoters}
              </span>{" "}
              voted
            </>
          ) : (
            <>
              <span className="font-semibold text-gray-900">{totalVoters}</span>{" "}
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
            ? "border-green-500 ring-2 ring-green-300"
            : isSelected
              ? "border-blue-600"
              : "border-gray-200";
          const bgClass = isSelected
            ? "bg-blue-50"
            : isWinner
              ? "bg-green-50"
              : "bg-white";
          const hoverClass = locked
            ? ""
            : "hover:border-gray-400 hover:shadow-sm";
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
                className={`flex w-full flex-col gap-2 rounded-lg border-2 px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-default ${borderClass} ${bgClass} ${hoverClass} ${cursorClass}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-base font-semibold text-gray-900">
                    {option.label}
                  </span>
                  <span className="flex flex-none items-center gap-2">
                    {isSelected && (
                      <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
                        Your vote
                      </span>
                    )}
                    {isWinner && (
                      <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white">
                        {hasMultipleWinners ? "Tied for lead" : "Winner"}
                      </span>
                    )}
                  </span>
                </div>

                {option.description && (
                  <div className="text-sm text-gray-700">
                    {option.description}
                  </div>
                )}

                {/* Vote counts are only rendered when the parent passes a tally.
                    The parent withholds the tally until everyone has voted so
                    the round stays anonymous in progress. */}
                {tally && (
                  <p className="text-xs font-medium text-gray-600">
                    {optionTally} {optionTally === 1 ? "vote" : "votes"}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {hasVoted && (
        <p className="text-xs text-gray-500">
          Your vote is locked in. Wait for everyone else to vote to see the
          results.
        </p>
      )}
    </div>
  );
}
