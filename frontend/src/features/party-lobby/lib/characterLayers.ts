/**
 * Data-driven layer map for the simplified composable 8-bit character.
 *
 * The character is now just BASE + ROLE: a polished neutral chibi plus a single
 * role layer (leader/planner/follower/chill/adventurer) that establishes the
 * user's identity in the party. Travel preferences are structured data and are
 * NOT encoded on the sprite.
 *
 * `assetKey` is a stable `${slot}:${id}` string resolved to pixel art by the
 * renderer (`pixelSprites.ts`). `order` keeps base behind the role layer.
 */

import type {
  CharacterDraft,
  LayerMap,
  LayerMapEntry,
  SpriteLayer,
  SpriteLayerSlot,
} from "../types";
import { GROUP_ROLES } from "./characterOptions";

/** Z-order per slot; lower renders behind higher. */
const SLOT_ORDER: Readonly<Record<SpriteLayerSlot, number>> = {
  base: 0,
  role: 1,
};

/** The id of the single, always-present base layer. */
export const BASE_LAYER_ID = "base";

/** Build the id -> entry record for one slot from its option catalog. */
function buildSlotEntries(
  slot: SpriteLayerSlot,
  options: readonly { id: string }[],
): Readonly<Record<string, LayerMapEntry>> {
  const entries: Record<string, LayerMapEntry> = {};
  for (const option of options) {
    entries[option.id] = {
      slot,
      order: SLOT_ORDER[slot],
      assetKey: `${slot}:${option.id}`,
    };
  }
  return entries;
}

/**
 * The data-driven layer map consumed by `resolveLayers`.
 *
 * - `base`: a single always-present entry.
 * - `role`: ids from `GROUP_ROLES` (leader/planner/follower/chill/adventurer).
 */
export const LAYER_MAP: LayerMap = {
  base: {
    [BASE_LAYER_ID]: {
      slot: "base",
      order: SLOT_ORDER.base,
      assetKey: `base:${BASE_LAYER_ID}`,
    },
  },
  role: buildSlotEntries("role", GROUP_ROLES),
};

/**
 * The single always-present base layer, exported for reuse by any consumer that
 * wants to render a neutral chibi (e.g. party cards). The renderer is reusable:
 * pass `[BASE_LAYER]` to `CharacterSprite` to draw the base human.
 */
export const BASE_LAYER: SpriteLayer = LAYER_MAP.base[BASE_LAYER_ID];

/**
 * Resolve a character draft into the ordered stack of sprite layers to render.
 *
 * Always includes the base layer; adds the role layer when a group role is set
 * and known. Unknown ids contribute no layer and never throw, so the stack is
 * never empty. Returned sorted ascending by `order` (base behind role).
 */
export function resolveLayers(
  draft: CharacterDraft,
  map: LayerMap,
): readonly SpriteLayer[] {
  const layers: SpriteLayer[] = [];

  const base = map.base[BASE_LAYER_ID];
  if (base) {
    layers.push(base);
  }

  if (draft.groupRole !== null) {
    const entry: LayerMapEntry | undefined = map.role[draft.groupRole];
    if (entry) {
      layers.push(entry);
    }
  }

  return layers.sort((a, b) => a.order - b.order);
}
