/**
 * Run progress contract — what the AI guide is doing right now.
 *
 * Mirrors `GET /trips/{tripId}/runs/latest?runType=…`. `phase` is the real step
 * the run is on (or failed on); the UI maps it to an in-world line.
 */
export type RunType =
  | "discovery"
  | "logistics"
  | "itinerary"
  | "refinement"
  | "tiebreak";

export type RunPhase =
  | "reading_party"
  | "asking_guide"
  | "searching_flights"
  | "checking_budget"
  | "checking_answer"
  | "drafting_days"
  | "weighing_feedback"
  | "weighing_options"
  | "posting";

export interface RunProgress {
  id: string;
  runType: RunType;
  status: "pending" | "running" | "completed" | "failed";
  phase: RunPhase | null;
  elapsedSeconds: number;
}

export interface RunService {
  /** The room's latest run of a type (any type when omitted), or null before any run. */
  getLatestRun(roomId: string, runType?: RunType): Promise<RunProgress | null>;

  /** Start a fresh run of a type (e.g. retry the tiebreak advice). */
  startRun(roomId: string, memberId: string, runType: RunType): Promise<void>;
}
