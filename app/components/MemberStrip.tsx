"use client";

/**
 * MemberStrip — horizontally scrollable row of MemberAvatar components.
 *
 * Renders one MemberAvatar per room member, looking up each member's
 * CharacterProfile by userId. Displays below the room header without
 * pushing stage content down on narrow viewports.
 *
 * Palette:
 *   Deep navy  #1E3A5F  — strip border/background accent
 *   Sand cream #FEF3C7  — strip background
 */

import React from "react";
import type { User, CharacterProfile } from "@/lib/types";
import MemberAvatar from "./MemberAvatar";

// ─── Prop types ──────────────────────────────────────────────────────────────

interface MemberStripProps {
  members: User[];
  hostUserId: string;
  characterProfiles: CharacterProfile[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MemberStrip({
  members,
  hostUserId,
  characterProfiles,
}: MemberStripProps) {
  // Build a fast lookup map: userId → CharacterProfile
  const profileByUserId = React.useMemo(() => {
    const map = new Map<string, CharacterProfile>();
    for (const profile of characterProfiles) {
      map.set(profile.userId, profile);
    }
    return map;
  }, [characterProfiles]);

  if (members.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Room members"
      style={{
        backgroundColor: "#FEF3C7",
        borderBottom: "2px solid #1E3A5F",
        padding: "8px 12px",
      }}
    >
      <ul
        className="flex flex-row gap-4 overflow-x-auto"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          maxHeight: 96,          // prevents pushing stage content down on narrow viewports
          alignItems: "flex-start",
        }}
      >
        {members.map((member) => {
          const profile = profileByUserId.get(member.id) ?? null;
          const isHost = member.id === hostUserId;

          return (
            <li key={member.id} style={{ flexShrink: 0 }}>
              <MemberAvatar
                user={member}
                characterProfile={profile}
                isHost={isHost}
              />
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
