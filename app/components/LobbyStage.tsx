"use client";

import { useEffect, useState } from "react";

import PersonaCard from "@/app/components/PersonaCard";
import type { StageProps } from "@/app/components/StageRouter";
import { broadcastMemberJoined } from "@/app/hooks/useRoomMembers";
import { createAnonSupabase } from "@/lib/supabase";
import type { Persona, TripRoom } from "@/lib/types";

/**
 * LobbyStage — the room's waiting area before planning begins.
 *
 * Members are sourced from the DB-backed `members` prop (passed down from the
 * room shell), so the list is reliable and does not depend on ephemeral
 * presence. Each user picks an 8-bit persona; the choice is persisted to the
 * `users` row, and a `member-joined` broadcast prompts every other client to
 * refetch — that's how everyone sees each other's selection in (near) real
 * time. Users may freely change their pick until the host advances past LOBBY.
 *
 * Host-only "Advance stage" control advances the room and broadcasts a
 * stage-change so all clients re-render.
 */
export default function LobbyStage({ room, identity, members, onRoomUpdated }: StageProps) {
  const isHost = identity.userId === room.hostUserId;

  // ── Personas ─────────────────────────────────────────────────────────────────
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personasError, setPersonasError] = useState<string | null>(null);

  // Selection persistence state. Optimistic — we update the local UI immediately
  // and revert on failure.
  const me = members.find((m) => m.id === identity.userId);
  const selectedPersonaId = me?.selectedPersonaId ?? null;
  const [savingPersonaId, setSavingPersonaId] = useState<string | null>(null);
  const [personaSaveError, setPersonaSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/personas", { cache: "no-store" });
        if (!res.ok) {
          throw new Error("Failed to load personas");
        }
        const data = (await res.json()) as Persona[];
        if (!cancelled) setPersonas(data);
      } catch (err) {
        if (!cancelled) {
          setPersonasError(
            err instanceof Error ? err.message : "Failed to load personas",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSelectPersona(persona: Persona) {
    if (savingPersonaId) return;
    if (persona.id === selectedPersonaId) return;

    setSavingPersonaId(persona.id);
    setPersonaSaveError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: identity.userId,
          displayName: identity.displayName || "Traveller",
          roomId: room.id,
          selectedPersonaId: persona.id,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Failed to save persona");
      }
      // Tell every other client to refetch the member list so they see this
      // user's new persona.
      await broadcastMemberJoined(room.id);
    } catch (err) {
      setPersonaSaveError(
        err instanceof Error ? err.message : "Failed to save persona",
      );
    } finally {
      setSavingPersonaId(null);
    }
  }

  // Lookup map for showing each member's chosen persona name.
  const personasById = new Map(personas.map((p) => [p.id, p]));

  // ── Stage advance ────────────────────────────────────────────────────────────
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdvance() {
    if (advancing) return;
    setAdvancing(true);
    setError(null);
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
      // Update local state immediately — don't wait for the broadcast.
      onRoomUpdated(updated);
      // Fire-and-forget broadcast for other clients.
      void broadcastStageChange(room.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to advance stage");
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
        <h2 className="mt-1 text-2xl font-bold">Lobby</h2>
        <p className="mt-2 text-gray-600">
          Pick the 8-bit persona that best represents how you travel. You can
          change it any time until the host starts planning.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Choose your persona</h3>
          {savingPersonaId && (
            <span className="text-xs text-gray-500">Saving…</span>
          )}
        </div>

        {personasError ? (
          <p className="text-sm text-red-600">{personasError}</p>
        ) : personas.length === 0 ? (
          <p className="text-sm text-gray-500">Loading personas…</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {personas.map((persona) => (
              <PersonaCard
                key={persona.id}
                persona={persona}
                selected={persona.id === selectedPersonaId}
                onSelect={() => void handleSelectPersona(persona)}
              />
            ))}
          </div>
        )}

        {personaSaveError && (
          <p className="mt-3 text-sm text-red-600">{personaSaveError}</p>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Members</h3>
          <span className="text-sm text-gray-500">
            {members.length} {members.length === 1 ? "person" : "people"} here
          </span>
        </div>

        {members.length === 0 ? (
          <p className="text-sm text-gray-500">No members yet…</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((member) => {
              const isSelf = member.id === identity.userId;
              const isMemberHost = member.id === room.hostUserId;
              const memberPersona = member.selectedPersonaId
                ? personasById.get(member.selectedPersonaId)
                : null;
              return (
                <li
                  key={member.id}
                  className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full bg-green-500"
                      aria-hidden="true"
                    />
                    <span className="font-medium">
                      {member.displayName || "Traveller"}
                      {isSelf && (
                        <span className="ml-1 text-gray-400">(you)</span>
                      )}
                    </span>
                    {isMemberHost && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">
                        Host
                      </span>
                    )}
                  </span>
                  <span className="text-sm">
                    {memberPersona ? (
                      <span className="font-medium text-blue-700">
                        {memberPersona.name}
                      </span>
                    ) : (
                      <span className="text-gray-400">(no persona yet)</span>
                    )}
                  </span>
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
            disabled={advancing}
            className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {advancing ? "Advancing…" : "Advance stage"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          Waiting for the host to start planning…
        </p>
      )}
    </section>
  );
}

/**
 * Broadcast a `stage-change` event so every connected client re-fetches the room.
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
