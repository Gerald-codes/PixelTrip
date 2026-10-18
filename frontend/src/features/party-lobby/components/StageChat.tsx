"use client";

/**
 * StageChat — the chatbot-style message primitives that frame each planning stage.
 *
 * The NPC guide ("MILO") speaks in left-aligned bubbles; the party's own actions
 * echo as right-aligned bubbles; system notes (e.g. "Everyone's ready!") are
 * centred muted lines. Interactive stage content (forms, destination cards) is
 * dropped into a guide bubble via {@link GuidePanel}. Presentational only; token
 * styling.
 */
import type { ReactElement, ReactNode } from "react";

import { GuidePortrait } from "@/components/GuidePortrait";

const GUIDE_NAME = "MILO";

/** Shared vertical rhythm wrapper for a stage's message feed. */
export function StageChat({ children }: { children: ReactNode }): ReactElement {
  return <div className="flex flex-col gap-24 pt-8">{children}</div>;
}

function GuideAvatar(): ReactElement {
  return (
    <span aria-hidden className="shrink-0">
      <GuidePortrait scale={2} />
    </span>
  );
}

/** A guide (NPC) message bubble, optionally wrapping interactive content. */
export function GuideMessage({
  time,
  children,
}: {
  time?: string;
  children: ReactNode;
}): ReactElement {
  return (
    // An RPG dialogue box: the portrait beside a framed panel, with the speaker's
    // name on a plate that sits on the panel's top edge.
    <div className="flex items-start gap-8 sm:gap-16">
      <GuideAvatar />
      <div className="relative min-w-0 flex-1 border-2 border-ink bg-bg-alt p-16 pt-24 shadow-pixel">
        <span className="absolute left-16 top-0 flex -translate-y-1/2 items-center gap-8 border-2 border-ink bg-bg px-8">
          <span className="font-display text-accent">{GUIDE_NAME}</span>
          {time ? <span className="font-body text-subtle">{time}</span> : null}
        </span>
        {children}
      </div>
    </div>
  );
}

/** A short line of guide dialogue. */
export function GuideSay({
  time,
  text,
}: {
  time?: string;
  text: string;
}): ReactElement {
  return (
    <GuideMessage time={time}>
      <p className="font-body">{text}</p>
    </GuideMessage>
  );
}

/** The party's own echoed action (right-aligned). */
export function PartySay({
  time,
  text,
}: {
  time?: string;
  text: string;
}): ReactElement {
  return (
    <div className="flex flex-col items-end gap-8">
      <div className="max-w-prose border-2 border-ink bg-primary-dark p-16 text-ink shadow-pixel">
        <p className="font-body">{text}</p>
      </div>
      {time ? <span className="font-body text-subtle">{time}</span> : null}
    </div>
  );
}

/** A centred system note (e.g. "Everyone's ready!"). */
export function SystemNote({ text }: { text: string }): ReactElement {
  return (
    <p className="font-body text-subtle mx-auto border-2 border-dashed border-muted px-16 py-8 text-center">
      {text}
    </p>
  );
}
