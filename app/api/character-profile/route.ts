import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
import type {
  CharacterProfile,
  BudgetLevel,
  TravelStyle,
  TripInterest,
  AvatarConfig,
} from "@/lib/types";

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_BUDGET_LEVELS: BudgetLevel[] = ["low", "medium", "high"];
const VALID_TRAVEL_STYLES: TravelStyle[] = [
  "leader",
  "planner",
  "follower",
  "chill",
  "adventurer",
];

// ─── DB row type ─────────────────────────────────────────────────────────────

interface CharacterProfileRow {
  id: string;
  user_id: string;
  room_id: string;
  display_name: string;
  budget_level: string;
  travel_style: string;
  trip_interests: string[];
  avatar_config: AvatarConfig;
  generated_persona_name: string;
  planning_weights: Record<string, number>;
  created_at: string;
  updated_at: string;
}

/** Map a snake_case DB row to the camelCase {@link CharacterProfile} shape. */
function mapRow(row: CharacterProfileRow): CharacterProfile {
  return {
    id: row.id,
    userId: row.user_id,
    roomId: row.room_id,
    displayName: row.display_name,
    budgetLevel: row.budget_level as BudgetLevel,
    travelStyle: row.travel_style as TravelStyle,
    tripInterests: row.trip_interests as TripInterest[],
    avatarConfig: row.avatar_config,
    generatedPersonaName: row.generated_persona_name,
    planningWeights: row.planning_weights,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Request body type ───────────────────────────────────────────────────────

interface PostBody {
  userId?: unknown;
  roomId?: unknown;
  displayName?: unknown;
  budgetLevel?: unknown;
  travelStyle?: unknown;
  tripInterests?: unknown;
  avatarConfig?: unknown;
  generatedPersonaName?: unknown;
  planningWeights?: unknown;
}

// ─── POST /api/character-profile ─────────────────────────────────────────────

/**
 * POST /api/character-profile
 *
 * Creates or updates a character profile for a user in a room.
 * Uses `ON CONFLICT (user_id, room_id) DO UPDATE SET ...` so re-confirming
 * the character creator replaces the existing row.
 *
 * Returns 201 on INSERT, 200 on UPDATE, 400 for validation errors,
 * 500 for DB errors.
 */
export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    userId,
    roomId,
    displayName,
    budgetLevel,
    travelStyle,
    tripInterests,
    avatarConfig,
    generatedPersonaName,
    planningWeights,
  } = body;

  // ── Required field validation ──────────────────────────────────────────────
  if (typeof userId !== "string" || userId.trim() === "") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (typeof roomId !== "string" || roomId.trim() === "") {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }
  if (typeof displayName !== "string" || displayName.trim() === "") {
    return NextResponse.json(
      { error: "displayName is required" },
      { status: 400 },
    );
  }
  if (typeof budgetLevel !== "string") {
    return NextResponse.json(
      { error: "budgetLevel is required" },
      { status: 400 },
    );
  }
  if (!VALID_BUDGET_LEVELS.includes(budgetLevel as BudgetLevel)) {
    return NextResponse.json(
      {
        error: `budgetLevel must be one of: ${VALID_BUDGET_LEVELS.join(", ")}`,
      },
      { status: 400 },
    );
  }
  if (typeof travelStyle !== "string") {
    return NextResponse.json(
      { error: "travelStyle is required" },
      { status: 400 },
    );
  }
  if (!VALID_TRAVEL_STYLES.includes(travelStyle as TravelStyle)) {
    return NextResponse.json(
      {
        error: `travelStyle must be one of: ${VALID_TRAVEL_STYLES.join(", ")}`,
      },
      { status: 400 },
    );
  }
  if (!Array.isArray(tripInterests)) {
    return NextResponse.json(
      { error: "tripInterests is required and must be an array" },
      { status: 400 },
    );
  }
  if (
    avatarConfig === null ||
    avatarConfig === undefined ||
    typeof avatarConfig !== "object" ||
    Array.isArray(avatarConfig)
  ) {
    return NextResponse.json(
      { error: "avatarConfig is required and must be an object" },
      { status: 400 },
    );
  }
  if (
    typeof generatedPersonaName !== "string" ||
    generatedPersonaName.trim() === ""
  ) {
    return NextResponse.json(
      { error: "generatedPersonaName is required" },
      { status: 400 },
    );
  }
  if (
    planningWeights === null ||
    planningWeights === undefined ||
    typeof planningWeights !== "object" ||
    Array.isArray(planningWeights)
  ) {
    return NextResponse.json(
      { error: "planningWeights is required and must be an object" },
      { status: 400 },
    );
  }

  // ── Upsert ─────────────────────────────────────────────────────────────────
  const supabase = getServiceSupabase();

  // We need to know whether this was an insert or an update so we can return
  // 201 vs 200. Check if the row already exists before the upsert.
  const { data: existing } = await supabase
    .from("character_profiles")
    .select("id")
    .eq("user_id", userId)
    .eq("room_id", roomId)
    .maybeSingle();

  const isNew = existing === null;

  const { data, error } = await supabase
    .from("character_profiles")
    .upsert(
      {
        user_id: userId,
        room_id: roomId,
        display_name: displayName,
        budget_level: budgetLevel,
        travel_style: travelStyle,
        trip_interests: tripInterests,
        avatar_config: avatarConfig,
        generated_persona_name: generatedPersonaName,
        planning_weights: planningWeights,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,room_id" },
    )
    .select()
    .single();

  if (error || !data) {
    console.error("[character-profile] POST upsert error:", error);
    return NextResponse.json(
      { error: "Failed to save character profile" },
      { status: 500 },
    );
  }

  return NextResponse.json(mapRow(data as CharacterProfileRow), {
    status: isNew ? 201 : 200,
  });
}

// ─── GET /api/character-profile?roomId=... ────────────────────────────────────

/**
 * GET /api/character-profile?roomId=...
 *
 * Returns all character profiles for a room, ordered by `created_at` ASC.
 * Used by `useCharacterProfiles` hook to populate `MemberStrip`.
 *
 * Returns 200 with `CharacterProfile[]`, 400 if `roomId` is missing.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("roomId");

  if (!roomId || roomId.trim() === "") {
    return NextResponse.json(
      { error: "roomId query parameter is required" },
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("character_profiles")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[character-profile] GET query error:", error);
    return NextResponse.json(
      { error: "Failed to fetch character profiles" },
      { status: 500 },
    );
  }

  const profiles = (data as CharacterProfileRow[]).map(mapRow);
  return NextResponse.json(profiles, { status: 200 });
}
