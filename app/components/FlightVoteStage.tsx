"use client";

import { useCallback, useState } from "react";

import type { StageProps } from "@/app/components/StageRouter";
import type { VoteOption } from "@/app/components/VotePanel";
import VotingStage from "@/app/components/VotingStage";
import { MOCK_FLIGHT_OPTIONS } from "@/app/components/FlightStage";
import { createAnonSupabase } from "@/lib/supabase";

/**
 * FlightVoteStage — wraps {@link VotingStage} for the flight category round.
 *
 * Responsibilities:
 * 1. Build {@link VoteOption}s from the three mocked flight categories
 *    (`MOCK_FLIGHT_OPTIONS`). Each option carries the price range and a
 *    one-line explanation so voters have the key facts in the vote card.
 * 2. Hand those options to {@link VotingStage} with `voteType="flight"`.
 * 3. On a winner, the host:
 *    a. POSTs to `/api/rooms/[code]/flight` to persist `selected_flight_option`.
 *    b. PATCHes `/api/rooms/[code]/stage` to advance to `ACTIVITIES`.
 *    c. Broadcasts `stage-change` so all clients re-render.
 *    Non-host clients receive the broadcast and re-render automatically.
 *
 * Pattern exactly mirrors `DestinationVoteStage`.
 */
export default function FlightVoteStage({
  room,
  identity,
  members,
}: StageProps) {
  const isHost = identity.userId === room.hostUserId;
  const [winnerError, setWinnerError] = useState<string | null>(null);

  // Build VoteOption[] from the mocked flight categories.
  // value = the DB-stored key ("budget" | "comfort" | "best_value")
  // label = display name + price range pill
  // description = one-liner explanation
  const options: VoteOption[] = MOCK_FLIGHT_OPTIONS.map((f) => ({
    value: f.value,
    label: (
      <span className="flex flex-wrap items-center gap-2">
        <span>{f.label}</span>
        <PricePill price={f.priceRange} />
      </span>
    ),
    description: (
      <div className="flex flex-col gap-1 text-sm text-gray-700">
        <p>{f.explanation}</p>
        <p className="text-xs text-amber-800">
          <span className="font-semibold">Itinerary impact:</span>{" "}
          {f.itineraryImpact}
        </p>
      </div>
    ),
  }));

  // ── Winner handler: host persists flight option + advances to ACTIVITIES ─
  const handleWinner = useCallback(
    async (winner: string) => {
      // Only the host performs side effects. Non-hosts re-render off the
      // stage-change broadcast that the host emits below.
      if (!isHost) return;

      try {
        const flightRes = await fetch(
          `/api/rooms/${room.roomCode}/flight`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              selectedFlightOption: winner,
              requestingUserId: identity.userId,
            }),
          },
        );
        if (!flightRes.ok) {
          const body = (await flightRes.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(
            body?.error ?? "Failed to save the selected flight option",
          );
        }

        const stageRes = await fetch(`/api/rooms/${room.roomCode}/stage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestingUserId: identity.userId }),
        });
        if (!stageRes.ok) {
          const body = (await stageRes.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error ?? "Failed to advance to activities");
        }

        await broadcastStageChange(room.id);
        setWinnerError(null);
      } catch (err) {
        setWinnerError(
          err instanceof Error
            ? err.message
            : "Failed to lock in the flight option",
        );
      }
    },
    [isHost, room.roomCode, room.id, identity.userId],
  );

  return (
    <>
      <VotingStage
        room={room}
        identity={identity}
        members={members}
        voteType="flight"
        options={options}
        title="Vote for a flight category"
        description="One vote per person. Vote is locked once cast. When everyone has voted, the winner is saved and the group moves on to activities."
        onWinner={handleWinner}
      />
      {winnerError && (
        <p className="mx-auto mt-4 max-w-3xl text-sm text-red-600">
          {winnerError}
        </p>
      )}
    </>
  );
}

// ── Presentational helpers ────────────────────────────────────────────────────

function PricePill({ price }: { price: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2 py-0.5 text-xs font-semibold text-gray-700">
      <span className="opacity-60">✈</span>
      <span>{price}</span>
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
