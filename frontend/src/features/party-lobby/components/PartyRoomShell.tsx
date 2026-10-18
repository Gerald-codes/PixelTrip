"use client";

/**
 * PartyRoomShell — the room screen: a chatbot-style stage column on the left and
 * the persistent "YOUR ADVENTURE" sidebar on the right.
 *
 * The sidebar (party, destination/flight, budget, quest progress) stays on screen
 * across every stage. The left column shows the active stage as a guided NPC
 * conversation (SETUP character build, DISCOVER destination choice, ...). There is
 * no separate top stepper (the sidebar already shows quest progress) and no
 * bottom party chat; the stage conversation IS the chat.
 *
 * Presentational only: session, roster, and copy flag in via props; copy/leave
 * out via callbacks. No service imports here.
 */
import { useCallback, useState, type ReactElement } from "react";

import { PixelButton } from "@/components/PixelButton";
import type { DiscoverState } from "@/services/destination.contract";
import type { RoomMember, RoomSession } from "@/types";

import { AdventureSidebar } from "./AdventureSidebar";
import { buildAdventureView } from "../lib/adventureMocks";
import { stageMeta } from "../lib/stages";
import { SetupStageContent } from "./SetupStageContent";
import { DestinationStageContent } from "./DestinationStageContent";
import { FlightStageContent } from "./FlightStageContent";
import { BuildStageContent } from "./BuildStageContent";
import { LateJoinStageContent } from "./LateJoinStageContent";
import { GuideActivityBar } from "./GuideActivityBar";
import { useActiveGuideRun } from "../hooks/useActiveGuideRun";
import { useRoomSelections } from "../hooks/useRoomSelections";
import { StagePlaceholder } from "./StagePlaceholder";
import { TravellerPreviewProvider } from "../hooks/useTravellerPreview";

export interface PartyRoomShellProps {
  /** The active room session (room + the viewer's member record). */
  session: RoomSession;
  /** Live roster of members in the room. */
  members: RoomMember[];
  /** True briefly after a successful copy of the room code. */
  copied: boolean;
  /** Copy the room code to the clipboard. */
  onCopyCode: () => void;
  /** Leave the party and return to the entry screen (local only). */
  onLeave: () => void;
}

/**
 * The room screen. Wrapped in the traveller-preview provider so the character
 * form (left column) and the sidebar (right column) share the traveller in progress.
 */
export function PartyRoomShell(props: PartyRoomShellProps): ReactElement {
  return (
    <TravellerPreviewProvider>
      <RoomShell {...props} />
    </TravellerPreviewProvider>
  );
}

function RoomShell({
  session,
  members,
  copied,
  onCopyCode,
  onLeave,
}: PartyRoomShellProps): ReactElement {
  const activeStage = session.room.planningStage;
  const [discover, setDiscover] = useState<DiscoverState | null>(null);
  const handleDiscoverChange = useCallback((state: DiscoverState): void => {
    setDiscover(state);
  }, []);
  const adventure = buildAdventureView(members);
  const selections = useRoomSelections(session.room.id);
  // A member who joined after SETUP has no character yet: they create one before
  // seeing (and voting in) the current stage. `savedHere` covers a character saved
  // in this tab, since the session from joining still says "not submitted".
  const [savedHere, setSavedHere] = useState(false);
  const markSaved = useCallback(() => setSavedHere(true), []);
  const activeRun = useActiveGuideRun(session.room.id);
  // DISCOVER and LOGISTICS explain their own runs (and ties) in place; the bar is
  // for everything else, so there is never more than one indicator on screen.
  const explainedInPlace =
    activeRun !== null &&
    ((activeStage === "discover" &&
      (activeRun.runType === "discovery" || activeRun.runType === "tiebreak")) ||
      (activeStage === "logistics" &&
        (activeRun.runType === "logistics" || activeRun.runType === "tiebreak")) ||
      (activeStage === "build" && activeRun.runType === "itinerary") ||
      (activeStage === "refine" && activeRun.runType === "refinement"));
  const needsCharacter =
    activeStage !== "setup" && !session.travelPreferences?.submittedAt && !savedHere;

  return (
    <main className="bg-bg text-ink font-body min-h-screen p-16 sm:p-24">
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-24">
        <div className="flex flex-wrap items-center justify-between gap-16">
          <h1 className="font-title text-pixel-lg capitalize text-accent" style={{ fontSize: "3.5rem" }}>
            {session.room.name}
          </h1>
        </div>

        {session.room.demoScenario === "vietnam-five-days" ? (
          <p className="border-2 border-primary bg-bg-alt p-8 font-body text-primary">
            Prepared demo · DemoAlice + DemoBob · Bali, Vietnam or Thailand. Flights and prices are sample data.
          </p>
        ) : null}

        {/* Two columns: chatbot-style stage flow (left) + persistent sidebar (right). */}
        <div className="flex flex-col gap-24 lg:grid lg:grid-cols-[2fr_1fr] lg:items-start lg:gap-24">
          <div className="flex flex-col gap-24">
            {activeRun && !explainedInPlace ? <GuideActivityBar run={activeRun} /> : null}
            {needsCharacter ? (
              <LateJoinStageContent session={session} onSaved={markSaved} />
            ) : activeStage === "setup" ? (
              <SetupStageContent
                session={session}
                members={members}
                copied={copied}
                onCopyCode={onCopyCode}
                onCharacterSaved={markSaved}
              />
            ) : activeStage === "discover" ? (
              <DestinationStageContent
                session={session}
                members={members}
                onDiscoverChange={handleDiscoverChange}
              />
            ) : activeStage === "logistics" ? (
              <FlightStageContent session={session} members={members} />
            ) : activeStage === "build" || activeStage === "refine" ? (
              <BuildStageContent
                session={session}
                members={members}
                selectedFlight={selections.flight}
                canStartRun={activeStage === "build"}
              />
            ) : activeStage === "wrap" ? (
              <BuildStageContent
                session={session}
                members={members}
                selectedFlight={selections.flight}
                canStartRun={false}
              />
            ) : (
              <StagePlaceholder stage={stageMeta(activeStage)} />
            )}
          </div>

          <AdventureSidebar
            adventure={adventure}
            roomSession={session}
            onLeave={onLeave}
            selectedDestination={
              selections.destination ?? discover?.selectedDestination ?? null
            }
            selectedFlight={selections.flight}
          />
        </div>
      </div>
    </main>
  );
}

export default PartyRoomShell;
