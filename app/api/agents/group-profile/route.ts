import { NextResponse } from "next/server";

import { runAgent } from "@/lib/bedrock";
import { calculateOverlap, type DateRange } from "@/lib/overlap";
import { getServiceSupabase } from "@/lib/supabase";
import {
  RoomStage,
  type Availability,
  type DestinationPreference,
  type GroupProfile,
  type Persona,
  type User,
} from "@/lib/types";

// Agents are stage-scoped and must always run live — never cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ─── Row shapes (snake_case columns from Supabase) ────────────────────────

interface TripRoomRow {
  id: string;
  room_code: string;
  current_stage: string;
}

interface UserRow {
  id: string;
  display_name: string;
  room_id: string;
  selected_persona_id: string | null;
}

interface PersonaRow {
  id: string;
  name: string;
  avatar_image: string;
  budget_level: "low" | "medium" | "high";
  travel_pace: "slow" | "moderate" | "fast";
  interests: string[];
  flexibility: "rigid" | "moderate" | "flexible";
  decision_style: string;
  description: string;
  planning_weight: Record<string, number>;
}

interface AvailabilityRow {
  id: string;
  user_id: string;
  room_id: string;
  start_date: string;
  end_date: string;
}

interface DestinationPreferenceRow {
  id: string;
  user_id: string;
  room_id: string;
  country_or_city: string;
}

interface RoomProfileRow {
  profile: GroupProfile;
  created_at: string;
}

// ─── Row → camelCase mappers ──────────────────────────────────────────────

function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.display_name,
    roomId: row.room_id,
    selectedPersonaId: row.selected_persona_id,
  };
}

function mapPersonaRow(row: PersonaRow): Persona {
  return {
    id: row.id,
    name: row.name,
    avatarImage: row.avatar_image,
    budgetLevel: row.budget_level,
    travelPace: row.travel_pace,
    interests: row.interests ?? [],
    flexibility: row.flexibility,
    decisionStyle: row.decision_style,
    description: row.description,
    planningWeight: row.planning_weight ?? {},
  };
}

function mapAvailabilityRow(row: AvailabilityRow): Availability {
  return {
    id: row.id,
    userId: row.user_id,
    roomId: row.room_id,
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

function mapDestinationPreferenceRow(
  row: DestinationPreferenceRow,
): DestinationPreference {
  return {
    id: row.id,
    userId: row.user_id,
    roomId: row.room_id,
    countryOrCity: row.country_or_city,
  };
}

// ─── Prompt construction ──────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You are PixelTrip's group travel advisor. You summarise a group of friends",
  "into a single combined travel profile so they understand their collective",
  "preferences and tensions before picking a destination.",
  "",
  "Return ONLY valid JSON matching this exact shape:",
  "{",
  '  "budgetRange": string,                     // concise prose, e.g. "budget to mid-range, with one luxury outlier"',
  '  "dominantPace": "slow" | "moderate" | "fast",',
  '  "commonInterests": string[],               // deduplicated, 3–8 entries',
  '  "travelWindow": { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" } | null,',
  '  "tensionPoints": string[],                 // 1–4 entries; concrete (e.g. "low-budget Scenic Wanderer vs. high-budget Luxury Traveller")',
  '  "dominantPersonaTraits": string[]          // 2–5 traits that define this group',
  "}",
  "",
  "Rules:",
  "- Use the precomputed travelWindow from the input verbatim; do not invent dates.",
  "- Keep budgetRange and each tensionPoint short and specific. No filler.",
  "- Deduplicate commonInterests (case-insensitive) and prefer the friendliest phrasing.",
  "- Surface 1–4 tensionPoints when budget, pace, flexibility, or interests clash; use [] if none.",
  "- Total output under 300 words.",
].join("\n");

interface AgentMember {
  displayName: string;
  persona: {
    name: string;
    budgetLevel: Persona["budgetLevel"];
    travelPace: Persona["travelPace"];
    flexibility: Persona["flexibility"];
    decisionStyle: string;
    interests: string[];
    description: string;
  } | null;
  availability: DateRange[];
  destinationInterests: string[];
}

interface AgentContext {
  travelWindow: DateRange | null;
  members: AgentMember[];
  obviousTensions: string[];
}

/**
 * Inspect the group for obvious mechanical tensions we can flag without the
 * model having to spot them. Helps the agent stay concrete instead of vague.
 */
function detectObviousTensions(members: AgentMember[]): string[] {
  const tensions: string[] = [];
  const personas = members
    .map((m) => m.persona)
    .filter((p): p is NonNullable<AgentMember["persona"]> => p !== null);

  const hasLow = personas.some((p) => p.budgetLevel === "low");
  const hasHigh = personas.some((p) => p.budgetLevel === "high");
  if (hasLow && hasHigh) {
    const lowNames = personas
      .filter((p) => p.budgetLevel === "low")
      .map((p) => p.name);
    const highNames = personas
      .filter((p) => p.budgetLevel === "high")
      .map((p) => p.name);
    tensions.push(
      `Budget mismatch: ${lowNames.join(", ")} (low) vs. ${highNames.join(", ")} (high)`,
    );
  }

  const hasSlow = personas.some((p) => p.travelPace === "slow");
  const hasFast = personas.some((p) => p.travelPace === "fast");
  if (hasSlow && hasFast) {
    tensions.push("Pace mismatch: slow-paced members alongside fast-paced ones");
  }

  return tensions;
}

function buildAgentContext(
  users: User[],
  personasById: Map<string, Persona>,
  availabilityByUser: Map<string, DateRange[]>,
  destinationInterestsByUser: Map<string, string[]>,
  travelWindow: DateRange | null,
): AgentContext {
  const members: AgentMember[] = users.map((user) => {
    const persona =
      user.selectedPersonaId !== null
        ? personasById.get(user.selectedPersonaId) ?? null
        : null;
    return {
      displayName: user.displayName,
      persona: persona
        ? {
            name: persona.name,
            budgetLevel: persona.budgetLevel,
            travelPace: persona.travelPace,
            flexibility: persona.flexibility,
            decisionStyle: persona.decisionStyle,
            interests: persona.interests,
            description: persona.description,
          }
        : null,
      availability: availabilityByUser.get(user.id) ?? [],
      destinationInterests: destinationInterestsByUser.get(user.id) ?? [],
    };
  });

  return {
    travelWindow,
    members,
    obviousTensions: detectObviousTensions(members),
  };
}

// ─── Shape validation ─────────────────────────────────────────────────────

const VALID_PACES = new Set<GroupProfile["dominantPace"]>([
  "slow",
  "moderate",
  "fast",
]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Validate the JSON object returned by the agent matches the GroupProfile
 * contract. Returns the validated object or null. Reject unknowns rather than
 * silently coercing — the UI relies on these fields.
 */
function validateGroupProfile(raw: unknown): GroupProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.budgetRange !== "string") return null;
  if (
    typeof obj.dominantPace !== "string" ||
    !VALID_PACES.has(obj.dominantPace as GroupProfile["dominantPace"])
  ) {
    return null;
  }
  if (!isStringArray(obj.commonInterests)) return null;
  if (!isStringArray(obj.tensionPoints)) return null;
  if (!isStringArray(obj.dominantPersonaTraits)) return null;

  let travelWindow: GroupProfile["travelWindow"] = null;
  if (obj.travelWindow !== null && obj.travelWindow !== undefined) {
    const tw = obj.travelWindow as Record<string, unknown>;
    if (
      typeof tw.startDate !== "string" ||
      typeof tw.endDate !== "string"
    ) {
      return null;
    }
    travelWindow = { startDate: tw.startDate, endDate: tw.endDate };
  }

  return {
    budgetRange: obj.budgetRange,
    dominantPace: obj.dominantPace as GroupProfile["dominantPace"],
    commonInterests: obj.commonInterests,
    travelWindow,
    tensionPoints: obj.tensionPoints,
    dominantPersonaTraits: obj.dominantPersonaTraits,
  };
}

// ─── Route handlers ───────────────────────────────────────────────────────

interface PostBody {
  roomId?: unknown;
}

/**
 * POST /api/agents/group-profile
 *
 * Runs the group-profile agent for the given room and persists the result.
 *
 * Stage gate: the room must be in `GROUP_PROFILE`. Any other stage returns 409
 * (per ai-agent-rules.md: agents are stage-scoped).
 *
 * Request body: `{ roomId: string }`
 * Response: the validated `GroupProfile` JSON.
 * On agent failure: `{ error, retryable }` with status 500.
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

  // 1. Stage check — room must exist and be in GROUP_PROFILE.
  const { data: roomRow, error: roomError } = await supabase
    .from("trip_rooms")
    .select("id, room_code, current_stage")
    .eq("id", roomId)
    .single();

  if (roomError || !roomRow) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  const room = roomRow as TripRoomRow;
  if (room.current_stage !== RoomStage.GROUP_PROFILE) {
    return NextResponse.json(
      {
        error: `Room is in stage ${room.current_stage}; group-profile agent requires ${RoomStage.GROUP_PROFILE}`,
      },
      { status: 409 },
    );
  }

  // 2. Load context in parallel.
  const [usersResult, personasResult, availabilityResult, preferencesResult] =
    await Promise.all([
      supabase
        .from("users")
        .select("id, display_name, room_id, selected_persona_id")
        .eq("room_id", roomId),
      supabase
        .from("personas")
        .select(
          "id, name, avatar_image, budget_level, travel_pace, interests, flexibility, decision_style, description, planning_weight",
        ),
      supabase
        .from("availability")
        .select("id, user_id, room_id, start_date, end_date")
        .eq("room_id", roomId),
      supabase
        .from("destination_preferences")
        .select("id, user_id, room_id, country_or_city")
        .eq("room_id", roomId),
    ]);

  if (
    usersResult.error ||
    personasResult.error ||
    availabilityResult.error ||
    preferencesResult.error
  ) {
    console.log("[agent/group-profile] failed to load context");
    return NextResponse.json(
      { error: "Failed to load group context" },
      { status: 500 },
    );
  }

  const users = (usersResult.data as UserRow[]).map(mapUserRow);
  if (users.length === 0) {
    return NextResponse.json(
      { error: "Room has no members" },
      { status: 409 },
    );
  }

  const personas = (personasResult.data as PersonaRow[]).map(mapPersonaRow);
  const personasById = new Map<string, Persona>(
    personas.map((p) => [p.id, p]),
  );

  // Group availability rows by user.
  const availabilityByUser = new Map<string, DateRange[]>();
  for (const row of (availabilityResult.data as AvailabilityRow[]).map(
    mapAvailabilityRow,
  )) {
    const list = availabilityByUser.get(row.userId) ?? [];
    list.push({ startDate: row.startDate, endDate: row.endDate });
    availabilityByUser.set(row.userId, list);
  }

  // Group destination preferences by user.
  const destinationInterestsByUser = new Map<string, string[]>();
  for (const row of (preferencesResult.data as DestinationPreferenceRow[]).map(
    mapDestinationPreferenceRow,
  )) {
    const list = destinationInterestsByUser.get(row.userId) ?? [];
    list.push(row.countryOrCity);
    destinationInterestsByUser.set(row.userId, list);
  }

  // 3. Compute the authoritative travel window.
  //    Only feed users who actually submitted ranges; if any member is missing
  //    ranges the group overlap is undefined, so we pass null to the model.
  let travelWindow: DateRange | null = null;
  const allMembersSubmitted = users.every(
    (u) => (availabilityByUser.get(u.id) ?? []).length > 0,
  );
  if (allMembersSubmitted) {
    const ranges: DateRange[][] = users.map(
      (u) => availabilityByUser.get(u.id) ?? [],
    );
    travelWindow = calculateOverlap(ranges);
  }

  // 4. Build context + run agent.
  const context = buildAgentContext(
    users,
    personasById,
    availabilityByUser,
    destinationInterestsByUser,
    travelWindow,
  );

  const result = await runAgent<unknown>({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: JSON.stringify(context),
    maxTokens: 800,
  });

  if (!result.ok) {
    console.log(
      `[agent/group-profile] room ${room.room_code} agent failed: ${result.error}`,
    );
    return NextResponse.json(
      { error: result.error, retryable: result.retryable },
      { status: 500 },
    );
  }

  const profile = validateGroupProfile(result.data);
  if (!profile) {
    console.log(
      `[agent/group-profile] room ${room.room_code} returned invalid shape`,
    );
    return NextResponse.json(
      { error: "Agent returned invalid group profile shape", retryable: true },
      { status: 500 },
    );
  }

  // 5. Persist (upsert by room_id so re-running replaces the prior profile).
  const { error: upsertError } = await supabase
    .from("room_profiles")
    .upsert(
      { room_id: roomId, profile },
      { onConflict: "room_id" },
    );

  if (upsertError) {
    console.log(
      `[agent/group-profile] room ${room.room_code} failed to persist: ${upsertError.message}`,
    );
    return NextResponse.json(
      { error: "Failed to persist group profile" },
      { status: 500 },
    );
  }

  console.log(
    `[agent/group-profile] room ${room.room_code} profile generated: budget=${profile.budgetRange} pace=${profile.dominantPace}`,
  );

  return NextResponse.json(profile);
}

/**
 * GET /api/agents/group-profile?roomId=...
 *
 * Returns the most recently persisted group profile for a room (without
 * re-running the agent). Used by `GroupProfileStage` to render the profile
 * for members who join the stage after the host has already generated it.
 *
 * Returns 404 when no profile has been generated yet.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId")?.trim();

  if (!roomId) {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("room_profiles")
    .select("profile, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to load group profile" },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "No group profile has been generated for this room yet" },
      { status: 404 },
    );
  }

  return NextResponse.json((data as RoomProfileRow).profile);
}
