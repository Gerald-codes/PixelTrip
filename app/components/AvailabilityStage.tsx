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

/** Dark card background — stays consistent with the rest of PixelTrip's dark theme. */
const CARD_BG = "var(--pt-bg-card, #122A4D)";
/** Slightly elevated surface for nested elements (date rows, member rows). */
const CARD_ELEVATED = "var(--pt-bg-elevated, #1B3964)";
/** Deep navy used for shadows and outlines that need contrast against card bg. */
const NAVY_SHADOW = "#081A33";
/** Card border colour. */
const CARD_BORDER = "var(--pt-border, #2F5E93)";
/** Primary light text on dark surfaces. */
const LIGHT_TEXT = "var(--pt-text-primary, #EAF2FF)";
/** Muted secondary text. */
const MUTED_TEXT = "var(--pt-text-secondary, #AFC5E6)";
const GRASS_GREEN = "#4ADE80";
const SUNSET_ORANGE = "#FB923C";
const AMBER_WARNING = "#FCD34D";
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
    // Wait until identity.userId is resolved from localStorage before hydrating.
    // On Vercel/SSR, the first render has userId === "" because localStorage
    // is only available after hydration. Running with an empty userId would
    // find no existing submission and set hydrateRef=true, permanently blocking
    // the real hydration once the userId becomes available.
    if (!identity.userId) return;
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
  function cardStyle(): React.CSSProperties {
    return {
      border: `3px solid ${CARD_BORDER}`,
      boxShadow: `4px 4px 0 ${NAVY_SHADOW}`,
      backgroundColor: CARD_BG,
      padding: "20px",
    };
  }

  const submitBtnStyle: React.CSSProperties = {
    border: `3px solid ${NAVY_SHADOW}`,
    borderRadius: 0,
    backgroundColor: saving ? "#1B3964" : GRASS_GREEN,
    color: saving ? MUTED_TEXT : NAVY_SHADOW,
    padding: "10px 28px",
    fontFamily: "'Courier New', Courier, monospace",
    fontWeight: 700,
    fontSize: "1rem",
    cursor: saving ? "not-allowed" : "pointer",
    opacity: saving ? 0.6 : 1,
    boxShadow: saving ? "none" : `4px 4px 0 ${NAVY_SHADOW}`,
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
      <div style={cardStyle()}>
        <h3
          style={{
            color: LIGHT_TEXT,
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
                border: `2px solid ${CARD_BORDER}`,
                backgroundColor: CARD_ELEVATED,
                padding: "12px",
                boxShadow: `2px 2px 0 ${NAVY_SHADOW}`,
                flexWrap: "wrap",
              }}
            >
              <label
                style={{ display: "flex", flexDirection: "column", flex: 1, gap: 6, minWidth: 120 }}
              >
                <span
                  style={{
                    color: MUTED_TEXT,
                    fontFamily: "'Courier New', Courier, monospace",
                    fontWeight: 700,
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  Start date
                </span>
                <input
                  type="date"
                  value={range.startDate}
                  onChange={(e) => updateRange(i, { startDate: e.target.value })}
                  disabled={saving || submitted}
                  aria-label={`Start date for range ${i + 1}`}
                  className="pt-date-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8] focus-visible:ring-offset-1"
                  style={{
                    border: `2px solid ${CARD_BORDER}`,
                    borderRadius: 0,
                    backgroundColor: "var(--pt-bg-deep, #081A33)",
                    color: LIGHT_TEXT,
                    padding: "8px 10px",
                    fontFamily: "'Courier New', Courier, monospace",
                    fontSize: "0.875rem",
                    outline: "none",
                    colorScheme: "dark",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                />
              </label>
              <label
                style={{ display: "flex", flexDirection: "column", flex: 1, gap: 6, minWidth: 120 }}
              >
                <span
                  style={{
                    color: MUTED_TEXT,
                    fontFamily: "'Courier New', Courier, monospace",
                    fontWeight: 700,
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  End date
                </span>
                <input
                  type="date"
                  value={range.endDate}
                  onChange={(e) => updateRange(i, { endDate: e.target.value })}
                  disabled={saving || submitted}
                  aria-label={`End date for range ${i + 1}`}
                  className="pt-date-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8] focus-visible:ring-offset-1"
                  style={{
                    border: `2px solid ${CARD_BORDER}`,
                    borderRadius: 0,
                    backgroundColor: "var(--pt-bg-deep, #081A33)",
                    color: LIGHT_TEXT,
                    padding: "8px 10px",
                    fontFamily: "'Courier New', Courier, monospace",
                    fontSize: "0.875rem",
                    outline: "none",
                    colorScheme: "dark",
                    width: "100%",
                    boxSizing: "border-box",
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
                    border: `2px solid ${draftRanges.length === 1 ? CARD_BORDER : SUNSET_ORANGE}`,
                    borderRadius: 0,
                    backgroundColor: draftRanges.length === 1 ? CARD_ELEVATED : "#3D1400",
                    color: draftRanges.length === 1 ? MUTED_TEXT : SUNSET_ORANGE,
                    padding: "8px 14px",
                    fontFamily: "'Courier New', Courier, monospace",
                    fontWeight: 700,
                    fontSize: "0.8125rem",
                    cursor: draftRanges.length === 1 ? "not-allowed" : "pointer",
                    opacity: draftRanges.length === 1 ? 0.45 : 1,
                    boxShadow: draftRanges.length === 1 ? "none" : `2px 2px 0 ${NAVY_SHADOW}`,
                    whiteSpace: "nowrap",
                    alignSelf: "flex-end",
                  }}
                >
                  ✕ Remove
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
              marginTop: 12,
              border: `2px dashed ${CARD_BORDER}`,
              borderRadius: 0,
              backgroundColor: "transparent",
              color: SKY_BLUE,
              padding: "7px 16px",
              fontFamily: "'Courier New', Courier, monospace",
              fontWeight: 700,
              fontSize: "0.875rem",
              cursor: "pointer",
              letterSpacing: "0.02em",
            }}
          >
            + Add another date range
          </button>
        )}
      </div>

      {/* ── Section 2: Travel vibes ────────────────────────────────────────── */}
      <div style={cardStyle()}>
        <h3
          style={{
            color: LIGHT_TEXT,
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
      <div style={cardStyle()}>
        <h3
          style={{
            color: LIGHT_TEXT,
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: "1rem",
            fontWeight: 700,
            marginBottom: 12,
          }}
        >
          📍 Pick your destinations{" "}
          <span style={{ fontWeight: 400, color: MUTED_TEXT, fontSize: "0.875rem" }}>(optional)</span>
        </h3>

        {selectedVibes.length === 0 ? (
          <p
            style={{
              fontSize: "0.875rem",
              fontFamily: "'Courier New', Courier, monospace",
              color: MUTED_TEXT,
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
              border: `2px dashed ${CARD_BORDER}`,
              borderRadius: 0,
              backgroundColor: "transparent",
              color: SKY_BLUE,
              padding: "6px 14px",
              fontFamily: "'Courier New', Courier, monospace",
              fontWeight: 700,
              fontSize: "0.875rem",
              cursor: submitted ? "default" : "pointer",
              opacity: submitted ? 0.45 : 1,
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
              color: MUTED_TEXT,
            }}
          >
            Selected:{" "}
            <span style={{ color: SKY_BLUE, fontWeight: 700 }}>
              {allDestinations.join(", ")}
            </span>
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
                color: AMBER_WARNING,
                fontFamily: "'Courier New', Courier, monospace",
                fontWeight: 700,
                border: `2px solid ${SUNSET_ORANGE}`,
                padding: "6px 10px",
                backgroundColor: "#1C0F00",
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
            backgroundColor: "#0A2A1A",
            boxShadow: `4px 4px 0 ${NAVY_SHADOW}`,
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontFamily: "'Courier New', Courier, monospace",
              fontWeight: 700,
              color: GRASS_GREEN,
              fontSize: "0.875rem",
            }}
          >
            ✓ Availability submitted! Waiting for others…
          </span>
          <button
            type="button"
            onClick={() => setSubmitted(false)}
            style={{
              border: `2px solid ${CARD_BORDER}`,
              borderRadius: 0,
              backgroundColor: CARD_ELEVATED,
              color: SKY_BLUE,
              padding: "4px 12px",
              fontFamily: "'Courier New', Courier, monospace",
              fontWeight: 700,
              fontSize: "0.75rem",
              cursor: "pointer",
              boxShadow: `2px 2px 0 ${NAVY_SHADOW}`,
            }}
          >
            ← Edit
          </button>
        </div>
      )}

      {/* ── Per-member submission status ───────────────────────────────────── */}
      <div style={cardStyle()}>
        <h3
          style={{
            color: LIGHT_TEXT,
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
              color: AMBER_WARNING,
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
              color: MUTED_TEXT,
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
                    gap: 8,
                    border: `2px solid ${isSelf ? SKY_BLUE : CARD_BORDER}`,
                    backgroundColor: isSelf ? "#0D2A3D" : CARD_ELEVATED,
                    padding: "8px 12px",
                    boxShadow: isSelf ? `2px 2px 0 ${NAVY_SHADOW}` : "none",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Courier New', Courier, monospace",
                      fontWeight: 700,
                      color: isSelf ? SKY_BLUE : LIGHT_TEXT,
                      fontSize: "0.875rem",
                    }}
                  >
                    {member.displayName || "Traveller"}
                    {isSelf && (
                      <span style={{ marginLeft: 6, fontWeight: 400, color: MUTED_TEXT, fontSize: "0.8125rem" }}>
                        (you)
                      </span>
                    )}
                  </span>
                  {isSubmitted ? (
                    <span
                      style={{
                        fontSize: "0.75rem",
                        fontFamily: "'Courier New', Courier, monospace",
                        color: NAVY_SHADOW,
                        fontWeight: 700,
                        border: `1px solid ${GRASS_GREEN}`,
                        padding: "2px 7px",
                        backgroundColor: GRASS_GREEN,
                        whiteSpace: "nowrap",
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
                        padding: "2px 7px",
                        backgroundColor: "#1C0800",
                        whiteSpace: "nowrap",
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
                  color: LIGHT_TEXT,
                }}
              >
                <span style={{ fontWeight: 700, color: GRASS_GREEN }}>
                  ✓ Overlap found:{" "}
                </span>
                <span
                  style={{
                    backgroundColor: "#0A2A1A",
                    border: `2px solid ${GRASS_GREEN}`,
                    padding: "2px 8px",
                    fontWeight: 700,
                    color: GRASS_GREEN,
                    fontFamily: "'Courier New', Courier, monospace",
                  }}
                >
                  {overlap.startDate}
                </span>
                <span style={{ color: MUTED_TEXT, margin: "0 4px" }}>→</span>
                <span
                  style={{
                    backgroundColor: "#0A2A1A",
                    border: `2px solid ${GRASS_GREEN}`,
                    padding: "2px 8px",
                    fontWeight: 700,
                    color: GRASS_GREEN,
                    fontFamily: "'Courier New', Courier, monospace",
                  }}
                >
                  {overlap.endDate}
                </span>
              </p>
            ) : (
              <p
                style={{
                  fontSize: "0.875rem",
                  color: AMBER_WARNING,
                  fontFamily: "'Courier New', Courier, monospace",
                  fontWeight: 700,
                  border: `2px solid ${SUNSET_ORANGE}`,
                  padding: "8px 12px",
                  backgroundColor: "#1C0F00",
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
              color: MUTED_TEXT,
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
