"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { StageProps } from "@/app/components/StageRouter";
import { broadcastMemberJoined } from "@/app/hooks/useRoomMembers";
import { calculateOverlap, type DateRange } from "@/lib/overlap";
import { createAnonSupabase } from "@/lib/supabase";
import type { Availability, DestinationPreference, TripRoom } from "@/lib/types";

/**
 * AvailabilityStage — each member submits their available date ranges and the
 * countries or cities they'd like to visit. The stage shows the live group
 * overlap as submissions arrive and gates the host's "Advance stage" control
 * on a real common window existing.
 *
 * The overlap itself is computed client-side from the per-user availability
 * rows (grouped by user) via `calculateOverlap`. We refetch the full
 * availability list on mount and after every save, and piggy-back on the
 * existing `member-joined` broadcast to nudge other clients to refetch their
 * member list (which in turn triggers their own polled refresh of this stage).
 */

interface DraftRange {
  startDate: string;
  endDate: string;
}

interface AvailabilityResponse {
  availability: Availability[];
  destinationPreferences: DestinationPreference[];
}

export default function AvailabilityStage({
  room,
  identity,
  members,
  onRoomUpdated,
}: StageProps) {
  const isHost = identity.userId === room.hostUserId;

  // ── Draft form (this user's input) ───────────────────────────────────────────
  const [draftRanges, setDraftRanges] = useState<DraftRange[]>([
    { startDate: "", endDate: "" },
  ]);
  const [draftInterestsText, setDraftInterestsText] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Group submissions ────────────────────────────────────────────────────────
  const [groupData, setGroupData] = useState<AvailabilityResponse | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);

  const fetchGroup =
    useCallback(async (): Promise<AvailabilityResponse | null> => {
      try {
        const res = await fetch(
          `/api/availability?roomId=${encodeURIComponent(room.id)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          throw new Error("Failed to load group availability");
        }
        const data = (await res.json()) as AvailabilityResponse;
        setGroupData(data);
        setGroupError(null);
        return data;
      } catch (err) {
        setGroupError(
          err instanceof Error
            ? err.message
            : "Failed to load group availability",
        );
        return null;
      }
    }, [room.id]);

  // Initial fetch + one-time hydration of the form with this user's existing
  // submission (if any) so they can edit rather than start over.
  const hydrateRef = useRef(false);
  useEffect(() => {
    if (hydrateRef.current) return;
    hydrateRef.current = true;
    void (async () => {
      const data = await fetchGroup();
      if (data) {
        const myRanges = data.availability
          .filter((a) => a.userId === identity.userId)
          .map((a) => ({ startDate: a.startDate, endDate: a.endDate }));
        const myInterests = data.destinationPreferences
          .filter((p) => p.userId === identity.userId)
          .map((p) => p.countryOrCity);
        if (myRanges.length > 0) setDraftRanges(myRanges);
        if (myInterests.length > 0) {
          setDraftInterestsText(myInterests.join(", "));
        }
      }
      setHydrated(true);
    })();
  }, [fetchGroup, identity.userId]);

  // Poll every 4 s so every member's tab picks up other members' submissions
  // without waiting for a broadcast. The broadcast from handleSave is still
  // sent as a fast path, but the poll is the reliable fallback.
  const fetchGroupRef = useRef(fetchGroup);
  fetchGroupRef.current = fetchGroup;
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchGroupRef.current();
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // ── Form handlers ────────────────────────────────────────────────────────────
  function updateRange(index: number, patch: Partial<DraftRange>) {
    setDraftRanges((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }
  function addRange() {
    setDraftRanges((prev) => [...prev, { startDate: "", endDate: "" }]);
  }
  function removeRange(index: number) {
    setDraftRanges((prev) =>
      prev.length === 1 ? prev : prev.filter((_, i) => i !== index),
    );
  }

  function parseInterests(text: string): string[] {
    return text
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async function handleSave() {
    if (saving) return;
    setSaveError(null);

    // Local validation mirrors what the API enforces — gives instant feedback.
    const ranges = draftRanges
      .map((r) => ({
        startDate: r.startDate.trim(),
        endDate: r.endDate.trim(),
      }))
      .filter((r) => r.startDate !== "" || r.endDate !== "");
    if (ranges.length === 0) {
      setSaveError("Add at least one date range before saving.");
      return;
    }
    for (let i = 0; i < ranges.length; i += 1) {
      const r = ranges[i];
      if (!r.startDate || !r.endDate) {
        setSaveError(`Range ${i + 1} is missing a start or end date.`);
        return;
      }
      if (r.endDate < r.startDate) {
        setSaveError(`Range ${i + 1} ends before it starts.`);
        return;
      }
    }

    const interests = parseInterests(draftInterestsText);

    setSaving(true);
    try {
      const res = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: identity.userId,
          roomId: room.id,
          dateRanges: ranges,
          destinationInterests: interests,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Failed to save availability");
      }
      // Refresh local view + nudge other clients to refetch.
      await fetchGroup();
      await broadcastMemberJoined(room.id);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save availability",
      );
    } finally {
      setSaving(false);
    }
  }

  // ── Derived: who submitted, overlap, per-member breakdown ────────────────────
  const submittedUserIds = useMemo(() => {
    if (!groupData) return new Set<string>();
    return new Set(groupData.availability.map((a) => a.userId));
  }, [groupData]);

  const allSubmitted =
    members.length > 0 && members.every((m) => submittedUserIds.has(m.id));

  const overlap: DateRange | null = useMemo(() => {
    if (!groupData || !allSubmitted) return null;
    const byUser = new Map<string, DateRange[]>();
    for (const a of groupData.availability) {
      const list = byUser.get(a.userId) ?? [];
      list.push({ startDate: a.startDate, endDate: a.endDate });
      byUser.set(a.userId, list);
    }
    return calculateOverlap(byUser);
  }, [groupData, allSubmitted]);

  const submissionsByUser = useMemo(() => {
    const map = new Map<
      string,
      { ranges: DateRange[]; interests: string[] }
    >();
    if (!groupData) return map;
    for (const a of groupData.availability) {
      const entry = map.get(a.userId) ?? { ranges: [], interests: [] };
      entry.ranges.push({ startDate: a.startDate, endDate: a.endDate });
      map.set(a.userId, entry);
    }
    for (const p of groupData.destinationPreferences) {
      const entry = map.get(p.userId) ?? { ranges: [], interests: [] };
      entry.interests.push(p.countryOrCity);
      map.set(p.userId, entry);
    }
    return map;
  }, [groupData]);

  const waitingOnCount = Math.max(0, members.length - submittedUserIds.size);

  // ── Host advance ─────────────────────────────────────────────────────────────
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const canAdvance = allSubmitted && overlap !== null;

  async function handleAdvance() {
    setAdvancing(true);
    setAdvanceError(null);
    try {
      const res = await fetch(`/api/rooms/${room.roomCode}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestingUserId: identity.userId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        throw new Error(body?.message ?? body?.error ?? "Failed to advance stage");
      }
      const updated = (await res.json()) as TripRoom;
      onRoomUpdated(updated);
      void broadcastStageChange(room.id);
    } catch (err) {
      setAdvanceError(
        err instanceof Error ? err.message : "Failed to advance stage",
      );
    } finally {
      setAdvancing(false);
    }
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="rounded-lg border border-gray-200 p-6">
        <p className="text-sm uppercase tracking-wide text-gray-500">
          Current stage
        </p>
        <h2 className="mt-1 text-2xl font-bold">Availability</h2>
        <p className="mt-2 text-gray-600">
          Share when you can travel and which countries or cities you&apos;re
          interested in. We&apos;ll find a window that works for everyone.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Your dates</h3>
          {saving && <span className="text-xs text-gray-500">Saving…</span>}
        </div>

        <ul className="flex flex-col gap-3">
          {draftRanges.map((range, i) => (
            <li
              key={i}
              className="flex flex-col gap-2 rounded-md bg-gray-50 p-3 sm:flex-row sm:items-end"
            >
              <label className="flex flex-1 flex-col text-sm">
                <span className="mb-1 text-gray-600">Start</span>
                <input
                  type="date"
                  value={range.startDate}
                  onChange={(e) =>
                    updateRange(i, { startDate: e.target.value })
                  }
                  className="rounded border border-gray-300 px-2 py-1"
                />
              </label>
              <label className="flex flex-1 flex-col text-sm">
                <span className="mb-1 text-gray-600">End</span>
                <input
                  type="date"
                  value={range.endDate}
                  onChange={(e) => updateRange(i, { endDate: e.target.value })}
                  className="rounded border border-gray-300 px-2 py-1"
                />
              </label>
              <button
                type="button"
                onClick={() => removeRange(i)}
                disabled={draftRanges.length === 1}
                className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={addRange}
          className="mt-3 rounded border border-dashed border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
        >
          + Add another date range
        </button>
      </div>

      <div className="rounded-lg border border-gray-200 p-6">
        <h3 className="mb-2 text-lg font-semibold">
          Countries or cities you&apos;d like to visit
        </h3>
        <p className="mb-3 text-sm text-gray-500">
          Separate multiple destinations with commas (e.g. &ldquo;Tokyo, Lisbon,
          Iceland&rdquo;).
        </p>
        <textarea
          value={draftInterestsText}
          onChange={(e) => setDraftInterestsText(e.target.value)}
          rows={3}
          placeholder="Tokyo, Lisbon, Iceland"
          className="w-full rounded border border-gray-300 px-2 py-1"
        />
      </div>

      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !hydrated}
          className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saveError && <p className="text-sm text-red-600">{saveError}</p>}
      </div>

      <div className="rounded-lg border border-gray-200 p-6">
        <h3 className="mb-3 text-lg font-semibold">Group overlap</h3>
        {groupError ? (
          <p className="text-sm text-red-600">{groupError}</p>
        ) : !groupData ? (
          <p className="text-sm text-gray-500">Loading group availability…</p>
        ) : !allSubmitted ? (
          <p className="text-sm text-gray-600">
            Waiting on {waitingOnCount}{" "}
            {waitingOnCount === 1 ? "member" : "members"}…
          </p>
        ) : overlap ? (
          <p className="text-sm">
            <span className="font-medium text-green-700">Overlap:</span>{" "}
            <span className="font-mono">{overlap.startDate}</span> to{" "}
            <span className="font-mono">{overlap.endDate}</span>
          </p>
        ) : (
          <p className="text-sm text-red-600">
            No overlap found — adjust your dates so the group shares at least
            one common day.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 p-6">
        <h3 className="mb-3 text-lg font-semibold">Submissions</h3>
        {members.length === 0 ? (
          <p className="text-sm text-gray-500">No members yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {members.map((member) => {
              const submission = submissionsByUser.get(member.id);
              const isSelf = member.id === identity.userId;
              return (
                <li key={member.id} className="rounded-md bg-gray-50 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {member.displayName || "Traveller"}
                      {isSelf && (
                        <span className="ml-1 text-gray-400">(you)</span>
                      )}
                    </span>
                    {!submission && (
                      <span className="text-xs text-gray-500">
                        Not yet submitted
                      </span>
                    )}
                  </div>
                  {submission && (
                    <div className="mt-1 text-sm text-gray-700">
                      <p>
                        <span className="text-gray-500">Dates: </span>
                        {submission.ranges
                          .map((r) => `${r.startDate} → ${r.endDate}`)
                          .join(", ")}
                      </p>
                      <p>
                        <span className="text-gray-500">Interests: </span>
                        {submission.interests.length > 0
                          ? submission.interests.join(", ")
                          : "(none)"}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isHost ? (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => void handleAdvance()}
            disabled={advancing || !canAdvance}
            className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {advancing ? "Advancing…" : "Advance stage"}
          </button>
          {!canAdvance && !advanceError && (
            <p className="text-xs text-gray-500">
              {!allSubmitted
                ? "Waiting for every member to submit."
                : "No overlap yet — adjust dates before advancing."}
            </p>
          )}
          {advanceError && (
            <p className="text-sm text-red-600">{advanceError}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          Waiting for the host to advance to the next stage…
        </p>
      )}
    </section>
  );
}

/**
 * Broadcast a `stage-change` event so every connected client re-fetches the
 * room. Mirrors the helper in `LobbyStage`.
 */
async function broadcastStageChange(roomId: string): Promise<void> {
  const supabase = createAnonSupabase();
  const channel = supabase.channel(`room:${roomId}:stage`);
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
  await channel.send({ type: "broadcast", event: "stage-change", payload: {} });
  void supabase.removeChannel(channel);
}
