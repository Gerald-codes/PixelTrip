"use client";

/**
 * CharacterPreview — the large composable layered avatar in the character creator
 * (Lobby Character Creation, Task 4.1).
 *
 * Presentational only: data in via props, no data fetching. Renders the character
 * as an ordered stack of visual layers by delegating to the SHARED extended
 * `CharacterSprite` primitive (size `lg`) — it does not re-implement sprite
 * rendering. The layers are supplied already resolved and ordered by the caller
 * (via the data-driven Layer_Map), so adding new assets never requires touching
 * this component (Req 2.4, 2.5).
 *
 * The preview is decorative to assistive technology: `decorative` makes the sprite
 * `aria-hidden`, so the whole preview region is hidden from assistive tech per
 * Requirement 18.6. The `label` describes the sprite for its data/label but is not
 * exposed as an accessible name.
 */
import type { ReactElement } from "react";

import { CharacterSprite } from "@/components/CharacterSprite";
import type { SpriteLayer } from "../types";

export interface CharacterPreviewProps {
  /** Ordered stack of resolved visual layers (pre-sorted by `order` upstream). */
  layers: readonly SpriteLayer[];
  /** Describes the character for the sprite's data/label (not an accessible name). */
  label: string;
}

export function CharacterPreview({
  layers,
  label,
}: CharacterPreviewProps): ReactElement {
  return (
    <div className="flex items-center justify-center p-16">
      <CharacterSprite
        spriteKey="preview"
        label={label}
        layers={layers}
        size="lg"
        decorative
      />
    </div>
  );
}

export default CharacterPreview;
