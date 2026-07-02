"use client";

import { useState } from "react";

import type { StageProps } from "@/app/components/StageRouter";
import { createAnonSupabase } from "@/lib/supabase";
import type { TripRoom } from "@/lib/types";

/**
 * A single mocked flight category option.
 *
 * For the MVP, flight data is hardcoded per the design's "mocked / seeded
 * flight data" simplification. The three categories (Budget, Comfort, Best
 * Value) map directly to the `selected_flight_option` values stored on the
 * room: "budget" | "comfort" | "best_value".
 */
export interface FlightOption {
  /** Value stored in DB and used as the vote's `selectedOption`. */
  value: "budget" | "comfort" | "best_value";
  /** Display name shown in the UI. */
  label: string;
  /** Estimated price range for the group. */
  priceRange: string;
  /** Estimated total travel duration (including layovers). */
  duration: string;
  /** Number of stops. */
  stops: number;
  /** Short description of this category. */
  explanation: string;
  /** How this choice may affect the day-by-day itinerary experience. */
  itineraryImpact: string;
}

/**
 * Mocked flight options — one set per category. In a real app these would
 * be fetched from a live flight API. For the MVP demo they are hardcoded so
 * the group can still vote on a meaningful trade-off.
 *
 * All three categories are always available regardless of destination. The
 * itinerary agent will receive the winning `value` and tailor the plan
 * accordingly (e.g. an early arrival for Budget, a flexible late check-in
 * for Comfort).
 */
export const MOCK_FLIGHT_OPTIONS: FlightOption[] = [
  {
    value: "budget",
    label: "Budget",
    priceRange: "$150–$280 per person",
    duration: "14–22 hrs",
    stops: 2,
    explanation:
      "Lowest fares with two stops. Expect longer layovers and less legroom, but significant savings for the whole group.",
    itineraryImpact:
      "Arrival is typically late evening or overnight, so Day 1 of the itinerary will be lighter — mostly check-in and a short explore nearby. Departure is often early morning, requiring an earlier last-day wrap-up.",
  },
  {
    value: "comfort",
    label: "Comfort",
    priceRange: "$420–$620 per person",
    duration: "9–13 hrs",
    stops: 1,
    explanation:
      "One stop, more legroom, and better in-flight amenities. You arrive refreshed and ready to start the trip.",
    itineraryImpact:
      "A mid-afternoon arrival means Day 1 is a proper half-day — dinner plans and an evening activity are realistic. The return flight leaves at a civilised hour, so the last morning is free for a final meal or quick activity.",
  },
  {
    value: "best_value",
    label: "Best Value",
    priceRange: "$290–$380 per person",
    duration: "11–16 hrs",
    stops: 1,
    explanation:
      "One stop with a reasonable travel time. Balances cost and comfort — the sweet spot for most groups.",
    itineraryImpact:
      "Morning or early-afternoon arrival means a productive first day without paying premium prices. The itinerary will have full first and last days, maximising time at the destination.",
  },
];

/**
 * FlightStage — presents the three mocked flight category cards and lets the
 * host advance to the FLIGHT_VOTE stage once the group has reviewed them.
 *
 * This stage is informational: it shows each category's price range,
 * duration, stops, explanation, and itinerary impact so the group can make
 * an informed vote in the next stage. No vote is cast here.
 *
 * Pattern mirrors `DestinationsStage` and `GroupProfileStage`.
 */
export default function FlightStage({ room, identity, members: _members, onRoomUpdated }: StageProps) {
  const isHost = identity.userId === room.hostUserId;

  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  async function handleAdvance() {
    if (advancing) return;
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
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Failed to advance stage");
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
      {/* Stage header */}
      <div className="border-4 border-[#1E3A5F] bg-[#FEF3C7] p-6 shadow-[4px_4px_0px_#1E3A5F]">
        <p className="text-sm font-bold uppercase tracking-wide text-[#1E3A5F]">
          Current stage
        </p>
        <h2 className="mt-1 text-2xl font-bold text-[#1E3A5F]">Flight options</h2>
        <p className="mt-2 text-[#1E3A5F]">
          Review the three flight categories below. When you&apos;re ready,
          the host will move to a vote so the group can pick which approach
          fits best.
          {room.selectedDestination && (
            <span className="ml-1 font-bold text-[#1E3A5F]">
              Destination: {room.selectedDestination}.
            </span>
          )}
        </p>
      </div>

      {/* Flight option cards */}
      <div className="flex flex-col gap-4">
        {MOCK_FLIGHT_OPTIONS.map((option) => (
          <FlightOptionCard key={option.value} option={option} />
        ))}
      </div>

      {/* Host advance control */}
      {isHost ? (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => void handleAdvance()}
            disabled={advancing}
            className="border-4 border-[#1E3A5F] bg-[#FB923C] px-4 py-2 font-bold text-[#1E3A5F] shadow-[4px_4px_0px_#1E3A5F] hover:bg-[#f97316] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {advancing ? "Advancing…" : "Advance to flight vote"}
          </button>
          {advanceError && (
            <p className="text-sm font-semibold text-red-600">{advanceError}</p>
          )}
        </div>
      ) : (
        <p className="text-sm font-semibold text-[#1E3A5F]">
          Waiting for the host to advance to the flight vote…
        </p>
      )}
    </section>
  );
}

// ── Presentational sub-components ────────────────────────────────────────────

function FlightOptionCard({ option }: { option: FlightOption }) {
  const categoryColors: Record<FlightOption["value"], string> = {
    budget: "border-[#4ADE80] bg-[#FEF3C7]",
    comfort: "border-[#A855F7] bg-[#FEF3C7]",
    best_value: "border-[#38BDF8] bg-[#FEF3C7]",
  };
  const labelColors: Record<FlightOption["value"], string> = {
    budget: "text-[#1E3A5F]",
    comfort: "text-[#1E3A5F]",
    best_value: "text-[#1E3A5F]",
  };

  const stopsLabel =
    option.stops === 0
      ? "Non-stop"
      : option.stops === 1
        ? "1 stop"
        : `${option.stops} stops`;

  return (
    <article
      className={`w-full max-w-full overflow-hidden border-4 ${categoryColors[option.value]} shadow-[4px_4px_0px_#1E3A5F]`}
    >
      {/* Card header: stacked on mobile, row on sm+ */}
      <header className="flex flex-col gap-3 border-b-4 border-inherit px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-6">
        <h3 className={`min-w-0 break-words text-xl font-bold ${labelColors[option.value]}`}>
          {option.label}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatPill label="Price" value={option.priceRange} />
          <StatPill label="Duration" value={option.duration} />
          <StatPill label="Stops" value={stopsLabel} />
        </div>
      </header>

      <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5">
        {/* What this category means */}
        <p className="break-words text-sm font-semibold leading-relaxed text-[#1E3A5F]">
          {option.explanation}
        </p>

        {/* Itinerary impact — amber callout */}
        <section
          aria-label="Itinerary impact"
          className="border-l-4 border-[#FB923C] bg-amber-50 px-4 py-3"
        >
          <p className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F]">
            How this affects your itinerary
          </p>
          <p className="mt-1 break-words text-sm font-semibold leading-relaxed text-[#1E3A5F]">
            {option.itineraryImpact}
          </p>
        </section>
      </div>
    </article>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex flex-col items-center border-2 border-[#1E3A5F] bg-[#FEF3C7] px-2 py-1 text-center shadow-[2px_2px_0px_#1E3A5F]">
      <span className="whitespace-nowrap text-xs font-bold uppercase tracking-wide text-[#1E3A5F]">
        {label}
      </span>
      <span className="whitespace-nowrap text-sm font-bold text-[#1E3A5F]">{value}</span>
    </span>
  );
}

// ── Realtime helper ───────────────────────────────────────────────────────────

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
