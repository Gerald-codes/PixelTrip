"use client";

/**
 * StagePlaceholder — honest "not yet available" content for a stubbed stage.
 *
 * Stages after SETUP (discover / logistics / build / refine / wrap) have no
 * backend yet (the AI Travel Guide does not exist). This renders a clear,
 * in-world message that the leg of the quest will open once the guide is ready.
 * It shows NO fake data — no mock itinerary, votes, or chat — and makes no
 * service calls. Purely presentational.
 */
import type { ReactElement } from "react";

import { PixelCard } from "@/components/PixelCard";
import { DialogueBox } from "@/components/DialogueBox";

import type { StageMeta } from "../lib/stages";

export interface StagePlaceholderProps {
  /** Metadata for the stubbed stage being shown. */
  stage: StageMeta;
}

export function StagePlaceholder({ stage }: StagePlaceholderProps): ReactElement {
  return (
    <div className="flex flex-col gap-24" data-testid="stage-placeholder">
      <DialogueBox
        speaker="Travel Guide"
        text={`This leg of the quest — ${stage.title} — isn't open yet. It will unlock once the Travel Guide is ready.`}
      />
      <PixelCard title={`${stage.title} — coming soon`}>
        <p className="font-body mb-8">{stage.blurb}</p>
        <p className="font-body text-subtle">
          This stage is not yet available. Its backend (the AI Travel Guide) is
          still being built, so there is nothing to decide here for now.
        </p>
      </PixelCard>
    </div>
  );
}

export default StagePlaceholder;
