/**
 * CharacterSprite — shared 8-bit character avatar primitive (Foundation, Task 5;
 * extended with composable layers in Lobby Character Creation, Task 3.1).
 *
 * Renders an 8-bit character avatar in one of two modes:
 *
 * - **Single-box mode (default):** when no `layers` are provided it reserves the
 *   sprite slot with an accessible label and a token-styled box sized by an integer
 *   factor — exactly as it has always rendered, so every existing call site (e.g.
 *   roster sprites) is unchanged.
 * - **Layered mode:** when a non-empty `layers` array is provided it stacks the
 *   layers as absolutely-positioned, pixelated, integer-scaled nodes inside a
 *   relatively-positioned box sized by the same size class. Layers paint in array
 *   order (the array is pre-sorted by `order` upstream, so later entries render on
 *   top).
 *
 * In both modes the whole sprite is a single image to assistive tech: `decorative`
 * usage keeps `aria-hidden`, labelled usage keeps `role="img"` + `aria-label`, and
 * the individual layer nodes are always decorative. Styling uses design-token
 * utility classes only.
 */
import type { ReactElement } from "react";
import type { SpriteLayer } from "@/features/party-lobby/types";
import {
  spriteGridFor,
  type SpriteGrid,
} from "@/features/party-lobby/lib/pixelSprites";
import { PixelSprite } from "./PixelSprite";

export type CharacterSpriteSize = "sm" | "md" | "lg";

export interface CharacterSpriteProps {
  /** Identifier for the sprite/appearance to render (resolved later). */
  spriteKey: string;
  /** Accessible label describing the character. */
  label: string;
  /** Marks a purely decorative sprite as hidden from assistive technology. */
  decorative?: boolean;
  /** Integer-scaled sprite size. Defaults to `md`. */
  size?: CharacterSpriteSize;
  /**
   * Optional ordered stack of visual layers. When provided and non-empty the
   * sprite renders in layered mode; when omitted or empty it renders exactly as
   * the single-box form. Entries are rendered in array order (pre-sorted by
   * `order` upstream) so later entries paint on top.
   */
  layers?: readonly SpriteLayer[];
  /** Integer pixel scale that overrides the size bucket (1 = 32px). Layered mode only. */
  scale?: number;
}

const SIZE_CLASSES: Record<CharacterSpriteSize, string> = {
  sm: "w-16 h-16",
  md: "w-24 h-24",
  lg: "w-32 h-32",
};

export function CharacterSprite({
  spriteKey,
  label,
  decorative = false,
  size = "md",
  layers,
  scale: scaleOverride,
}: CharacterSpriteProps): ReactElement {
  const role = decorative ? undefined : "img";
  const ariaHidden = decorative || undefined;
  const ariaLabel = decorative ? undefined : label;

  if (layers && layers.length > 0) {
    // Resolve each layer's assetKey to its 16x16 pixel-art grid; unknown keys
    // (no art yet) contribute nothing. Grids composite in order (base behind).
    const grids: SpriteGrid[] = [];
    for (const layer of layers) {
      const grid = spriteGridFor(layer.assetKey);
      if (grid) grids.push(grid);
    }
    // Integer pixel scale per size bucket (32px grid * scale).
    const scale = scaleOverride ?? (size === "lg" ? 7 : size === "md" ? 4 : 1);

    return (
      <div
        role={role}
        aria-hidden={ariaHidden}
        aria-label={ariaLabel}
        data-sprite-key={spriteKey}
        // No frame: the character stands on whatever surface the caller gives it.
        className="inline-flex items-center justify-center"
      >
        <PixelSprite grids={grids} scale={scale} />
      </div>
    );
  }

  return (
    <div
      role={role}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      data-sprite-key={spriteKey}
      className={`image-rendering-pixelated bg-bg-alt ${SIZE_CLASSES[size]}`}
    />
  );
}

export default CharacterSprite;
