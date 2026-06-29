import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
import type { User } from "@/lib/types";

// Never cache this route — the member list must always be live.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Shape of a `users` row as returned by Supabase (snake_case columns). */
interface UserRow {
  id: string;
  display_name: string;
  room_id: string;
  selected_persona_id: string | null;
}

function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.display_name,
    roomId: row.room_id,
    selectedPersonaId: row.selected_persona_id,
  };
}

/**
 * GET /api/rooms/[code]/members
 *
 * Returns every user who has joined the room (read from the `users` table).
 * This is the reliable source of truth for the member list — it does not depend
 * on ephemeral Realtime presence.
 */
export async function GET(
  _request: Request,
  { params }: { params: { code: string } },
) {
  const code = params.code?.trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "Room code is required" }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  // Resolve the room id from the code.
  const { data: roomRow, error: roomError } = await supabase
    .from("trip_rooms")
    .select("id")
    .eq("room_code", code)
    .single();

  if (roomError || !roomRow) {
    console.log(`[members] room "${code}" not found`);
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const roomId = (roomRow as { id: string }).id;

  const { data, error } = await supabase
    .from("users")
    .select("id, display_name, room_id, selected_persona_id")
    .eq("room_id", roomId);

  if (error) {
    console.log(`[members] failed to load members for room ${code}:`, error.message);
    return NextResponse.json({ error: "Failed to load members" }, { status: 500 });
  }

  const members = (data as UserRow[]).map(mapUserRow);

  // Server-side log: who is inside the room right now.
  console.log(
    `[members] room ${code} (${roomId}) has ${members.length} member(s):`,
    members.map((m) => `${m.displayName} (${m.id.slice(0, 8)})`).join(", ") || "(none)",
  );

  return NextResponse.json(members);
}
