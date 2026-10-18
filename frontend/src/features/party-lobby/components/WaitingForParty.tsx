"use client";

/**
 * WaitingForParty — the "waiting for other party members" readiness panel.
 *
 * Shown after the viewer completes the current stage (saved their character,
 * picked a destination, ...). Lists each member with a ready / waiting marker,
 * driven by the live `stageReady` flag on the roster (mirrored by the backend and
 * streamed over Supabase Realtime). Presentational only; token styling.
 */
import type { ReactElement } from "react";

import { PixelCard } from "@/components/PixelCard";
import type { RoomMember } from "@/types";

export interface WaitingForPartyProps {
  /** Live roster with per-member readiness. */
  members: readonly RoomMember[];
  /** Short label for what everyone is completing (e.g. "character"). */
  what: string;
}

export function WaitingForParty({
  members,
  what,
}: WaitingForPartyProps): ReactElement {
  const readyCount = members.filter((m) => m.stageReady).length;
  const total = members.length;

  return (
    <PixelCard title="Waiting for other party members">
      <p className="font-body mb-16">
        You are ready. {readyCount} of {total} adventurers have finished their{" "}
        {what}.
      </p>
      <ul className="flex flex-col gap-8" aria-label="Party readiness">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex items-center justify-between gap-16 border-2 border-muted p-8"
          >
            <span className="font-body">{member.displayName}</span>
            <span
              className={`font-display ${
                member.stageReady ? "text-success" : "text-subtle"
              }`}
            >
              {member.stageReady ? "READY" : "WAITING…"}
            </span>
          </li>
        ))}
      </ul>
    </PixelCard>
  );
}

export default WaitingForParty;
