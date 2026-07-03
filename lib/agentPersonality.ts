/**
 * Named agent personalities for PixelTrip's conversational multiplayer UX.
 *
 * This module is the single source of truth for the five documented
 * Agent_Characters — Milo, Compass, Atlas, Harmony, and Echo — and the pure,
 * total `resolvePersonality()` helper that always returns a fully-populated
 * `AgentPersonality` for any `AgentId`, filling documented defaults for every
 * missing or partial field (Req 3.8, design Property 11).
 *
 * All logic here is pure — no side effects, no API calls.
 *
 * Import `AgentId`, `AgentPersonality`, and `AgentAnimation` from
 * `lib/types.ts` — do not redefine these shapes inline.
 */

import type { AgentId, AgentPersonality, AgentAnimation } from "./types";

// ─── Documented character personalities (Req 3.1–3.6, 3.9) ─────────────────────

/**
 * The five documented Agent_Characters, keyed by `AgentId`.
 *
 * Mirrors the personality table in the design document exactly:
 *
 * | id          | name    | role                   | color                     | avatar    | animation | speaking style |
 * |-------------|---------|------------------------|---------------------------|-----------|-----------|----------------|
 * | guide       | Milo    | Guild host             | sky-blue + sunset-orange  | guide     | wave      | warm, inviting |
 * | destination | Compass | Destination specialist | blue + green              | compass   | bounce    | adventurous    |
 * | itinerary   | Atlas   | Travel planner         | purple                    | calendar  | organize  | organized      |
 * | mediator    | Harmony | Facilitator            | gold                      | handshake | nod       | diplomatic     |
 * | feedback    | Echo    | Travel analyst         | teal                      | chart     | think     | thoughtful     |
 */
export const AGENT_PERSONALITIES: Record<AgentId, AgentPersonality> = {
  guide: {
    id: "guide",
    name: "Milo",
    role: "Guild host",
    personality: "Warm, welcoming, and encouraging — the friendly face who greets the party and keeps everyone moving together.",
    colorHex: "#38BDF8", // sky-blue (paired with sunset-orange #FB923C)
    avatarIcon: "guide",
    speakingStyle: "Warm and inviting, using friendly first-person guild-host language that makes everyone feel welcome.",
    animation: "wave",
  },
  destination: {
    id: "destination",
    name: "Compass",
    role: "Destination specialist",
    personality: "Adventurous and curious — always excited to explore new places and surface destinations the party will love.",
    colorHex: "#2563EB", // blue (paired with grass-green #22C55E)
    avatarIcon: "compass",
    speakingStyle: "Adventurous and enthusiastic, painting a picture of each place with vivid, exploratory language.",
    animation: "bounce",
  },
  itinerary: {
    id: "itinerary",
    name: "Atlas",
    role: "Travel planner",
    personality: "Organized and methodical — turns the party's ideas into a clear, well-structured plan.",
    colorHex: "#A855F7", // purple
    avatarIcon: "calendar",
    speakingStyle: "Organized and precise, laying out flights, activities, and days in a clear, structured way.",
    animation: "organize",
  },
  mediator: {
    id: "mediator",
    name: "Harmony",
    role: "Facilitator",
    personality: "Diplomatic and even-handed — helps the party discuss travel tradeoffs and find compromises everyone can enjoy.",
    colorHex: "#F59E0B", // gold
    avatarIcon: "handshake",
    speakingStyle: "Diplomatic and balanced, framing differences positively and guiding the group toward fair compromises.",
    animation: "nod",
  },
  feedback: {
    id: "feedback",
    name: "Echo",
    role: "Travel analyst",
    personality: "Thoughtful and reflective — quietly analyzes how well the trip fits everyone and surfaces insights at the end.",
    colorHex: "#14B8A6", // teal
    avatarIcon: "chart",
    speakingStyle: "Thoughtful and measured, reflecting back what the numbers say in a calm, insightful tone.",
    animation: "think",
  },
};

// ─── Documented defaults (Req 3.8, design Property 11) ─────────────────────────

/**
 * Documented fallback personality used to fill any missing or partial field,
 * and to synthesize a safe personality for an unknown `AgentId`.
 *
 * These values are intentionally neutral and always valid so that
 * `resolvePersonality()` is total: it can never return a personality with an
 * empty required field.
 */
const DEFAULT_ANIMATION: AgentAnimation = "wave";

const DEFAULT_PERSONALITY: Omit<AgentPersonality, "id"> = {
  name: "Guide",
  role: "Travel companion",
  personality: "A helpful travel companion guiding the party through planning.",
  colorHex: "#1E3A5F", // deep-navy — the app's base brand color
  avatarIcon: "guide",
  speakingStyle: "Friendly and clear.",
  animation: DEFAULT_ANIMATION,
};

// ─── Pure, total resolver (Req 3.8, design Property 11) ────────────────────────

/**
 * Return a fully-populated `AgentPersonality` for any `AgentId`.
 *
 * Totality guarantee (design Property 11): for every `AgentId` — and for any
 * partial or missing documented entry — this returns an `AgentPersonality`
 * with EVERY required field (`id`, `name`, `role`, `personality`, `colorHex`,
 * `avatarIcon`, `speakingStyle`, `animation`) populated. It works by merging
 * the documented entry (if any) over `DEFAULT_PERSONALITY`, treating any
 * empty-string or nullish field on the entry as "missing" so a documented but
 * blank field still falls back to the default. An unknown id yields a safe
 * synthesized default carrying that id.
 *
 * Pure function — no side effects, no API calls.
 */
export function resolvePersonality(id: AgentId): AgentPersonality {
  const entry = AGENT_PERSONALITIES[id] as Partial<AgentPersonality> | undefined;

  return {
    id,
    name: pick(entry?.name, DEFAULT_PERSONALITY.name),
    role: pick(entry?.role, DEFAULT_PERSONALITY.role),
    personality: pick(entry?.personality, DEFAULT_PERSONALITY.personality),
    colorHex: pick(entry?.colorHex, DEFAULT_PERSONALITY.colorHex),
    avatarIcon: pick(entry?.avatarIcon, DEFAULT_PERSONALITY.avatarIcon),
    speakingStyle: pick(entry?.speakingStyle, DEFAULT_PERSONALITY.speakingStyle),
    animation: entry?.animation ?? DEFAULT_PERSONALITY.animation,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Return `value` when it is a non-empty string; otherwise return `fallback`.
 * Treats `undefined`, `null`, and whitespace-only strings as "missing" so a
 * documented-but-blank field still falls back to the documented default.
 */
function pick(value: string | undefined | null, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) return value;
  return fallback;
}
