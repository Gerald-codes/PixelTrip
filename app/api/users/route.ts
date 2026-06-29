import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
import type { User } from "@/lib/types";

/** Shape of a `users` row as returned by Supabase (snake_case columns). */
interface UserRow {
  id: string;
  display_name: string;
  room_id: string;
  selected_persona_id: string | null;
}

/** Map a snake_case `users` row to the camelCase {@link User} shape. */
function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.display_name,
    roomId: row.room_id,
    selectedPersonaId: row.selected_persona_id,
  };
}

interface UpsertUserBody {
  id?: unknown;
  displayName?: unknown;
  roomId?: unknown;
  selectedPersonaId?: unknown;
}

/**
 * POST /api/users
 *
 * Creates or updates a user within a room. Identity is a client-generated UUID
 * (no auth), so the body must supply `id`. Re-posting with the same `id` updates
 * the existing row (e.g. changing display name or rejoining), mapping
 * snake_case ↔ camelCase per the {@link User} shape in lib/types.ts.
 */
export async function POST(request: Request) {
  let body: UpsertUserBody;
  try {
    body = (await request.json()) as UpsertUserBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, displayName, roomId, selectedPersonaId } = body;

  if (typeof id !== "string" || id.trim() === "") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (typeof displayName !== "string" || displayName.trim() === "") {
    return NextResponse.json(
      { error: "displayName is required" },
      { status: 400 },
    );
  }
  if (typeof roomId !== "string" || roomId.trim() === "") {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }
  if (
    selectedPersonaId !== undefined &&
    selectedPersonaId !== null &&
    typeof selectedPersonaId !== "string"
  ) {
    return NextResponse.json(
      { error: "selectedPersonaId must be a string or null" },
      { status: 400 },
    );
  }

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("users")
    .upsert(
      {
        id,
        display_name: displayName,
        room_id: roomId,
        selected_persona_id:
          (selectedPersonaId as string | null | undefined) ?? null,
      },
      { onConflict: "id" },
    )
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to save user" },
      { status: 500 },
    );
  }

  return NextResponse.json(mapUserRow(data as UserRow), { status: 200 });
}
