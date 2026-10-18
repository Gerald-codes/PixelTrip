"use client";

/**
 * RosterPanel — the live party roster, shared by the waiting room and the shell.
 *
 * Presentational only: data in via props, no data fetching. Renders each member
 * as a row with their character sprite, name, and a host badge for the owner.
 * Factored out of PartyWaitingRoom so the stage shell can reuse the exact same
 * roster rather than forking a copy.
 */
import type { ReactElement } from "react";

import { PixelCard } from "@/components/PixelCard";
import { CharacterSprite } from "@/components/CharacterSprite";
import type { RoomMember } from "@/types";

export interface RosterPanelProps {
  /** Live roster of members in the room. */
  members: RoomMember[];
  /** The viewer's member id, used to label "you" in the panel heading. */
  viewerDisplayName: string;
  /** Whether the viewer is the party host (owner). */
  viewerIsHost: boolean;
}

export function RosterPanel({
  members,
  viewerDisplayName,
  viewerIsHost,
}: RosterPanelProps): ReactElement {
  return (
    <PixelCard title={`Your party (${members.length})`}>
      <p className="font-body mb-8">
        You are <span className="text-accent">{viewerDisplayName}</span>
        {viewerIsHost ? " — the host." : " — a party member."}
      </p>
      <ul className="flex flex-col gap-8" aria-label="Party roster">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex items-center gap-16 border-2 border-muted p-8"
          >
            <CharacterSprite
              spriteKey={member.guestId}
              label={`${member.displayName}'s character`}
              size="sm"
              decorative
            />
            <span className="font-body">{member.displayName}</span>
            {member.role === "owner" ? (
              <span className="font-display text-accent">Host</span>
            ) : null}
          </li>
        ))}
      </ul>
    </PixelCard>
  );
}

export default RosterPanel;
