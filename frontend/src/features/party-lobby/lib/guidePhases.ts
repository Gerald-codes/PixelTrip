/**
 * In-world lines for the AI guide's real steps.
 *
 * The backend records the step a run is on (`agent_runs.phase`, see
 * `backend/app/agents/progress.py`); this maps each step to what the party reads,
 * and lists the steps each kind of run goes through so the UI can show a small
 * quest log ("done / now / next") instead of a fake progress bar.
 */
import type { RunPhase, RunProgress, RunType } from "@/services/run.contract";

export const PHASE_LINES: Record<RunPhase, string> = {
  reading_party: "Reading the party's wishes",
  asking_guide: "Consulting the guide's world map",
  searching_flights: "Searching for flights",
  checking_budget: "Checking dates and budget",
  checking_answer: "Double-checking the picks",
  drafting_days: "Drafting the quest log",
  weighing_feedback: "Weighing the party's feedback",
  weighing_options: "Weighing the tied options",
  posting: "Laying out the options",
};

/** The steps each run type goes through, in order. */
export const RUN_STEPS: Record<RunType, readonly RunPhase[]> = {
  discovery: [
    "reading_party",
    "asking_guide",
    "checking_budget",
    "checking_answer",
    "posting",
  ],
  logistics: [
    "reading_party",
    "searching_flights",
    "checking_budget",
    "checking_answer",
    "posting",
  ],
  itinerary: ["reading_party", "drafting_days", "posting"],
  refinement: ["reading_party", "weighing_feedback", "asking_guide", "checking_answer", "posting"],
  tiebreak: ["weighing_options", "posting"],
};

/** What went wrong, from the step a failed run stopped on. */
export function failureLine(run: RunProgress): string {
  if (run.runType === "refinement") {
    return "The guide couldn't finish updating your itinerary. Your previous plan is still saved.";
  }
  if (run.phase === "searching_flights") {
    return "The flight search is unavailable right now (the flight service may be out of searches for this month).";
  }
  if (run.phase === "asking_guide" || run.phase === "drafting_days") {
    return "The guide's crystal ball went dark (the AI service is busy or unavailable).";
  }
  return "The guide hit a snag before finishing.";
}

/** Reassurance for long waits; null while the wait is still short. */
export function waitHint(elapsedSeconds: number): string | null {
  if (elapsedSeconds >= 45) {
    return "Still working: the guide's servers are busy today. Hang tight, or try again soon.";
  }
  if (elapsedSeconds >= 10) {
    return "Big quests take a moment, usually under a minute.";
  }
  return null;
}

/** What a run is for, as the party reads it ("MILO is finding destinations"). */
export const RUN_PURPOSE: Record<RunType, string> = {
  discovery: "finding destinations",
  logistics: "searching for flights",
  itinerary: "drafting your itinerary",
  refinement: "updating the itinerary",
  tiebreak: "weighing up the tie",
};
