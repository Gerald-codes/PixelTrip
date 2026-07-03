"use client";

import { useEffect, useState } from "react";

import type { Itinerary } from "@/lib/types";
import type { StageProps } from "./StageRouter";

import ExportButton from "./ExportButton";
import FairnessSummary from "./FairnessSummary";
import ItineraryDay from "./ItineraryDay";

// ── Date formatter ───────────────────────────────────────────────────────────
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
    case "budget":
      return "✈ Budget";
    case "comfort":
      return "✈ Comfort";
    case "best_value":
      return "✈ Best Value";
    default:
      return "✈ —";
  }
}

// ── FinalStage ───────────────────────────────────────────────────────────────

export default function FinalStage({ room, members }: StageProps) {
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadFinalItinerary() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/itinerary/${room.id}`);
        if (!res.ok) {
          setError("No final itinerary found — ask the host to finalise");
          return;
        }
        const versions: Itinerary[] = await res.json() as Itinerary[];

        // Prefer the version flagged as 'final'; fall back to finalItineraryId match
        let final: Itinerary | undefined = versions.find(
          (v) => v.status === "final"
        );

        if (!final && room.finalItineraryId) {
          final = versions.find((v) => v.id === room.finalItineraryId);
        }

        if (!final) {
          setError("No final itinerary found — ask the host to finalise");
          return;
        }

        setItinerary(final);
      } catch {
        setError("Failed to load the itinerary. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    void loadFinalItinerary();
  }, [room.id, room.finalItineraryId]);

  // ── Loading ──────────────────────────────────────────────────────────────
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

  // ── Error ────────────────────────────────────────────────────────────────
  if (error || !itinerary) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="border-4 border-[#FB923C] bg-[var(--pt-bg-card)] shadow-pixel-card p-6 flex flex-col gap-3">
          <p className="text-lg font-bold text-pt-text-primary flex items-center gap-2">
            <span aria-hidden="true">⚠️</span>
            {error ?? "No final itinerary found — ask the host to finalise"}
          </p>
          <p className="text-sm text-pt-text-primary opacity-70">
            Once the host has reviewed and finalised the itinerary, it will appear here for everyone.
          </p>
        </div>
      </div>
    );
  }

  // ── Final view ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">

      {/* ── Hero header ─────────────────────────────────────────────────── */}
      <header className="border-4 border-[#4ADE80] bg-[var(--pt-bg-card)] shadow-pixel-card p-6">
        <div className="flex flex-col gap-3">
          {/* Celebration headline */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-3xl" aria-hidden="true">🎉</span>
            <h1 className="text-2xl font-bold text-[#4ADE80] leading-tight">
              Your Trip is Planned!
            </h1>
          </div>

          {/* Trip details row */}
          <div className="flex flex-wrap gap-3 mt-1">
            {/* Destination */}
            <span className="inline-flex items-center gap-1.5 border-2 border-pt-text-primary border-opacity-20 bg-[#38BDF8] px-3 py-1 text-sm font-bold text-pt-text-primary shadow-pixel-sm">
              📍 {itinerary.destination}
            </span>

            {/* Dates */}
            <span className="inline-flex items-center gap-1.5 border-2 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] px-3 py-1 text-sm font-bold text-pt-text-primary shadow-pixel-sm">
              📅 {formatDate(itinerary.startDate)} – {formatDate(itinerary.endDate)}
            </span>

            {/* Flight option */}
            {room.selectedFlightOption && (
              <span className="inline-flex items-center gap-1.5 border-2 border-pt-text-primary border-opacity-20 bg-[var(--pt-agent-atlas)] px-3 py-1 text-sm font-bold text-white shadow-pixel-sm">
                {flightLabel(room.selectedFlightOption)}
              </span>
            )}

            {/* Version badge */}
            <span className="inline-flex items-center gap-1.5 border-2 border-pt-text-primary border-opacity-20 bg-[#4ADE80] px-3 py-1 text-xs font-bold text-pt-text-primary shadow-pixel-sm">
              v{itinerary.versionNumber}
            </span>
          </div>

          <p className="text-sm text-pt-text-primary opacity-80 leading-relaxed mt-1">
            The group has agreed on this itinerary. Everyone can copy it below and start packing!
          </p>
        </div>
      </header>

      {/* ── Export bar ──────────────────────────────────────────────────── */}
      <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] shadow-pixel-card p-4">
        <p className="text-sm font-bold text-pt-text-primary mb-3 flex items-center gap-2">
          <span aria-hidden="true">📋</span>
          Export your itinerary
        </p>
        <div className="flex flex-wrap gap-3">
          <ExportButton
            itinerary={itinerary}
            format="text"
            flightOption={room.selectedFlightOption}
          />
          <ExportButton
            itinerary={itinerary}
            format="markdown"
            flightOption={room.selectedFlightOption}
          />
        </div>
      </div>

      {/* ── Fairness summary ────────────────────────────────────────────── */}
      <FairnessSummary summary={itinerary.fairnessSummary} members={members} />

      {/* ── Day-by-day itinerary ─────────────────────────────────────────── */}
      <section aria-label="Day-by-day itinerary" className="flex flex-col gap-3">
        {itinerary.days.map((day, i) => (
          <ItineraryDay key={i} day={day} dayNumber={i + 1} defaultOpen={i === 0} />
        ))}
      </section>

      {/* ── Bottom export bar (repeat for convenience) ───────────────────── */}
      <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] shadow-pixel-card p-4">
        <p className="text-sm font-bold text-pt-text-primary mb-3 flex items-center gap-2">
          <span aria-hidden="true">📋</span>
          Copy your trip plan
        </p>
        <div className="flex flex-wrap gap-3">
          <ExportButton
            itinerary={itinerary}
            format="text"
            flightOption={room.selectedFlightOption}
          />
          <ExportButton
            itinerary={itinerary}
            format="markdown"
            flightOption={room.selectedFlightOption}
          />
        </div>
      </div>

    </div>
  );
}
