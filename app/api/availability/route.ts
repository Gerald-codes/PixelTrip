import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
import type { Availability, DestinationPreference } from "@/lib/types";

// The submitted member list must always be live — never cache this route.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Shape of an `availability` row as returned by Supabase. */
interface AvailabilityRow {
  id: string;
  user_id: string;
  room_id: string;
  start_date: string;
  end_date: string;
}

/** Shape of a `destination_preferences` row as returned by Supabase. */
interface DestinationPreferenceRow {
  id: string;
  user_id: string;
  room_id: string;
  country_or_city: string;
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

interface PostBody {
  userId?: unknown;
  roomId?: unknown;
  dateRanges?: unknown;
  destinationInterests?: unknown;
}

interface ParsedDateRange {
  startDate: string;
  endDate: string;
}

/** Match plain ISO date strings (YYYY-MM-DD). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateRanges(value: unknown): ParsedDateRange[] | { error: string } {
  if (!Array.isArray(value)) {
    return { error: "dateRanges must be an array" };
  }
  if (value.length === 0) {
    return { error: "dateRanges must contain at least one range" };
  }

  const parsed: ParsedDateRange[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i] as { startDate?: unknown; endDate?: unknown };
    const startDate = entry?.startDate;
    const endDate = entry?.endDate;

    if (typeof startDate !== "string" || !ISO_DATE_RE.test(startDate)) {
      return { error: `dateRanges[${i}].startDate must be a YYYY-MM-DD string` };
    }
    if (typeof endDate !== "string" || !ISO_DATE_RE.test(endDate)) {
      return { error: `dateRanges[${i}].endDate must be a YYYY-MM-DD string` };
    }
    if (endDate < startDate) {
      return {
        error: `dateRanges[${i}].endDate must be on or after startDate`,
      };
    }
    parsed.push({ startDate, endDate });
  }
  return parsed;
}

function parseDestinationInterests(
  value: unknown,
): string[] | { error: string } {
  if (!Array.isArray(value)) {
    return { error: "destinationInterests must be an array" };
  }
  const cleaned: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i];
    if (typeof entry !== "string") {
      return { error: `destinationInterests[${i}] must be a string` };
    }
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    cleaned.push(trimmed);
  }
  return cleaned;
}

/**
 * POST /api/availability
 *
 * Stores a user's date ranges and destination interests for a room.
 *
 * Idempotent: re-posting replaces the user's previous submission for that room
 * by deleting the existing `availability` and `destination_preferences` rows
 * first and then inserting the new ones.
 *
 * Request body:
 *   {
 *     userId: string,
 *     roomId: string,
 *     dateRanges: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }[],
 *     destinationInterests: string[]
 *   }
 *
 * Returns 200 with { availability, destinationPreferences } in camelCase.
 */
export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { userId, roomId } = body;
  if (typeof userId !== "string" || userId.trim() === "") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (typeof roomId !== "string" || roomId.trim() === "") {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }

  const dateRangesResult = parseDateRanges(body.dateRanges);
  if (!Array.isArray(dateRangesResult)) {
    return NextResponse.json({ error: dateRangesResult.error }, { status: 400 });
  }

  const interestsResult = parseDestinationInterests(body.destinationInterests);
  if (!Array.isArray(interestsResult)) {
    return NextResponse.json({ error: interestsResult.error }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  // Replace any prior submission for this user in this room (idempotency).
  const { error: deleteAvailabilityError } = await supabase
    .from("availability")
    .delete()
    .eq("user_id", userId)
    .eq("room_id", roomId);
  if (deleteAvailabilityError) {
    return NextResponse.json(
      { error: "Failed to clear previous availability" },
      { status: 500 },
    );
  }

  const { error: deletePrefsError } = await supabase
    .from("destination_preferences")
    .delete()
    .eq("user_id", userId)
    .eq("room_id", roomId);
  if (deletePrefsError) {
    return NextResponse.json(
      { error: "Failed to clear previous destination preferences" },
      { status: 500 },
    );
  }

  // Insert fresh availability rows (one row per range).
  const availabilityInserts = dateRangesResult.map((range) => ({
    user_id: userId,
    room_id: roomId,
    start_date: range.startDate,
    end_date: range.endDate,
  }));
  const { data: availabilityRows, error: availabilityInsertError } =
    await supabase.from("availability").insert(availabilityInserts).select();
  if (availabilityInsertError || !availabilityRows) {
    return NextResponse.json(
      { error: "Failed to save availability" },
      { status: 500 },
    );
  }

  // Insert fresh destination_preferences rows (one row per city).
  let preferenceRows: DestinationPreferenceRow[] = [];
  if (interestsResult.length > 0) {
    const prefInserts = interestsResult.map((countryOrCity) => ({
      user_id: userId,
      room_id: roomId,
      country_or_city: countryOrCity,
    }));
    const { data: insertedPrefs, error: prefsInsertError } = await supabase
      .from("destination_preferences")
      .insert(prefInserts)
      .select();
    if (prefsInsertError || !insertedPrefs) {
      return NextResponse.json(
        { error: "Failed to save destination preferences" },
        { status: 500 },
      );
    }
    preferenceRows = insertedPrefs as DestinationPreferenceRow[];
  }

  return NextResponse.json(
    {
      availability: (availabilityRows as AvailabilityRow[]).map(mapAvailabilityRow),
      destinationPreferences: preferenceRows.map(mapDestinationPreferenceRow),
    },
    { status: 200 },
  );
}

/**
 * GET /api/availability?roomId=...
 *
 * Returns every availability row and destination preference row for the room.
 * Used by `AvailabilityStage` to show what each member has submitted and to
 * compute the group's overlapping window.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId")?.trim();

  if (!roomId) {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  const [availabilityResult, preferencesResult] = await Promise.all([
    supabase
      .from("availability")
      .select("id, user_id, room_id, start_date, end_date")
      .eq("room_id", roomId),
    supabase
      .from("destination_preferences")
      .select("id, user_id, room_id, country_or_city")
      .eq("room_id", roomId),
  ]);

  if (availabilityResult.error || preferencesResult.error) {
    return NextResponse.json(
      { error: "Failed to load availability" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    availability: (availabilityResult.data as AvailabilityRow[]).map(
      mapAvailabilityRow,
    ),
    destinationPreferences: (
      preferencesResult.data as DestinationPreferenceRow[]
    ).map(mapDestinationPreferenceRow),
  });
}
