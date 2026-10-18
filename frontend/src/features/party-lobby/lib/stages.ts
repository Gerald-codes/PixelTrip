/**
 * The six in-world planning stages of the adventure, in order.
 *
 * This is a presentational model for the pipeline shell: it maps each
 * {@link PlanningStage} (from the room contract) to its in-world label and a
 * short blurb, and derives which stages are complete / current / upcoming from
 * the room's current `planningStage`.
 *
 * Only "setup" is a real, working stage today. The remaining stages are honest
 * placeholders — their backends (the AI Travel Guide) do not exist yet.
 */
import type { PlanningStage } from "@/types";

/** Ordered list of the six stages — the canonical pipeline order. */
export const STAGE_ORDER: readonly PlanningStage[] = [
  "setup",
  "discover",
  "logistics",
  "build",
  "refine",
  "wrap",
] as const;

/** Presentational metadata for a single stage. */
export interface StageMeta {
  /** The planning-stage key. */
  stage: PlanningStage;
  /** 1-based position in the pipeline, for display. */
  step: number;
  /** Short in-world title (e.g. "Gather the party"). */
  title: string;
  /** One-line in-world description of this leg of the quest. */
  blurb: string;
}

/** In-world title + blurb for each stage. */
const STAGE_META: Record<PlanningStage, Omit<StageMeta, "stage" | "step">> = {
  setup: {
    title: "Gather the party",
    blurb: "Form your party and share the room code so others can join.",
  },
  discover: {
    title: "Choose the destination",
    blurb: "Compare destinations and vote on where the quest begins.",
  },
  logistics: {
    title: "Arrange travel",
    blurb: "Weigh flight and travel options against budget and dates.",
  },
  build: {
    title: "Draft the quest log",
    blurb: "Draft the first itinerary from the party's choices.",
  },
  refine: {
    title: "Improve together",
    blurb: "Refine the plan together until the whole party approves.",
  },
  wrap: {
    title: "Complete the adventure",
    blurb: "Review and share the final adventure summary.",
  },
};

/** Progress status of a stage relative to the current one. */
export type StageStatus = "complete" | "current" | "upcoming";

/** A stage plus its status, ready to render in the stepper. */
export interface StageStep extends StageMeta {
  status: StageStatus;
}

/** The ordered stage metadata (step numbers assigned from {@link STAGE_ORDER}). */
export const STAGES: readonly StageMeta[] = STAGE_ORDER.map((stage, index) => ({
  stage,
  step: index + 1,
  ...STAGE_META[stage],
}));

/** The only stage with a working, real implementation today. */
export const REAL_STAGE: PlanningStage = "setup";

/** True when the stage has no backend yet and must render a placeholder. */
export function isStageStubbed(stage: PlanningStage): boolean {
  return stage !== REAL_STAGE;
}

/**
 * Build the stepper model: each stage with its status derived from the active
 * `planningStage`. Stages before the active one are `complete`, the active one
 * is `current`, and later ones are `upcoming`.
 *
 * An unrecognised `planningStage` (should not happen with contract-shaped data)
 * is treated as position 0 so the first stage is current and the rest upcoming.
 */
export function buildStageSteps(active: PlanningStage): StageStep[] {
  const activeIndex = Math.max(0, STAGE_ORDER.indexOf(active));
  return STAGES.map((meta, index) => ({
    ...meta,
    status:
      index < activeIndex
        ? "complete"
        : index === activeIndex
          ? "current"
          : "upcoming",
  }));
}

/** The metadata for a single stage key. */
export function stageMeta(stage: PlanningStage): StageMeta {
  return STAGES[STAGE_ORDER.indexOf(stage)] ?? STAGES[0];
}
