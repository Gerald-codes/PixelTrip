"use client";

/**
 * GuidePortrait — MILO, the NPC travel guide, as crisp pixel art.
 *
 * A 32x32 head-and-shoulders portrait (leather aviator cap with gold goggles, a
 * raised brow and smirk, explorer's leather jacket with a satchel strap and a gold
 * compass badge) drawn by PixelSprite at an integer scale. A
 * second, eyes-only layer blinks for a moment every few seconds, like an idle RPG
 * character; under `prefers-reduced-motion` the blink layer is hidden.
 *
 * Decorative by default (the guide's name is shown as text next to it).
 */
import type { ReactElement } from "react";

import { spriteGridFor } from "@/features/party-lobby/lib/pixelSprites";

import { PixelSprite } from "./PixelSprite";

export interface GuidePortraitProps {
  /** Integer pixel scale: 1 = 32px, 2 = 64px. Defaults to 2. */
  scale?: 1 | 2 | 3;
  /** Give it an accessible name instead of hiding it from assistive tech. */
  label?: string;
}

export function GuidePortrait({
  scale = 2,
  label,
}: GuidePortraitProps): ReactElement {
  const portrait = spriteGridFor("guide:milo");
  const blink = spriteGridFor("guide:milo-blink");

  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="relative inline-block"
    >
      {portrait ? <PixelSprite grids={[portrait]} scale={scale} /> : null}
      {blink ? (
        <span className="absolute left-0 top-0 opacity-0 animate-pixel-blink motion-reduce:hidden">
          <PixelSprite grids={[blink]} scale={scale} />
        </span>
      ) : null}
    </span>
  );
}

export default GuidePortrait;
