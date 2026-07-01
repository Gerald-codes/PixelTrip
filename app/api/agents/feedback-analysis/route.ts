import { NextResponse } from "next/server";

import { runAgent } from "@/lib/bedrock";
import { createAnonSupabase, getServiceSupabase } from "@/lib/supabase";
import {
  RoomStage,
  type ConflictOption,
  type ConflictResolution,
  type Itinerary,
  type ItineraryDay,
  type FairnessSummary,
} from "@/lib/types";

/**
 * Feedback Analysis Agent — Demo Moment 3.
 *
 * Endpoint contract:
 *   POST /api/agents/feedback-analysis   body: { roomId }
 *
 * Stage gate: room must be in FEEDBACK → 409 if not.
 *
 * Reads:
 *  - trip_rooms for roomId (gets current_itinerary_id)
 *  - itineraries by current_itinerary_id → 412 if missing
 *  - itinerary_feedback WHERE itinerary_id = current_itinerary_id
 *  - users WHERE room_id = roomId (member context)
 *  - character_profiles WHERE room_id = roomId (fallback gracefully on error)
 *
 * Calls the Bedrock feedback analyst agent. Validates output.
 * Persists any conflicts into conflict_resolutions with status='open'.
 * Broadcasts conflicts-updated on room:{roomId}:negotiation.
 *
 * Response: { analysisText, requiresNegotiation, conflicts: ConflictResolution[] }
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Postgres "no rows" code returned by `.single()` when nothing matches. */
const NO_ROWS = "PGRST116";

// ─── Row shapes + mappers ─────────────────────────────────────────────────

interface TripRoomRow {
  id: string;
  room_code: string;
  current_stage: string;
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

interface FeedbackRow {
  id: string;
  itinerary_id: string;
  user_id: string;
  score: number;
  liked_items: unknown;
  disliked_items: unknown;
  requested_additions: unknown;
  requested_removals: unknown;
  important_requests: unknown;
  created_at: string;
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
  planning_weights: Record<string, number>;
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

// ─── Agent output types ───────────────────────────────────────────────────

interface AgentConflictOption {
  id: string;
  description: string;
  tradeoffs: string;
}

interface AgentConflict {
  conflictSummary: string;
  affectedUsers: string[];
  proposedOptions: AgentConflictOption[];
}

interface AgentFeedbackAnalysisOutput {
  analysisText: string;
  requiresNegotiation: boolean;
  conflicts: AgentConflict[];
}

// ─── Agent output validation ──────────────────────────────────────────────

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isAgentConflictOption(value: unknown): value is AgentConflictOption {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id.trim() !== "" &&
    typeof v.description === "string" &&
    typeof v.tradeoffs === "string"
  );
}

function isAgentConflict(value: unknown): value is AgentConflict {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.conflictSummary !== "string" || v.conflictSummary.trim() === "") return false;
  if (!isStringArray(v.affectedUsers)) return false;
  if (!Array.isArray(v.proposedOptions) || v.proposedOptions.length < 2) return false;
  if (!v.proposedOptions.every(isAgentConflictOption)) return false;
  return true;
}

function isAgentFeedbackAnalysisOutput(
  value: unknown,
): value is AgentFeedbackAnalysisOutput {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.analysisText !== "string" || v.analysisText.trim() === "") return false;
  if (typeof v.requiresNegotiation !== "boolean") return false;
  if (!Array.isArray(v.conflicts)) return false;
  if (!v.conflicts.every(isAgentConflict)) return false;

  // If requiresNegotiation is true, there must be at least one conflict.
  if (v.requiresNegotiation && v.conflicts.length === 0) return false;

  return true;
}

// ─── System prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are PixelTrip's feedback analyst.
A group of friends has reviewed a travel itinerary and submitted scores and comments. Analyse the feedback and identify whether the group is satisfied or if conflicts need to be resolved.

Output a single JSON object with EXACTLY these fields:
- analysisText: string — a friendly 2-4 sentence summary of how the group feels
- requiresNegotiation: boolean — true if any of these conditions apply:
    * average score < 6
    * any single score < 4
    * two or more users have directly conflicting requested changes
    * a must-have preference is missing from the itinerary
- conflicts: array of conflict objects (empty array if requiresNegotiation is false)

Each conflict object must have:
- conflictSummary: string
- affectedUsers: string[] (userId values)
- proposedOptions: array of 2+ option objects, each with:
    * id: string (e.g. "option_a", "option_b")
    * description: string
    * tradeoffs: string

Non-negotiable rules:
1. If requiresNegotiation is true, produce at least one conflict with at least 2 proposedOptions.
2. Each conflict must name specific userId values in affectedUsers.
3. Keep analysisText friendly and constructive.
4. Return only valid JSON. No preamble, no markdown, no commentary.`;

// ─── Realtime broadcast ───────────────────────────────────────────────────

async function broadcastConflictsUpdated(roomId: string): Promise<void> {
  const supabase = createAnonSupabase();
  const channel = supabase.channel(`room:${roomId}:negotiation`);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
  await channel.send({
    type: "broadcast",
    event: "conflicts-updated",
    payload: {},
  });
  void supabase.removeChannel(channel);
}

// ─── POST ─────────────────────────────────────────────────────────────────

interface PostBody {
  roomId?: unknown;
}

/**
 * POST /api/agents/feedback-analysis
 *
 * Body: { roomId: string }
 *
 * Runs the feedback analysis agent, validates output, persists any conflicts
 * into conflict_resolutions, broadcasts conflicts-updated, and returns
 * { analysisText, requiresNegotiation, conflicts: ConflictResolution[] }.
 *
 * Errors:
 *   400 — missing/invalid body
 *   404 — room not found
 *   409 — room is not in FEEDBACK stage
 *   412 — current itinerary not found
 *   500 — agent failure or DB failure
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

  // 1. Verify room exists and is in FEEDBACK stage.
  const { data: roomData, error: roomError } = await supabase
    .from("trip_rooms")
    .select("id, room_code, current_stage, current_itinerary_id")
    .eq("id", roomId)
    .single();

  if (roomError) {
    if (roomError.code === NO_ROWS) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    console.log(`[agent/feedback-analysis] failed to load room ${roomId}:`, roomError.message);
    return NextResponse.json({ error: "Failed to load room" }, { status: 500 });
  }

  const room = roomData as TripRoomRow;

  if (room.current_stage !== RoomStage.FEEDBACK) {
    return NextResponse.json(
      {
        error: `Room is not in FEEDBACK stage (current: ${room.current_stage})`,
      },
      { status: 409 },
    );
  }

  // 2. Load current itinerary. Missing → 412.
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

  if (!itineraryData) {
    return NextResponse.json(
      {
        error: "Current itinerary not found — generate an itinerary first",
        retryable: false,
      },
      { status: 412 },
    );
  }

  if (itineraryError) {
    const code = (itineraryError as { code?: string }).code;
    if (code === NO_ROWS) {
      return NextResponse.json(
        {
          error: "Current itinerary not found — generate an itinerary first",
          retryable: false,
        },
        { status: 412 },
      );
    }
    console.log(
      `[agent/feedback-analysis] failed to load itinerary for room ${room.room_code}:`,
      String(itineraryError),
    );
    return NextResponse.json({ error: "Failed to load itinerary" }, { status: 500 });
  }

  const currentItinerary = mapItineraryRow(itineraryData as ItineraryRow);
  const currentItineraryId = currentItinerary.id;

  // 3. Load all feedback for the current itinerary.
  const { data: feedbackData, error: feedbackError } = await supabase
    .from("itinerary_feedback")
    .select(
      "id, itinerary_id, user_id, score, liked_items, disliked_items, requested_additions, requested_removals, important_requests, created_at",
    )
    .eq("itinerary_id", currentItineraryId);

  if (feedbackError) {
    console.log(
      `[agent/feedback-analysis] failed to load feedback for itinerary ${currentItineraryId}:`,
      feedbackError.message,
    );
    return NextResponse.json({ error: "Failed to load feedback" }, { status: 500 });
  }

  const feedbackRows = (feedbackData as FeedbackRow[]) ?? [];

  // 4. Load all users for member context.
  const { data: usersData, error: usersError } = await supabase
    .from("users")
    .select("id, display_name")
    .eq("room_id", roomId);

  if (usersError) {
    console.log(
      `[agent/feedback-analysis] failed to load users for room ${room.room_code}:`,
      usersError.message,
    );
    return NextResponse.json({ error: "Failed to load members" }, { status: 500 });
  }

  const users = (usersData as UserRow[]) ?? [];

  // 5. Load character_profiles (fallback gracefully on error).
  let characterProfiles: CharacterProfileRow[] = [];
  const { data: cpData, error: cpError } = await supabase
    .from("character_profiles")
    .select(
      "user_id, display_name, budget_level, travel_style, trip_interests, generated_persona_name, planning_weights",
    )
    .eq("room_id", roomId);

  if (cpError) {
    console.log(
      `[agent/feedback-analysis] character_profiles unavailable for room ${room.room_code} (falling back gracefully):`,
      cpError.message,
    );
  } else {
    characterProfiles = (cpData as CharacterProfileRow[]) ?? [];
  }

  // 6. Build user prompt.
  const averageScore =
    feedbackRows.length > 0
      ? feedbackRows.reduce((sum, f) => sum + f.score, 0) / feedbackRows.length
      : null;

  // Index character profiles by user_id for O(1) lookup.
  const profileByUserId = new Map<string, CharacterProfileRow>(
    characterProfiles.map((cp) => [cp.user_id, cp]),
  );

  const members = users.map((u) => {
    const cp = profileByUserId.get(u.id);
    return {
      userId: u.id,
      displayName: u.display_name,
      characterProfile: cp
        ? {
            generatedPersonaName: cp.generated_persona_name,
            budgetLevel: cp.budget_level,
            travelStyle: cp.travel_style,
            tripInterests: cp.trip_interests,
            planningWeights: cp.planning_weights,
          }
        : null,
    };
  });

  const feedback = feedbackRows.map((f) => ({
    userId: f.user_id,
    score: f.score,
    likedItems: (f.liked_items as string[]) ?? [],
    dislikedItems: (f.disliked_items as string[]) ?? [],
    requestedAdditions: (f.requested_additions as string[]) ?? [],
    requestedRemovals: (f.requested_removals as string[]) ?? [],
    importantRequests: (f.important_requests as string[]) ?? [],
  }));

  const userPrompt = JSON.stringify(
    {
      itinerary: {
        destination: currentItinerary.destination,
        startDate: currentItinerary.startDate,
        endDate: currentItinerary.endDate,
        days: currentItinerary.days,
        fairnessSummary: currentItinerary.fairnessSummary,
      },
      members,
      feedback,
      averageScore,
    },
    null,
    2,
  );

  // 7. Call the agent.
  const result = await runAgent<unknown>({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 3000,
  });

  if (!result.ok) {
    console.log(
      `[agent/feedback-analysis] agent failure for room ${room.room_code}:`,
      result.error,
    );
    return NextResponse.json(
      { error: result.error, retryable: result.retryable },
      { status: 500 },
    );
  }

  // 8. Validate agent output.
  if (!isAgentFeedbackAnalysisOutput(result.data)) {
    console.log(
      `[agent/feedback-analysis] invalid agent output shape for room ${room.room_code}`,
    );
    return NextResponse.json(
      { error: "Agent returned an invalid feedback analysis", retryable: true },
      { status: 500 },
    );
  }

  const analysis = result.data;

  // 9. Persist conflicts (if any) into conflict_resolutions.
  let persistedConflicts: ConflictResolution[] = [];

  if (analysis.conflicts.length > 0) {
    const inserts = analysis.conflicts.map((c) => ({
      room_id: roomId,
      itinerary_id: currentItineraryId,
      conflict_summary: c.conflictSummary,
      affected_users: c.affectedUsers,
      proposed_options: c.proposedOptions,
      selected_resolution: null,
      status: "open" as const,
    }));

    const { data: insertedRows, error: insertError } = await supabase
      .from("conflict_resolutions")
      .insert(inserts)
      .select();

    if (insertError || !insertedRows) {
      console.log(
        `[agent/feedback-analysis] failed to persist conflicts for room ${room.room_code}:`,
        insertError?.message ?? "no rows returned",
      );
      return NextResponse.json(
        { error: "Failed to persist conflict resolutions" },
        { status: 500 },
      );
    }

    persistedConflicts = (insertedRows as ConflictRow[]).map(mapConflictRow);
  }

  // 10. Broadcast conflicts-updated on room:{roomId}:negotiation.
  try {
    await broadcastConflictsUpdated(roomId);
  } catch (broadcastErr) {
    // Non-fatal — log and continue; the response is still valid.
    console.log(
      `[agent/feedback-analysis] broadcast failed for room ${room.room_code}:`,
      broadcastErr instanceof Error ? broadcastErr.message : String(broadcastErr),
    );
  }

  console.log(
    `[agent/feedback-analysis] room ${room.room_code} — requiresNegotiation=${analysis.requiresNegotiation}, conflicts=${persistedConflicts.length}`,
  );

  return NextResponse.json({
    analysisText: analysis.analysisText,
    requiresNegotiation: analysis.requiresNegotiation,
    conflicts: persistedConflicts,
  });
}
