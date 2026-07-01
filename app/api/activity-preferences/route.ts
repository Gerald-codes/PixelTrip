import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
import type { ActivityPreference } from "@/lib/types";

// Always serve fresh data — never cache this route.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Valid values for the `type` field. */
const VALID_TYPES = ["activity", "food", "sight", "experience", "avoid"] as const;
type ActivityType = (typeof VALID_TYPES)[number];

/** Valid values for the `priority` field. */
const VALID_PRIORITIES = ["must_have", "optional"] as const;
type ActivityPriority = (typeof VALID_PRIORITIES)[number];

/** Shape of an `activity_preferences` row as returned by Supabase. */
interface ActivityPreferenceRow {
  id: string;
  room_id: string;
  user_id: string;
  title: string;
  type: ActivityType;
  priority: ActivityPriority;
  notes: string | null;
}

/** Map a snake_case DB row to the camelCase {@link ActivityPreference} shape. */
function mapRow(row: ActivityPreferenceRow): ActivityPreference {
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    title: row.title,
    type: row.type,
    priority: row.priority,
    notes: row.notes,
  };
}

function isValidType(value: unknown): value is ActivityType {
  return typeof value === "string" && (VALID_TYPES as readonly string[]).includes(value);
}

function isValidPriority(value: unknown): value is ActivityPriority {
  return typeof value === "string" && (VALID_PRIORITIES as readonly string[]).includes(value);
}

interface PostBody {
  roomId?: unknown;
  userId?: unknown;
  title?: unknown;
  type?: unknown;
  priority?: unknown;
  notes?: unknown;
}

/**
 * POST /api/activity-preferences
 *
 * Body: { roomId, userId, title, type, priority, notes? }
 *
 * Validates required fields, inserts a row into `activity_preferences`, and
 * returns 201 with the new {@link ActivityPreference}.
 */
export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { roomId, userId, title, type, priority, notes } = body;

  if (typeof roomId !== "string" || roomId.trim() === "") {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }
  if (typeof userId !== "string" || userId.trim() === "") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (typeof title !== "string" || title.trim() === "") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!isValidType(type)) {
    return NextResponse.json(
      {
        error: `type must be one of: ${VALID_TYPES.join(", ")}`,
      },
      { status: 400 },
    );
  }
  if (!isValidPriority(priority)) {
    return NextResponse.json(
      {
        error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // notes is optional; coerce non-string/undefined to null
  const notesValue: string | null =
    typeof notes === "string" && notes.trim() !== "" ? notes.trim() : null;

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("activity_preferences")
    .insert({
      room_id: roomId.trim(),
      user_id: userId.trim(),
      title: title.trim(),
      type,
      priority,
      notes: notesValue,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to save activity preference" },
      { status: 500 },
    );
  }

  return NextResponse.json(mapRow(data as ActivityPreferenceRow), {
    status: 201,
  });
}

/**
 * GET /api/activity-preferences?roomId=...
 *
 * Returns all {@link ActivityPreference} rows for the given room.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId")?.trim();

  if (!roomId) {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("activity_preferences")
    .select("id, room_id, user_id, title, type, priority, notes")
    .eq("room_id", roomId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to load activity preferences" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    (data as ActivityPreferenceRow[]).map(mapRow),
    { status: 200 },
  );
}

/**
 * DELETE /api/activity-preferences?id=...&userId=...
 *
 * Loads the row, verifies the requesting user owns it (403 if not), then
 * deletes it and returns 204.
 */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();
  const userId = url.searchParams.get("userId")?.trim();

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  // Load the row first to verify ownership.
  const { data, error: fetchError } = await supabase
    .from("activity_preferences")
    .select("id, user_id")
    .eq("id", id)
    .single();

  if (fetchError || !data) {
    return NextResponse.json(
      { error: "Activity preference not found" },
      { status: 404 },
    );
  }

  if ((data as { user_id: string }).user_id !== userId) {
    return NextResponse.json(
      { error: "Forbidden: you do not own this preference" },
      { status: 403 },
    );
  }

  const { error: deleteError } = await supabase
    .from("activity_preferences")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return NextResponse.json(
      { error: "Failed to delete activity preference" },
      { status: 500 },
    );
  }

  return new NextResponse(null, { status: 204 });
}
