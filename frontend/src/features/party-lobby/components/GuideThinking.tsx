"use client";

/**
 * GuideThinking — what the party sees while the AI guide works.
 *
 * - Blinking pixel dots plus the run's REAL current step (from the backend's
 *   `phase`), not a rotating guess and not a fake progress bar.
 * - A tiny quest log of the run's steps: done / now / next, marked with text as
 *   well as colour.
 * - Reassurance after 10s and 45s, because AI runs can take up to a minute.
 * - If the run failed: what went wrong (from the step it stopped on) and, for the
 *   room owner, a Try again button; everyone else is told the leader can retry.
 *
 * Accessibility: one polite status message per step change (the dots are
 * decorative); animations stop under `prefers-reduced-motion`.
 */
import type { ReactElement } from "react";

import { PixelButton } from "@/components/PixelButton";
import type { RunProgress, RunType } from "@/services/run.contract";

import {
  PHASE_LINES,
  RUN_STEPS,
  failureLine,
  waitHint,
} from "../lib/guidePhases";

export interface GuideThinkingProps {
  runType: RunType;
  /** The latest run, or null before one has started. */
  run: RunProgress | null;
  /** Only the room owner can retry a failed run. */
  isOwner: boolean;
  /** Start a fresh run (owner only). */
  onRetry?: () => void;
  /** True while the retry request is being sent. */
  retrying?: boolean;
}

function Dots(): ReactElement {
  return (
    <span aria-hidden className="flex items-center gap-8">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-8 w-8 bg-accent animate-pixel-dot motion-reduce:animate-none"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}

export function GuideThinking({
  runType,
  run,
  isOwner,
  onRetry,
  retrying = false,
}: GuideThinkingProps): ReactElement {
  const steps = RUN_STEPS[runType];

  if (run?.status === "failed") {
    return (
      <div
        role="alert"
        className="flex flex-col gap-16 border-l-4 border-danger bg-bg p-16"
      >
        <p className="font-display text-alert">THE GUIDE HIT A SNAG</p>
        <p className="font-body text-ink">{failureLine(run)}</p>
        {isOwner && onRetry ? (
          <PixelButton
            variant="primary"
            label={retrying ? "ASKING AGAIN…" : "TRY AGAIN"}
            disabled={retrying}
            onClick={onRetry}
          />
        ) : (
          <p className="font-body text-subtle">
            The party leader can ask the guide to try again.
          </p>
        )}
      </div>
    );
  }

  const current = run?.phase ?? steps[0];
  const currentIndex = Math.max(0, steps.indexOf(current));
  const line = run ? PHASE_LINES[current] : "Waiting for the guide to begin";
  const hint = run ? waitHint(run.elapsedSeconds) : null;

  return (
    <div className="flex flex-col gap-16" aria-busy="true">
      <div className="flex items-center gap-16">
        <Dots />
        <p
          role="status"
          aria-live="polite"
          className="font-display leading-relaxed text-accent"
        >
          {line}…
        </p>
      </div>

      {run ? (
        <ol
          aria-label="Guide progress"
          className="flex flex-col gap-8 font-body"
        >
          {steps.map((step, index) => {
            const state =
              index < currentIndex
                ? "done"
                : index === currentIndex
                  ? "now"
                  : "next";
            const marker =
              state === "done" ? "[x]" : state === "now" ? "[>]" : "[ ]";
            const tone =
              state === "done"
                ? "text-success"
                : state === "now"
                  ? "text-ink"
                  : "text-subtle";
            return (
              <li key={step} className={`flex gap-8 ${tone}`}>
                <span aria-hidden className="font-display">
                  {marker}
                </span>
                <span>
                  {PHASE_LINES[step]}
                  <span className="sr-only">
                    {state === "done"
                      ? " (done)"
                      : state === "now"
                        ? " (in progress)"
                        : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {hint ? <p className="font-body text-subtle">{hint}</p> : null}
    </div>
  );
}

export default GuideThinking;
