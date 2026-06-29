import { NextResponse } from "next/server";

import { getServiceSupabase } from "@/lib/supabase";
import type { Persona } from "@/lib/types";

// Personas are seeded once, but we never want a stale CDN cache to hide a
// re-seed — always read fresh from the database.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Shape of a `personas` row as returned by Supabase (snake_case columns). */
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

/** Map a snake_case `personas` row to the camelCase {@link Persona} shape. */
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

/**
 * GET /api/personas
 *
 * Returns every seeded persona, mapped from snake_case to the camelCase
 * {@link Persona} shape defined in `lib/types.ts`. Ordered alphabetically by
 * name for a stable UI render order.
 */
export async function GET() {
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("personas")
    .select(
      "id, name, avatar_image, budget_level, travel_pace, interests, flexibility, decision_style, description, planning_weight",
    )
    .order("name", { ascending: true });

  if (error) {
    console.log("[personas] failed to load personas:", error.message);
    return NextResponse.json(
      { error: "Failed to load personas" },
      { status: 500 },
    );
  }

  const personas = (data as PersonaRow[]).map(mapPersonaRow);
  return NextResponse.json(personas);
}
