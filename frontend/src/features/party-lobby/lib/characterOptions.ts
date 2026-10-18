/**
 * Frontend-local option catalogs for the RPG-style character/preference setup.
 *
 * UI-only placeholders. These ids/labels are not a backend contract — when a real
 * preferences service lands, the authoritative sets come from `api-contracts.md`.
 * Nothing here is sent anywhere while the feature is in-memory.
 */

import type { PixelIconName } from "@/components/PixelIcon";

/** A single selectable option with a stable id and a human-facing label. */
export interface CharacterOption {
  /** Stable id used in local selection state (and, later, by a real service). */
  id: string;
  /** Human-facing label rendered on the option card. */
  label: string;
  /** Optional one-line description shown on richer card groups (e.g. vibes). */
  description?: string;
  /** Optional pixel icon shown on card groups. */
  icon?: PixelIconName;
}

/** Step 1 — budget tier (single-select). */
export const BUDGET_TIERS: readonly CharacterOption[] = [
  { id: "low", label: "Low Budget", icon: "coin", description: "Hostels & street eats" },
  {
    id: "medium",
    label: "Medium Budget",
    icon: "bag",
    description: "Comfy stays & nice meals",
  },
  {
    id: "high",
    label: "High Budget",
    icon: "chest",
    description: "Premium stays & fine dining",
  },
] as const;

/** Step 2 — group-trip role (single-select); drives the character's identity. */
export const GROUP_ROLES: readonly CharacterOption[] = [
  { id: "leader", label: "Leader", icon: "crown", description: "Rallies the party & decides" },
  {
    id: "planner",
    label: "Planner",
    icon: "clipboard",
    description: "Maps out every detail",
  },
  {
    id: "follower",
    label: "Follower",
    icon: "compass",
    description: "Happy to go with the flow",
  },
  { id: "chill", label: "Chill", icon: "sunglasses", description: "Relaxed, no stress" },
  {
    id: "adventurer",
    label: "Adventurer",
    icon: "backpack",
    description: "Chases the next thrill",
  },
] as const;

/** Step 3 — what the user wants most from the trip (multi-select). */
export const TRIP_PRIORITIES: readonly CharacterOption[] = [
  { id: "food", label: "Food", icon: "food", description: "Eat your way around" },
  { id: "scenery", label: "Scenery", icon: "scenery", description: "Views worth the trip" },
  { id: "adventure", label: "Adventure", icon: "adventure", description: "Thrills & action" },
  { id: "shopping", label: "Shopping", icon: "shopping", description: "Markets & retail" },
  { id: "nightlife", label: "Nightlife", icon: "nightlife", description: "After-dark fun" },
  { id: "culture", label: "Culture", icon: "culture", description: "History & art" },
  {
    id: "relaxation",
    label: "Relaxation",
    icon: "relaxation",
    description: "Rest & recharge",
  },
  {
    id: "hidden-gems",
    label: "Hidden Gems",
    icon: "hidden-gems",
    description: "Off-the-beaten path",
  },
  {
    id: "flexibility",
    label: "Flexibility",
    icon: "flexibility",
    description: "Keep plans open",
  },
] as const;

/**
 * Destination VIBES (multi-select). Rather than specific cities, the user picks the
 * kind of trip they feel like — "Where do you feel like going?". These are the
 * free-form destination preferences sent to the planner.
 */
export const DESTINATIONS: readonly CharacterOption[] = [
  { id: "asia", label: "Asia", icon: "pagoda", description: "Rich cultures & buzzing cities" },
  {
    id: "western-cities",
    label: "Western Cities",
    icon: "skyline",
    description: "Architecture, culture & nightlife",
  },
  {
    id: "beach-escape",
    label: "Beach Escape",
    icon: "palm",
    description: "Sun, sand & crystal waters",
  },
  {
    id: "nature-scenery",
    label: "Nature & Scenery",
    icon: "scenery",
    description: "Mountains, forests & wild beauty",
  },
  {
    id: "food-trip",
    label: "Food Trip",
    icon: "food",
    description: "Eat your way around the world",
  },
  {
    id: "cultural-trip",
    label: "Cultural Trip",
    icon: "culture",
    description: "History, art & local traditions",
  },
  {
    id: "adventure-trip",
    label: "Adventure Trip",
    icon: "adventure",
    description: "Thrills, trails & unforgettable moments",
  },
  {
    id: "shopping-city",
    label: "Shopping City",
    icon: "shopping",
    description: "Fashion, markets & retail therapy",
  },
  {
    id: "hidden-gems",
    label: "Hidden Gems",
    icon: "hidden-gems",
    description: "Off-the-beaten-path discoveries",
  },
] as const;

/** Activity options (multi-select tags). */
export const ACTIVITIES: readonly CharacterOption[] = [
  { id: "hiking", label: "Hiking", icon: "boot", description: "Trails & peaks" },
  { id: "markets", label: "Markets", icon: "lantern", description: "Local stalls & finds" },
  { id: "beaches", label: "Beaches", icon: "palm", description: "Sun & sea" },
  { id: "temples", label: "Temples", icon: "torii", description: "Shrines & heritage" },
  { id: "tours", label: "Tours", icon: "map", description: "Guided discovery" },
  { id: "relaxing", label: "Relaxing", icon: "relaxation", description: "Slow & easy days" },
] as const;
