import { NextResponse } from "next/server";

import { runAgent } from "@/lib/bedrock";
import { getServiceSupabase } from "@/lib/supabase";
import {
  RoomStage,
  type DestinationSuggestion,
  type BudgetLevel,
  type TravelStyle,
  type TripInterest,
} from "@/lib/types";

/**
 * Destination Research Agent — Demo Moment 1.
 *
 * Endpoint contract:
 *   POST /api/agents/destinations   body: { roomId }    runs the agent and
 *                                                       (re-)persists 3–5
 *                                                       suggestions.
 *   GET  /api/agents/destinations?roomId=...            returns the most
 *                                                       recently persisted
 *                                                       suggestions without
 *                                                       re-running the agent.
 *
 * Demo guarantees (see .kiro/steering/ai-agent-rules.md, Demo Moment 1):
 * - Concrete reasoning tied to seasonality, weather, crowds, price, and
 *   persona fit for the group's actual travel window.
 * - No generic popularity picks; every option has at least one honest
 *   downside in `downsides`.
 * - Returned array is sorted by `fitScore` descending.
 *
 * Stage gate: the room must be in `DESTINATIONS`. Anything else → 409.
 * Profile gate: a `room_profiles` row for the room must exist (created by the
 * group-profile agent — task 5.2). If missing → 412 so the caller knows to
 * run the group-profile agent first.
 */

// Always run on the server, always fresh — agent output must not be cached.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Postgres "no rows" code returned by `.single()` when nothing matches. */
const NO_ROWS = "PGRST116";

// ─── Row shapes + mappers ─────────────────────────────────────────────────

/** Shape of a `destination_suggestions` row as returned by Supabase. */
interface DestinationSuggestionRow {
  id: string;
  room_id: string;
  destination_name: string;
  fit_score: number;
  weather_summary: string;
  seasonality_summary: string;
  crowd_level: "low" | "moderate" | "high";
  price_level: "budget" | "moderate" | "premium";
  best_activities: string[];
  downsides: string[];
  persona_fit_summary: string;
  recommendation_reason: string;
}

function mapSuggestionRow(row: DestinationSuggestionRow): DestinationSuggestion {
  return {
    id: row.id,
    roomId: row.room_id,
    destinationName: row.destination_name,
    fitScore: row.fit_score,
    weatherSummary: row.weather_summary,
    seasonalitySummary: row.seasonality_summary,
    crowdLevel: row.crowd_level,
    priceLevel: row.price_level,
    bestActivities: row.best_activities ?? [],
    downsides: row.downsides ?? [],
    personaFitSummary: row.persona_fit_summary,
    recommendationReason: row.recommendation_reason,
  };
}

// ─── Agent output validation ──────────────────────────────────────────────

/** What the agent must produce per item — DestinationSuggestion minus the DB-owned fields. */
type AgentDestinationItem = Omit<DestinationSuggestion, "id" | "roomId">;

const CROWD_LEVELS = new Set(["low", "moderate", "high"]);
const PRICE_LEVELS = new Set(["budget", "moderate", "premium"]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isAgentDestinationItem(value: unknown): value is AgentDestinationItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  if (typeof v.destinationName !== "string" || v.destinationName.trim() === "") {
    return false;
  }
  if (
    typeof v.fitScore !== "number" ||
    !Number.isFinite(v.fitScore) ||
    v.fitScore < 0 ||
    v.fitScore > 100
  ) {
    return false;
  }
  if (typeof v.weatherSummary !== "string") return false;
  if (typeof v.seasonalitySummary !== "string") return false;
  if (typeof v.crowdLevel !== "string" || !CROWD_LEVELS.has(v.crowdLevel)) {
    return false;
  }
  if (typeof v.priceLevel !== "string" || !PRICE_LEVELS.has(v.priceLevel)) {
    return false;
  }
  if (!isStringArray(v.bestActivities) || v.bestActivities.length === 0) return false;
  // Demo Moment 1: every option must state at least one honest downside.
  if (!isStringArray(v.downsides) || v.downsides.length < 1) return false;
  if (typeof v.personaFitSummary !== "string") return false;
  if (typeof v.recommendationReason !== "string") return false;

  return true;
}

// ─── Prompt ───────────────────────────────────────────────────────────────

/** Build the vibe-weighting addition for the system prompt when vibes are present. */
function buildVibeWeightingInstructions(vibes: string[]): string {
  if (vibes.length === 0) return "";

  const vibeDescriptions: Record<string, string> = {
    asia: "Asian destinations (East Asia, Southeast Asia, South Asia)",
    western_cities: "European and Western city destinations with urban culture",
    beach_escape: "coastal and island destinations with beaches, ocean, and warm-weather activities",
    nature_scenery: "destinations known for stunning natural landscapes, mountains, parks, and scenic vistas",
    food_trip: "destinations celebrated for their food scene, local cuisine, and culinary experiences",
    culture_trip: "culturally rich destinations with strong historical, artistic, or heritage significance",
    adventure_trip: "destinations offering outdoor adventure activities, hiking, extreme sports, or wilderness exploration",
    shopping_city: "shopping-oriented city destinations with markets, malls, and retail culture",
    hidden_gems: "off-the-beaten-path destinations that are less touristy and offer authentic local experiences",
    anywhere: "any destination worldwide that best fits the group's profile",
  };

  const descriptions = vibes
    .filter((v) => v !== "anywhere")
    .map((v) => vibeDescriptions[v] ?? v)
    .filter(Boolean);

  if (descriptions.length === 0) return "";

  return [
    "",
    "TRAVEL VIBE WEIGHTING:",
    `The group has expressed interest in: ${descriptions.join("; ")}.`,
    "Weight your destination suggestions toward categories that match these vibes. Specifically:",
    ...vibes
      .filter((v) => v !== "anywhere")
      .map((v) => {
        const weightingMap: Record<string, string> = {
          asia: "  - Prioritise Asian countries and cities.",
          western_cities: "  - Prioritise European capitals and Western urban destinations.",
          beach_escape: "  - Prioritise coastal, island, or beach resort destinations.",
          nature_scenery: "  - Prioritise destinations with dramatic natural scenery, national parks, or mountain/forest landscapes.",
          food_trip: "  - Prioritise destinations internationally recognised for food culture and culinary diversity.",
          culture_trip: "  - Prioritise destinations with UNESCO heritage sites, museums, historical districts, or strong local traditions.",
          adventure_trip: "  - Prioritise destinations with trekking, diving, skiing, surfing, or other active outdoor pursuits.",
          shopping_city: "  - Prioritise destinations with vibrant retail scenes, night markets, or luxury shopping districts.",
          hidden_gems: "  - Prioritise underrated, lesser-known destinations that deliver authentic experiences over tourist traps.",
        };
        return weightingMap[v] ?? `  - Consider destinations matching the \"${v}\" vibe.`;
      }),
    "When vibes conflict with the group's dates or budget, state the trade-off in `downsides` but still respect the vibe preference.",
  ].join("\n");
}

const BASE_SYSTEM_PROMPT_LINES = [
  "You are PixelTrip's destination research expert.",
  "A small group of friends (2–6 people) is choosing a trip destination together. You must give them honest, specific, persona-aware recommendations — never generic popularity picks.",
  "",
  "Output a JSON array of 3 to 5 destination objects. Each object MUST have exactly these fields (no extras, no omissions):",
  "- destinationName: string — city or country.",
  "- fitScore: integer 0–100 — how well this destination fits THIS group at THIS time.",
  "- weatherSummary: string — expected weather during the group's actual travel window.",
  "- seasonalitySummary: string — why this season is good or bad for this destination.",
  "- crowdLevel: \"low\" | \"moderate\" | \"high\" — expected tourist density during the window.",
  "- priceLevel: \"budget\" | \"moderate\" | \"premium\" — overall cost level.",
  "- bestActivities: string[] of 3–5 concrete activities at this destination.",
  "- downsides: string[] — at least one honest trade-off. Never leave this empty.",
  "- personaFitSummary: string — which personas in this group it fits well and which it does not.",
  "- recommendationReason: string — the concrete, group-specific reason this destination is on the list.",
  "",
  "Non-negotiable rules:",
  "1. Tailor every reason to THIS group at THIS time of year. Reference the actual travel window dates, the group's budget range, dominant pace, common interests, and the specific persona mix you are given.",
  "2. Do NOT recommend generic popular destinations. If a famous place would be wrong for this group's dates, budget, or persona mix, either exclude it OR include it with the trade-off stated explicitly in both `recommendationReason` and `downsides`.",
  "3. Every option must include at least one honest downside in `downsides`. No destination is perfect; if you cannot think of a trade-off, you have not thought hard enough.",
  "4. Sort the array by `fitScore` descending.",
  "5. Prefer destinations that overlap with the group's stated destination interests when they fit the criteria, but include other strong candidates when a stated interest is genuinely a poor fit — and explain why.",
  "6. Keep `recommendationReason` and `personaFitSummary` concrete and concise (2–4 sentences each).",
  "7. When member character data is provided with budgetLevel, travelStyle, tripInterests, and planningWeights — use them as authoritative signals for that member's preferences over any generic description.",
];

/** Build the full system prompt, including vibe-weighting instructions when relevant. */
function buildSystemPrompt(travelVibes: string[]): string {
  const vibeInstructions = buildVibeWeightingInstructions(travelVibes);
  return [...BASE_SYSTEM_PROMPT_LINES, vibeInstructions].join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────

interface JoinedUserRow {
  id: string;
  display_name: string;
  selected_persona_id: string | null;
  personas:
    | {
        name: string;
        budget_level: string;
        travel_pace: string;
        interests: string[];
        flexibility: string;
        decision_style: string;
        description: string;
      }
    | null;
}

interface AvailabilityRow {
  user_id: string;
  start_date: string;
  end_date: string;
}

interface DestinationPreferenceRow {
  user_id: string;
  country_or_city: string;
}

/** Minimal shape of a `character_profiles` row as returned by Supabase. */
interface CharacterProfileRow {
  user_id: string;
  display_name: string;
  budget_level: BudgetLevel;
  travel_style: TravelStyle;
  trip_interests: TripInterest[];
  generated_persona_name: string;
  planning_weights: Record<string, number>;
}

/** Build the user-prompt payload the agent will read. */
function buildContext(args: {
  groupProfile: Record<string, unknown>;
  users: JoinedUserRow[];
  availability: AvailabilityRow[];
  destinationPreferences: DestinationPreferenceRow[];
  characterProfiles: CharacterProfileRow[];
}): { userPrompt: string; travelVibes: string[] } {
  // Index character profiles by user_id for O(1) lookup.
  const profileByUserId = new Map<string, CharacterProfileRow>(
    args.characterProfiles.map((cp) => [cp.user_id, cp]),
  );

  // Separate vibe-prefixed preferences from plain destination preferences.
  const travelVibes: string[] = [];
  const plainPreferences: DestinationPreferenceRow[] = [];

  for (const pref of args.destinationPreferences) {
    if (pref.country_or_city.startsWith("vibe:")) {
      const vibeName = pref.country_or_city.slice("vibe:".length).trim();
      if (vibeName && !travelVibes.includes(vibeName)) {
        travelVibes.push(vibeName);
      }
    } else {
      plainPreferences.push(pref);
    }
  }

  const members = args.users.map((u) => {
    const cp = profileByUserId.get(u.id);

    if (cp) {
      // Requirement 6.2: use CharacterProfile data when available.
      return {
        userId: u.id,
        displayName: u.display_name,
        characterProfile: {
          generatedPersonaName: cp.generated_persona_name,
          budgetLevel: cp.budget_level,
          travelStyle: cp.travel_style,
          tripInterests: cp.trip_interests,
          planningWeights: cp.planning_weights,
        },
        // Include legacy persona as supplemental context if it exists.
        persona: u.personas
          ? {
              name: u.personas.name,
              budgetLevel: u.personas.budget_level,
              travelPace: u.personas.travel_pace,
              interests: u.personas.interests,
              flexibility: u.personas.flexibility,
              decisionStyle: u.personas.decision_style,
              description: u.personas.description,
            }
          : null,
      };
    }

    // Requirement 6.3: fall back to persona data when no CharacterProfile exists.
    return {
      userId: u.id,
      displayName: u.display_name,
      characterProfile: null,
      persona: u.personas
        ? {
            name: u.personas.name,
            budgetLevel: u.personas.budget_level,
            travelPace: u.personas.travel_pace,
            interests: u.personas.interests,
            flexibility: u.personas.flexibility,
            decisionStyle: u.personas.decision_style,
            description: u.personas.description,
          }
        : null,
    };
  });

  const dateRanges = args.availability.map((a) => ({
    userId: a.user_id,
    startDate: a.start_date,
    endDate: a.end_date,
  }));

  const destinationInterests = plainPreferences.map((p) => ({
    userId: p.user_id,
    countryOrCity: p.country_or_city,
  }));

  const userPrompt = JSON.stringify(
    {
      today: new Date().toISOString().slice(0, 10),
      groupProfile: args.groupProfile,
      members,
      dateRanges,
      destinationInterests,
      // Requirement 6.4/6.5: include extracted travel vibes as a signal.
      travelVibes: travelVibes.length > 0 ? travelVibes : undefined,
    },
    null,
    2,
  );

  return { userPrompt, travelVibes };
}

// ─── POST: run the agent and persist suggestions ──────────────────────────

interface PostBody {
  roomId?: unknown;
}

/**
 * POST /api/agents/destinations
 *
 * Body: { roomId: string }
 *
 * Runs the destination research agent, validates the output, deletes any
 * previously persisted suggestions for the room, inserts the new ones, and
 * returns them as `DestinationSuggestion[]` sorted by `fitScore` descending.
 *
 * Errors:
 *   400 — missing/invalid body
 *   404 — room not found
 *   409 — room is not in `DESTINATIONS` stage
 *   412 — group profile not yet generated for this room
 *   500 — agent failure or DB failure (with `{ error, retryable }`)
 */
export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const roomId = body.roomId;
  if (typeof roomId !== "string" || roomId.trim() === "") {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  // 1. Verify the room exists and is in the DESTINATIONS stage.
  const { data: roomData, error: roomError } = await supabase
    .from("trip_rooms")
    .select("id, room_code, current_stage")
    .eq("id", roomId)
    .single();

  if (roomError) {
    if (roomError.code === NO_ROWS) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    console.log(`[agent/destinations] failed to load room ${roomId}:`, roomError.message);
    return NextResponse.json({ error: "Failed to load room" }, { status: 500 });
  }

  const room = roomData as { id: string; room_code: string; current_stage: string };

  if (room.current_stage !== RoomStage.DESTINATIONS) {
    return NextResponse.json(
      {
        error: `Room is not in DESTINATIONS stage (current: ${room.current_stage})`,
      },
      { status: 409 },
    );
  }

  // 2. Load the group profile (created by task 5.2). Missing → 412.
  const { data: profileRow, error: profileError } = await supabase
    .from("room_profiles")
    .select("*")
    .eq("room_id", roomId)
    .maybeSingle();

  if (profileError || !profileRow) {
    if (profileError) {
      // Most commonly: table does not exist yet (Postgres 42P01) or no row.
      console.log(
        `[agent/destinations] group profile unavailable for room ${room.room_code}:`,
        profileError.message,
      );
    }
    return NextResponse.json(
      {
        error:
          "Group profile not found for this room — run /api/agents/group-profile first",
        retryable: false,
      },
      { status: 412 },
    );
  }

  // 3. Load members + their selected personas (via the FK on selected_persona_id).
  const { data: usersData, error: usersError } = await supabase
    .from("users")
    .select(
      "id, display_name, selected_persona_id, personas:selected_persona_id (name, budget_level, travel_pace, interests, flexibility, decision_style, description)",
    )
    .eq("room_id", roomId);

  if (usersError) {
    console.log(`[agent/destinations] failed to load members for room ${room.room_code}:`, usersError.message);
    return NextResponse.json({ error: "Failed to load members" }, { status: 500 });
  }

  // 4. Load availability + raw destination preferences for full context.
  const [availabilityResult, preferencesResult] = await Promise.all([
    supabase
      .from("availability")
      .select("user_id, start_date, end_date")
      .eq("room_id", roomId),
    supabase
      .from("destination_preferences")
      .select("user_id, country_or_city")
      .eq("room_id", roomId),
  ]);

  if (availabilityResult.error) {
    console.log(
      `[agent/destinations] failed to load availability for room ${room.room_code}:`,
      availabilityResult.error.message,
    );
    return NextResponse.json({ error: "Failed to load availability" }, { status: 500 });
  }
  if (preferencesResult.error) {
    console.log(
      `[agent/destinations] failed to load destination preferences for room ${room.room_code}:`,
      preferencesResult.error.message,
    );
    return NextResponse.json(
      { error: "Failed to load destination preferences" },
      { status: 500 },
    );
  }

  // 5. Query character_profiles for all room members.
  //    Requirement 6.1: read character_profiles before constructing the agent prompt.
  //    Requirement 6.8: on any error (including table-not-found / 42P01), log and fall back
  //    to persona-only — never return 500 due to this query failing.
  let characterProfiles: CharacterProfileRow[] = [];
  const { data: cpData, error: cpError } = await supabase
    .from("character_profiles")
    .select(
      "user_id, display_name, budget_level, travel_style, trip_interests, generated_persona_name, planning_weights",
    )
    .eq("room_id", roomId);

  if (cpError) {
    console.log(
      `[agent/destinations] character_profiles unavailable for room ${room.room_code} (falling back to persona-only):`,
      cpError.message,
    );
    // Fall back gracefully — characterProfiles stays empty, existing persona data is used.
  } else {
    characterProfiles = (cpData as CharacterProfileRow[]) ?? [];
  }

  // 6. Build context and call the agent.
  const { userPrompt, travelVibes } = buildContext({
    groupProfile: profileRow as Record<string, unknown>,
    users: (usersData as unknown as JoinedUserRow[]) ?? [],
    availability: (availabilityResult.data as AvailabilityRow[]) ?? [],
    destinationPreferences:
      (preferencesResult.data as DestinationPreferenceRow[]) ?? [],
    characterProfiles,
  });

  // Build the system prompt, enriched with vibe-weighting instructions when vibes exist.
  const systemPrompt = buildSystemPrompt(travelVibes);

  const result = await runAgent<unknown>({
    systemPrompt,
    userPrompt,
    maxTokens: 3000,
  });

  if (!result.ok) {
    console.log(
      `[agent/destinations] agent failure for room ${room.room_code}:`,
      result.error,
    );
    return NextResponse.json(
      { error: result.error, retryable: result.retryable },
      { status: 500 },
    );
  }

  // 7. Validate the agent's output shape.
  const data = result.data;
  if (
    !Array.isArray(data) ||
    data.length < 3 ||
    data.length > 5 ||
    !data.every(isAgentDestinationItem)
  ) {
    console.log(
      `[agent/destinations] invalid agent output shape for room ${room.room_code}`,
    );
    return NextResponse.json(
      { error: "Agent returned an invalid destination list", retryable: true },
      { status: 500 },
    );
  }

  // Defensive: sort by fitScore descending in case the model didn't.
  const sorted = [...data].sort((a, b) => b.fitScore - a.fitScore);

  // 8. Replace any prior suggestions for this room (re-runs replace).
  //
  // Also clear any existing destination votes for this room BEFORE deleting
  // the suggestions — vote rows store selected_option = destination_suggestions.id,
  // so regenerating destinations without clearing votes leaves orphaned vote
  // rows pointing at deleted IDs. Those orphans corrupt the tally (phantom
  // "tied options" that don't correspond to any visible destination card).
  const { error: clearVotesError } = await supabase
    .from("votes")
    .delete()
    .eq("room_id", roomId)
    .eq("vote_type", "destination");

  if (clearVotesError) {
    console.log(
      `[agent/destinations] failed to clear previous votes for room ${room.room_code}:`,
      clearVotesError.message,
    );
    return NextResponse.json(
      { error: "Failed to clear previous votes" },
      { status: 500 },
    );
  }

  const { error: deleteError } = await supabase
    .from("destination_suggestions")
    .delete()
    .eq("room_id", roomId);

  if (deleteError) {
    console.log(
      `[agent/destinations] failed to clear previous suggestions for room ${room.room_code}:`,
      deleteError.message,
    );
    return NextResponse.json(
      { error: "Failed to clear previous suggestions" },
      { status: 500 },
    );
  }

  // 9. Persist new suggestions. Map camelCase → snake_case.
  const inserts = sorted.map((item) => ({
    room_id: roomId,
    destination_name: item.destinationName,
    fit_score: Math.round(item.fitScore),
    weather_summary: item.weatherSummary,
    seasonality_summary: item.seasonalitySummary,
    crowd_level: item.crowdLevel,
    price_level: item.priceLevel,
    best_activities: item.bestActivities,
    downsides: item.downsides,
    persona_fit_summary: item.personaFitSummary,
    recommendation_reason: item.recommendationReason,
  }));

  const { data: insertedRows, error: insertError } = await supabase
    .from("destination_suggestions")
    .insert(inserts)
    .select();

  if (insertError || !insertedRows) {
    console.log(
      `[agent/destinations] failed to persist suggestions for room ${room.room_code}:`,
      insertError?.message ?? "no rows returned",
    );
    return NextResponse.json(
      { error: "Failed to persist suggestions" },
      { status: 500 },
    );
  }

  const suggestions = (insertedRows as DestinationSuggestionRow[])
    .map(mapSuggestionRow)
    .sort((a, b) => b.fitScore - a.fitScore);

  console.log(
    `[agent/destinations] room ${room.room_code} generated ${suggestions.length} suggestions: ${suggestions
      .map((s) => s.destinationName)
      .join(", ")}`,
  );

  return NextResponse.json(suggestions);
}

// ─── GET: return the most recently persisted suggestions (no re-run) ──────

/**
 * GET /api/agents/destinations?roomId=...
 *
 * Returns the most recently persisted destination suggestions for the room
 * (sorted by `fitScore` descending). Does NOT invoke the agent — use POST to
 * (re-)run it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId")?.trim();

  if (!roomId) {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("destination_suggestions")
    .select()
    .eq("room_id", roomId)
    .order("fit_score", { ascending: false });

  if (error) {
    console.log(
      `[agent/destinations] failed to load persisted suggestions for room ${roomId}:`,
      error.message,
    );
    return NextResponse.json(
      { error: "Failed to load suggestions" },
      { status: 500 },
    );
  }

  const suggestions = (data as DestinationSuggestionRow[]).map(mapSuggestionRow);
  return NextResponse.json(suggestions);
}
