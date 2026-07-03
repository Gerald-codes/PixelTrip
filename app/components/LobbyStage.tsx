"use client";

import { useState } from "react";

import CharacterCreator from "@/app/components/CharacterCreator";
import type { StageProps } from "@/app/components/StageRouter";
import { broadcastMemberJoined } from "@/app/hooks/useRoomMembers";
import { createAnonSupabase } from "@/lib/supabase";
import type { CharacterProfile, TripRoom } from "@/lib/types";

/**
 * LobbyStage — the room's waiting area before planning begins.
 *
 * Members are shown in a pixel-styled member list. Each user builds their
 * 8-bit travel character via CharacterCreator; the profile is persisted to
 * `character_profiles` and a `member-joined` broadcast prompts every other
 * client to refetch — that's how everyone sees each other's avatar in real
 * time. Users may freely change their character until the host advances past
 * LOBBY.
 *
 * Host-only "Advance stage" control advances the room and broadcasts a
 * stage-change so all clients re-render.
 */
export default function LobbyStage({ room, identity, members, onRoomUpdated }: StageProps) {
  const isHost = identity.userId === room.hostUserId;

  // ── Character confirmation ───────────────────────────────────────────────────
  const [confirmedProfile, setConfirmedProfile] = useState<CharacterProfile | null>(null);

  async function handleConfirmed(profile: CharacterProfile) {
    setConfirmedProfile(profile);
    // Broadcast so other clients update their MemberStrip
    await broadcastMemberJoined(room.id);
  }

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
      onRoomUpdated(updated);
      void broadcastStageChange(room.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to advance stage");
    } finally {
      setAdvancing(false);
    }
  }

  // ─── Palette constants ────────────────────────────────────────────────────────
  const DEEP_NAVY = "var(--pt-bg-deep, #0F1B2E)";
  const TEXT_PRIMARY = "var(--pt-text-primary, #E8ECF1)";
  const BG_CARD = "var(--pt-bg-card, #162032)";
  const SUNSET_ORANGE = "#FB923C";
  const GRASS_GREEN = "#4ADE80";
  const SKY_BLUE = "#38BDF8";

  return (
    <section
      className="mx-auto flex max-w-3xl flex-col gap-6"
      style={{ fontFamily: "'Courier New', Courier, monospace" }}
    >
      {/* ── Stage header ──────────────────────────────────────────────────────── */}
      <div
        style={{
          border: `2px solid rgba(255,255,255,0.15)`,
          boxShadow: `0 2px 8px rgba(0,0,0,0.35)`,
          backgroundColor: BG_CARD,
          padding: "20px 24px",
        }}
      >
        <p
          style={{
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: TEXT_PRIMARY,
            opacity: 0.75,
          }}
        >
          Current stage
        </p>
        <h2
          style={{
            fontSize: "22px",
            fontWeight: 700,
            color: TEXT_PRIMARY,
            marginTop: "4px",
            letterSpacing: "0.05em",
          }}
        >
          🏕️ Lobby
        </h2>
        <p
          style={{
            marginTop: "8px",
            color: TEXT_PRIMARY,
            fontSize: "13px",
            lineHeight: 1.5,
          }}
        >
          Build your 8-bit travel character. Your choices shape the destination
          suggestions and itinerary the AI creates for your group.
        </p>
      </div>

      {/* ── Character Creator ──────────────────────────────────────────────────── */}
      <div
        style={{
          border: `2px solid rgba(255,255,255,0.15)`,
          boxShadow: `0 2px 8px rgba(0,0,0,0.35)`,
          backgroundColor: BG_CARD,
          padding: "24px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "20px",
          }}
        >
          <h3
            style={{
              fontSize: "14px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: TEXT_PRIMARY,
            }}
          >
            Build Your Character
          </h3>
          {confirmedProfile && (
            <span
              style={{
                fontSize: "11px",
                color: DEEP_NAVY,
                backgroundColor: GRASS_GREEN,
                border: `2px solid ${GRASS_GREEN}`,
                padding: "2px 8px",
                fontWeight: 700,
                letterSpacing: "0.05em",
              }}
            >
              ✔ Saved
            </span>
          )}
        </div>

        <CharacterCreator
          identity={identity}
          roomId={room.id}
          onConfirmed={(profile) => void handleConfirmed(profile)}
        />
      </div>

      {/* ── Members list ──────────────────────────────────────────────────────── */}
      <div
        style={{
          border: `2px solid rgba(255,255,255,0.15)`,
          boxShadow: `0 2px 8px rgba(0,0,0,0.35)`,
          backgroundColor: BG_CARD,
          padding: "24px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "16px",
          }}
        >
          <h3
            style={{
              fontSize: "14px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: TEXT_PRIMARY,
            }}
          >
            Party Members
          </h3>
          <span
            style={{
              fontSize: "12px",
              color: DEEP_NAVY,
              backgroundColor: SKY_BLUE,
              border: `2px solid ${SKY_BLUE}`,
              padding: "2px 8px",
            }}
          >
            {members.length} {members.length === 1 ? "person" : "people"} here
          </span>
        </div>

        {members.length === 0 ? (
          <p style={{ fontSize: "13px", color: TEXT_PRIMARY, opacity: 0.6 }}>
            No members yet…
          </p>
        ) : (
          <ul style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {members.map((member) => {
              const isSelf = member.id === identity.userId;
              const isMemberHost = member.id === room.hostUserId;
              return (
                <li
                  key={member.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    backgroundColor: isSelf ? "rgba(79, 209, 197, 0.15)" : "rgba(255,255,255,0.05)",
                    border: `1px solid rgba(255,255,255,0.15)`,
                    padding: "8px 12px",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {/* Online dot */}
                    <span
                      aria-hidden="true"
                      style={{
                        display: "inline-block",
                        width: "10px",
                        height: "10px",
                        backgroundColor: GRASS_GREEN,
                        border: `2px solid ${GRASS_GREEN}`,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontWeight: 700, fontSize: "13px", color: TEXT_PRIMARY }}>
                      {member.displayName || "Traveller"}
                      {isSelf && (
                        <span style={{ marginLeft: "6px", opacity: 0.5, fontWeight: 400 }}>
                          (you)
                        </span>
                      )}
                    </span>
                    {isMemberHost && (
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          backgroundColor: SUNSET_ORANGE,
                          color: DEEP_NAVY,
                          border: `2px solid ${SUNSET_ORANGE}`,
                          padding: "1px 6px",
                        }}
                      >
                        👑 Host
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Host advance control ───────────────────────────────────────────────── */}
      {isHost ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "8px" }}>
          <button
            type="button"
            onClick={() => void handleAdvance()}
            disabled={advancing}
            aria-disabled={advancing}
            style={{
              border: `2px solid ${SUNSET_ORANGE}`,
              boxShadow: advancing ? "none" : `4px 4px 0px ${SUNSET_ORANGE}`,
              backgroundColor: advancing ? "#9CA3AF" : SUNSET_ORANGE,
              color: DEEP_NAVY,
              padding: "12px 24px",
              fontFamily: "'Courier New', Courier, monospace",
              fontWeight: 700,
              fontSize: "14px",
              letterSpacing: "0.05em",
              cursor: advancing ? "not-allowed" : "pointer",
              opacity: advancing ? 0.5 : 1,
              borderRadius: 0,
              transition: "opacity 0.1s",
            }}
          >
            {advancing ? "Advancing…" : "Advance stage →"}
          </button>
          {error && (
            <p
              role="alert"
              style={{
                fontSize: "12px",
                color: TEXT_PRIMARY,
                backgroundColor: BG_CARD,
                border: `2px solid ${SUNSET_ORANGE}`,
                padding: "8px 12px",
              }}
            >
              {error}
            </p>
          )}
        </div>
      ) : (
        <p
          style={{
            fontSize: "13px",
            color: TEXT_PRIMARY,
            opacity: 0.65,
            fontStyle: "italic",
          }}
        >
          ⏳ Waiting for the host to start planning…
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
