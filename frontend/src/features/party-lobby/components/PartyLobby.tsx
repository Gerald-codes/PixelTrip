"use client";

/**
 * PartyLobby — the entry screen where an adventurer creates or joins a party.
 *
 * A single centred card with a Create Room / Join Room tab toggle, a shared
 * "Display name" field, a contextual second field (party name when creating, room
 * code when joining), and one primary action button. Branded with the PixelTrip
 * mark + tagline.
 *
 * Presentational only: data in via props, events out via callbacks (no service
 * imports, no data fetching). Submits on Enter, shows pending states, and surfaces
 * safe error/validation messages via an `aria-live` region. Token styling only.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from "react";

import { GuidePortrait } from "@/components/GuidePortrait";
import { PixelButton } from "@/components/PixelButton";

import type { LobbyView } from "../hooks/usePartyLobby";

export interface PartyLobbyProps {
  /** Current lobby view; used to show pending states on the two actions. */
  view: LobbyView;
  /** Safe, player-facing error message, if any. */
  errorMessage?: string;
  /** Safe, player-facing validation message, if any. */
  validationMessage?: string;
  /** Create a new party with a room name and the owner's adventurer name. */
  onCreateParty: (name: string, ownerDisplayName: string) => void;
  /** Join an existing party with a code and the adventurer's name. */
  onJoinParty: (roomCode: string, displayName: string) => void;
}

type Tab = "create" | "join";

const INPUT_CLASSES =
  "font-body text-ink bg-bg border-2 border-muted w-full px-16 py-8 focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

export function PartyLobby({
  view,
  errorMessage,
  validationMessage,
  onCreateParty,
  onJoinParty,
}: PartyLobbyProps): ReactElement {
  const [tab, setTab] = useState<Tab>("create");
  const [displayName, setDisplayName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomCode, setRoomCode] = useState("");

  // An invite link (`/?code=ABC123`) opens the join form with the code filled in.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code && code.trim() !== "") {
      setTab("join");
      setRoomCode(code.trim().toUpperCase());
    }
  }, []);

  const creating = view === "creating";
  const joining = view === "joining";
  const busy = creating || joining;

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (tab === "create") {
      onCreateParty(roomName, displayName);
    } else {
      onJoinParty(roomCode, displayName);
    }
  };

  const status = errorMessage ?? validationMessage;

  const tabClass = (active: boolean): string =>
    `font-display flex-1 border-2 px-16 py-8 uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
      active
        ? "border-primary bg-primary text-bg"
        : "border-muted bg-bg text-subtle enabled:hover:border-ink enabled:hover:text-ink"
    }`;

  const buttonLabel =
    tab === "create"
      ? creating
        ? "Creating party…"
        : "Create party"
      : joining
        ? "Joining party…"
        : "Join party";

  return (
    <main className="bg-bg text-ink font-body flex min-h-screen items-center justify-center p-16 sm:p-24">
      <div className="flex w-full max-w-md flex-col items-center gap-24">
        {/* Branding: MILO, the guide, greets the player. */}
        <div className="flex flex-col items-center gap-16 text-center">
          <GuidePortrait scale={3} />
          <h1 className="font-title text-pixel-xl text-accent">PixelTrip</h1>
          <p className="font-body text-subtle">
            Every great adventure starts with a party!
            <br />
            Gather your crew, and let MILO guide the way!
          </p>
        </div>

        {/* Single card with the tab toggle + form */}
        <section className="bg-bg-alt border-2 border-ink w-full p-24 shadow-pixel">
          <div
            className="mb-24 flex gap-8"
            role="tablist"
            aria-label="Start or join a party"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "create"}
              onClick={() => setTab("create")}
              disabled={busy}
              className={tabClass(tab === "create")}
            >
              New party
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "join"}
              onClick={() => setTab("join")}
              disabled={busy}
              className={tabClass(tab === "join")}
            >
              Have a code
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-24">
            <div className="flex flex-col gap-8">
              <label htmlFor="display-name" className="font-display text-ink">
                Your name
              </label>
              <input
                id="display-name"
                name="display-name"
                type="text"
                autoComplete="nickname"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={busy}
                className={INPUT_CLASSES}
              />
            </div>

            {tab === "create" ? (
              <div className="flex flex-col gap-8">
                <label htmlFor="room-name" className="font-display text-ink">
                  Party name
                </label>
                <input
                  id="room-name"
                  name="room-name"
                  type="text"
                  autoComplete="off"
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                  disabled={busy}
                  placeholder="The Wandering Party"
                  className={INPUT_CLASSES}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-8">
                <label htmlFor="room-code" className="font-display text-ink">
                  Party code
                </label>
                <input
                  id="room-code"
                  name="room-code"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  value={roomCode}
                  onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                  disabled={busy}
                  placeholder="AB12CD"
                  className={`${INPUT_CLASSES} uppercase`}
                />
              </div>
            )}

            {/* Problems are reported here, next to the fields and the button. */}
            {status ? (
              <p role="alert" className="font-body text-alert">
                {status}
              </p>
            ) : null}

            <PixelButton
              type="submit"
              variant="option"
              label={buttonLabel}
              disabled={busy}
              className="w-full"
            />
          </form>
        </section>
      </div>
    </main>
  );
}

export default PartyLobby;
