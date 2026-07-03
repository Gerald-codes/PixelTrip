"use client";

/**
 * app/room/[code]/page.tsx — thin loader.
 *
 * Responsibilities:
 * - Identity derivation (getOrCreateUserId, getDisplayName, etc.)
 * - Initial room fetch (loading state, error state)
 * - useRoomMembers hook call
 * - useCharacterProfiles hook call
 * - Initial user upsert to /api/users
 * - handleGoBack (host-only previous-stage PATCH, delegated to RoomShell via onGoBack)
 *
 * Everything else — persistent header, member strip, stage-change subscription,
 * 3-second polling, sync button — lives in RoomShell.
 *
 * Requirements: 3.1, 3.6, 7.1, 7.2
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import RoomShell from "@/app/components/RoomShell";
import type { Identity } from "@/app/components/StageRouter";
import { broadcastMemberJoined, broadcastMemberLeft, useRoomMembers } from "@/app/hooks/useRoomMembers";
import { useCharacterProfiles } from "@/app/hooks/useCharacterProfiles";
import {
  getDisplayName,
  getOrCreateUserId,
  setDisplayName as persistDisplayName,
} from "@/lib/identity";
import { createAnonSupabase } from "@/lib/supabase";
import type { TripRoom } from "@/lib/types";

interface RoomPageProps {
  params: { code: string };
}

type LoadState = "loading" | "ready" | "error";

const IS_DEV = process.env.NODE_ENV === "development";

export default function RoomPage({ params }: RoomPageProps) {
  const code = params.code.toUpperCase();

  // ── Identity ──────────────────────────────────────────────────────────────
  const [userId, setUserId] = useState<string>("");
  const [userDisplayName, setUserDisplayName] = useState<string>("");

  useEffect(() => {
    const id = getOrCreateUserId();
    const urlParams = new URLSearchParams(window.location.search);
    const nameFromUrl = urlParams.get("name") ?? "";
    const name = nameFromUrl || getDisplayName();
    if (nameFromUrl) persistDisplayName(nameFromUrl);
    setUserId(id);
    setUserDisplayName(name);
  }, []);

  const identity = useMemo<Identity | null>(() => {
    if (!userId) return null;
    return { userId, displayName: userDisplayName };
  }, [userId, userDisplayName]);

  // ── Room fetch ────────────────────────────────────────────────────────────
  const [room, setRoom] = useState<TripRoom | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const fetchRoom = useCallback(async (): Promise<TripRoom | null> => {
    const res = await fetch(`/api/rooms/${code}`, { cache: "no-store" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(body?.error ?? "Failed to load room");
    }
    return (await res.json()) as TripRoom;
  }, [code]);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await fetchRoom();
        if (!cancelled) {
          setRoom(loaded);
          setLoadState("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(
            err instanceof Error ? err.message : "Failed to load room",
          );
          setLoadState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchRoom]);

  // ── Members ───────────────────────────────────────────────────────────────
  const members = useRoomMembers(code, room?.id ?? null);

  // ── Character Profiles ────────────────────────────────────────────────────
  const characterProfiles = useCharacterProfiles(room?.id ?? null);

  // ── Travel dates, vibes, shortlist (from availability) ───────────────────
  const [travelDates, setTravelDates] = useState<{ startDate: string; endDate: string } | null>(null);
  const [travelVibes, setTravelVibes] = useState<string[] | null>(null);
  const [destinationShortlist, setDestinationShortlist] = useState<string[] | null>(null);
  const [selectedDestinationSuggestion, setSelectedDestinationSuggestion] = useState<{ priceLevel: "budget" | "moderate" | "premium" } | null>(null);
  const [tripLengthDays, setTripLengthDays] = useState<number>(7);

  useEffect(() => {
    if (!room?.id) return;
    void (async () => {
      try {
        const res = await fetch(
          `/api/availability?roomId=${encodeURIComponent(room.id)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          availability: Array<{ userId: string; startDate: string; endDate: string }>;
          destinationPreferences: Array<{ userId: string; countryOrCity: string }>;
        };

        // Compute overlapping date window across all members who submitted
        if (data.availability.length > 0) {
          const byUser = new Map<string, Array<{ startDate: string; endDate: string }>>();
          for (const a of data.availability) {
            const list = byUser.get(a.userId) ?? [];
            list.push({ startDate: a.startDate, endDate: a.endDate });
            byUser.set(a.userId, list);
          }
          // Simple earliest-start / latest-end of the submitted ranges as an approximation
          // (full overlap calculation requires lib/overlap which is server-side heavy)
          let minStart = "";
          let maxEnd = "";
          for (const ranges of byUser.values()) {
            for (const r of ranges) {
              if (!minStart || r.startDate < minStart) minStart = r.startDate;
              if (!maxEnd || r.endDate > maxEnd) maxEnd = r.endDate;
            }
          }
          if (minStart && maxEnd) {
            setTravelDates({ startDate: minStart, endDate: maxEnd });
          }
        }

        // Destination shortlist — all unique countryOrCity values
        // Also parse vibe: prefixed rows into travelVibes
        if (data.destinationPreferences.length > 0) {
          const unique = [...new Set(data.destinationPreferences.map((p) => p.countryOrCity))];
          setDestinationShortlist(unique.length > 0 ? unique : null);

          // Parse vibe:xxx rows into human-readable vibe names
          const vibes = unique
            .filter((v) => v.startsWith("vibe:"))
            .map((v) => v.replace("vibe:", "").replace(/_/g, " "));
          setTravelVibes(vibes.length > 0 ? vibes : null);
        }
      } catch {
        // Silent — panel just shows "Not set"
      }
    })();
  }, [room?.id]);

  // ── Fetch selected destination priceLevel for budget estimate ────────────
  // Runs whenever room.selectedDestination changes (set after flight vote).
  useEffect(() => {
    if (!room?.id || !room.selectedDestination) {
      setSelectedDestinationSuggestion(null);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(
          `/api/agents/destinations?roomId=${encodeURIComponent(room.id)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const suggestions = (await res.json()) as Array<{
          destinationName: string;
          priceLevel: "budget" | "moderate" | "premium";
        }>;
        const match = suggestions.find(
          (s) => s.destinationName === room.selectedDestination,
        );
        if (match) setSelectedDestinationSuggestion({ priceLevel: match.priceLevel });
      } catch { /* silent */ }
    })();
  }, [room?.id, room?.selectedDestination]);

  // ── Compute trip length from travel dates ─────────────────────────────────
  useEffect(() => {
    if (!travelDates) return;
    const start = Date.parse(travelDates.startDate);
    const end = Date.parse(travelDates.endDate);
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      setTripLengthDays(Math.floor((end - start) / 86_400_000) + 1);
    }
  }, [travelDates]);

  // ── Running budget spend: activity + itinerary item costs ────────────────
  //
  // Distinct from the forecasted BudgetEstimate (flight + destination price
  // level). This tallies REAL committed costs so the budget bar in
  // TripContextPanel starts at $0 and fills up as the group adds costed
  // activities and the itinerary agent assigns per-item costs.
  const [activityCosts, setActivityCosts] = useState<number[]>([]);
  const [itineraryCosts, setItineraryCosts] = useState<number[]>([]);

  const fetchActivityCosts = useCallback(async () => {
    if (!room?.id) return;
    try {
      const res = await fetch(
        `/api/activity-preferences?roomId=${encodeURIComponent(room.id)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as Array<{ estimatedCost: number | null }>;
      setActivityCosts(
        data
          .map((p) => p.estimatedCost)
          .filter((c): c is number => typeof c === "number"),
      );
    } catch { /* silent */ }
  }, [room?.id]);

  const fetchItineraryCosts = useCallback(async () => {
    if (!room?.id) return;
    try {
      const res = await fetch(
        `/api/agents/itinerary?roomId=${encodeURIComponent(room.id)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setItineraryCosts([]);
        return;
      }
      const data = (await res.json()) as {
        days: Array<{
          morning?: Array<{ estimatedCost?: number }>;
          afternoon?: Array<{ estimatedCost?: number }>;
          evening?: Array<{ estimatedCost?: number }>;
          night?: Array<{ estimatedCost?: number }>;
        }>;
      };
      const costs: number[] = [];
      for (const day of data.days ?? []) {
        for (const section of [day.morning, day.afternoon, day.evening, day.night]) {
          for (const item of section ?? []) {
            if (typeof item.estimatedCost === "number") costs.push(item.estimatedCost);
          }
        }
      }
      setItineraryCosts(costs);
    } catch { /* silent */ }
  }, [room?.id]);

  useEffect(() => {
    void fetchActivityCosts();
    void fetchItineraryCosts();
    const interval = setInterval(() => {
      void fetchActivityCosts();
      void fetchItineraryCosts();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchActivityCosts, fetchItineraryCosts]);

  // Poll availability every 10s to keep panel fresh after members submit
  useEffect(() => {
    if (!room?.id) return;
    const interval = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/availability?roomId=${encodeURIComponent(room.id)}`,
            { cache: "no-store" },
          );
          if (!res.ok) return;
          const data = (await res.json()) as {
            availability: Array<{ userId: string; startDate: string; endDate: string }>;
            destinationPreferences: Array<{ userId: string; countryOrCity: string }>;
          };
          if (data.availability.length > 0) {
            let minStart = "";
            let maxEnd = "";
            for (const a of data.availability) {
              if (!minStart || a.startDate < minStart) minStart = a.startDate;
              if (!maxEnd || a.endDate > maxEnd) maxEnd = a.endDate;
            }
            if (minStart && maxEnd) setTravelDates({ startDate: minStart, endDate: maxEnd });
          }
          if (data.destinationPreferences.length > 0) {
            const unique = [...new Set(data.destinationPreferences.map((p) => p.countryOrCity))];
            setDestinationShortlist(unique.length > 0 ? unique : null);
            const vibes = unique
              .filter((v) => v.startsWith("vibe:"))
              .map((v) => v.replace("vibe:", "").replace(/_/g, " "));
            setTravelVibes(vibes.length > 0 ? vibes : null);
          }
        } catch { /* silent */ }
      })();
    }, 10_000);
    return () => clearInterval(interval);
  }, [room?.id]);

  // Ensure this user is in the room DB row.
  const joinedRef = useRef(false);
  useEffect(() => {
    if (!room?.id || !identity || joinedRef.current) return;
    joinedRef.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: identity.userId,
            displayName: identity.displayName || "Traveller",
            roomId: room.id,
          }),
        });
        if (!res.ok) {
          console.log("[room] failed to upsert user:", await res.text());
          return;
        }
        if (IS_DEV) console.log("[room] upserted user:", identity.displayName);
        await broadcastMemberJoined(room.id);
      } catch (err) {
        console.log("[room] join error:", err);
      }
    })();
  }, [room?.id, identity]);

  // Broadcast member-left when the user navigates away or closes the tab.
  // Uses pagehide (fires reliably on mobile/bfcache) + beforeunload fallback.
  // sendBeacon is used so the message is sent even as the page unloads.
  useEffect(() => {
    if (!room?.id || !identity?.userId) return;
    const roomId = room.id;
    const userId = identity.userId;

    const handleLeave = () => {
      // Fire-and-forget; best-effort (page may be closing).
      void broadcastMemberLeft(roomId, userId);
    };

    window.addEventListener("pagehide", handleLeave);
    window.addEventListener("beforeunload", handleLeave);
    return () => {
      window.removeEventListener("pagehide", handleLeave);
      window.removeEventListener("beforeunload", handleLeave);
      // Also broadcast on React unmount (SPA navigation away from the room page).
      handleLeave();
    };
  }, [room?.id, identity?.userId]);

  // ── applyUpdate: called by RoomShell via onRoomUpdated ────────────────────
  // page.tsx owns the room state; RoomShell calls this whenever it detects a change.
  const applyUpdate = useCallback((updated: TripRoom) => {
    setRoom(updated);
  }, []);

  // ── Go back (host-only previous stage) ───────────────────────────────────
  const [goingBack, setGoingBack] = useState(false);

  const handleGoBack = useCallback(async () => {
    if (goingBack || !room || !identity) return;
    setGoingBack(true);
    try {
      const res = await fetch(`/api/rooms/${room.roomCode}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestingUserId: identity.userId,
          direction: "backward",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Failed to go back");
      }
      const updated = (await res.json()) as TripRoom;
      applyUpdate(updated);
      // Broadcast so other clients pick up the change immediately.
      void broadcastStageChangeFf(room.id);
    } finally {
      setGoingBack(false);
    }
  }, [goingBack, room, identity, applyUpdate]);

  const isHost = identity?.userId === room?.hostUserId;

  // ── Render: loading / error states ───────────────────────────────────────
  if (loadState === "loading" || !identity) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <p className="text-gray-600">Loading room {code}…</p>
      </main>
    );
  }

  if (loadState === "error" || !room) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-2xl font-bold">Room {code}</h1>
        <p className="text-red-600">{errorMessage}</p>
        <a className="text-blue-600 underline" href="/">
          Back to home
        </a>
      </main>
    );
  }

  // ── Render: RoomShell — TripAgentChat is wired inside RoomShell (task 12.2) ──
  return (
    <RoomShell
      room={room}
      identity={identity}
      members={members}
      characterProfiles={characterProfiles}
      onRoomUpdated={applyUpdate}
      onGoBack={isHost ? handleGoBack : undefined}
      travelDates={travelDates}
      travelVibes={travelVibes}
      destinationShortlist={destinationShortlist}
      selectedDestinationSuggestion={selectedDestinationSuggestion}
      tripLengthDays={tripLengthDays}
      activityCosts={activityCosts}
      itineraryCosts={itineraryCosts}
    />
  );
}

/** Fire-and-forget broadcast helper — never awaited by callers. */
async function broadcastStageChangeFf(roomId: string): Promise<void> {
  try {
    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${roomId}:stage`);
    await new Promise<void>((resolve) => {
      ch.subscribe((s) => {
        if (s === "SUBSCRIBED") resolve();
      });
    });
    await ch.send({ type: "broadcast", event: "stage-change", payload: {} });
    void supabase.removeChannel(ch);
  } catch {
    // best-effort — other clients will catch up via polling
  }
}
