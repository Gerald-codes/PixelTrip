"use client";

/**
 * TiebreakPanel — shown as soon as a destination/flight vote ties. Everyone sees
 * the tied options and who backed them; once the AI's advice arrives it adds the
 * advice paragraph, scores and reasons (until then `thinking` shows the guide at
 * work). Only the room OWNER sees "Choose" buttons (calling break-tie), and can
 * choose without waiting for the advice. Others see a "waiting for the leader"
 * note. Presentational: data in via props, the owner's pick raised through
 * `onBreakTie`.
 */
import { useState, type ReactElement, type ReactNode } from "react";

import { PixelButton } from "@/components/PixelButton";
import type { TiebreakAdvice } from "@/services/destination.contract";
import { TAG_PILL_OUTLINE } from "../lib/tagStyles";

export interface TiebreakPanelProps {
  tiebreak: TiebreakAdvice;
  /** Whether the viewer is the room owner (the only one who can break the tie). */
  isOwner: boolean;
  /** True while a break-tie request is in flight. */
  deciding: boolean;
  /** Error from the last break-tie attempt, if any. */
  error: string | null;
  /** Raised with the chosen option id (owner only). */
  onBreakTie: (optionId: string) => void;
  /** Shown in place of the advice while it is still being written. */
  thinking?: ReactNode;
}

export function TiebreakPanel({
  tiebreak,
  isOwner,
  deciding,
  error,
  onBreakTie,
  thinking,
}: TiebreakPanelProps): ReactElement {
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-col gap-8">
        <span className="font-display text-warning">IT'S A TIE</span>
        {tiebreak.pending ? (
          thinking
        ) : (
          <p className="font-body">{tiebreak.advice}</p>
        )}
        {!isOwner ? (
          <p className="font-body text-subtle">
            Waiting for the party leader to make the final call…
          </p>
        ) : tiebreak.pending ? (
          <p className="font-body text-subtle">
            You're the leader. Choose now, or wait for the guide's advice.
          </p>
        ) : (
          <p className="font-body text-subtle">
            You're the leader — review the guide's advice and choose for the party.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-16">
        {tiebreak.options.map((option) => {
          const recommended = option.id === tiebreak.recommendedOptionId;
          const selected = picked === option.id;
          return (
            <article
              key={option.id}
              className={`flex flex-col gap-8 border-2 p-16 ${
                selected ? "border-accent bg-bg-alt" : "border-muted bg-bg-alt"
              }`}
            >
              <header className="flex items-center justify-between gap-16">
                <h4 className="font-display text-accent">{option.title}</h4>
                {typeof option.score === "number" ? (
                  <span className="font-display border-2 border-success bg-success px-8 py-8 text-bg">
                    FIT {option.score}/100
                  </span>
                ) : null}
              </header>

              {recommended ? (
                <span className="font-display text-success">
                  ★ Guide's suggestion
                </span>
              ) : null}

              {option.whyThisFits ? (
                <p className="font-body">{option.whyThisFits}</p>
              ) : option.description ? (
                <p className="font-body">{option.description}</p>
              ) : null}

              {option.tags && option.tags.length > 0 ? (
                <ul className="flex flex-wrap gap-8">
                  {option.tags.map((tag) => (
                    <li
                      key={tag}
                      className={TAG_PILL_OUTLINE}
                    >
                      {tag}
                    </li>
                  ))}
                </ul>
              ) : null}

              {option.tradeOff ? (
                <p className="font-body text-subtle">
                  <span className="font-display text-warning">TRADE-OFF </span>
                  {option.tradeOff}
                </p>
              ) : null}

              {option.votes && option.votes.length > 0 ? (
                <p className="font-body text-subtle">
                  Voted by: {option.votes.join(", ")}
                </p>
              ) : null}

              {/* Per-member fit breakdown */}
              {option.memberFit && option.memberFit.length > 0 ? (
                <ul className="flex flex-col gap-8">
                  {option.memberFit.map((fit) => (
                    <li
                      key={fit.memberId}
                      className="font-body flex items-start justify-between gap-16 border-l-2 border-muted pl-8"
                    >
                      <span>
                        <span className="text-ink">{fit.displayName}</span>
                        {fit.reason ? (
                          <span className="text-subtle"> — {fit.reason}</span>
                        ) : null}
                      </span>
                      <span className="text-subtle">{fit.score}/100</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {isOwner ? (
                <PixelButton
                  variant={selected ? "primary" : "option"}
                  label={`Choose ${option.title}`}
                  disabled={deciding}
                  onClick={() => {
                    setPicked(option.id);
                    onBreakTie(option.id);
                  }}
                />
              ) : null}
            </article>
          );
        })}
      </div>

      {error !== null ? (
        <p role="alert" className="font-body text-alert">
          {error}
        </p>
      ) : null}
      {deciding ? (
        <p role="status" aria-live="polite" className="font-body text-subtle">
          Locking in the party's choice…
        </p>
      ) : null}
    </div>
  );
}

export default TiebreakPanel;
