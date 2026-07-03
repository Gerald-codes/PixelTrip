import { NextResponse } from "next/server";

import { runAgent } from "@/lib/bedrock";
import { getServiceSupabase } from "@/lib/supabase";
import type { ConflictOption } from "@/lib/types";

/**
 * POST /api/agents/tiebreak
 *
 * Generates AI-mediated resolution options for a tied group vote.
 * Works for any vote type (destination, flight, future activity).
 * No stage gate — ties can occur at any voting stage.
 *
 * Body:
 * {
 *   roomId: string
 *   voteType: "destination" | "flight" | "conflict_resolution"
 *   tiedOptions: string[]    // e.g. ["budget", "comfort"]
 *   tally: Record<string, number>
 * }
 *
 * Returns:
 * {
 *   conflictSummary: string
 *   proposedOptions: ConflictOption[]   // ≥ 2, each with description + tradeoffs
 * }
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_ROWS = "PGRST116";

interface PostBody {
  roomId?: unknown;
  voteType?: unknown;
  tiedOptions?: unknown;
  tally?: unknown;
}

interface TripRoomRow {
  id: string;
  room_code: string;
  current_stage: string;
  selected_destination: string | null;
  selected_flight_option: string | null;
}

interface UserRow {
  id: string;
  display_name: string;
}

interface CharacterProfileRow {
  user_id: string;
  display_name: string;
  budget_level: string;
  travel_style: string;
  trip_interests: string[];
  generated_persona_name: string;
}

interface TiebreakAgentOutput {
  conflictSummary: string;
  proposedOptions: ConflictOption[];
}

function isTiebreakOutput(value: unknown): value is TiebreakAgentOutput {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.conflictSummary !== "string" || v.conflictSummary.trim() === "") return false;
  if (!Array.isArray(v.proposedOptions) || v.proposedOptions.length < 2) return false;
  for (const opt of v.proposedOptions) {
    if (!opt || typeof opt !== "object") return false;
    const o = opt as Record<string, unknown>;
    if (typeof o.id !== "string") return false;
    if (typeof o.description !== "string") return false;
    if (typeof o.tradeoffs !== "string") return false;
  }
  return true;
}

const SYSTEM_PROMPT = `You are PixelTrip's group decision mediator. A group vote ended in a tie and you must help the group break it fairly.

Your job:
1. Explain the tie clearly in 1–2 sentences.
2. Propose 2–3 concrete resolution options. Each option should either pick one of the tied options and explain why, or suggest a compromise that the group can vote on.

Output a single JSON object with EXACTLY these fields:
- conflictSummary: string — 1-2 sentence plain-language explanation of what the tie means and why it matters for this group
- proposedOptions: array of objects, each with:
  - id: string (unique slug, e.g. "pick_budget", "pick_comfort", "compromise_best_value")
  - description: string — short action label, ≤ 15 words
  - tradeoffs: string — one sentence on the trade-off for this choice

Rules:
- Use plain, friendly language. No jargon.
- When the vote involves destinations, ALWAYS use the destination NAME (city/country) in your descriptions, NEVER use the raw UUID/ID.
- Every option must have a meaningful trade-off — not just "it's cheaper" but who it helps and who it doesn't.
- If a "Best Value" or middle-ground option exists, you may include it as a compromise.
- Never leave proposedOptions empty or with only one item.
- Return ONLY valid JSON. No preamble, no markdown.`;

export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { roomId, voteType, tiedOptions, tally } = body;

  if (typeof roomId !== "string" || roomId.trim() === "") {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }
  if (typeof voteType !== "string") {
    return NextResponse.json({ error: "voteType is required" }, { status: 400 });
  }
  if (!Array.isArray(tiedOptions) || tiedOptions.length < 2) {
    return NextResponse.json(
      { error: "tiedOptions must be an array with at least 2 options" },
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();

  // Load room for context.
  const { data: roomData, error: roomError } = await supabase
    .from("trip_rooms")
    .select("id, room_code, current_stage, selected_destination, selected_flight_option")
    .eq("id", roomId)
    .single();

  if (roomError) {
    if (roomError.code === NO_ROWS) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to load room" }, { status: 500 });
  }

  const room = roomData as TripRoomRow;

  // Load members.
  const { data: usersData } = await supabase
    .from("users")
    .select("id, display_name")
    .eq("room_id", roomId);

  const users = (usersData as UserRow[]) ?? [];

  // Load character profiles (graceful fallback).
  let characterProfiles: CharacterProfileRow[] = [];
  const { data: cpData } = await supabase
    .from("character_profiles")
    .select("user_id, display_name, budget_level, travel_style, trip_interests, generated_persona_name")
    .eq("room_id", roomId);
  if (cpData) characterProfiles = cpData as CharacterProfileRow[];

  // Load availability overlap for travel window (from room_profiles).
  let travelWindow: { startDate: string; endDate: string } | null = null;
  const { data: profileData } = await supabase
    .from("room_profiles")
    .select("profile")
    .eq("room_id", roomId)
    .maybeSingle();
  if (profileData) {
    const profile = (profileData as { profile: { travelWindow?: { startDate: string; endDate: string } | null } }).profile;
    travelWindow = profile?.travelWindow ?? null;
  }

  // Build human-readable context for the agent.
  const memberContext = users.map((u) => {
    const cp = characterProfiles.find((p) => p.user_id === u.id);
    return cp
      ? { name: u.display_name, persona: cp.generated_persona_name, budget: cp.budget_level, style: cp.travel_style, interests: cp.trip_interests }
      : { name: u.display_name };
  });

  // Build vote-type-specific context.
  let voteContext = "";
  if (voteType === "flight") {
    // Include flight option descriptions for a useful agent prompt.
    const FLIGHT_DESC: Record<string, string> = {
      budget: "Budget ($150–$280/person, 2 stops, 14–22h travel time)",
      best_value: "Best Value ($290–$380/person, 1 stop, 11–16h)",
      comfort: "Comfort ($420–$620/person, 1 stop, 9–13h)",
    };
    const tiedDescriptions = (tiedOptions as string[]).map(
      (o) => `${o}: ${FLIGHT_DESC[o] ?? o}`,
    );
    voteContext = `Tied flight options: ${tiedDescriptions.join(" | ")}. ${room.selected_destination ? `Destination: ${room.selected_destination}.` : ""}`;
  } else if (voteType === "destination") {
    // Resolve destination IDs to human-readable names from the DB.
    const destIds = tiedOptions as string[];
    const { data: destRows } = await supabase
      .from("destination_suggestions")
      .select("id, destination_name")
      .in("id", destIds);

    const nameMap = new Map<string, string>(
      ((destRows ?? []) as Array<{ id: string; destination_name: string }>).map(
        (r) => [r.id, r.destination_name],
      ),
    );
    const tiedNames = destIds.map((id) => nameMap.get(id) ?? id);
    voteContext = `Tied destinations: ${tiedNames.join(", ")}. Use the destination NAMES (not IDs) in your descriptions.`;
  } else {
    voteContext = `Tied options: ${(tiedOptions as string[]).join(", ")}.`;
  }

  // For destination ties, include an ID→name mapping so the agent uses human
  // readable names and the client can map back to IDs for resolution.
  let optionNames: Record<string, string> | undefined;
  if (voteType === "destination") {
    const destIds = tiedOptions as string[];
    const { data: destRows2 } = await supabase
      .from("destination_suggestions")
      .select("id, destination_name")
      .in("id", destIds);
    optionNames = Object.fromEntries(
      ((destRows2 ?? []) as Array<{ id: string; destination_name: string }>).map(
        (r) => [r.id, r.destination_name],
      ),
    );
  }

  const userPrompt = JSON.stringify({
    voteType,
    tiedOptions,
    optionNames, // maps IDs → names for destination votes
    tally,
    voteContext,
    travelWindow,
    members: memberContext,
    currentStage: room.current_stage,
    selectedDestination: room.selected_destination,
  });

  const result = await runAgent<unknown>({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 1200,
  });

  if (!result.ok) {
    console.log(`[agent/tiebreak] agent failure for room ${room.room_code}:`, result.error);
    return NextResponse.json(
      { error: result.error, retryable: result.retryable },
      { status: 500 },
    );
  }

  if (!isTiebreakOutput(result.data)) {
    console.log(`[agent/tiebreak] invalid output shape for room ${room.room_code}`);
    return NextResponse.json(
      { error: "Agent returned an invalid tiebreak response", retryable: true },
      { status: 500 },
    );
  }

  console.log(
    `[agent/tiebreak] room ${room.room_code} tiebreak for ${voteType}: ${(tiedOptions as string[]).join(", ")}`,
  );

  return NextResponse.json(result.data, { status: 200 });
}
