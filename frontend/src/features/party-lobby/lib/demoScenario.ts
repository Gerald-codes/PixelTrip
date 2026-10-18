import type { RoomSession } from "@/types";
import type { CharacterDraft } from "../types";

export const DEMO_CHANGES: Readonly<Record<number, string>> = {
  1: "Add a separate club visit after dinner",
  2: "Replace lunch with a bar lunch",
  3: "Add dinner before the evening walk",
  4: "Start the morning later",
  5: "Add a café stop before the airport transfer",
};

export function demoDraft(session: RoomSession): CharacterDraft | undefined {
  if (
    session.room.demoScenario !== "vietnam-five-days" ||
    !session.room.demoStart
  )
    return;
  const start = session.room.demoStart;
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 4);
  const alice = session.member.displayName.trim().toLowerCase() === "demoalice";
  return {
    budgetTier: "medium",
    groupRole: alice ? "leader" : "adventurer",
    tripPriorities: alice ? ["food", "nightlife"] : ["scenery", "culture"],
    destinations: ["asia", "beach-escape"],
    activities: alice ? ["markets", "beaches"] : ["temples", "tours"],
    budgetText: "2000",
    availableDates: [{ start, end: end.toISOString().slice(0, 10) }],
  };
}
