/**
 * Avatar configuration derivation utilities for PixelTrip.
 *
 * Pure functions — no API calls, no side effects.
 * Imported by CharacterCreator and any component that needs to derive
 * AvatarConfig or a human-readable persona summary from user selections.
 */

import type { AvatarConfig, BudgetLevel, TravelStyle, TripInterest } from "./types";

// ─── Mapping tables ──────────────────────────────────────────────────────────

const BUDGET_TO_OUTFIT: Record<BudgetLevel, string> = {
  low: "backpacker",
  medium: "casual",
  high: "luxury",
};

const STYLE_TO_HEADWEAR: Record<TravelStyle, string> = {
  leader: "captain_hat",
  planner: "cap_glasses",
  follower: "villager_hat",
  chill: "beanie",
  adventurer: "explorer_hat",
};

const INTEREST_TO_HANDHELD: Record<TripInterest, string> = {
  food: "bubble_tea",
  scenery: "camera",
  adventure: "hiking_stick",
  shopping: "shopping_bag",
  nightlife: "neon_cup",
  culture: "guidebook",
  relaxation: "headphones",
  hidden_gems: "compass",
  flexible: "map",
};

// ─── Human-readable label tables ─────────────────────────────────────────────

const BUDGET_LABELS: Record<BudgetLevel, string> = {
  low: "budget",
  medium: "mid-range",
  high: "luxury",
};

const STYLE_LABELS: Record<TravelStyle, string> = {
  leader: "Leader",
  planner: "Planner",
  follower: "Follower",
  chill: "Chill Traveller",
  adventurer: "Adventurer",
};

const INTEREST_LABELS: Record<TripInterest, string> = {
  food: "Foodie",
  scenery: "Scenery Lover",
  adventure: "Adventure Seeker",
  shopping: "Shopaholic",
  nightlife: "Nightlife Explorer",
  culture: "Culture Enthusiast",
  relaxation: "Relaxation Seeker",
  hidden_gems: "Hidden Gems Hunter",
  flexible: "Flexible Wanderer",
};

// ─── Exported functions ───────────────────────────────────────────────────────

/**
 * Derives an `AvatarConfig` from a user's three character selections.
 *
 * The `primaryInterest` (first interest in the user's selection) determines
 * the handheld item. `baseBody` is always `"default"` for MVP.
 */
export function deriveAvatarConfig(
  budget: BudgetLevel,
  style: TravelStyle,
  primaryInterest: TripInterest
): AvatarConfig {
  return {
    baseBody: "default",
    outfit: BUDGET_TO_OUTFIT[budget],
    headwear: STYLE_TO_HEADWEAR[style],
    handheldItem: INTEREST_TO_HANDHELD[primaryInterest],
  };
}

/**
 * Returns a human-readable persona summary sentence for the CharacterCreator
 * preview. Pure function — no API call.
 *
 * Example output:
 *   "Alex is a mid-range Foodie + Nightlife Explorer Planner who likes
 *    organised routes and good meals."
 */
export function generatePersonaSummary(
  budget: BudgetLevel,
  style: TravelStyle,
  interests: TripInterest[],
  displayName: string
): string {
  const budgetLabel = BUDGET_LABELS[budget];
  const styleLabel = STYLE_LABELS[style];
  const interestLabel = interests
    .map((i) => INTEREST_LABELS[i])
    .join(" + ");

  return `${displayName} is a ${budgetLabel}-budget ${interestLabel} ${styleLabel}.`;
}
