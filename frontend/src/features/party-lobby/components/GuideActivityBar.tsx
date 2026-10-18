"use client";

/**
 * GuideActivityBar — a compact, sticky "MILO is working" bar for any AI run.
 *
 * Shown at the top of the stage column whenever a run is in progress that the
 * current screen does not already explain with its own GuideThinking view, so the
 * party always knows what is happening (and never sees two indicators at once).
 * Non-blocking: everything below stays usable. One line high so it never hides a
 * focused control; a single polite status region announces each step change.
 */
import type { ReactElement } from "react";

import { GuidePortrait } from "@/components/GuidePortrait";
import type { RunProgress } from "@/services/run.contract";

import { PHASE_LINES, RUN_PURPOSE, waitHint } from "../lib/guidePhases";

export function GuideActivityBar({ run }: { run: RunProgress }): ReactElement {
  const step = run.phase ? PHASE_LINES[run.phase] : "Getting started";
  const hint = waitHint(run.elapsedSeconds);

  return (
    <div className="sticky top-0 z-10 flex items-center gap-16 border-2 border-accent bg-bg-alt px-16 py-8">
      <span aria-hidden className="shrink-0">
        <GuidePortrait scale={1} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p role="status" aria-live="polite" className="font-body text-ink">
          <span className="font-display text-accent">MILO</span> is{" "}
          {RUN_PURPOSE[run.runType]}: {step}…
        </p>
        {hint ? <p className="font-body text-subtle">{hint}</p> : null}
      </div>
      <span aria-hidden className="flex items-center gap-8">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-8 w-8 bg-accent animate-pixel-dot motion-reduce:animate-none"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </span>
    </div>
  );
}

export default GuideActivityBar;
