"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  getDisplayName,
  getOrCreateUserId,
  setDisplayName as persistDisplayName,
} from "@/lib/identity";
import type { TripRoom, User } from "@/lib/types";

type Mode = "create" | "join";

/**
 * Landing form — dark navy PixelTrip theme.
 *
 * Two flows gated on a display name:
 * - Create: POST /api/rooms → POST /api/users → navigate to /room/[code]
 * - Join:   GET /api/rooms/[code] → POST /api/users → navigate to /room/[code]
 */
export default function LandingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const inviteCode = searchParams.get("join")?.toUpperCase() ?? "";

  const [mode, setMode] = useState<Mode>(inviteCode ? "join" : "create");
  const [displayName, setDisplayNameState] = useState<string>(() => getDisplayName());
  const [joinCode, setJoinCode] = useState<string>(inviteCode);

  useEffect(() => {
    if (inviteCode) {
      setJoinCode(inviteCode);
      setMode("join");
    }
  }, [inviteCode]);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [createdRoom, setCreatedRoom] = useState<TripRoom | null>(null);

  const inviteLink = useMemo(() => {
    if (!createdRoom) return "";
    if (typeof window === "undefined") return `/?join=${createdRoom.roomCode}`;
    return `${window.location.origin}/?join=${createdRoom.roomCode}`;
  }, [createdRoom]);

  async function joinRoom(roomId: string, userId: string, name: string) {
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: userId, displayName: name, roomId }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Failed to join room");
    }
    return (await res.json()) as User;
  }

  async function handleCreate() {
    const name = displayName.trim();
    const userId = getOrCreateUserId();
    persistDisplayName(name);

    const createRes = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostUserId: userId }),
    });
    if (!createRes.ok) {
      const body = (await createRes.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Failed to create room");
    }
    const room = (await createRes.json()) as TripRoom;
    await joinRoom(room.id, userId, name);
    setCreatedRoom(room);
    router.push(`/room/${room.roomCode}?name=${encodeURIComponent(name)}`);
  }

  async function handleJoin() {
    const name = displayName.trim();
    const code = joinCode.trim().toUpperCase();
    const userId = getOrCreateUserId();
    persistDisplayName(name);

    const lookupRes = await fetch(`/api/rooms/${code}`);
    if (!lookupRes.ok) {
      const body = (await lookupRes.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Room not found");
    }
    const room = (await lookupRes.json()) as TripRoom;
    await joinRoom(room.id, userId, name);
    router.push(`/room/${room.roomCode}?name=${encodeURIComponent(name)}`);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage("");

    if (displayName.trim() === "") {
      setErrorMessage("Please enter a display name.");
      return;
    }
    if (mode === "join" && joinCode.trim() === "") {
      setErrorMessage("Please enter a room code to join.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "create") {
        await handleCreate();
      } else {
        await handleJoin();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  // ── Shared input style ──────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 6,
    padding: "10px 14px",
    color: "#E8ECF1",
    fontFamily: "var(--pt-font-body)",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0A1628",
        backgroundImage: `
          radial-gradient(ellipse at 20% 30%, rgba(79,209,197,0.06) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 70%, rgba(167,139,250,0.06) 0%, transparent 50%)
        `,
        padding: "32px 16px",
        fontFamily: "var(--pt-font-body)",
      }}
    >
      {/* ── Logo block ── */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        {/* Pixel compass icon made of rects */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true" style={{ imageRendering: "pixelated" }}>
            {/* Outer ring */}
            <rect x="14" y="4"  width="20" height="4"  fill="#4FD1C5" />
            <rect x="14" y="40" width="20" height="4"  fill="#4FD1C5" />
            <rect x="4"  y="14" width="4"  height="20" fill="#4FD1C5" />
            <rect x="40" y="14" width="4"  height="20" fill="#4FD1C5" />
            <rect x="8"  y="8"  width="8"  height="4"  fill="#4FD1C5" />
            <rect x="32" y="8"  width="8"  height="4"  fill="#4FD1C5" />
            <rect x="8"  y="36" width="8"  height="4"  fill="#4FD1C5" />
            <rect x="32" y="36" width="8"  height="4"  fill="#4FD1C5" />
            <rect x="8"  y="12" width="4"  height="8"  fill="#4FD1C5" />
            <rect x="36" y="12" width="4"  height="8"  fill="#4FD1C5" />
            <rect x="8"  y="28" width="4"  height="8"  fill="#4FD1C5" />
            <rect x="36" y="28" width="4"  height="8"  fill="#4FD1C5" />
            {/* Inner fill */}
            <rect x="12" y="12" width="24" height="24" fill="#0F1B2E" />
            {/* Compass needle — north orange */}
            <rect x="22" y="14" width="4"  height="10" fill="#FB923C" />
            {/* Compass needle — south teal */}
            <rect x="22" y="24" width="4"  height="10" fill="#4FD1C5" />
            {/* Centre dot */}
            <rect x="22" y="22" width="4"  height="4"  fill="#E8ECF1" />
          </svg>
        </div>

        <h1
          style={{
            fontFamily: "var(--pt-font-pixel)",
            fontSize: 22,
            color: "#E8ECF1",
            letterSpacing: "0.06em",
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          PixelTrip
        </h1>
        <p
          style={{
            marginTop: 10,
            fontSize: 14,
            color: "rgba(232,236,241,0.55)",
            fontFamily: "var(--pt-font-body)",
            fontWeight: 400,
          }}
        >
          Collaborative AI travel planning with 8-bit personas.
        </p>
      </div>

      {/* ── Card ── */}
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          backgroundColor: "#0F1B2E",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          padding: "28px 28px 32px",
        }}
      >
        {/* Mode tabs */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 24,
            background: "rgba(255,255,255,0.05)",
            borderRadius: 8,
            padding: 4,
          }}
          role="tablist"
        >
          {(["create", "join"] as Mode[]).map((m) => {
            const isActive = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => { setMode(m); setErrorMessage(""); }}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: 6,
                  border: "none",
                  background: isActive ? "#4FD1C5" : "transparent",
                  color: isActive ? "#0F1B2E" : "rgba(232,236,241,0.55)",
                  fontFamily: "var(--pt-font-pixel)",
                  fontSize: 8,
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                  transition: "all 0.15s",
                }}
              >
                {m === "create" ? "Create Room" : "Join Room"}
              </button>
            );
          })}
        </div>

        <form
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
          onSubmit={handleSubmit}
        >
          {/* Display name */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label
              htmlFor="displayName"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "rgba(232,236,241,0.6)",
                fontFamily: "var(--pt-font-body)",
                letterSpacing: "0.03em",
              }}
            >
              Display name
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayNameState(e.target.value)}
              placeholder="e.g. Alex"
              maxLength={40}
              style={inputStyle}
              onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "rgba(79,209,197,0.6)"; }}
              onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.15)"; }}
            />
          </div>

          {/* Room code (join mode) */}
          {mode === "join" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label
                htmlFor="roomCode"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "rgba(232,236,241,0.6)",
                  fontFamily: "var(--pt-font-body)",
                  letterSpacing: "0.03em",
                }}
              >
                Room code
              </label>
              <input
                id="roomCode"
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="e.g. AB12CD"
                maxLength={6}
                style={{
                  ...inputStyle,
                  fontFamily: "var(--pt-font-pixel)",
                  fontSize: 12,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                }}
                onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "rgba(79,209,197,0.6)"; }}
                onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.15)"; }}
              />
            </div>
          )}

          {/* Error */}
          {errorMessage && (
            <div
              style={{
                background: "rgba(248,113,113,0.1)",
                border: "1px solid rgba(248,113,113,0.35)",
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 13,
                color: "#FCA5A5",
                fontFamily: "var(--pt-font-body)",
              }}
            >
              ⚠ {errorMessage}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            style={{
              marginTop: 4,
              padding: "12px 24px",
              borderRadius: 8,
              border: "none",
              background: submitting ? "rgba(255,255,255,0.08)" : "#FB923C",
              color: submitting ? "rgba(232,236,241,0.35)" : "#0F1B2E",
              fontFamily: "var(--pt-font-pixel)",
              fontSize: 10,
              fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
              letterSpacing: "0.04em",
              opacity: submitting ? 0.6 : 1,
              transition: "all 0.15s",
            }}
          >
            {submitting
              ? "Please wait…"
              : mode === "create"
                ? "Create room"
                : "Join room"}
          </button>
        </form>

        {/* Room created success */}
        {createdRoom && (
          <div
            style={{
              marginTop: 20,
              background: "rgba(74,222,128,0.08)",
              border: "1px solid rgba(74,222,128,0.3)",
              borderRadius: 8,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <span
              style={{
                fontFamily: "var(--pt-font-pixel)",
                fontSize: 9,
                color: "#4ADE80",
                letterSpacing: "0.04em",
              }}
            >
              Room created!
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "rgba(232,236,241,0.55)", fontFamily: "var(--pt-font-body)" }}>
                Code:
              </span>
              <span
                style={{
                  fontFamily: "var(--pt-font-pixel)",
                  fontSize: 13,
                  color: "#A78BFA",
                  letterSpacing: "0.12em",
                }}
              >
                {createdRoom.roomCode}
              </span>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 11,
                color: "rgba(232,236,241,0.45)",
                fontFamily: "var(--pt-font-body)",
                wordBreak: "break-all",
              }}
            >
              {inviteLink}
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <p
        style={{
          marginTop: 32,
          fontSize: 11,
          color: "rgba(232,236,241,0.2)",
          fontFamily: "var(--pt-font-body)",
          textAlign: "center",
        }}
      >
        No account needed · Share a room code to travel together
      </p>
    </main>
  );
}
