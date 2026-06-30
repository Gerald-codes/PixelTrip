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
 * Landing form (client component).
 *
 * Wrapped in a Suspense boundary by app/page.tsx because it uses
 * useSearchParams() to read ?join=CODE from invite links.
 *
 * Two flows, both gated on a display name:
 * - Create: POST /api/rooms (with the local hostUserId), then POST /api/users
 *   to join the new room as host. On success the room code and a shareable
 *   invite link are shown before navigating to /room/[code].
 * - Join: GET /api/rooms/[code] to resolve the room, then POST /api/users to
 *   join, then navigate to /room/[code].
 *
 * Identity (userId + displayName) comes from lib/identity.ts (localStorage).
 */
export default function LandingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const inviteCode = searchParams.get("join")?.toUpperCase() ?? "";

  const [mode, setMode] = useState<Mode>(inviteCode ? "join" : "create");
  const [displayName, setDisplayNameState] = useState<string>(() =>
    getDisplayName(),
  );
  const [joinCode, setJoinCode] = useState<string>(inviteCode);

  useEffect(() => {
    if (inviteCode) {
      setJoinCode(inviteCode);
      setMode("join");
    }
  }, [inviteCode]);

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
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
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
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
      const body = (await createRes.json().catch(() => null)) as
        | { error?: string }
        | null;
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
      const body = (await lookupRes.json().catch(() => null)) as
        | { error?: string }
        | null;
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
      setErrorMessage(
        err instanceof Error ? err.message : "Something went wrong",
      );
      setSubmitting(false);
    }
  }

  return (
    /* Hero section: two-stop gradient from deep navy → sky blue */
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 bg-gradient-to-br from-[#1E3A5F] to-[#38BDF8] p-8">

      {/* Title block */}
      <div className="text-center">
        <h1 className="text-5xl font-black tracking-tight text-[#FEF3C7] drop-shadow-[3px_3px_0px_#1E3A5F]">
          🗺️ PixelTrip
        </h1>
        <p className="mt-3 text-lg font-semibold text-[#FEF3C7]">
          Collaborative AI travel planning with 8-bit personas.
        </p>
      </div>

      {/* Card */}
      <div
        className="w-full max-w-md border-4 border-[#1E3A5F] bg-[#FEF3C7] p-6 shadow-[4px_4px_0px_#1E3A5F]"
        /* no border-radius — pixel card style */
      >
        {/* Mode tabs */}
        <div className="mb-6 flex gap-3" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "create"}
            onClick={() => {
              setMode("create");
              setErrorMessage("");
            }}
            className={`flex-1 border-2 px-4 py-2 text-sm font-bold shadow-[3px_3px_0px_#1E3A5F] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
              mode === "create"
                ? "border-[#1E3A5F] bg-[#FB923C] text-[#1E3A5F]"
                : "border-[#1E3A5F] bg-[#FEF3C7] text-[#1E3A5F] hover:bg-[#FB923C]/30"
            }`}
          >
            ✈️ Create Room
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "join"}
            onClick={() => {
              setMode("join");
              setErrorMessage("");
            }}
            className={`flex-1 border-2 px-4 py-2 text-sm font-bold shadow-[3px_3px_0px_#1E3A5F] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
              mode === "join"
                ? "border-[#1E3A5F] bg-[#38BDF8] text-[#1E3A5F]"
                : "border-[#1E3A5F] bg-[#FEF3C7] text-[#1E3A5F] hover:bg-[#38BDF8]/30"
            }`}
          >
            🚪 Join Room
          </button>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-bold text-[#1E3A5F]">Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayNameState(e.target.value)}
              placeholder="e.g. Alex"
              className="border-2 border-[#1E3A5F] bg-[#FEF3C7] px-3 py-2 font-medium text-[#1E3A5F] placeholder-[#1E3A5F]/40 shadow-[2px_2px_0px_#1E3A5F] outline-none focus:bg-white"
              maxLength={40}
            />
          </label>

          {mode === "join" && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-bold text-[#1E3A5F]">Room code</span>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="e.g. AB12CD"
                className="border-2 border-[#1E3A5F] bg-[#FEF3C7] px-3 py-2 font-mono font-bold uppercase tracking-widest text-[#1E3A5F] placeholder-[#1E3A5F]/40 shadow-[2px_2px_0px_#1E3A5F] outline-none focus:bg-white"
                maxLength={6}
              />
            </label>
          )}

          {errorMessage && (
            <p className="border-2 border-red-600 bg-red-100 px-3 py-2 text-sm font-semibold text-red-700 shadow-[2px_2px_0px_#991b1b]">
              ⚠️ {errorMessage}
            </p>
          )}

          {/* CTA button — sunset orange, retro 8-bit style */}
          <button
            type="submit"
            disabled={submitting}
            className="border-4 border-[#1E3A5F] bg-[#FB923C] px-4 py-3 font-black text-[#1E3A5F] shadow-[4px_4px_0px_#1E3A5F] transition-all hover:bg-[#f97316] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? "⏳ Please wait…"
              : mode === "create"
                ? "🚀 Create room"
                : "🎮 Join room"}
          </button>
        </form>

        {/* Room created success panel */}
        {createdRoom && (
          <div className="mt-6 border-4 border-[#4ADE80] bg-[#FEF3C7] p-4 text-sm shadow-[4px_4px_0px_#1E3A5F]">
            <p className="font-black text-[#1E3A5F]">🎉 Room created!</p>
            <p className="mt-2 text-[#1E3A5F]">
              Code:{" "}
              <span className="font-mono font-black tracking-widest text-[#A855F7]">
                {createdRoom.roomCode}
              </span>
            </p>
            <p className="mt-2 break-all font-medium text-[#1E3A5F]">
              Share this link:{" "}
              <span className="font-mono text-xs text-[#1E3A5F]/70">{inviteLink}</span>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
