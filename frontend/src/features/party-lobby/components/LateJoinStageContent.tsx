"use client";

/**
 * LateJoinStageContent — for a member who joins after the party left SETUP.
 *
 * They have no travel character yet, so before seeing the current stage (and
 * being counted in its vote) they create one. Saving it does not mark them
 * "ready" (past SETUP, ready means "has voted"); it just lets them in. The AI's
 * existing suggestions were made before they joined, which the guide says.
 */
import type { ReactElement } from "react";

import type { RoomSession } from "@/types";

import { CharacterCreator } from "./CharacterCreator";
import { GuideMessage, GuideSay, StageChat } from "./StageChat";

export interface LateJoinStageContentProps {
  session: RoomSession;
  onSaved: () => void;
}

export function LateJoinStageContent({
  session,
  onSaved,
}: LateJoinStageContentProps): ReactElement {
  return (
    <StageChat>
      <GuideSay text="Welcome aboard! The party has already set off, so let's get you a travel character first." />
      <GuideSay text="Once you're done you'll join the party where they are. The options already on the table were picked before you arrived, but your vote still counts." />
      <GuideMessage>
        <CharacterCreator session={session} onSaved={onSaved} />
      </GuideMessage>
    </StageChat>
  );
}

export default LateJoinStageContent;
