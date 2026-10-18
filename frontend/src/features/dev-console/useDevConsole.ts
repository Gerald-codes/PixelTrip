"use client";

/**
 * useDevConsole — all state and side effects for the `/dev/run` test console.
 *
 * Holds the current room session, the runs started from this page, and the room's
 * live data (messages, votes, itinerary versions), polled while a session is open.
 * Every call goes through `@/services/devConsole.api`; this hook never touches
 * `fetch` or Supabase itself.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/errors";
import * as api from "@/services/devConsole.api";
import type {
  ConsoleItineraryVersion,
  ConsoleMessage,
  ConsoleRun,
  ConsoleSession,
  ConsoleVoteSession,
  RunType,
} from "@/services/devConsole.api";

/** How often the room's data and any active runs are refreshed. */
export const POLL_INTERVAL_MS = 2500;

const ACTIVE_STATUSES = new Set(["pending", "running"]);

export interface DevConsoleState {
  session: ConsoleSession | null;
  runs: ConsoleRun[];
  messages: ConsoleMessage[];
  votes: ConsoleVoteSession[];
  versions: ConsoleItineraryVersion[];
  /** The action currently in flight, or null. */
  busy: string | null;
  /** The last failure, formatted for display, or null. */
  error: string | null;
  /** A short confirmation of the last successful action, or null. */
  notice: string | null;
}

export interface DevConsoleActions {
  createRoom: (name: string, ownerDisplayName: string) => Promise<void>;
  joinRoom: (roomCode: string, displayName: string) => Promise<void>;
  savePreferences: (json: string) => Promise<void>;
  startRun: (runType: RunType) => Promise<void>;
  lockTestFlight: (departAt: string, returnAt: string) => Promise<void>;
  castVote: (voteSessionId: string, optionId: string) => Promise<void>;
  closeVote: (voteSessionId: string) => Promise<void>;
  addFeedback: (
    itineraryVersionId: string,
    itemId: string,
    comment: string,
  ) => Promise<void>;
  leave: () => void;
}

/** Turn any thrown value into one readable line. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof SyntaxError) {
    return `Not valid JSON: ${error.message}`;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function useDevConsole(): DevConsoleState & DevConsoleActions {
  const [session, setSession] = useState<ConsoleSession | null>(null);
  const [runs, setRuns] = useState<ConsoleRun[]>([]);
  const [messages, setMessages] = useState<ConsoleMessage[]>([]);
  const [votes, setVotes] = useState<ConsoleVoteSession[]>([]);
  const [versions, setVersions] = useState<ConsoleItineraryVersion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Read through a ref so the polling loop sees the latest runs without restarting.
  const runsRef = useRef<ConsoleRun[]>([]);
  runsRef.current = runs;
  const refreshing = useRef(false);

  const refresh = useCallback(async (current: ConsoleSession) => {
    if (refreshing.current) {
      return; // a slow poll must not pile up behind itself
    }
    refreshing.current = true;
    try {
      const [nextMessages, nextVotes, nextVersions] = await Promise.all([
        api.listMessages(current.roomId),
        api.listVoteSessions(current.roomId),
        api.listItineraryVersions(current.tripId),
      ]);
      setMessages(nextMessages);
      setVotes(nextVotes);
      setVersions(nextVersions);

      const active = runsRef.current.filter((run) =>
        ACTIVE_STATUSES.has(run.status),
      );
      if (active.length > 0) {
        const updated = await Promise.all(
          active.map((run) => api.getRun(run.id)),
        );
        setRuns((previous) =>
          previous.map((run) => updated.find((u) => u.id === run.id) ?? run),
        );
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    if (!session) {
      return undefined;
    }
    void refresh(session);
    const timer = setInterval(() => void refresh(session), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [session, refresh]);

  /** Run one action: mark it busy, clear the last error, report the outcome. */
  const perform = useCallback(
    async (label: string, action: () => Promise<string | void>) => {
      setBusy(label);
      setError(null);
      setNotice(null);
      try {
        const message = await action();
        if (message) {
          setNotice(message);
        }
      } catch (caught) {
        setError(describeError(caught));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const openSession = useCallback((next: ConsoleSession) => {
    setSession(next);
    setRuns([]);
    setMessages([]);
    setVotes([]);
    setVersions([]);
  }, []);

  const requireSession = (): ConsoleSession => {
    if (!session) {
      throw new Error("Create or join a room first.");
    }
    return session;
  };

  return {
    session,
    runs,
    messages,
    votes,
    versions,
    busy,
    error,
    notice,

    createRoom: (name, ownerDisplayName) =>
      perform("create room", async () => {
        const created = await api.createRoom(name, ownerDisplayName);
        openSession(created);
        return `Created room ${created.roomCode}.`;
      }),

    joinRoom: (roomCode, displayName) =>
      perform("join room", async () => {
        const joined = await api.joinRoom(roomCode, displayName);
        openSession(joined);
        return `Joined room ${joined.roomCode} as ${joined.displayName}.`;
      }),

    savePreferences: (json) =>
      perform("save preferences", async () => {
        const current = requireSession();
        const parsed: unknown = JSON.parse(json);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error("Preferences must be a JSON object.");
        }
        const saved = await api.savePreferences(
          current,
          parsed as Record<string, unknown>,
        );
        setSession({ ...current, tripStatus: saved.tripStatus });
        return `Preferences saved (trip is now ${saved.tripStatus}).`;
      }),

    startRun: (runType) =>
      perform(`start ${runType}`, async () => {
        const current = requireSession();
        const run = await api.startRun(
          current,
          runType,
          `${runType}-${Date.now()}`,
        );
        setRuns((previous) =>
          previous.some((existing) => existing.id === run.id)
            ? previous.map((existing) =>
                existing.id === run.id ? run : existing,
              )
            : [run, ...previous],
        );
        return `Started ${runType} run.`;
      }),

    lockTestFlight: (departAt, returnAt) =>
      perform("lock test flight", async () => {
        const current = requireSession();
        await api.lockTestFlight(current.tripId, departAt, returnAt);
        return "Test flight locked.";
      }),

    castVote: (voteSessionId, optionId) =>
      perform("cast vote", async () => {
        const current = requireSession();
        const result = await api.castVote(current, voteSessionId, optionId);
        await refresh(current);
        return result.sessionStatus === "closed"
          ? "Vote cast; the session closed and the choice is locked in."
          : "Vote cast.";
      }),

    closeVote: (voteSessionId) =>
      perform("close vote", async () => {
        const current = requireSession();
        await api.closeVote(current, voteSessionId);
        await refresh(current);
        return "Vote closed.";
      }),

    addFeedback: (itineraryVersionId, itemId, comment) =>
      perform("add feedback", async () => {
        const current = requireSession();
        await api.addTestFeedback(current, itineraryVersionId, itemId, comment);
        return "Feedback added; start a refinement run to apply it.";
      }),

    leave: () => {
      setSession(null);
      setRuns([]);
      setMessages([]);
      setVotes([]);
      setVersions([]);
      setError(null);
      setNotice(null);
    },
  };
}
