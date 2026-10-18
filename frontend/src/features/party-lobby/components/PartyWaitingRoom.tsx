"use client";

/**
 * PartyWaitingRoom — the live waiting room shown once a party is created/joined.
 *
 * Presentational only: data in via props, events out via callbacks. It supplies
 * the page chrome (title + leave action) around the shared SETUP-stage content
 * (room-code share + live roster). Kept for standalone use/tests; the pipeline
 * shell renders the same {@link SetupStageContent} inside its stage area.
 */
import type { ReactElement } from "react";

import { PixelButton } from "@/components/PixelButton";
import type { RoomMember, RoomSession } from "@/types";

import { SetupStageContent } from "./SetupStageContent";

export interface PartyWaitingRoomProps {
  /** The active session (room + the viewer's member record). */
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

export function PartyWaitingRoom({
  session,
  members,
  copied,
  onCopyCode,
  onLeave,
}: PartyWaitingRoomProps): ReactElement {
  return (
    <main className="bg-bg text-ink font-body min-h-screen p-24">
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-24">
        <h1 className="font-title text-pixel-lg capitalize text-accent text-center">
          {session.room.name}
        </h1>

        <SetupStageContent
          session={session}
          members={members}
          copied={copied}
          onCopyCode={onCopyCode}
        />

        <PixelButton variant="danger" label="Leave party" onClick={onLeave} />
      </div>
    </main>
  );
}

export default PartyWaitingRoom;
