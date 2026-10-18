"use client";

/**
 * usePartyLobby — the party lobby's single stateful hook.
 *
 * Owns the lobby view state ("entry" | "creating" | "joining" | "waiting"), the
 * current {@link RoomSession} and live member roster, plus safe error/validation
 * messages and the copy-code flag. All backend access goes through the service
 * layer via {@link getServices} — this hook never imports a concrete mock/real
 * implementation or Supabase directly.
 *
 * Live roster: while in "waiting" the hook subscribes via
 * `room.subscribeMembers`, which pushes the full roster whenever it changes and
 * primes it once immediately. The mock backs this with an interval; the real
 * service uses a Supabase Realtime channel — both behind the same service
 * boundary, so this hook never imports Supabase. The subscription is torn down on
 * cleanup, leave, or unmount, and no state is set after unmount.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { getServices } from "@/services";
import type { RoomMember, RoomSession } from "@/types";

import { toCreateErrorMessage, toJoinErrorMessage } from "../lib/lobbyErrors";
import {
  validateDisplayName,
  validateRoomCode,
  validateRoomName,
} from "../lib/lobbyValidation";

/** The lobby's coarse view state. */
export type LobbyView = "entry" | "creating" | "joining" | "waiting";

/** The shape returned by {@link usePartyLobby}. */
export interface PartyLobbyState {
  view: LobbyView;
  /** The active session once a party is created or joined; `undefined` before. */
  session: RoomSession | undefined;
  /** Live roster of the current room; empty until "waiting". */
  members: RoomMember[];
  /** Safe, player-facing error from the last service call, if any. */
  errorMessage: string | undefined;
  /** Safe, player-facing validation message for invalid input, if any. */
  validationMessage: string | undefined;
  /** True briefly after the room code is copied to the clipboard. */
  copied: boolean;
  createParty: (name: string, ownerDisplayName: string) => Promise<void>;
  joinParty: (roomCode: string, displayName: string) => Promise<void>;
  copyCode: () => Promise<void>;
  leaveParty: () => void;
}

/** Where the browser remembers which party this player is in. */
const SESSION_KEY = "pixeltrip.party";

interface RememberedParty {
  roomCode: string;
  displayName: string;
}

/** Storage can be blocked (private mode); remembering is a convenience only. */
function remember(party: RememberedParty | null): void {
  try {
    if (party) window.localStorage.setItem(SESSION_KEY, JSON.stringify(party));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to do: the player simply joins again after a refresh.
  }
}

function remembered(): RememberedParty | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RememberedParty>;
    return typeof value.roomCode === "string" && typeof value.displayName === "string"
      ? { roomCode: value.roomCode, displayName: value.displayName }
      : null;
  } catch {
    return null;
  }
}

export function usePartyLobby(): PartyLobbyState {
  const [view, setView] = useState<LobbyView>("entry");
  const [session, setSession] = useState<RoomSession | undefined>(undefined);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [validationMessage, setValidationMessage] = useState<string | undefined>(
    undefined,
  );
  const [copied, setCopied] = useState(false);

  // Tracks mount status so async callbacks never set state after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const createParty = useCallback(
    async (name: string, ownerDisplayName: string): Promise<void> => {
      const nameCheck = validateRoomName(name);
      const ownerCheck = validateDisplayName(ownerDisplayName);
      if (!nameCheck.valid || !ownerCheck.valid) {
        // Invalid input: show a field message and make NO service call.
        setValidationMessage(nameCheck.message ?? ownerCheck.message);
        return;
      }

      setValidationMessage(undefined);
      setErrorMessage(undefined);
      setView("creating");
      try {
        const next = await getServices().room.createRoom({
          name: name.trim(),
          ownerDisplayName: ownerDisplayName.trim(),
        });
        if (!mountedRef.current) return;
        remember({
          roomCode: next.room.roomCode,
          displayName: next.member.displayName,
        });
        setSession(next);
        setMembers([next.member]);
        setView("waiting");
      } catch (error) {
        if (!mountedRef.current) return;
        setErrorMessage(toCreateErrorMessage(error));
        setView("entry");
      }
    },
    [],
  );

  const joinParty = useCallback(
    async (roomCode: string, displayName: string): Promise<void> => {
      const codeCheck = validateRoomCode(roomCode);
      const nameCheck = validateDisplayName(displayName);
      if (!codeCheck.valid || !nameCheck.valid) {
        // Invalid input: show a field message and make NO service call.
        setValidationMessage(codeCheck.message ?? nameCheck.message);
        return;
      }

      setValidationMessage(undefined);
      setErrorMessage(undefined);
      setView("joining");
      try {
        const next = await getServices().room.joinRoom({
          roomCode: roomCode.trim(),
          displayName: displayName.trim(),
        });
        if (!mountedRef.current) return;
        remember({
          roomCode: next.room.roomCode,
          displayName: next.member.displayName,
        });
        setSession(next);
        setMembers([next.member]);
        setView("waiting");
      } catch (error) {
        if (!mountedRef.current) return;
        setErrorMessage(toJoinErrorMessage(error));
        setView("entry");
      }
    },
    [],
  );

  // After a refresh, walk straight back into the party this browser was in. Joining
  // with the same name resumes the same member; if the party is gone, forget it
  // and show the entry screen without an error.
  useEffect(() => {
    const party = remembered();
    if (!party) return;
    setView("joining");
    getServices()
      .room.joinRoom(party)
      .then((next) => {
        if (!mountedRef.current) return;
        setSession(next);
        setMembers([next.member]);
        setView("waiting");
      })
      .catch(() => {
        remember(null);
        if (mountedRef.current) setView("entry");
      });
  }, []);

  // Subscribe to live roster updates while waiting. The service pushes the full
  // roster (primed once immediately, then on every change); we only forward it
  // to state while still mounted and still waiting. Unsubscribe on cleanup —
  // which also covers leaving "waiting" and unmount.
  const roomId = session?.room.id;
  useEffect(() => {
    if (view !== "waiting" || !roomId) return;

    let cancelled = false;
    const services = getServices();

    const unsubscribeMembers = services.room.subscribeMembers(
      roomId,
      (next) => {
        if (!cancelled && mountedRef.current) {
          setMembers(next);
        }
      },
    );

    // Live room updates (notably planningStage advancing SETUP -> DISCOVER). Merge
    // the fresh room into the session so the shell renders the active stage.
    const unsubscribeRoom = services.room.subscribeRoom(
      roomId,
      (room) => {
        if (cancelled || !mountedRef.current) return;
        setSession((prev) => (prev ? { ...prev, room } : prev));
      },
    );

    return () => {
      cancelled = true;
      unsubscribeMembers();
      unsubscribeRoom();
    };
  }, [view, roomId]);

  const copyCode = useCallback(async (): Promise<void> => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.room.roomCode);
      if (!mountedRef.current) return;
      setCopied(true);
    } catch {
      if (!mountedRef.current) return;
      setCopied(false);
    }
  }, [session]);

  const leaveParty = useCallback((): void => {
    // Local-only reset; no backend call. Returns the player to the entry view and
    // forgets the party, so a refresh does not walk back in.
    remember(null);
    setSession(undefined);
    setMembers([]);
    setErrorMessage(undefined);
    setValidationMessage(undefined);
    setCopied(false);
    setView("entry");
  }, []);

  return {
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
  };
}
