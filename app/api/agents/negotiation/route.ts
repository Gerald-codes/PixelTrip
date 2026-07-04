import { NextResponse } from "next/server";

import { runAgent } from "@/lib/bedrock";
import { getServiceSupabase, createAnonSupabase } from "@/lib/supabase";
import {
  RoomStage,
  type Itinerary,
  type ItineraryDay,
  type FairnessSummary,
  type ConflictResolution,
  type ConflictOption,
  type CharacterProfile,
  type BudgetLevel,
  type TravelStyle,
  type TripInterest,
} from "@/lib/types";

/**
 * Negotiation / Revision Agent — Demo Moment 3.
 *
 * Endpoint contract:
 *   POST /api/agents/negotiation   body: { roomId, conflictId, selectedResolution }
 *
 * Stage gate: room must be in `NEGOTIATION`. Anything else → 409.
 *
 * Flow:
 *   1. Verify stage gate.
 *   2. Load trip_rooms for roomId.
 *   3. Load current itinerary via trip_rooms.current_itinerary_id → 412 if missing.
 *   4. Load conflict row from conflict_resolutions WHERE id = conflictId → 404 if missing.
 *   5. Find chosen option from conflict.proposedOptions → 400 if not found.
 *   6. Load users WHERE room_id = roomId.
 *   7. Load character_profiles WHERE room_id = roomId (graceful fallback on error).
 *   8. Build system + user prompt and call runAgent.
 *   9. Validate agent output.
 *  10. Persist new itinerary version, update room, resolve conflict.
 *  11. Broadcast itinerary-updated with diffSummary.
 *  12. Return full Itinerary merged with diffSummary (201).
 */

// Always run on the server, always fresh.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Postgres "no rows" code returned by `.single()` when nothing matches. */
const NO_ROWS = "PGRST116";

// ─── Row shapes + mappers ─────────────────────────────────────────────────

interface TripRoomRow {
  id: string;
  room_code: string;
  current_stage: string;
  host_user_id: string;
  selected_destination: string | null;
  selected_flight_option: "budget" | "comfort" | "best_value" | null;
  current_itinerary_id: string | null;
}

interface ItineraryRow {
  id: string;
  room_id: string;
  version_number: number;
  destination: string;
  start_date: string;
  end_date: string;
  days: unknown;
  fairness_summary: unknown;
  average_satisfaction_score: number | null;
  status: "draft" | "final";
}

function mapItineraryRow(row: ItineraryRow): Itinerary {
  return {
    id: row.id,
    roomId: row.room_id,
    versionNumber: row.version_number,
    destination: row.destination,
    startDate: row.start_date,
    endDate: row.end_date,
    days: row.days as ItineraryDay[],
    fairnessSummary: row.fairness_summary as FairnessSummary,
    averageSatisfactionScore: row.average_satisfaction_score,
    status: row.status,
  };
}

interface ConflictRow {
  id: string;
  room_id: string;
  itinerary_id: string;
  conflict_summary: string;
  affected_users: unknown;
  proposed_options: unknown;
  selected_resolution: string | null;
  status: "open" | "voting" | "resolved";
}

function mapConflictRow(row: ConflictRow): ConflictResolution {
  return {
    id: row.id,
    roomId: row.room_id,
    itineraryId: row.itinerary_id,
    conflictSummary: row.conflict_summary,
    affectedUsers: row.affected_users as string[],
    proposedOptions: row.proposed_options as ConflictOption[],
    selectedResolution: row.selected_resolution,
    status: row.status,
  };
}

interface UserRow {
  id: string;
  display_name: string;
}

interface CharacterProfileRow {
  user_id: string;
  display_name: string;
  budget_level: BudgetLevel;
  travel_style: TravelStyle;
  trip_interests: TripInterest[];
  generated_persona_name: string;
  planning_weights: Record<string, number>;
}

// ─── Agent output shape ───────────────────────────────────────────────────

interface NegotiationAgentOutput {
  days: ItineraryDay[];
  fairnessSummary: FairnessSummary;
  diffSummary: string;
}

// ─── Agent output validation ──────────────────────────────────────────────

function isItineraryItem(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== "string" || v.title.trim() === "") return false;
  if (typeof v.description !== "string") return false;
  if (typeof v.type !== "string") return false;
  if (typeof v.reason !== "string") return false;
  // personaBenefits must be a non-empty string array.
  if (
    !Array.isArray(v.personaBenefits) ||
    v.personaBenefits.length === 0 ||
    !v.personaBenefits.every((b: unknown) => typeof b === "string")
  ) {
    return false;
  }
  return true;
}

function isItineraryDay(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.date !== "string") return false;
  if (!Array.isArray(v.morning) || !v.morning.every(isItineraryItem)) return false;
  if (!Array.isArray(v.afternoon) || !v.afternoon.every(isItineraryItem)) return false;
  if (!Array.isArray(v.evening) || !v.evening.every(isItineraryItem)) return false;
  // night is optional
  if (v.night !== undefined && v.night !== null) {
    if (!Array.isArray(v.night) || !v.night.every(isItineraryItem)) return false;
  }
  return true;
}

function isNegotiationAgentOutput(
  value: unknown,
): value is NegotiationAgentOutput {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  // days must be a non-empty array of valid ItineraryDay objects.
  if (!Array.isArray(v.days) || v.days.length === 0) return false;
  if (!v.days.every(isItineraryDay)) return false;

  // diffSummary must be a non-empty string.
  if (typeof v.diffSummary !== "string" || v.diffSummary.trim() === "") {
    return false;
  }

  // fairnessSummary must exist (we allow partial structure — the agent is trusted here).
  if (!v.fairnessSummary || typeof v.fairnessSummary !== "object") return false;

  return true;
}

// ─── Realtime broadcast ───────────────────────────────────────────────────

async function broadcastItineraryUpdated(
  roomId: string,
  diffSummary: string,
): Promise<void> {
  const supabase = createAnonSupabase();
  const channel = supabase.channel(`room:${roomId}:itinerary`);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
  await channel.send({
    type: "broadcast",
    event: "itinerary-updated",
    payload: { diffSummary },
  });
  void supabase.removeChannel(channel);
}

// ─── System prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are PixelTrip's itinerary revision expert.
A group of friends resolved multiple conflicts. Revise the existing itinerary to incorporate ALL chosen resolutions from the provided conflicts list in a single pass. Preserve as many unchanged items as possible.

Output a single JSON object with EXACTLY these fields:
- days: ItineraryDay[] — the full revised itinerary days
- fairnessSummary: FairnessSummary — regenerated to reflect the revised plan
- diffSummary: string — a plain-language 2-4 sentence summary of what changed and why, naming the specific items that were updated

Non-negotiable rules:
1. Apply ALL resolutions from the conflicts array in one pass — do not process them one at a time.
2. Only modify days/items directly affected by the chosen resolutions.
3. Every ItineraryItem.personaBenefits MUST remain non-empty.
4. The diffSummary must specifically name which items changed and which conflict each change addresses.
5. The revised fairnessSummary must cover every persona.
6. Return only valid JSON. No preamble, no markdown, no commentary.`;

// ─── POST: run the negotiation agent and persist revised itinerary ────────

interface PostBody {
  roomId?: unknown;
  conflicts?: unknown; // Array<{ conflictId: string; selectedResolution: string }>
}

/**
 * POST /api/agents/negotiation
 *
 * Body: { roomId: string; conflicts: Array<{ conflictId: string; selectedResolution: string }> }
 *
 * Runs the negotiation/revision agent, validates the output, persists a new
 * itinerary version, resolves all conflicts, broadcasts itinerary-updated, and
 * returns the new Itinerary merged with diffSummary as status 201.
 *
 * Errors:
 *   400 — missing/invalid body, conflicts is not a non-empty array, or a selectedResolution not found in conflict options
 *   404 — room not found or one or more conflicts not found
 *   409 — room is not in NEGOTIATION stage
 *   412 — current_itinerary_id is missing / no itinerary loaded yet
 *   500 — agent failure or DB failure (with { error, retryable })
 */
export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { roomId, conflicts } = body;

  if (typeof roomId !== "string" || roomId.trim() === "") {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }
  if (!Array.isArray(conflicts) || conflicts.length === 0) {
    return NextResponse.json(
      { error: "conflicts must be a non-empty array" },
      { status: 400 },
    );
  }
  for (const entry of conflicts as Array<Record<string, unknown>>) {
    if (typeof entry.conflictId !== "string" || typeof entry.selectedResolution !== "string") {
      return NextResponse.json(
        { error: "each conflicts entry must have string conflictId and selectedResolution" },
        { status: 400 },
      );
    }
  }
  const conflictEntries = conflicts as Array<{ conflictId: string; selectedResolution: string }>;

  const supabase = getServiceSupabase();

  // 1. Load trip_rooms and verify stage.
  const { data: roomData, error: roomError } = await supabase
    .from("trip_rooms")
    .select(
      "id, room_code, current_stage, host_user_id, selected_destination, selected_flight_option, current_itinerary_id",
    )
    .eq("id", roomId)
    .single();

  if (roomError) {
    if (roomError.code === NO_ROWS) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    console.log(
      `[agent/negotiation] failed to load room ${roomId}:`,
      roomError.message,
    );
    return NextResponse.json({ error: "Failed to load room" }, { status: 500 });
  }

  const room = roomData as TripRoomRow;

  if (room.current_stage !== RoomStage.NEGOTIATION) {
    return NextResponse.json(
      {
        error: `Room is not in NEGOTIATION stage (current: ${room.current_stage})`,
      },
      { status: 409 },
    );
  }

  // 2. Verify current_itinerary_id exists and load the itinerary.
  if (!room.current_itinerary_id) {
    return NextResponse.json(
      {
        error: "No current itinerary found for this room — generate an itinerary first",
        retryable: false,
      },
      { status: 412 },
    );
  }

  const { data: itineraryData, error: itineraryError } = await supabase
    .from("itineraries")
    .select(
      "id, room_id, version_number, destination, start_date, end_date, days, fairness_summary, average_satisfaction_score, status",
    )
    .eq("id", room.current_itinerary_id)
    .single();

  if (itineraryError) {
    if (itineraryError.code === NO_ROWS) {
      return NextResponse.json(
        { error: "Current itinerary not found", retryable: false },
        { status: 412 },
      );
    }
    console.log(
      `[agent/negotiation] failed to load itinerary for room ${room.room_code}:`,
      itineraryError.message,
    );
    return NextResponse.json(
      { error: "Failed to load current itinerary" },
      { status: 500 },
    );
  }

  const currentItinerary = mapItineraryRow(itineraryData as ItineraryRow);

  // 3. Bulk-load all conflict rows for the submitted conflict IDs.
  const conflictIds = conflictEntries.map(e => e.conflictId);
  const { data: conflictsData, error: conflictsError } = await supabase
    .from("conflict_resolutions")
    .select(
      "id, room_id, itinerary_id, conflict_summary, affected_users, proposed_options, selected_resolution, status",
    )
    .in("id", conflictIds);

  if (conflictsError) {
    console.log(
      `[agent/negotiation] failed to bulk-load conflicts for room ${room.room_code}:`,
      conflictsError.message,
    );
    return NextResponse.json(
      { error: "Failed to load conflicts" },
      { status: 500 },
    );
  }

  const loadedConflicts: ConflictResolution[] = (conflictsData as ConflictRow[]).map(mapConflictRow);

  if (loadedConflicts.length !== conflictIds.length) {
    const foundIds = new Set(loadedConflicts.map(c => c.id));
    const missingIds = conflictIds.filter(id => !foundIds.has(id));
    return NextResponse.json(
      { error: `Conflicts not found: ${missingIds.join(", ")}` },
      { status: 404 },
    );
  }

  // 4. Validate that each selectedResolution is present in the conflict's proposedOptions.
  for (const entry of conflictEntries) {
    const conflict = loadedConflicts.find(c => c.id === entry.conflictId)!;
    const optionExists = conflict.proposedOptions.some(o => o.id === entry.selectedResolution);
    if (!optionExists) {
      return NextResponse.json(
        {
          error: `Resolution option "${entry.selectedResolution}" not found in proposedOptions for conflict "${entry.conflictId}"`,
        },
        { status: 400 },
      );
    }
  }

  // 5. Load users for the room.
  const { data: usersData, error: usersError } = await supabase
    .from("users")
    .select("id, display_name")
    .eq("room_id", roomId);

  if (usersError) {
    console.log(
      `[agent/negotiation] failed to load users for room ${room.room_code}:`,
      usersError.message,
    );
    return NextResponse.json({ error: "Failed to load members" }, { status: 500 });
  }

  const users = (usersData as UserRow[]) ?? [];

  // 6. Load character_profiles for all room members (graceful fallback on error).
  let characterProfiles: CharacterProfileRow[] = [];
  const { data: cpData, error: cpError } = await supabase
    .from("character_profiles")
    .select(
      "user_id, display_name, budget_level, travel_style, trip_interests, generated_persona_name, planning_weights",
    )
    .eq("room_id", roomId);

  if (cpError) {
    console.log(
      `[agent/negotiation] character_profiles unavailable for room ${room.room_code} (falling back to display names):`,
      cpError.message,
    );
  } else {
    characterProfiles = (cpData as CharacterProfileRow[]) ?? [];
  }

  // Build a map for O(1) lookup.
  const cpByUser = new Map<string, CharacterProfile>(
    characterProfiles.map((cp) => [
      cp.user_id,
      {
        id: cp.user_id,
        userId: cp.user_id,
        roomId,
        displayName: cp.display_name,
        budgetLevel: cp.budget_level,
        travelStyle: cp.travel_style,
        tripInterests: cp.trip_interests,
        avatarConfig: {
          baseBody: "default",
          outfit: "",
          headwear: "",
          handheldItem: "",
        },
        generatedPersonaName: cp.generated_persona_name,
        planningWeights: cp.planning_weights,
        createdAt: "",
        updatedAt: "",
      } satisfies CharacterProfile,
    ]),
  );

  // 7. Build user prompt context (combined for all conflicts).
  const userPromptContext = {
    currentItinerary: {
      destination: currentItinerary.destination,
      startDate: currentItinerary.startDate,
      endDate: currentItinerary.endDate,
      days: currentItinerary.days,
      fairnessSummary: currentItinerary.fairnessSummary,
    },
    conflicts: loadedConflicts.map((conflict) => {
      const entry = conflictEntries.find(e => e.conflictId === conflict.id)!;
      const chosenOption = conflict.proposedOptions.find(o => o.id === entry.selectedResolution)!;
      return {
        conflictSummary: conflict.conflictSummary,
        affectedUsers: conflict.affectedUsers,
        proposedOptions: conflict.proposedOptions,
        chosenOptionId: entry.selectedResolution,
        chosenOptionDescription: chosenOption.description,
      };
    }),
    members: users.map((u) => ({
      userId: u.id,
      displayName: u.display_name,
      characterProfile: cpByUser.get(u.id) ?? null,
    })),
  };

  const userPrompt = JSON.stringify(userPromptContext, null, 2);

  // 8. Call the negotiation agent.
  // The negotiation agent must return a full revised itinerary (all days, all
  // slots, fairness summary, diff summary). Multi-day itineraries can easily
  // exceed 4000 tokens, so we use 8000 to avoid truncated/invalid JSON.
  const result = await runAgent<unknown>({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 8000,
  });

  if (!result.ok) {
    console.log(
      `[agent/negotiation] agent failure for room ${room.room_code}:`,
      result.error,
    );
    return NextResponse.json(
      { error: result.error, retryable: result.retryable },
      { status: 500 },
    );
  }

  // 9. Validate agent output shape.
  if (!isNegotiationAgentOutput(result.data)) {
    console.log(
      `[agent/negotiation] invalid agent output shape for room ${room.room_code}:`,
      JSON.stringify(result.data).slice(0, 500),
    );
    return NextResponse.json(
      { error: "Agent returned an invalid itinerary revision", retryable: true },
      { status: 500 },
    );
  }

  const agentOutput = result.data;

  // 10. Persist the new itinerary version.
  //     Compute version_number = MAX(version_number) + 1 for this room.
  const { data: maxVersionData, error: maxVersionError } = await supabase
    .from("itineraries")
    .select("version_number")
    .eq("room_id", roomId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxVersionError) {
    console.log(
      `[agent/negotiation] failed to compute next version_number for room ${room.room_code}:`,
      maxVersionError.message,
    );
    return NextResponse.json(
      { error: "Failed to compute itinerary version" },
      { status: 500 },
    );
  }

  const nextVersion =
    maxVersionData && typeof (maxVersionData as { version_number: number }).version_number === "number"
      ? (maxVersionData as { version_number: number }).version_number + 1
      : 1;

  const { data: newItineraryData, error: insertError } = await supabase
    .from("itineraries")
    .insert({
      room_id: roomId,
      version_number: nextVersion,
      destination: currentItinerary.destination,
      start_date: currentItinerary.startDate,
      end_date: currentItinerary.endDate,
      days: agentOutput.days,
      fairness_summary: agentOutput.fairnessSummary,
      average_satisfaction_score: null,
      status: "draft",
    })
    .select()
    .single();

  if (insertError || !newItineraryData) {
    console.log(
      `[agent/negotiation] failed to insert new itinerary for room ${room.room_code}:`,
      insertError?.message ?? "no row returned",
    );
    return NextResponse.json(
      { error: "Failed to persist revised itinerary" },
      { status: 500 },
    );
  }

  const newItinerary = mapItineraryRow(newItineraryData as ItineraryRow);

  // 11. Update trip_rooms.current_itinerary_id to the new version.
  const { error: updateRoomError } = await supabase
    .from("trip_rooms")
    .update({ current_itinerary_id: newItinerary.id })
    .eq("id", roomId);

  if (updateRoomError) {
    console.log(
      `[agent/negotiation] failed to update current_itinerary_id for room ${room.room_code}:`,
      updateRoomError.message,
    );
    return NextResponse.json(
      { error: "Failed to update room itinerary reference" },
      { status: 500 },
    );
  }

  // Stage is intentionally NOT advanced here. The host reviews the revised
  // itinerary and diff summary in NegotiationStage, then manually clicks
  // "Another round of feedback" to advance to FEEDBACK when ready.

  // 12. Bulk-resolve all conflicts and persist each selectedResolution.
  const { error: resolveConflictsError } = await supabase
    .from("conflict_resolutions")
    .update({ status: "resolved" })
    .in("id", conflictIds);

  if (resolveConflictsError) {
    // Non-fatal: log but don't fail the response — the itinerary was successfully revised.
    console.log(
      `[agent/negotiation] failed to bulk-resolve conflicts for room ${room.room_code}:`,
      resolveConflictsError.message,
    );
  }

  // Also persist each conflict's selectedResolution.
  for (const entry of conflictEntries) {
    const { error: selResError } = await supabase
      .from("conflict_resolutions")
      .update({ selected_resolution: entry.selectedResolution })
      .eq("id", entry.conflictId);
    if (selResError) {
      console.log(
        `[agent/negotiation] failed to update selected_resolution for conflict ${entry.conflictId}:`,
        selResError.message,
      );
    }
  }

  // 13. Broadcast itinerary-updated on room:{roomId}:itinerary.
  try {
    await broadcastItineraryUpdated(roomId, agentOutput.diffSummary);
  } catch (broadcastErr) {
    // Non-fatal: log but don't fail the response.
    console.log(
      `[agent/negotiation] broadcast failed for room ${room.room_code}:`,
      broadcastErr,
    );
  }

  console.log(
    `[agent/negotiation] room ${room.room_code} revised itinerary to v${nextVersion} (${conflictIds.length} conflicts resolved)`,
  );

  // 14. Return the new itinerary merged with diffSummary (201).
  return NextResponse.json(
    { ...newItinerary, diffSummary: agentOutput.diffSummary },
    { status: 201 },
  );
}
