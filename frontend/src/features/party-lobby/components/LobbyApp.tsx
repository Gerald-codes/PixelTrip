"use client";

/**
 * LobbyApp — the party lobby container.
 *
 * The only stateful piece: it runs {@link usePartyLobby} and renders the entry
 * screen or the in-room pipeline shell depending on the view. The presentational
 * components stay data-fetching-free; this container bridges them to the hook.
 */
import type { ReactElement } from "react";

import { usePartyLobby } from "../hooks/usePartyLobby";
import { PartyLobby } from "./PartyLobby";
import { PartyRoomShell } from "./PartyRoomShell";

export function LobbyApp(): ReactElement {
  const {
    view,
    session,
    members,
    errorMessage,
    validationMessage,
    copied,
    createParty,
    joinParty,
    copyCode,
    leaveParty,
  } = usePartyLobby();

  if (view === "waiting" && session) {
    // Once in a room, the pipeline shell owns the stage stepper plus the active
    // stage's content (SETUP is the real waiting room; later stages are honest
    // placeholders until their backends exist).
    return (
      <PartyRoomShell
        session={session}
        members={members}
        copied={copied}
        onCopyCode={() => {
          void copyCode();
        }}
        onLeave={leaveParty}
      />
    );
  }

  return (
    <PartyLobby
      view={view}
      errorMessage={errorMessage}
      validationMessage={validationMessage}
      onCreateParty={(name, ownerDisplayName) => {
        void createParty(name, ownerDisplayName);
      }}
      onJoinParty={(roomCode, displayName) => {
        void joinParty(roomCode, displayName);
      }}
    />
  );
}

export default LobbyApp;
