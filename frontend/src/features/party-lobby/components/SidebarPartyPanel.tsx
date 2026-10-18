"use client";

/**
 * SidebarPartyPanel — the party section of the adventure sidebar.
 *
 * Presentational only: data in via props, no data fetching, no service calls, no
 * network. Renders each party member as a row: their own character (the look they
 * saved, standing on the row with no frame), their name and party role, a "Ready"
 * mark once they have finished the current step, and a crown for the party leader
 * (Req 13.1, 13.3). A dashed row below them shows the party is still open; there is
 * no size limit, so it never gives a number (Req 13.2).
 *
 * COPY INVITE LINK copies a link that opens the join form with the room code filled
 * in; the button confirms for a moment ("LINK COPIED!"). The room code is shown
 * below it to read out (Req 13.5). If the browser refuses the clipboard the panel
 * says so. Without a room code a placeholder stands in (Req 13.6). Nothing here
 * makes a network request (Req 13.4).
 *
 * Leaving the party is a dim text link at the foot of the card, unlike the
 * invite button, and asks for confirmation.
 *
 * Composes the shared PixelCard, PixelButton, and CharacterSprite primitives and uses
 * design-token utility classes only.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";

import { PixelCard } from "@/components/PixelCard";
import { PixelButton } from "@/components/PixelButton";
import { CharacterSprite } from "@/components/CharacterSprite";
import type { PartyMemberView } from "../types";
import { PixelIcon } from "@/components/PixelIcon";
import { BASE_LAYER, LAYER_MAP } from "../lib/characterLayers";
import { GROUP_ROLES } from "../lib/characterOptions";

export interface SidebarPartyPanelProps {
  /** The party members currently in the room. */
  members: readonly PartyMemberView[];
  /** The active room code, or null when no room session is available. */
  roomCode: string | null;
  /** Leave the party. When given, a quiet link at the foot of the card offers it. */
  onLeave?: () => void;
}

/** How long a "copied" confirmation stays on the button. */
const COPIED_MS = 2000;

/** The link that opens the join form with this room's code filled in. */
export function inviteLink(roomCode: string, origin: string): string {
  return `${origin}/?code=${encodeURIComponent(roomCode)}`;
}

export function SidebarPartyPanel({
  members,
  roomCode,
  onLeave,
}: SidebarPartyPanelProps): ReactElement {
  const [copied, setCopied] = useState<"link" | "failed" | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copyLink = async (): Promise<void> => {
    if (roomCode === null) return;
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(
        inviteLink(roomCode, window.location.origin),
      );
      setCopied("link");
      timer.current = setTimeout(() => setCopied(null), COPIED_MS);
    } catch {
      setCopied("failed");
    }
  };

  return (
    <PixelCard title="PARTY">
      <ul className="flex flex-col gap-8" aria-label="Party members">
        {members.map((member) => {
          const role = GROUP_ROLES.find((r) => r.id === member.groupRole);
          const roleLayer = member.groupRole
            ? LAYER_MAP.role[member.groupRole]
            : undefined;
          return (
            // The character stands straight on the dark row: no frame around it.
            <li
              key={member.id}
              className="flex items-center gap-16 border-2 border-muted bg-bg pr-16"
            >
              <span className="flex h-64 w-64 shrink-0 items-end justify-center overflow-hidden">
                <CharacterSprite
                  spriteKey={member.spriteKey}
                  label={`${member.displayName}'s character`}
                  layers={roleLayer ? [BASE_LAYER, roleLayer] : [BASE_LAYER]}
                  scale={2}
                  decorative
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-body break-words text-ink">
                  {member.displayName}
                </span>
                <span className="font-body text-subtle">
                  {role ? role.label : "Choosing a character"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-8">
                {member.ready ? (
                  <span className="font-display text-success">Ready</span>
                ) : null}
                {member.isHost ? (
                  <span className="text-accent">
                    <PixelIcon name="crown" size={16} label="Party leader" />
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
        {/* An open seat: the party has no size limit, so it never says how many. */}
        <li className="border-2 border-dashed border-muted px-16 py-8 font-body text-subtle">
          {members.length <= 1 ? "Waiting for others to join…" : "Room for more"}
        </li>
      </ul>

      {roomCode !== null ? (
        <div className="mt-16 flex flex-col gap-8">
          <PixelButton
            label={copied === "link" ? "LINK COPIED!" : "COPY INVITE LINK"}
            variant="secondary"
            onClick={() => {
              void copyLink();
            }}
          />
          <p className="font-body">
            Room code:{" "}
            <span className="font-display text-accent">{roomCode}</span>
          </p>
          {/* Success shows on the button; only a failure needs words. */}
          <p role="status" aria-live="polite" className="font-body text-alert">
            {copied === "failed"
              ? "Could not copy. Share the room code instead."
              : ""}
          </p>
        </div>
      ) : (
        <p className="mt-16 font-body text-subtle">No room code yet</p>
      )}

      {/* Leaving sits apart from the invite button and looks nothing like it: a dim
          text link, so it is there when wanted and hard to press by accident. It
          still asks before leaving. */}
      {onLeave ? (
        <div>
          {confirmingLeave ? (
            <div
              role="group"
              aria-label="Leave this party?"
              className="flex flex-col gap-8"
            >
              <p className="font-body text-subtle">
                Leave this party? You can come back with the code.
              </p>
              <div className="flex flex-wrap gap-8">
                <PixelButton variant="danger" label="Leave" onClick={onLeave} />
                <PixelButton
                  variant="secondary"
                  label="Stay"
                  onClick={() => setConfirmingLeave(false)}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingLeave(true)}
              className="font-body text-sm text-subtle underline decoration-dotted underline-offset-4 hover:text-alert focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-alt"
            >
              Leave party
            </button>
          )}
        </div>
      ) : null}
    </PixelCard>
  );
}

export default SidebarPartyPanel;
