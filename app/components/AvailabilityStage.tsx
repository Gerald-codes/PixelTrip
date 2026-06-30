"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { StageProps } from "@/app/components/StageRouter";
import CustomDestinationInput from "@/app/components/CustomDestinationInput";
import DestinationSuggestionPicker from "@/app/components/DestinationSuggestionPicker";
import TravelVibeSelector from "@/app/components/TravelVibeSelector";
import { broadcastMemberJoined } from "@/app/hooks/useRoomMembers";
import { buildDestinationInterests, hydrateFromPreferences } from "@/lib/destinationEncoding";
import { calculateOverlap, type DateRange } from "@/lib/overlap";
import { createAnonSupabase } from "@/lib/supabase";
import type { Availability, DestinationPreference, TravelVibe, TripRoom } from "@/lib/types";

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
  const [selectedVibes, setSelectedVibes] = useState<TravelVibe[]>([]);
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [customDestinations, setCustomDestinations] = useState<string[]>([]);
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
        const myPrefs = data.destinationPreferences.filter(
          (p) => p.userId === identity.userId,
        );
        const { vibes, chips, customs } = hydrateFromPreferences(myPrefs);
        if (myRanges.length > 0) setDraftRanges(myRanges);
        if (vibes.length > 0) setSelectedVibes(vibes);
        if (chips.length > 0) setSelectedChips(chips);
        if (customs.length > 0) setCustomDestinations(customs);
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

    const interests = buildDestinationInterests(selectedVibes, selectedChips, customDestinations);

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
      {/* Stage header card */}
      <div
        style={{
          border: "3px solid #1E3A5F",
          boxShadow: "4px 4px 0px #1E3A5F",
          backgroundColor: "#38BDF8",
          padding: "24px",
        }}
      >
        <p
          style={{
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "#1E3A5F",
            fontFamily: "monospace",
            fontWeight: 700,
          }}
        >
          ▶ Current stage
        </p>
        <h2
          className="mt-1 text-2xl font-bold"
          style={{ color: "#1E3A5F", fontFamily: "monospace" }}
        >
          Availability
        </h2>
        <p
          className="mt-2"
          style={{ color: "#1E3A5F", fontFamily: "monospace", fontSize: "0.875rem" }}
        >
          Share when you can travel and which countries or cities you&apos;re
          interested in. We&apos;ll find a window that works for everyone.
        </p>
      </div>

      {/* Date ranges card */}
      <div
        style={{
          border: "3px solid #1E3A5F",
          boxShadow: "4px 4px 0px #1E3A5F",
          backgroundColor: "#FEF3C7",
          padding: "24px",
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3
            className="text-lg font-semibold"
            style={{ color: "#1E3A5F", fontFamily: "monospace" }}
          >
            📅 Your dates
          </h3>
          {saving && (
            <span
              style={{
                fontSize: "0.75rem",
                color: "#FB923C",
                fontFamily: "monospace",
                fontWeight: 700,
              }}
            >
              Saving…
            </span>
          )}
        </div>

        <ul className="flex flex-col gap-3">
          {draftRanges.map((range, i) => (
            <li
              key={i}
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              style={{
                border: "2px solid #1E3A5F",
                backgroundColor: "#FEF3C7",
                padding: "12px",
                boxShadow: "2px 2px 0px #1E3A5F",
              }}
            >
              <label className="flex flex-1 flex-col text-sm">
                <span
                  className="mb-1"
                  style={{ color: "#1E3A5F", fontFamily: "monospace", fontWeight: 700 }}
                >
                  Start
                </span>
                <input
                  type="date"
                  value={range.startDate}
                  onChange={(e) =>
                    updateRange(i, { startDate: e.target.value })
                  }
                  style={{
                    border: "2px solid #1E3A5F",
                    borderRadius: 0,
                    backgroundColor: "#FEF3C7",
                    color: "#1E3A5F",
                    padding: "4px 8px",
                    fontFamily: "monospace",
                    fontSize: "0.875rem",
                    outline: "none",
                  }}
                  className="focus-visible:ring-2 focus-visible:ring-[#38BDF8] focus-visible:ring-offset-1"
                />
              </label>
              <label className="flex flex-1 flex-col text-sm">
                <span
                  className="mb-1"
                  style={{ color: "#1E3A5F", fontFamily: "monospace", fontWeight: 700 }}
                >
                  End
                </span>
                <input
                  type="date"
                  value={range.endDate}
                  onChange={(e) => updateRange(i, { endDate: e.target.value })}
                  style={{
                    border: "2px solid #1E3A5F",
                    borderRadius: 0,
                    backgroundColor: "#FEF3C7",
                    color: "#1E3A5F",
                    padding: "4px 8px",
                    fontFamily: "monospace",
                    fontSize: "0.875rem",
                    outline: "none",
                  }}
                  className="focus-visible:ring-2 focus-visible:ring-[#38BDF8] focus-visible:ring-offset-1"
                />
              </label>
              <button
                type="button"
                onClick={() => removeRange(i)}
                disabled={draftRanges.length === 1}
                style={{
                  border: "2px solid #1E3A5F",
                  borderRadius: 0,
                  backgroundColor: draftRanges.length === 1 ? "#FEF3C7" : "#FB923C",
                  color: "#1E3A5F",
                  padding: "4px 12px",
                  fontFamily: "monospace",
                  fontWeight: 700,
                  fontSize: "0.875rem",
                  cursor: draftRanges.length === 1 ? "not-allowed" : "pointer",
                  opacity: draftRanges.length === 1 ? 0.5 : 1,
                  boxShadow: draftRanges.length === 1 ? "none" : "2px 2px 0px #1E3A5F",
                  whiteSpace: "nowrap",
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={addRange}
          style={{
            marginTop: "12px",
            border: "2px dashed #1E3A5F",
            borderRadius: 0,
            backgroundColor: "transparent",
            color: "#1E3A5F",
            padding: "6px 16px",
            fontFamily: "monospace",
            fontWeight: 700,
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
          className="hover:bg-[#FEF3C7]"
        >
          + Add another date range
        </button>
      </div>

      {/* Destination discovery card */}
      <div
        style={{
          border: "3px solid #1E3A5F",
          boxShadow: "4px 4px 0px #1E3A5F",
          backgroundColor: "#FEF3C7",
          padding: "24px",
        }}
      >
        <h3
          className="mb-4 text-lg font-semibold"
          style={{ color: "#1E3A5F", fontFamily: "monospace" }}
        >
          🗺️ Where do you feel like going?
        </h3>
        <div className="flex flex-col gap-4">
          <TravelVibeSelector
            value={selectedVibes}
            onChange={setSelectedVibes}
            disabled={saving}
          />
          {selectedVibes.filter((v) => v !== "anywhere").length > 0 && (
            <div>
              <p
                style={{
                  fontSize: "0.75rem",
                  fontFamily: "monospace",
                  fontWeight: 700,
                  color: "#1E3A5F",
                  marginBottom: "8px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Suggested destinations
              </p>
              <DestinationSuggestionPicker
                selectedVibes={selectedVibes}
                value={selectedChips}
                onChange={setSelectedChips}
                disabled={saving}
              />
            </div>
          )}
          <div>
            <p
              style={{
                fontSize: "0.75rem",
                fontFamily: "monospace",
                fontWeight: 700,
                color: "#1E3A5F",
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Custom destinations
            </p>
            <CustomDestinationInput
              value={customDestinations}
              onChange={setCustomDestinations}
            />
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !hydrated}
          style={{
            border: "3px solid #1E3A5F",
            borderRadius: 0,
            backgroundColor: saving || !hydrated ? "#A855F7" : "#4ADE80",
            color: "#1E3A5F",
            padding: "10px 28px",
            fontFamily: "monospace",
            fontWeight: 700,
            fontSize: "1rem",
            cursor: saving || !hydrated ? "not-allowed" : "pointer",
            opacity: saving || !hydrated ? 0.6 : 1,
            boxShadow: saving || !hydrated ? "none" : "4px 4px 0px #1E3A5F",
            transition: "opacity 0.1s",
          }}
        >
          {saving ? "Saving…" : "💾 Save"}
        </button>
        {saveError && (
          <p
            style={{
              fontSize: "0.875rem",
              color: "#FB923C",
              fontFamily: "monospace",
              fontWeight: 700,
              border: "2px solid #FB923C",
              padding: "6px 10px",
              backgroundColor: "#FEF3C7",
            }}
          >
            ⚠ {saveError}
          </p>
        )}
      </div>

      {/* Group overlap card */}
      <div
        style={{
          border: "3px solid #1E3A5F",
          boxShadow: "4px 4px 0px #1E3A5F",
          backgroundColor: "#FEF3C7",
          padding: "24px",
        }}
      >
        <h3
          className="mb-3 text-lg font-semibold"
          style={{ color: "#1E3A5F", fontFamily: "monospace" }}
        >
          🔗 Group overlap
        </h3>
        {groupError ? (
          <p
            style={{
              fontSize: "0.875rem",
              color: "#FB923C",
              fontFamily: "monospace",
              fontWeight: 700,
            }}
          >
            ⚠ {groupError}
          </p>
        ) : !groupData ? (
          <p style={{ fontSize: "0.875rem", color: "#1E3A5F", fontFamily: "monospace" }}>
            Loading group availability…
          </p>
        ) : !allSubmitted ? (
          <p style={{ fontSize: "0.875rem", color: "#1E3A5F", fontFamily: "monospace" }}>
            ⏳ Waiting on {waitingOnCount}{" "}
            {waitingOnCount === 1 ? "member" : "members"}…
          </p>
        ) : overlap ? (
          <p
            style={{
              fontSize: "0.875rem",
              fontFamily: "monospace",
              color: "#1E3A5F",
            }}
          >
            <span style={{ fontWeight: 700, color: "#4ADE80" }}>✓ Overlap found:</span>{" "}
            <span
              style={{
                backgroundColor: "#4ADE80",
                border: "2px solid #1E3A5F",
                padding: "2px 6px",
                fontWeight: 700,
              }}
            >
              {overlap.startDate}
            </span>
            {" "}→{" "}
            <span
              style={{
                backgroundColor: "#4ADE80",
                border: "2px solid #1E3A5F",
                padding: "2px 6px",
                fontWeight: 700,
              }}
            >
              {overlap.endDate}
            </span>
          </p>
        ) : (
          <p
            style={{
              fontSize: "0.875rem",
              color: "#FB923C",
              fontFamily: "monospace",
              fontWeight: 700,
            }}
          >
            ✗ No overlap found — adjust your dates so the group shares at least
            one common day.
          </p>
        )}
      </div>

      {/* Submissions card */}
      <div
        style={{
          border: "3px solid #1E3A5F",
          boxShadow: "4px 4px 0px #1E3A5F",
          backgroundColor: "#FEF3C7",
          padding: "24px",
        }}
      >
        <h3
          className="mb-3 text-lg font-semibold"
          style={{ color: "#1E3A5F", fontFamily: "monospace" }}
        >
          👥 Submissions
        </h3>
        {members.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "#1E3A5F", fontFamily: "monospace" }}>
            No members yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {members.map((member) => {
              const submission = submissionsByUser.get(member.id);
              const isSelf = member.id === identity.userId;
              return (
                <li
                  key={member.id}
                  style={{
                    border: "2px solid #1E3A5F",
                    backgroundColor: isSelf ? "#38BDF8" : "#FEF3C7",
                    padding: "10px 14px",
                    boxShadow: "2px 2px 0px #1E3A5F",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      style={{
                        fontFamily: "monospace",
                        fontWeight: 700,
                        color: "#1E3A5F",
                        fontSize: "0.875rem",
                      }}
                    >
                      {member.displayName || "Traveller"}
                      {isSelf && (
                        <span
                          style={{
                            marginLeft: "6px",
                            fontWeight: 400,
                            color: "#1E3A5F",
                            opacity: 0.65,
                          }}
                        >
                          (you)
                        </span>
                      )}
                    </span>
                    {!submission && (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontFamily: "monospace",
                          color: "#FB923C",
                          fontWeight: 700,
                          border: "1px solid #FB923C",
                          padding: "2px 6px",
                          backgroundColor: "#FEF3C7",
                        }}
                      >
                        Not yet submitted
                      </span>
                    )}
                    {submission && (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontFamily: "monospace",
                          color: "#1E3A5F",
                          fontWeight: 700,
                          border: "1px solid #4ADE80",
                          padding: "2px 6px",
                          backgroundColor: "#4ADE80",
                        }}
                      >
                        ✓ Submitted
                      </span>
                    )}
                  </div>
                  {submission && (
                    <div
                      className="mt-2"
                      style={{
                        fontSize: "0.8125rem",
                        fontFamily: "monospace",
                        color: "#1E3A5F",
                      }}
                    >
                      <p>
                        <span style={{ fontWeight: 700 }}>Dates: </span>
                        {submission.ranges
                          .map((r) => `${r.startDate} → ${r.endDate}`)
                          .join(", ")}
                      </p>
                      <p className="mt-1">
                        <span style={{ fontWeight: 700 }}>Interests: </span>
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

      {/* Host advance / waiting message */}
      {isHost ? (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => void handleAdvance()}
            disabled={advancing || !canAdvance}
            style={{
              border: "3px solid #1E3A5F",
              borderRadius: 0,
              backgroundColor: advancing || !canAdvance ? "#FEF3C7" : "#FB923C",
              color: "#1E3A5F",
              padding: "10px 28px",
              fontFamily: "monospace",
              fontWeight: 700,
              fontSize: "1rem",
              cursor: advancing || !canAdvance ? "not-allowed" : "pointer",
              opacity: advancing || !canAdvance ? 0.6 : 1,
              boxShadow: advancing || !canAdvance ? "none" : "4px 4px 0px #1E3A5F",
              transition: "opacity 0.1s",
            }}
          >
            {advancing ? "Advancing…" : "▶ Advance stage"}
          </button>
          {!canAdvance && !advanceError && (
            <p
              style={{
                fontSize: "0.75rem",
                fontFamily: "monospace",
                color: "#1E3A5F",
                opacity: 0.7,
              }}
            >
              {!allSubmitted
                ? "⏳ Waiting for every member to submit."
                : "✗ No overlap yet — adjust dates before advancing."}
            </p>
          )}
          {advanceError && (
            <p
              style={{
                fontSize: "0.875rem",
                color: "#FB923C",
                fontFamily: "monospace",
                fontWeight: 700,
                border: "2px solid #FB923C",
                padding: "6px 10px",
                backgroundColor: "#FEF3C7",
              }}
            >
              ⚠ {advanceError}
            </p>
          )}
        </div>
      ) : (
        <p
          style={{
            fontSize: "0.875rem",
            fontFamily: "monospace",
            color: "#1E3A5F",
            border: "2px solid #1E3A5F",
            padding: "10px 16px",
            backgroundColor: "#FEF3C7",
            boxShadow: "2px 2px 0px #1E3A5F",
          }}
        >
          ⏳ Waiting for the host to advance to the next stage…
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
