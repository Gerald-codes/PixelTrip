"use client";

import type { Persona } from "@/lib/types";

/**
 * Presentational props for {@link PersonaCard}.
 *
 * The card is purely presentational and owns no state — the parent stage owns
 * the "currently selected persona" and tells each card whether it is selected.
 *
 * - `persona`  — the persona to render.
 * - `selected` — whether this card is the currently chosen persona.
 * - `onSelect` — fired when the card is clicked (the parent persists the
 *                choice and broadcasts to other members).
 * - `disabled` — optional; when true, the card cannot be selected (e.g. the
 *                host has advanced past LOBBY). Defaults to false.
 */
export interface PersonaCardProps {
  persona: Persona;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * A single 8-bit persona card. Renders the persona's avatar, name, budget,
 * pace, flexibility, decision style, and interest tags, and visually
 * highlights the selected state.
 *
 * The avatar PNG asset may not exist yet for every persona — the `<img>`
 * `alt` text covers the missing-image case for accessibility.
 */
export default function PersonaCard({
  persona,
  selected,
  onSelect,
  disabled = false,
}: PersonaCardProps) {
  const baseClasses =
    "flex w-full flex-col gap-3 rounded-lg border-2 p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-400";
  const stateClasses = selected
    ? "border-blue-600 bg-blue-50 shadow-sm"
    : "border-gray-200 bg-white hover:border-gray-300";
  const disabledClasses = disabled
    ? "cursor-not-allowed opacity-60"
    : "cursor-pointer";

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`${baseClasses} ${stateClasses} ${disabledClasses}`}
    >
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- pixel-art PNG asset; next/image would force a domain/config we don't have for the MVP */}
        <img
          src={persona.avatarImage}
          alt={`${persona.name} avatar`}
          className="h-14 w-14 rounded-md bg-gray-100 object-cover"
          style={{ imageRendering: "pixelated" }}
        />
        <div className="flex flex-col">
          <span className="text-base font-semibold">{persona.name}</span>
          <span className="text-xs text-gray-500">{persona.decisionStyle}</span>
        </div>
        {selected && (
          <span className="ml-auto rounded bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
            Selected
          </span>
        )}
      </div>

      <p className="text-sm text-gray-700">{persona.description}</p>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">
        <div className="flex justify-between">
          <dt className="font-medium text-gray-500">Budget</dt>
          <dd className="capitalize">{persona.budgetLevel}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="font-medium text-gray-500">Pace</dt>
          <dd className="capitalize">{persona.travelPace}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="font-medium text-gray-500">Flexibility</dt>
          <dd className="capitalize">{persona.flexibility}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="font-medium text-gray-500">Decision</dt>
          <dd>{persona.decisionStyle}</dd>
        </div>
      </dl>

      {persona.interests.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {persona.interests.map((interest) => (
            <li
              key={interest}
              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
            >
              {interest}
            </li>
          ))}
        </ul>
      )}
    </button>
  );
}
