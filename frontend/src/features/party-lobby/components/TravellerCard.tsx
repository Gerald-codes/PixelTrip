"use client";

/**
 * TravellerCard — the traveller being created, updating with every choice.
 *
 * Shown in the sticky sidebar while the character form is open (and as a slim
 * strip pinned above the form on small screens, where the sidebar folds away), so
 * the player always sees what their answers do:
 *
 * - the role changes the costume and the role name;
 * - the budget, priorities, places and activities appear as pixel badges;
 * - the free dates appear as a line;
 * - a count shows how many of the six questions are answered.
 */
import type { ReactElement } from "react";

import { CharacterSprite } from "@/components/CharacterSprite";
import { PixelCard } from "@/components/PixelCard";
import { PixelIcon, type PixelIconName } from "@/components/PixelIcon";

import { LAYER_MAP, resolveLayers } from "../lib/characterLayers";
import {
  ACTIVITIES,
  BUDGET_TIERS,
  DESTINATIONS,
  GROUP_ROLES,
  TRIP_PRIORITIES,
  type CharacterOption,
} from "../lib/characterOptions";
import { formatDay } from "../lib/tripDates";
import type { CharacterDraft } from "../types";

const QUESTIONS = 6;

/** How many of the form's six questions have an answer. */
export function answeredCount(draft: CharacterDraft): number {
  return [
    draft.budgetTier !== null,
    draft.groupRole !== null,
    draft.tripPriorities.length > 0,
    draft.destinations.length > 0,
    draft.activities.length > 0,
    draft.availableDates.some((range) => range.start && range.end),
  ].filter(Boolean).length;
}

function pick(
  catalog: readonly CharacterOption[],
  ids: readonly string[],
): CharacterOption[] {
  return ids
    .map((id) => catalog.find((option) => option.id === id))
    .filter((option): option is CharacterOption => option !== undefined);
}

function Badge({ icon, label }: { icon?: PixelIconName; label: string }): ReactElement {
  return (
    <li className="border-2 border-accent bg-bg p-8 text-accent" title={label}>
      <PixelIcon name={icon ?? "star"} size={16} label={label} />
    </li>
  );
}

export interface TravellerCardProps {
  draft: CharacterDraft;
  /** The player's name. */
  name: string;
  /** `card` for the sidebar, `strip` for the slim bar above the form on phones. */
  variant?: "card" | "strip";
}

export function TravellerCard({
  draft,
  name,
  variant = "card",
}: TravellerCardProps): ReactElement {
  const layers = resolveLayers(draft, LAYER_MAP);
  const role = GROUP_ROLES.find((option) => option.id === draft.groupRole);
  const budget = BUDGET_TIERS.find((option) => option.id === draft.budgetTier);
  const answered = answeredCount(draft);
  const count = `${answered} of ${QUESTIONS} answered`;

  if (variant === "strip") {
    return (
      <div className="flex items-center gap-16 border-2 border-ink bg-bg px-8">
        <span className="flex h-64 w-64 shrink-0 items-end justify-center overflow-hidden">
          <CharacterSprite
            // Re-keyed on the role so the new costume steps in.
            key={draft.groupRole ?? "none"}
            spriteKey="preview"
            label={`${name}'s traveller`}
            layers={layers}
            scale={2}
            decorative
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-display text-accent">
            {role ? role.label : "Your traveller"}
          </span>
          <span className="font-body text-subtle">{count}</span>
        </span>
      </div>
    );
  }

  const dates = draft.availableDates.filter((range) => range.start && range.end);
  const badges = [
    ...pick(TRIP_PRIORITIES, draft.tripPriorities),
    ...pick(DESTINATIONS, draft.destinations),
    ...pick(ACTIVITIES, draft.activities),
  ];

  return (
    <PixelCard title="Your traveller">
      <div className="flex flex-col items-center gap-16" data-testid="traveller-card">
        <span
          key={draft.groupRole ?? "none"}
          className="animate-pixel-pop motion-reduce:animate-none"
        >
          <CharacterSprite
            spriteKey="preview"
            label={`${name}'s traveller`}
            layers={layers}
            scale={5}
            decorative
          />
        </span>

        <div className="flex flex-col items-center gap-8 text-center">
          <p className="font-display text-accent">{name}</p>
          <p className="font-body">
            {role ? role.label : "Pick a role to dress your traveller"}
            {budget ? `, ${budget.label.toLowerCase()}` : ""}
            {draft.budgetText ? `, SGD ${Number(draft.budgetText).toLocaleString("en-SG")}` : ""}
          </p>
        </div>

        {badges.length > 0 ? (
          <ul
            className="flex flex-wrap justify-center gap-8"
            aria-label="What you are after"
          >
            {badges.map((option, index) => (
              <Badge
                key={`${option.id}-${index}`}
                icon={option.icon}
                label={option.label}
              />
            ))}
          </ul>
        ) : null}

        {dates.length > 0 ? (
          <p className="font-body text-center text-subtle">
            Free{" "}
            {dates
              .map((range) =>
                range.start === range.end
                  ? formatDay(range.start)
                  : `${formatDay(range.start)} to ${formatDay(range.end)}`,
              )
              .join(", ")}
          </p>
        ) : null}

        <p className="font-display text-subtle" aria-live="polite">
          {count}
        </p>
      </div>
    </PixelCard>
  );
}

export default TravellerCard;
