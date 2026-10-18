/**
 * PixelSprite — renders one or more pixel-art grids as crisp 8-bit art.
 *
 * Each grid is an array of rows of single-character colour keys (see
 * `pixelSprites.ts`). Grids are drawn into a shared SPRITE_SIZE coordinate space using
 * CSS `box-shadow` pixels: a single 1px element emits one box-shadow per opaque
 * pixel, then the whole thing is integer-scaled up so the art stays hard-edged.
 * Stacking grids (base -> role) composites the full character; later grids
 * paint on top.
 *
 * This is the renderer the layered `CharacterSprite` was always meant to have.
 * It is tolerant of slightly ragged art data: rows shorter than 16 are treated
 * as transparent past their end, and extra rows/cols beyond the grid are ignored, so
 * authored grids never need to be pixel-perfect in length to line up.
 */
"use client";

import type { CSSProperties, ReactElement } from "react";

import {
  SPRITE_SIZE,
  resolveSpriteColor,
  type SpriteGrid,
} from "@/features/party-lobby/lib/pixelSprites";

export interface PixelSpriteProps {
  /** Ordered grids to composite, back (first) to front (last). */
  grids: readonly SpriteGrid[];
  /** On-screen pixel size of a single sprite pixel (integer scale). Default 8. */
  scale?: number;
}

/** Build the box-shadow value for every opaque pixel across all grids. */
function buildBoxShadow(grids: readonly SpriteGrid[]): string {
  const shadows: string[] = [];
  for (const grid of grids) {
    const rows = grid.slice(0, SPRITE_SIZE);
    for (let y = 0; y < rows.length; y += 1) {
      const row = rows[y];
      const cols = Math.min(row.length, SPRITE_SIZE);
      for (let x = 0; x < cols; x += 1) {
        const color = resolveSpriteColor(row.charAt(x));
        if (color === null) continue;
        // Each pixel is a 1px box-shadow offset onto the grid; later grids are
        // appended last so they paint over earlier ones.
        shadows.push(`${x + 1}px ${y + 1}px 0 0 ${color}`);
      }
    }
  }
  return shadows.join(", ");
}

export function PixelSprite({
  grids,
  scale = 8,
}: PixelSpriteProps): ReactElement {
  const boxShadow = buildBoxShadow(grids);

  // The emitter is a 1px dot at the top-left; box-shadows draw the pixels. The
  // wrapper is sized to the full grid and integer-scaled up.
  const wrapperStyle: CSSProperties = {
    width: `${SPRITE_SIZE}px`,
    height: `${SPRITE_SIZE}px`,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    imageRendering: "pixelated",
  };
  const emitterStyle: CSSProperties = {
    width: "1px",
    height: "1px",
    boxShadow,
  };

  return (
    <div
      aria-hidden
      style={{
        width: `${SPRITE_SIZE * scale}px`,
        height: `${SPRITE_SIZE * scale}px`,
      }}
    >
      <div style={wrapperStyle}>
        <div style={emitterStyle} />
      </div>
    </div>
  );
}

export default PixelSprite;
