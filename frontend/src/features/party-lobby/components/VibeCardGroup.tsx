"use client";

/**
 * VibeCardGroup — the single reusable selectable-card group used across the whole
 * character/preference questionnaire AND the destination picker, so every choice
 * on the screen looks identical.
 *
 * The question is a title-size heading with a one-line hint when it takes several answers.
 * Each option renders as a compact tile: an 8-bit blue panel with a gold border + gold
 * title (pixel icon + label) and a readable white description. The SELECTED card flips
 * to a gold fill with dark ink text, so the chosen option is obvious.
 *
 * Supports both selection modes via `mode`:
 * - `"multi"` (default): any number selected; `onToggle(id)` adds/removes.
 * - `"single"`: exactly one; the same `onToggle(id)` fires and the parent keeps
 *   one id. (Re-selecting the active one is a parent decision.)
 *
 * Presentational only: no data fetching, no persistence. Token styling only.
 */
import { PixelIcon } from "@/components/PixelIcon";
import type { ReactElement } from "react";

import type { CharacterOption } from "../lib/characterOptions";
import { QUESTION_HEADING, QUESTION_HINT } from "../lib/questionStyles";

export interface VibeCardGroupProps {
  /** Group heading rendered as the fieldset legend. */
  legend: string;
  /** Selectable options; each carries a stable id, label, optional icon + description. */
  options: readonly CharacterOption[];
  /** Ids of the currently selected options. */
  selectedIds: readonly string[];
  /** Raised when a card is activated. */
  onToggle: (id: string) => void;
  /** Selection semantics for assistive tech + visuals. Defaults to "multi". */
  mode?: "single" | "multi";
}

export function VibeCardGroup({
  legend,
  options,
  selectedIds,
  onToggle,
  mode = "multi",
}: VibeCardGroupProps): ReactElement {
  return (
    <fieldset className="flex flex-col gap-8">
      <legend className={`${QUESTION_HEADING} mb-8`}>{legend}</legend>
      {/* Only questions that take several answers need saying so. */}
      {mode === "multi" ? (
        <p className={`${QUESTION_HINT} mb-8`}>Pick as many as you like</p>
      ) : null}
      {/* Answers are compact tiles, three across when there is room, so the
          question stays the loudest thing and the form stays short. */}
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 xl:grid-cols-3">
        {options.map((option) => {
          const selected = selectedIds.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              aria-label={mode === "single" ? option.label : undefined}
              onClick={() => onToggle(option.id)}
              className={`flex flex-col border-2 px-16 py-8 text-left enabled:hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none ${
                selected
                  ? "border-ink bg-accent text-bg shadow-pixel-sm"
                  : "border-accent bg-bg-alt text-ink"
              }`}
            >
              <span
                className={`flex items-center gap-8 font-display ${
                  selected ? "text-bg" : "text-accent"
                }`}
              >
                {option.icon ? <PixelIcon name={option.icon} size={16} /> : null}
                {option.label}
              </span>
              {option.description ? (
                <span
                  className={`font-body text-sm ${selected ? "text-bg" : "text-subtle"}`}
                >
                  {option.description}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default VibeCardGroup;
