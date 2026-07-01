import { NextResponse } from "next/server";

import { runAgent } from "@/lib/bedrock";
import { getServiceSupabase, createAnonSupabase } from "@/lib/supabase";
import {
  RoomStage,
  type Itinerary,
  type ItineraryDay,
  type ItineraryItem,
  type FairnessSummary,
  type BudgetLevel,
  type TravelStyle,
  type TripInterest,
} from "@/lib/types";

/**
 * Itinerary Planning Agent — Demo Moment 2.
 *
 * Endpoint contract:
 *   POST /api/agents/itinerary   body: { roomId }   runs the agent and
 *                                                    persists a new itinerary
 *                                                    version.
 *   GET  /api/agents/itinerary?roomId=...            returns the most recently
 *                                                    persisted itinerary
 *                                                    (by version_number DESC)
 *                                                    without re-running the agent.
 *
 * Stage gate: room must be in `ITINERARY`. Anything else → 409.
 * Finalised guard: if current_itinerary_id points to a `status='final'`
 * itinerary → 409 `{ error: "Itinerary is finalised" }`.
 * Profile gate: room_profiles row must exist → 412 if missing.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Postgres "no rows" code returned by `.single()` when nothing matches. */
const NO_ROWS = "PGRST116";

// ─── Row shapes + mappers ──────────────────────────────────────────────────

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
    averageSatisfactionScore: row.average_satisfaction_score ?? null,
    status: row.status,
  };
}

// ─── DB row types ──────────────────────────────────────────────────────────

interface TripRoomRow {
  id: string;
  room_code: string;
  host_user_id: string;
  current_stage: string;
  selected_destination: string | null;
  selected_flight_option: "budget" | "comfort" | "best_value" | null;
  current_itinerary_id: string | null;
}

interface AvailabilityRow {
  user_id: string;
  start_date: string;
  end_date: string;
}

interface ActivityPreferenceRow {
  user_id: string;
  title: string;
  type: string;
  priority: string;
  notes: string | null;
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

interface JoinedUserRow {
  id: string;
  display_name: string;
  selected_persona_id: string | null;
  personas: {
    name: string;
    budget_level: string;
    travel_pace: string;
    interests: string[];
    flexibility: string;
    decision_style: string;
    description: string;
  } | null;
}

// ─── Agent output validation ───────────────────────────────────────────────

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isItineraryItem(value: unknown): value is ItineraryItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== "string" || v.title.trim() === "") return false;
  if (typeof v.description !== "string") return false;
  if (typeof v.type !== "string") return false;
  // personaBenefits must be a string array (may be empty for rest/travel items)
  if (!isStringArray(v.personaBenefits)) return false;
  if (typeof v.reason !== "string") return false;
  return true;
}

function isItineraryItemArray(value: unknown): value is ItineraryItem[] {
  return Array.isArray(value) && value.every(isItineraryItem);
}

function isItineraryDay(value: unknown): value is ItineraryDay {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.date !== "string") return false;
  // Accept null / undefined / missing sections as empty arrays — the model
  // sometimes omits afternoon/evening on the last departure day.
  const toItemArray = (x: unknown) => (x == null ? [] : x);
  if (!isItineraryItemArray(toItemArray(v.morning))) return false;
  if (!isItineraryItemArray(toItemArray(v.afternoon))) return false;
  if (!isItineraryItemArray(toItemArray(v.evening))) return false;
  // night is optional
  if (v.night != null && !isItineraryItemArray(v.night)) return false;
  return true;
}

function isFairnessSummary(value: unknown): value is FairnessSummary {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!v.perPersona || typeof v.perPersona !== "object") return false;
  if (!isStringArray(v.warnings)) return false;
  if (!isStringArray(v.recommendations)) return false;
  return true;
}

type AgentItineraryOutput = {
  destination: string;
  startDate: string;
  endDate: string;
  days: ItineraryDay[];
  fairnessSummary: FairnessSummary;
};

function isAgentItineraryOutput(value: unknown): value is AgentItineraryOutput {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.destination !== "string" || v.destination.trim() === "") return false;
  if (typeof v.startDate !== "string") return false;
  if (typeof v.endDate !== "string") return false;
  if (!Array.isArray(v.days) || v.days.length === 0) return false;
  if (!v.days.every(isItineraryDay)) return false;
  if (!isFairnessSummary(v.fairnessSummary)) return false;
  return true;
}

// ─── Availability window computation ──────────────────────────────────────

/**
 * From a list of individual availability windows, compute the overlapping
 * window: earliest start = max of all starts, latest end = min of all ends.
 * Falls back to the broadest window if no clean overlap can be determined.
 */
function computeTravelWindow(rows: AvailabilityRow[]): {
  startDate: string;
  endDate: string;
} {
  if (rows.length === 0) {
    const today = new Date();
    const next = new Date(today);
    next.setDate(today.getDate() + 7);
    return {
      startDate: today.toISOString().slice(0, 10),
      endDate: next.toISOString().slice(0, 10),
    };
  }

  // Overlapping window: max of starts, min of ends
  const startDate = rows.reduce(
    (best, row) => (row.start_date > best ? row.start_date : best),
    rows[0].start_date,
  );
  const endDate = rows.reduce(
    (best, row) => (row.end_date < best ? row.end_date : best),
    rows[0].end_date,
  );

  // If overlap is invalid (start > end), fall back to broadest window
  if (startDate > endDate) {
    const broadStart = rows.reduce(
      (best, row) => (row.start_date < best ? row.start_date : best),
      rows[0].start_date,
    );
    const broadEnd = rows.reduce(
      (best, row) => (row.end_date > best ? row.end_date : best),
      rows[0].end_date,
    );
    return { startDate: broadStart, endDate: broadEnd };
  }

  return { startDate, endDate };
}

// ─── Realtime broadcast ────────────────────────────────────────────────────

async function broadcastItineraryUpdated(
  roomId: string,
  diffSummary?: string,
): Promise<void> {
  try {
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
  } catch (err) {
    // Broadcast failure should never block the response
    console.log("[agent/itinerary] broadcast failed (non-fatal):", err);
  }
}

// ─── System prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are PixelTrip's itinerary planning expert.
A group of friends has chosen their destination and flight option. Generate a fair, persona-driven day-by-day itinerary for their trip.

Output a single JSON object with EXACTLY these fields (no extras, no omissions):
- destination: string
- startDate: string (ISO date)
- endDate: string (ISO date)
- days: array of ItineraryDay objects
- fairnessSummary: FairnessSummary object

Each ItineraryDay must have:
- date: string (ISO date)
- morning: ItineraryItem[]
- afternoon: ItineraryItem[]
- evening: ItineraryItem[]
- night: ItineraryItem[] (optional, only for nightlife-heavy days)

Each ItineraryItem must have:
- title: string
- description: string (1-2 sentences)
- type: string (e.g. "food", "sight", "activity", "rest")
- personaBenefits: string[] — MUST NOT be empty. List the persona names who specifically benefit.
- reason: string — why this item is included

FairnessSummary must have:
- perPersona: Record<personaName, string> — one entry per member
- warnings: string[]
- recommendations: string[]

Non-negotiable rules:
1. Every ItineraryItem.personaBenefits MUST be non-empty.
2. Honor all must_have activity preferences.
3. Respect avoid items.
4. Balance pace for chill/slow personas.
5. Balance budget for low-budget personas.
6. The fairnessSummary must cover every member.
7. Return only valid JSON. No preamble, no markdown, no commentary.`;

// ─── POST: run the agent and persist itinerary ────────────────────────────

interface PostBody {
  roomId?: unknown;
}

/**
 * POST /api/agents/itinerary
 *
 * Body: { roomId: string }
 *
 * Runs the itinerary planning agent, validates the output, inserts a new
 * versioned itinerary row, updates trip_rooms.current_itinerary_id, and
 * broadcasts itinerary-updated.
 *
 * Errors:
 *   400 — missing/invalid body
 *   404 — room not found
 *   409 — room not in ITINERARY stage, or itinerary is finalised
 *   412 — group profile missing
 *   500 — agent failure or DB failure (with { error, retryable })
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

  // 1. Verify room exists and is in ITINERARY stage.
  const { data: roomData, error: roomError } = await supabase
    .from("trip_rooms")
    .select(
      "id, room_code, host_user_id, current_stage, selected_destination, selected_flight_option, current_itinerary_id",
    )
    .eq("id", roomId)
    .single();

  if (roomError) {
    if (roomError.code === NO_ROWS) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    console.log(`[agent/itinerary] failed to load room ${roomId}:`, roomError.message);
    return NextResponse.json({ error: "Failed to load room" }, { status: 500 });
  }

  const room = roomData as TripRoomRow;

  if (room.current_stage !== RoomStage.ITINERARY) {
    return NextResponse.json(
      {
        error: `Room is not in ITINERARY stage (current: ${room.current_stage})`,
      },
      { status: 409 },
    );
  }

  // 2. Finalised guard — if current itinerary is final, block re-generation.
  if (room.current_itinerary_id) {
    const { data: currentItinerary, error: itinError } = await supabase
      .from("itineraries")
      .select("id, status")
      .eq("id", room.current_itinerary_id)
      .single();

    if (!itinError && currentItinerary) {
      const row = currentItinerary as { id: string; status: string };
      if (row.status === "final") {
        return NextResponse.json(
          { error: "Itinerary is finalised" },
          { status: 409 },
        );
      }
    }
  }

  // 3. Load group profile — required, 412 if missing.
  const { data: profileRow, error: profileError } = await supabase
    .from("room_profiles")
    .select("*")
    .eq("room_id", roomId)
    .maybeSingle();

  if (profileError || !profileRow) {
    if (profileError) {
      console.log(
        `[agent/itinerary] group profile unavailable for room ${room.room_code}:`,
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

  // 4. Parallel DB reads: availability, activity_preferences, users+personas, character_profiles.
  const [availabilityResult, activityPrefsResult, usersResult] =
    await Promise.all([
      supabase
        .from("availability")
        .select("user_id, start_date, end_date")
        .eq("room_id", roomId),
      supabase
        .from("activity_preferences")
        .select("user_id, title, type, priority, notes")
        .eq("room_id", roomId),
      supabase
        .from("users")
        .select(
          "id, display_name, selected_persona_id, personas:selected_persona_id (name, budget_level, travel_pace, interests, flexibility, decision_style, description)",
        )
        .eq("room_id", roomId),
    ]);

  if (availabilityResult.error) {
    console.log(
      `[agent/itinerary] failed to load availability for room ${room.room_code}:`,
      availabilityResult.error.message,
    );
    return NextResponse.json({ error: "Failed to load availability" }, { status: 500 });
  }
  if (activityPrefsResult.error) {
    console.log(
      `[agent/itinerary] failed to load activity preferences for room ${room.room_code}:`,
      activityPrefsResult.error.message,
    );
    return NextResponse.json(
      { error: "Failed to load activity preferences" },
      { status: 500 },
    );
  }
  if (usersResult.error) {
    console.log(
      `[agent/itinerary] failed to load members for room ${room.room_code}:`,
      usersResult.error.message,
    );
    return NextResponse.json({ error: "Failed to load members" }, { status: 500 });
  }

  // 5. Load character_profiles — graceful fallback to personas if absent.
  let characterProfiles: CharacterProfileRow[] = [];
  const { data: cpData, error: cpError } = await supabase
    .from("character_profiles")
    .select(
      "user_id, display_name, budget_level, travel_style, trip_interests, generated_persona_name, planning_weights",
    )
    .eq("room_id", roomId);

  if (cpError) {
    console.log(
      `[agent/itinerary] character_profiles unavailable for room ${room.room_code} (falling back to persona-only):`,
      cpError.message,
    );
  } else {
    characterProfiles = (cpData as CharacterProfileRow[]) ?? [];
  }

  // 6. Compute travel window from availability overlap.
  const availability = (availabilityResult.data as AvailabilityRow[]) ?? [];
  const { startDate, endDate } = computeTravelWindow(availability);

  const activityPrefs = (activityPrefsResult.data as ActivityPreferenceRow[]) ?? [];
  const usersData = (usersResult.data as unknown as JoinedUserRow[]) ?? [];

  // Index character profiles by user_id.
  const cpByUser = new Map<string, CharacterProfileRow>(
    characterProfiles.map((cp) => [cp.user_id, cp]),
  );

  // 7. Build user prompt context.
  // Keep the group profile concise — drop raw SQL-level fields that bloat the prompt.
  const slimGroupProfile = profileRow
    ? {
        budgetRange: (profileRow as Record<string, unknown>).budget_range ?? (profileRow as Record<string, unknown>).budgetRange,
        dominantPace: (profileRow as Record<string, unknown>).dominant_pace ?? (profileRow as Record<string, unknown>).dominantPace,
        commonInterests: (profileRow as Record<string, unknown>).common_interests ?? (profileRow as Record<string, unknown>).commonInterests,
        travelWindow: (profileRow as Record<string, unknown>).travel_window ?? (profileRow as Record<string, unknown>).travelWindow,
        tensionPoints: (profileRow as Record<string, unknown>).tension_points ?? (profileRow as Record<string, unknown>).tensionPoints,
      }
    : null;

  const userPromptContext = {
    today: new Date().toISOString().slice(0, 10),
    destination: room.selected_destination,
    startDate,
    endDate,
    flightOption: room.selected_flight_option,
    groupProfile: slimGroupProfile,
    members: usersData.map((u) => {
      const cp = cpByUser.get(u.id);
      return {
        userId: u.id,
        displayName: u.display_name,
        // Prefer CharacterProfile; fall back to persona summary only
        budgetLevel: cp?.budget_level ?? u.personas?.budget_level ?? "medium",
        travelStyle: cp?.travel_style ?? u.personas?.travel_pace ?? "moderate",
        tripInterests: cp?.trip_interests ?? u.personas?.interests ?? [],
        personaName: cp?.generated_persona_name ?? u.personas?.name ?? u.display_name,
      };
    }),
    activityPreferences: activityPrefs.map((ap) => ({
      userId: ap.user_id,
      title: ap.title,
      type: ap.type,
      priority: ap.priority,
      notes: ap.notes,
    })),
  };

  const userPrompt = JSON.stringify(userPromptContext);

  // 8. Call the agent.
  const result = await runAgent<unknown>({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 8000,
  });

  if (!result.ok) {
    console.log(
      `[agent/itinerary] agent failure for room ${room.room_code}:`,
      result.error,
    );
    return NextResponse.json(
      { error: result.error, retryable: result.retryable },
      { status: 500 },
    );
  }

  // 9. Validate agent output shape.
  if (!isAgentItineraryOutput(result.data)) {
    // Log enough detail to diagnose which field is wrong without dumping the
    // full 4 000-token response into the log.
    try {
      const raw = result.data as Record<string, unknown>;
      const dayCount = Array.isArray(raw?.days) ? (raw.days as unknown[]).length : "non-array";
      const firstBadDay = Array.isArray(raw?.days)
        ? (raw.days as unknown[]).findIndex((d) => !isItineraryDay(d))
        : -1;
      console.log(
        `[agent/itinerary] invalid agent output shape for room ${room.room_code}:`,
        `destination=${typeof raw?.destination}`,
        `startDate=${typeof raw?.startDate}`,
        `endDate=${typeof raw?.endDate}`,
        `days=${dayCount}`,
        `firstBadDay=${firstBadDay}`,
        `hasFairnessSummary=${typeof raw?.fairnessSummary}`,
      );
      if (firstBadDay >= 0 && Array.isArray(raw?.days)) {
        const day = (raw.days as unknown[])[firstBadDay] as Record<string, unknown>;
        const sections = ["morning", "afternoon", "evening"] as const;
        for (const sec of sections) {
          const items = day?.[sec];
          if (Array.isArray(items)) {
            const firstBadItem = (items as unknown[]).findIndex((it) => !isItineraryItem(it));
            if (firstBadItem >= 0) {
              const item = (items as unknown[])[firstBadItem];
              console.log(
                `[agent/itinerary] bad item at day[${firstBadDay}].${sec}[${firstBadItem}]:`,
                JSON.stringify(item).slice(0, 300),
              );
              break;
            }
          }
        }
      }
    } catch {
      // diagnostic logging is best-effort
    }
    return NextResponse.json(
      { error: "Agent returned an invalid itinerary", retryable: true },
      { status: 500 },
    );
  }

  const agentOutput = result.data;

  // 10. Compute version_number = MAX(version_number WHERE room_id = roomId) + 1 (or 1 if none).
  const { data: maxVersionData } = await supabase
    .from("itineraries")
    .select("version_number")
    .eq("room_id", roomId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevVersion =
    (maxVersionData as { version_number: number } | null)?.version_number ?? 0;
  const versionNumber = prevVersion + 1;

  // 11. INSERT new itinerary row.
  const { data: insertedRow, error: insertError } = await supabase
    .from("itineraries")
    .insert({
      room_id: roomId,
      version_number: versionNumber,
      destination: agentOutput.destination,
      start_date: agentOutput.startDate,
      end_date: agentOutput.endDate,
      // Normalise any null/missing sections to empty arrays before persisting
      days: agentOutput.days.map((d) => ({
        ...d,
        morning: d.morning ?? [],
        afternoon: d.afternoon ?? [],
        evening: d.evening ?? [],
        night: d.night ?? undefined,
      })),
      fairness_summary: agentOutput.fairnessSummary,
      average_satisfaction_score: null,
      status: "draft",
    })
    .select()
    .single();

  if (insertError || !insertedRow) {
    console.log(
      `[agent/itinerary] failed to persist itinerary for room ${room.room_code}:`,
      insertError?.message ?? "no row returned",
    );
    return NextResponse.json(
      { error: "Failed to persist itinerary" },
      { status: 500 },
    );
  }

  const newItineraryId = (insertedRow as { id: string }).id;

  // 12. UPDATE trip_rooms.current_itinerary_id.
  const { error: updateError } = await supabase
    .from("trip_rooms")
    .update({ current_itinerary_id: newItineraryId })
    .eq("id", roomId);

  if (updateError) {
    console.log(
      `[agent/itinerary] failed to update current_itinerary_id for room ${room.room_code}:`,
      updateError.message,
    );
    // Non-fatal — itinerary is still persisted; broadcast will still work.
  }

  // 13. Broadcast itinerary-updated.
  void broadcastItineraryUpdated(roomId);

  const itinerary = mapItineraryRow(insertedRow as ItineraryRow);

  console.log(
    `[agent/itinerary] room ${room.room_code} generated itinerary v${versionNumber}: ${agentOutput.destination} (${agentOutput.startDate} – ${agentOutput.endDate})`,
  );

  return NextResponse.json(itinerary, { status: 201 });
}

// ─── GET: return the latest persisted itinerary (no re-run) ───────────────

/**
 * GET /api/agents/itinerary?roomId=...
 *
 * Returns the most recently persisted itinerary for the room
 * (by version_number DESC, LIMIT 1). Does NOT invoke the agent.
 * Returns 404 if no itinerary exists yet.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId")?.trim();

  if (!roomId) {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("itineraries")
    .select()
    .eq("room_id", roomId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.log(
      `[agent/itinerary] failed to load itinerary for room ${roomId}:`,
      error.message,
    );
    return NextResponse.json(
      { error: "Failed to load itinerary" },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "No itinerary found for this room" },
      { status: 404 },
    );
  }

  return NextResponse.json(mapItineraryRow(data as ItineraryRow));
}
