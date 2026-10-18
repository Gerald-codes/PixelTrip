"use client";

/**
 * SkeletonCards — placeholder cards shaped like the recommendation cards, shown
 * while the guide works so the layout does not jump when results arrive. A
 * stepped scan line sweeps across each card (off under reduced motion). Hidden
 * from screen readers; the GuideThinking status line announces progress.
 */
import type { ReactElement } from "react";

function Bar({ width }: { width: string }): ReactElement {
  return <span className={`block h-16 bg-muted ${width}`} />;
}

export function SkeletonCards({ count = 3 }: { count?: number }): ReactElement {
  return (
    <div aria-hidden className="flex flex-col gap-16">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="relative flex flex-col gap-16 overflow-hidden border-4 border-primary-dark bg-bg-alt p-8"
        >
          <div className="flex items-center justify-between gap-16 border-2 border-primary-dark bg-bg px-16 py-8">
            <Bar width="w-1/2" />
            <Bar width="w-1/5" />
          </div>
          <div className="flex flex-col gap-8 px-8">
            <Bar width="w-1/4" />
            <Bar width="w-full" />
            <Bar width="w-5/6" />
          </div>
          <div className="flex gap-8 px-8 pb-8">
            <Bar width="w-1/6" />
            <Bar width="w-1/6" />
            <Bar width="w-1/6" />
          </div>
          <span
            className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-ink opacity-10 animate-pixel-scan motion-reduce:animate-none"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        </div>
      ))}
    </div>
  );
}

export default SkeletonCards;
