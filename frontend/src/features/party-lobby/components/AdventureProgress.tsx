"use client";

/**
 * AdventureProgress — the six-stage quest progress stepper.
 *
 * Purely presentational: it renders the ordered {@link StageStep} model it is
 * given (built by `buildStageSteps(planningStage)` in the parent) and marks each
 * stage complete / current / upcoming. It does not call `buildStageSteps` itself
 * and performs no data fetching.
 *
 * The current stage is distinguished from complete / upcoming stages by a text
 * status label and an `aria-current="step"` marker IN ADDITION TO a theme-token
 * color — color is never the only signal (Req 16.4). Its list is labelled
 * "Quest progress" so assistive tech can address it distinctly. It is the only
 * six-stage progress display on the screen (the sidebar is persistent across
 * stages). Built from the shared {@link PixelCard} primitive; styling uses
 * design-token utility classes only.
 */
import type { ReactElement } from "react";

import { PixelCard } from "@/components/PixelCard";

import type { StageStep } from "../lib/stages";

export interface AdventureProgressProps {
  /** The ordered six-stage model with each stage's status. */
  steps: readonly StageStep[];
}

/** Human-readable status label (also announced to screen readers). */
function statusLabel(status: StageStep["status"]): string {
  if (status === "complete") return "Done";
  if (status === "current") return "In progress";
  return "Locked";
}

/** Token-based classes for the step marker, keyed by status. */
function markerClasses(status: StageStep["status"]): string {
  if (status === "current") {
    return "border-accent bg-accent text-bg";
  }
  if (status === "complete") {
    return "border-primary bg-primary text-bg";
  }
  return "border-muted text-subtle";
}

export function AdventureProgress({
  steps,
}: AdventureProgressProps): ReactElement {
  return (
    <PixelCard title="Your quest">
      {/* A compact log: one line per step, joined by a track down the left. Only
          the current step opens up to show what to do. */}
      <ol className="flex flex-col" aria-label="Quest progress">
        {steps.map((step, index) => {
          const isCurrent = step.status === "current";
          const isLast = index === steps.length - 1;
          return (
            <li
              key={step.stage}
              aria-current={isCurrent ? "step" : undefined}
              className="flex gap-16"
            >
              <span className="flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className={`font-display flex h-24 w-24 shrink-0 items-center justify-center border-2 ${markerClasses(
                    step.status,
                  )}`}
                >
                  {step.status === "complete" ? "✓" : step.step}
                </span>
                {isLast ? null : (
                  <span
                    aria-hidden="true"
                    className={`w-0 flex-1 border-l-2 ${
                      step.status === "complete"
                        ? "border-primary"
                        : "border-dashed border-muted"
                    }`}
                  />
                )}
              </span>
              <span className={`flex min-w-0 flex-col ${isLast ? "" : "pb-16"}`}>
                <span
                  className={`font-display ${
                    isCurrent
                      ? "text-accent"
                      : step.status === "complete"
                        ? "text-ink"
                        : "text-subtle"
                  }`}
                >
                  {step.title}
                </span>
                <span className="sr-only">{statusLabel(step.status)}</span>
                {isCurrent ? (
                  <span className="font-body text-subtle">{step.blurb}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </PixelCard>
  );
}

export default AdventureProgress;
