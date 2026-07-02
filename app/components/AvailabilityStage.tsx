"use client";

/**
 * AvailabilityStage — unified form: dates + vibes + destinations in one submit.
 *
 * All three sections are visible at once. The "Submit availability" button
 * requires both valid dates AND at least one destination before submitting.
 *
 * Validation:
 *   - Missing start/end date → inline error, blocks submission
 *   - No destination selected → inline error, blocks submission
 *
 * On successful save: calls onRoomUpdated so TripAgentChat can intercept
 * and append a summary AgentMessage.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";

import type { StageProps } from "@/app/components/StageRouter";
import CustomDestinationInput from "@/app/components/CustomDestinationInput";
import DestinationSuggestionPicker from "@/app/components/DestinationSuggestionPicker";
import TravelVibeSelector from "@/app/components/TravelVibeSelector";
import { broadcastMemberJoined } from "@/app/hooks/useRoomMembers";
import { buildDestinationInterests, hydrateFromPreferences } from "@/lib/destinationEncoding";
import { calculateOverlap, type DateRange } from "@/lib/overlap";
import type { Availability, DestinationPreference, TravelVibe } from "@/lib/types";

// ─── Palette ──────────────────────────────────────────────────────────────────

const DEEP_NAVY = "#1E3A5F";
const SAND_CREAM = "#FEF3C7";
const GRASS_GREEN = "#4ADE80";
const SUNSET_ORANGE = "#FB923C";
const SKY_BLUE = "#38BDF8";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  // ── Draft form ────────────────────────────────────────────────────────────
  const [draftRanges, setDraftRanges] = useState<DraftRange[]>([
    { startDate: "", endDate: "" },
  ]);
  const [selectedVibes, setSelectedVibes] = useState<TravelVibe[]>([]);
  const [selectedChips, setSelectedChips] = useState<string[]>([]);
  const [customDestinations, setCustomDestinations] = useState<string[]>([]);
  const [customExpanded, setCustomExpanded] = useState(false);

  // ── Save state ────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // ── Group submissions ─────────────────────────────────────────────────────
  const [groupData, setGroupData] = useState<AvailabilityResponse | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);

  const fetchGroup = useCallback(async (): Promise<AvailabilityResponse | null> => {
    try {
      const res = await fetch(
        `/api/availability?roomId=${encodeURIComponent(room.id)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Failed to load group availability");
      const data = (await res.json()) as AvailabilityResponse;
      setGroupData(data);
      setGroupError(null);
      return data;
    } catch (err) {
      setGroupError(
        err instanceof Error ? err.message : "Failed to load group availability",
      );
      return null;
    }
  }, [room.id]);

  // Initial fetch + hydration of existing submission
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
        if (myRanges.length > 0) {
          setDraftRanges(myRanges);
        }
        if (vibes.length > 0) setSelectedVibes(vibes);
        if (chips.length > 0) setSelectedChips(chips);
        if (customs.length > 0) setCustomDestinations(customs);
        // If they already had a full submission, mark as submitted
        if (myRanges.length > 0) {
          setSubmitted(true);
        }
      }
    })();
  }, [fetchGroup, identity.userId]);

  // Poll every 4s to pick up other members' submissions
  const fetchGroupRef = useRef(fetchGroup);
  fetchGroupRef.current = fetchGroup;
  useEffect(() => {
    const interval = setInterval(() => void fetchGroupRef.current(), 4000);
    return () => clearInterval(interval);
  }, []);

  // ── Date range helpers ────────────────────────────────────────────────────
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

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): string | null {
    const ranges = draftRanges
      .map((r) => ({ startDate: r.startDate.trim(), endDate: r.endDate.trim() }))
      .filter((r) => r.startDate !== "" || r.endDate !== "");
    if (ranges.length === 0) return "Add at least one date range.";
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (!r.startDate || !r.endDate)
        return `Date range ${i + 1} is missing a start or end date.`;
      if (r.endDate < r.startDate)
        return `Date range ${i + 1} ends before it starts.`;
    }
    // Destinations are optional — vibes alone are enough
    return null;
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (saving) return;
    setSubmitError(null);

    const error = validate();
    if (error) {
      setSubmitError(error);
      return;
    }

    const ranges = draftRanges
      .map((r) => ({ startDate: r.startDate.trim(), endDate: r.endDate.trim() }))
      .filter((r) => r.startDate !== "" && r.endDate !== "");

    const interests = buildDestinationInterests(
      selectedVibes,
      selectedChips,
      customDestinations,
    );

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
      await fetchGroup();
      await broadcastMemberJoined(room.id);
      setSubmitted(true);
      // Notify TripAgentChat — it intercepts this to append summary + mark submitted
      onRoomUpdated({ ...room });
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to save. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  // ── Derived: who submitted, overlap ──────────────────────────────────────
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

  const waitingOnCount = Math.max(0, members.length - submittedUserIds.size);
  const allDestinations = [...selectedChips, ...customDestinations];

  // ── Styles ────────────────────────────────────────────────────────────────
  function cardStyle(bg: string = SAND_CREAM): React.CSSProperties {
    return {
      border: `3px solid ${DEEP_NAVY}`,
      boxShadow: `4px 4px 0 ${DEEP_NAVY}`,
      backgroundColor: bg,
      padding: "20px",
    };
  }

  const submitBtnStyle: React.CSSProperties = {
    border: `3px solid ${DEEP_NAVY}`,
    borderRadius: 0,
    backgroundColor: saving ? DEEP_NAVY : GRASS_GREEN,
    color: DEEP_NAVY,
    padding: "10px 28px",
    fontFamily: "'Courier New', Courier, monospace",
    fontWeight: 700,
    fontSize: "1rem",
    cursor: saving ? "not-allowed" : "pointer",
    opacity: saving ? 0.6 : 1,
    boxShadow: saving ? "none" : `4px 4px 0 ${DEEP_NAVY}`,
    transition: "opacity 0.1s",
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 680,
      }}
    >
      {/* ── Section 1: Date ranges ─────────────────────────────────────────── */}
      <div style={cardStyle(SAND_CREAM)}>
        <h3
          style={{
            color: DEEP_NAVY,
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: "1rem",
            fontWeight: 700,
            marginBottom: 12,
          }}
        >
          📅 Your available dates
        </h3>

        <ul
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            listStyle: "none",
            padding: 0,
            margin: 0,
          }}
        >
          {draftRanges.map((range, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-end",
                border: `2px solid ${DEEP_NAVY}`,
                backgroundColor: SAND_CREAM,
                padding: "10px",
                boxShadow: `2px 2px 0 ${DEEP_NAVY}`,
                flexWrap: "wrap",
              }}
            >
              <label
                style={{ display: "flex", flexDirection: "column", flex: 1, gap: 4 }}
              >
                <span
                  style={{
                    color: DEEP_NAVY,
                    fontFamily: "'Courier New', Courier, monospace",
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  Start
                </span>
                <input
                  type="date"
                  value={range.startDate}
                  onChange={(e) => updateRange(i, { startDate: e.target.value })}
                  disabled={saving || submitted}
                  aria-label={`Start date for range ${i + 1}`}
                  style={{
                    border: `2px solid ${DEEP_NAVY}`,
                    borderRadius: 0,
                    backgroundColor: SAND_CREAM,
                    color: DEEP_NAVY,
                    padding: "4px 8px",
                    fontFamily: "'Courier New', Courier, monospace",
                    fontSize: "0.875rem",
                    outline: "none",
                  }}
                />
              </label>
              <label
                style={{ display: "flex", flexDirection: "column", flex: 1, gap: 4 }}
              >
                <span
                  style={{
                    color: DEEP_NAVY,
                    fontFamily: "'Courier New', Courier, monospace",
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  End
                </span>
                <input
                  type="date"
                  value={range.endDate}
                  onChange={(e) => updateRange(i, { endDate: e.target.value })}
                  disabled={saving || submitted}
                  aria-label={`End date for range ${i + 1}`}
                  style={{
                    border: `2px solid ${DEEP_NAVY}`,
                    borderRadius: 0,
                    backgroundColor: SAND_CREAM,
                    color: DEEP_NAVY,
                    padding: "4px 8px",
                    fontFamily: "'Courier New', Courier, monospace",
                    fontSize: "0.875rem",
                    outline: "none",
                  }}
                />
              </label>
              {!submitted && (
                <button
                  type="button"
                  onClick={() => removeRange(i)}
                  disabled={draftRanges.length === 1 || saving}
                  aria-label={`Remove date range ${i + 1}`}
                  style={{
                    border: `2px solid ${DEEP_NAVY}`,
                    borderRadius: 0,
                    backgroundColor:
                      draftRanges.length === 1 ? SAND_CREAM : SUNSET_ORANGE,
                    color: DEEP_NAVY,
                    padding: "4px 12px",
                    fontFamily: "'Courier New', Courier, monospace",
                    fontWeight: 700,
                    fontSize: "0.875rem",
                    cursor: draftRanges.length === 1 ? "not-allowed" : "pointer",
                    opacity: draftRanges.length === 1 ? 0.5 : 1,
                    boxShadow:
                      draftRanges.length === 1 ? "none" : `2px 2px 0 ${DEEP_NAVY}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>

        {!submitted && (
          <button
            type="button"
            onClick={addRange}
            disabled={saving}
            aria-label="Add another date range"
            style={{
              marginTop: 10,
              border: `2px dashed ${DEEP_NAVY}`,
              borderRadius: 0,
              backgroundColor: "transparent",
              color: DEEP_NAVY,
              padding: "6px 16px",
              fontFamily: "'Courier New', Courier, monospace",
              fontWeight: 700,
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            + Add another date range
          </button>
        )}
      </div>

      {/* ── Section 2: Travel vibes ────────────────────────────────────────── */}
      <div style={cardStyle(SAND_CREAM)}>
        <h3
          style={{
            color: DEEP_NAVY,
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: "1rem",
            fontWeight: 700,
            marginBottom: 12,
          }}
        >
          ✈️ Where do you feel like going?
        </h3>
        <TravelVibeSelector
          value={selectedVibes}
          onChange={setSelectedVibes}
          disabled={submitted}
        />
      </div>

      {/* ── Section 3: Destination chips + custom input ────────────────────── */}
      <div style={cardStyle(SAND_CREAM)}>
        <h3
          style={{
            color: DEEP_NAVY,
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: "1rem",
            fontWeight: 700,
            marginBottom: 12,
          }}
        >
          📍 Pick your destinations{" "}
          <span style={{ fontWeight: 400, opacity: 0.6, fontSize: "0.875rem" }}>(optional)</span>
        </h3>

        {selectedVibes.length === 0 ? (
          <p
            style={{
              fontSize: "0.875rem",
              fontFamily: "'Courier New', Courier, monospace",
              color: DEEP_NAVY,
              opacity: 0.6,
              fontStyle: "italic",
            }}
          >
            Optional — select a travel vibe above to see destination suggestions.
          </p>
        ) : (
          <DestinationSuggestionPicker
            selectedVibes={selectedVibes}
            value={selectedChips}
            onChange={setSelectedChips}
            disabled={submitted}
          />
        )}

        {/* Custom destination collapsible — always visible */}
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() => setCustomExpanded((prev) => !prev)}
            aria-expanded={customExpanded}
            disabled={submitted}
            style={{
              border: `2px dashed ${DEEP_NAVY}`,
              borderRadius: 0,
              backgroundColor: "transparent",
              color: DEEP_NAVY,
              padding: "6px 14px",
              fontFamily: "'Courier New', Courier, monospace",
              fontWeight: 700,
              fontSize: "0.875rem",
              cursor: submitted ? "default" : "pointer",
              opacity: submitted ? 0.5 : 1,
            }}
          >
            {customExpanded ? "▲ Hide custom destination" : "▼ Add a custom destination"}
          </button>
          {customExpanded && (
            <div style={{ marginTop: 10 }}>
              <CustomDestinationInput
                value={customDestinations}
                onChange={setCustomDestinations}
              />
            </div>
          )}
        </div>

        {/* Selected destinations summary */}
        {allDestinations.length > 0 && (
          <p
            style={{
              marginTop: 10,
              fontSize: "0.8125rem",
              fontFamily: "'Courier New', Courier, monospace",
              color: DEEP_NAVY,
              opacity: 0.8,
            }}
          >
            Selected: {allDestinations.join(", ")}
          </p>
        )}
      </div>

      {/* ── Submit button ──────────────────────────────────────────────────── */}
      {!submitted ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            alignItems: "flex-start",
          }}
        >
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving}
            aria-label={saving ? "Submitting…" : "Submit your availability"}
            style={submitBtnStyle}
          >
            {saving ? "Submitting…" : "✔ Submit availability"}
          </button>
          {submitError && (
            <p
              style={{
                fontSize: "0.875rem",
                color: SUNSET_ORANGE,
                fontFamily: "'Courier New', Courier, monospace",
                fontWeight: 700,
                border: `2px solid ${SUNSET_ORANGE}`,
                padding: "6px 10px",
                backgroundColor: SAND_CREAM,
              }}
            >
              ⚠ {submitError}
            </p>
          )}
        </div>
      ) : (
        <div
          style={{
            border: `3px solid ${GRASS_GREEN}`,
            backgroundColor: SAND_CREAM,
            boxShadow: `4px 4px 0 ${DEEP_NAVY}`,
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              fontFamily: "'Courier New', Courier, monospace",
              fontWeight: 700,
              color: DEEP_NAVY,
              fontSize: "0.875rem",
            }}
          >
            ✓ Availability submitted! Waiting for others…
          </span>
          <button
            type="button"
            onClick={() => setSubmitted(false)}
            style={{
              border: `2px solid ${DEEP_NAVY}`,
              borderRadius: 0,
              backgroundColor: SUNSET_ORANGE,
              color: DEEP_NAVY,
              padding: "4px 12px",
              fontFamily: "'Courier New', Courier, monospace",
              fontWeight: 700,
              fontSize: "0.75rem",
              cursor: "pointer",
              boxShadow: `2px 2px 0 ${DEEP_NAVY}`,
            }}
          >
            ← Edit
          </button>
        </div>
      )}

      {/* ── Per-member submission status ───────────────────────────────────── */}
      <div style={cardStyle(SAND_CREAM)}>
        <h3
          style={{
            color: DEEP_NAVY,
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: "1rem",
            fontWeight: 700,
            marginBottom: 10,
          }}
        >
          👥 Group status
        </h3>
        {groupError ? (
          <p
            style={{
              fontSize: "0.875rem",
              color: SUNSET_ORANGE,
              fontFamily: "'Courier New', Courier, monospace",
              fontWeight: 700,
            }}
          >
            ⚠ {groupError}
          </p>
        ) : members.length === 0 ? (
          <p
            style={{
              fontSize: "0.875rem",
              color: DEEP_NAVY,
              fontFamily: "'Courier New', Courier, monospace",
            }}
          >
            No members yet.
          </p>
        ) : (
          <ul
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              listStyle: "none",
              padding: 0,
              margin: 0,
            }}
          >
            {members.map((member) => {
              const isSubmitted = submittedUserIds.has(member.id);
              const isSelf = member.id === identity.userId;
              return (
                <li
                  key={member.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    border: `2px solid ${DEEP_NAVY}`,
                    backgroundColor: isSelf ? SKY_BLUE : SAND_CREAM,
                    padding: "8px 12px",
                    boxShadow: `2px 2px 0 ${DEEP_NAVY}`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Courier New', Courier, monospace",
                      fontWeight: 700,
                      color: DEEP_NAVY,
                      fontSize: "0.875rem",
                    }}
                  >
                    {member.displayName || "Traveller"}
                    {isSelf && (
                      <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.65 }}>
                        (you)
                      </span>
                    )}
                  </span>
                  {isSubmitted ? (
                    <span
                      style={{
                        fontSize: "0.75rem",
                        fontFamily: "'Courier New', Courier, monospace",
                        color: DEEP_NAVY,
                        fontWeight: 700,
                        border: `1px solid ${GRASS_GREEN}`,
                        padding: "2px 6px",
                        backgroundColor: GRASS_GREEN,
                      }}
                    >
                      ✓ Submitted
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: "0.75rem",
                        fontFamily: "'Courier New', Courier, monospace",
                        color: SUNSET_ORANGE,
                        fontWeight: 700,
                        border: `1px solid ${SUNSET_ORANGE}`,
                        padding: "2px 6px",
                        backgroundColor: SAND_CREAM,
                      }}
                    >
                      … Pending
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Group overlap (once all submitted) */}
        {allSubmitted && (
          <div style={{ marginTop: 12 }}>
            {overlap ? (
              <p
                style={{
                  fontSize: "0.875rem",
                  fontFamily: "'Courier New', Courier, monospace",
                  color: DEEP_NAVY,
                }}
              >
                <span style={{ fontWeight: 700, color: GRASS_GREEN }}>
                  ✓ Overlap found:{" "}
                </span>
                <span
                  style={{
                    backgroundColor: GRASS_GREEN,
                    border: `2px solid ${DEEP_NAVY}`,
                    padding: "2px 6px",
                    fontWeight: 700,
                  }}
                >
                  {overlap.startDate}
                </span>
                {" → "}
                <span
                  style={{
                    backgroundColor: GRASS_GREEN,
                    border: `2px solid ${DEEP_NAVY}`,
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
                  color: SUNSET_ORANGE,
                  fontFamily: "'Courier New', Courier, monospace",
                  fontWeight: 700,
                }}
              >
                ✗ No overlap — adjust dates so the group shares at least one common day.
              </p>
            )}
          </div>
        )}
        {!allSubmitted && members.length > 0 && (
          <p
            style={{
              marginTop: 10,
              fontSize: "0.8125rem",
              fontFamily: "'Courier New', Courier, monospace",
              color: DEEP_NAVY,
              opacity: 0.75,
            }}
          >
            ⏳ Waiting on {waitingOnCount}{" "}
            {waitingOnCount === 1 ? "member" : "members"}…
          </p>
        )}
      </div>
    </section>
  );
}
