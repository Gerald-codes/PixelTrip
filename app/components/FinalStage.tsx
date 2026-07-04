"use client";

import { useCallback, useEffect, useState } from "react";

import type { Itinerary, TripRoom } from "@/lib/types";
import type { StageProps } from "./StageRouter";

import ExportButton from "./ExportButton";
import FairnessSummary from "./FairnessSummary";
import ItineraryDay from "./ItineraryDay";

// ── Palette ───────────────────────────────────────────────────────────────────
const GREEN = "#4ADE80";
const SKY = "#38BDF8";
const ORANGE = "#FB923C";
const AMBER_BG = "#1C0F00";
const AMBER_BORDER = "#92400E";
const AMBER_TEXT = "#FDE68A";
const NAVY = "#0F1B2E";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function flightLabel(option: string | null | undefined): string {
  switch (option) {
    case "budget":    return "✈ Budget";
    case "comfort":   return "✈ Comfort";
    case "best_value":return "✈ Best Value";
    default:          return "✈ —";
  }
}

// ── FinalStage ────────────────────────────────────────────────────────────────

export default function FinalStage({ room, members, identity, onRoomUpdated }: StageProps) {
  const isHost = identity.userId === room.hostUserId;

  const [itinerary, setItinerary]         = useState<Itinerary | null>(null);
  const [loading, setLoading]             = useState(true);
  /** true when a final-status version was found — false means we're showing a fallback */
  const [hasFinalVersion, setHasFinalVersion] = useState(false);
  const [fetchError, setFetchError]       = useState<string | null>(null);

  // Finalise recovery state (host only)
  const [finalising, setFinalising]       = useState(false);
  const [finaliseError, setFinaliseError] = useState<string | null>(null);

  // Replan state (host only)
  const [replanConfirm, setReplanConfirm] = useState(false);
  const [replanning, setReplanning]       = useState(false);
  const [replanError, setReplanError]     = useState<string | null>(null);

  // ── Load itinerary ──────────────────────────────────────────────────────────

  const loadItinerary = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/itinerary/${room.id}`, { cache: "no-store" });
      if (!res.ok) {
        setFetchError("Could not load the trip itinerary. Please refresh.");
        return;
      }
      const versions: Itinerary[] = await res.json() as Itinerary[];

      if (versions.length === 0) {
        setFetchError("No itinerary has been generated for this trip yet.");
        return;
      }

      // 1. Prefer the version explicitly marked as "final"
      let best = versions.find((v) => v.status === "final");

      // 2. Fall back to the version matching finalItineraryId
      if (!best && room.finalItineraryId) {
        best = versions.find((v) => v.id === room.finalItineraryId);
      }

      if (best) {
        setItinerary(best);
        setHasFinalVersion(true);
        return;
      }

      // 3. Graceful fallback: show the latest draft version so the screen
      //    isn't blank, and let the host finalise it from here.
      const latest = versions[versions.length - 1];
      setItinerary(latest);
      setHasFinalVersion(false);
    } catch {
      setFetchError("Failed to load the itinerary. Please refresh and try again.");
    } finally {
      setLoading(false);
    }
  }, [room.id, room.finalItineraryId]);

  useEffect(() => {
    void loadItinerary();
  }, [loadItinerary]);

  // ── Finalise current itinerary (host only, recovery path) ──────────────────

  async function handleFinalise() {
    if (finalising) return;
    setFinalising(true);
    setFinaliseError(null);
    try {
      const res = await fetch(`/api/itinerary/${room.id}/finalise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestingUserId: identity.userId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        // 409 means it's already finalised — just refresh
        if (res.status !== 409) {
          throw new Error(body?.error ?? "Failed to finalise itinerary");
        }
      }
      // Re-fetch so we pick up the updated status="final"
      await loadItinerary();
      // Refresh room state
      const roomRes = await fetch(`/api/rooms/${room.roomCode}`, { cache: "no-store" });
      if (roomRes.ok) {
        const updatedRoom = (await roomRes.json()) as TripRoom;
        onRoomUpdated(updatedRoom);
      }
    } catch (err) {
      setFinaliseError(err instanceof Error ? err.message : "Failed to finalise. Please try again.");
    } finally {
      setFinalising(false);
    }
  }

  // ── Replan: move room back to ITINERARY stage ───────────────────────────────
  //
  // Uses the existing backward stage-patch endpoint. This keeps all room data
  // (members, personas, destination, flight) and lets the host regenerate a
  // new itinerary version. Destination/flight/activities are all preserved.

  async function handleReplan() {
    if (replanning) return;
    setReplanning(true);
    setReplanError(null);
    setReplanConfirm(false);
    try {
      // Walk back stage-by-stage until we reach ITINERARY.
      // The stage route supports direction:"backward" for the host.
      // FINAL → NEGOTIATION → ITINERARY (2 backward steps).
      for (let i = 0; i < 2; i++) {
        const res = await fetch(`/api/rooms/${room.roomCode}/stage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestingUserId: identity.userId,
            direction: "backward",
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Failed to go back");
        }
        const updatedRoom = (await res.json()) as TripRoom;
        onRoomUpdated(updatedRoom);
      }
    } catch (err) {
      setReplanError(err instanceof Error ? err.message : "Failed to replan. Please try again.");
    } finally {
      setReplanning(false);
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <span className="text-4xl animate-bounce" aria-hidden="true">🎉</span>
        <p className="font-bold text-pt-text-primary text-lg tracking-wide">
          Loading your final trip plan…
        </p>
      </div>
    );
  }

  // ── Hard error (no itinerary at all) ──────────────────────────────────────
  if (fetchError && !itinerary) {
    return (
      <div className="mx-auto max-w-2xl">
        <div
          className="p-6 flex flex-col gap-3"
          style={{ border: `4px solid ${AMBER_BORDER}`, backgroundColor: AMBER_BG }}
        >
          <p className="text-lg font-bold flex items-center gap-2" style={{ color: AMBER_TEXT }}>
            <span aria-hidden="true">⚠️</span>
            {fetchError}
          </p>
          <p className="text-sm" style={{ color: "#FEF3C7", opacity: 0.8 }}>
            Once the host has generated and finalised the itinerary, it will appear here.
          </p>
        </div>
      </div>
    );
  }

  // ── Recovery state: itinerary exists but hasn't been marked "final" ────────
  if (!hasFinalVersion && itinerary) {
    return (
      <div className="mx-auto max-w-2xl flex flex-col gap-4">
        {/* Recovery notice */}
        <div
          className="p-5 flex flex-col gap-3"
          style={{ border: `4px solid ${AMBER_BORDER}`, backgroundColor: AMBER_BG }}
        >
          <p className="text-base font-bold flex items-center gap-2" style={{ color: AMBER_TEXT }}>
            <span aria-hidden="true">📋</span>
            No final itinerary has been saved yet.
          </p>
          <p className="text-sm leading-relaxed" style={{ color: "#FEF3C7" }}>
            A current itinerary (v{itinerary.versionNumber}) exists for{" "}
            <strong style={{ color: AMBER_TEXT }}>{itinerary.destination}</strong>.
            {isHost
              ? " You can finalise it now to lock it in for the group."
              : " Ask the host to finalise it so everyone can see the final plan."}
          </p>

          {isHost && (
            <div className="flex flex-col gap-2 items-start">
              <button
                type="button"
                onClick={() => void handleFinalise()}
                disabled={finalising}
                style={{
                  border: `3px solid ${GREEN}`,
                  backgroundColor: finalising ? "#0A2A1A" : "#14532D",
                  color: GREEN,
                  padding: "9px 20px",
                  fontFamily: "'Courier New', Courier, monospace",
                  fontWeight: 700,
                  fontSize: "0.875rem",
                  cursor: finalising ? "not-allowed" : "pointer",
                  boxShadow: finalising ? "none" : `3px 3px 0 ${NAVY}`,
                  opacity: finalising ? 0.65 : 1,
                }}
              >
                {finalising ? "⏳ Finalising…" : "✓ Finalise current itinerary"}
              </button>
              {finaliseError && (
                <p className="text-sm font-semibold" style={{ color: "#FCA5A5" }}>
                  ⚠ {finaliseError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Preview of the current (non-final) itinerary */}
        <p className="text-xs font-semibold" style={{ color: "var(--pt-text-muted)" }}>
          Preview of current itinerary (not yet finalised):
        </p>
        <ItineraryPreview itinerary={itinerary} room={room} members={members} />
      </div>
    );
  }

  // ── Full final view ────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">

      {/* ── Hero header ──────────────────────────────────────────────────── */}
      <header
        className="p-6"
        style={{ border: `4px solid ${GREEN}`, backgroundColor: "var(--pt-bg-card)" }}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-3xl" aria-hidden="true">🎉</span>
            <h1 className="text-2xl font-bold leading-tight" style={{ color: GREEN }}>
              Your Trip is Planned!
            </h1>
          </div>

          <div className="flex flex-wrap gap-3 mt-1">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 text-sm font-bold"
              style={{ border: `2px solid ${SKY}`, backgroundColor: "#071E2E", color: SKY }}
            >
              📍 {itinerary!.destination}
            </span>
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 text-sm font-bold"
              style={{ border: "2px solid var(--pt-border)", backgroundColor: "var(--pt-bg-card)", color: "var(--pt-text-primary)" }}
            >
              📅 {formatDate(itinerary!.startDate)} – {formatDate(itinerary!.endDate)}
            </span>
            {room.selectedFlightOption && (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 text-sm font-bold"
                style={{ border: "2px solid var(--pt-accent-purple)", backgroundColor: "#150A2E", color: "#A78BFA" }}
              >
                {flightLabel(room.selectedFlightOption)}
              </span>
            )}
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold uppercase tracking-wide"
              style={{ border: `2px solid ${GREEN}`, backgroundColor: "#0A2A1A", color: GREEN }}
            >
              v{itinerary!.versionNumber} · Final
            </span>
          </div>

          <p className="text-sm leading-relaxed mt-1" style={{ color: "var(--pt-text-secondary)" }}>
            The group has agreed on this itinerary. Export it below and start packing!
          </p>
        </div>
      </header>

      {/* ── Export bar ───────────────────────────────────────────────────── */}
      <ExportBar itinerary={itinerary!} room={room} />

      {/* ── Replan section (host only) ───────────────────────────────────── */}
      {isHost && (
        <ReplanSection
          destination={room.selectedDestination}
          replanning={replanning}
          replanConfirm={replanConfirm}
          replanError={replanError}
          onRequestConfirm={() => setReplanConfirm(true)}
          onCancelConfirm={() => setReplanConfirm(false)}
          onConfirmReplan={() => void handleReplan()}
        />
      )}

      {/* ── Fairness summary ─────────────────────────────────────────────── */}
      <FairnessSummary summary={itinerary!.fairnessSummary} members={members} />

      {/* ── Day-by-day itinerary ─────────────────────────────────────────── */}
      <section aria-label="Day-by-day itinerary" className="flex flex-col gap-3">
        {itinerary!.days.map((day, i) => (
          <ItineraryDay key={i} day={day} dayNumber={i + 1} defaultOpen={i === 0} />
        ))}
      </section>

      {/* ── Bottom export bar (repeat) ───────────────────────────────────── */}
      <ExportBar itinerary={itinerary!} room={room} label="Copy your trip plan" />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ExportBar({
  itinerary,
  room,
  label = "Export your itinerary",
}: {
  itinerary: Itinerary;
  room: StageProps["room"];
  label?: string;
}) {
  return (
    <div
      className="p-4"
      style={{ border: "4px solid var(--pt-border-subtle)", backgroundColor: "var(--pt-bg-card)" }}
    >
      <p className="text-sm font-bold text-pt-text-primary mb-3 flex items-center gap-2">
        <span aria-hidden="true">📋</span>
        {label}
      </p>
      <div className="flex flex-wrap gap-3">
        <ExportButton itinerary={itinerary} format="text"     flightOption={room.selectedFlightOption} />
        <ExportButton itinerary={itinerary} format="markdown" flightOption={room.selectedFlightOption} />
      </div>
    </div>
  );
}

function ReplanSection({
  destination,
  replanning,
  replanConfirm,
  replanError,
  onRequestConfirm,
  onCancelConfirm,
  onConfirmReplan,
}: {
  destination: string | null;
  replanning: boolean;
  replanConfirm: boolean;
  replanError: string | null;
  onRequestConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirmReplan: () => void;
}) {
  return (
    <div
      className="p-4 flex flex-col gap-3"
      style={{ border: "2px solid var(--pt-border)", backgroundColor: "var(--pt-bg-card)" }}
    >
      <p className="text-sm font-bold text-pt-text-primary flex items-center gap-2">
        <span aria-hidden="true">🔄</span>
        Want to change the plan?
      </p>

      {!replanConfirm ? (
        <div className="flex flex-wrap gap-3 items-center">
          <button
            type="button"
            onClick={onRequestConfirm}
            disabled={replanning}
            style={{
              border: `2px solid ${ORANGE}`,
              backgroundColor: "#1C0800",
              color: ORANGE,
              padding: "7px 16px",
              fontFamily: "'Courier New', Courier, monospace",
              fontWeight: 700,
              fontSize: "0.8125rem",
              cursor: replanning ? "not-allowed" : "pointer",
              boxShadow: `2px 2px 0 ${NAVY}`,
              opacity: replanning ? 0.6 : 1,
            }}
          >
            🔄 Replan trip
          </button>
          <p className="text-xs" style={{ color: "var(--pt-text-muted)" }}>
            Goes back to the itinerary step. Destination, flight, and everyone's characters are kept.
          </p>
        </div>
      ) : (
        /* Confirmation prompt */
        <div
          className="flex flex-col gap-3 p-3"
          style={{ border: `2px solid ${AMBER_BORDER}`, backgroundColor: AMBER_BG }}
        >
          <p className="text-sm font-bold" style={{ color: AMBER_TEXT }}>
            ⚠ Start a new plan?
          </p>
          <p className="text-xs leading-relaxed" style={{ color: "#FEF3C7" }}>
            This will move everyone back to the itinerary generation step.
            {destination && (
              <>
                {" "}Your destination (<strong style={{ color: AMBER_TEXT }}>{destination}</strong>),
              </>
            )}{" "}
            flight style, member characters, dates, and activities are all kept.
            Only the current itinerary draft will be replaced when a new one is generated.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onConfirmReplan}
              disabled={replanning}
              style={{
                border: `2px solid ${ORANGE}`,
                backgroundColor: "#3D1400",
                color: ORANGE,
                padding: "7px 16px",
                fontFamily: "'Courier New', Courier, monospace",
                fontWeight: 700,
                fontSize: "0.8125rem",
                cursor: replanning ? "not-allowed" : "pointer",
                boxShadow: replanning ? "none" : `2px 2px 0 ${NAVY}`,
                opacity: replanning ? 0.6 : 1,
              }}
            >
              {replanning ? "⏳ Going back…" : "✓ Yes, replan the trip"}
            </button>
            <button
              type="button"
              onClick={onCancelConfirm}
              disabled={replanning}
              style={{
                border: "2px solid var(--pt-border)",
                backgroundColor: "var(--pt-bg-elevated)",
                color: "var(--pt-text-secondary)",
                padding: "7px 16px",
                fontFamily: "'Courier New', Courier, monospace",
                fontWeight: 700,
                fontSize: "0.8125rem",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
          {replanError && (
            <p className="text-sm font-semibold" style={{ color: "#FCA5A5" }}>
              ⚠ {replanError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Read-only itinerary preview used in the recovery state. */
function ItineraryPreview({
  itinerary,
  room,
  members,
}: {
  itinerary: Itinerary;
  room: StageProps["room"];
  members: StageProps["members"];
}) {
  return (
    <div className="flex flex-col gap-4">
      <FairnessSummary summary={itinerary.fairnessSummary} members={members} />
      <section aria-label="Itinerary preview" className="flex flex-col gap-3">
        {itinerary.days.map((day, i) => (
          <ItineraryDay key={i} day={day} dayNumber={i + 1} defaultOpen={i === 0} />
        ))}
      </section>
      <div
        className="p-4"
        style={{ border: "2px solid var(--pt-border)", backgroundColor: "var(--pt-bg-card)" }}
      >
        <p className="text-sm font-bold text-pt-text-primary mb-3">📋 Export preview</p>
        <div className="flex flex-wrap gap-3">
          <ExportButton itinerary={itinerary} format="text"     flightOption={room.selectedFlightOption} />
          <ExportButton itinerary={itinerary} format="markdown" flightOption={room.selectedFlightOption} />
        </div>
      </div>
    </div>
  );
}
