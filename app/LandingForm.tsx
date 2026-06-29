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
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold">PixelTrip</h1>
        <p className="mt-2 text-gray-600">
          Collaborative AI travel planning with 8-bit personas.
        </p>
      </div>

      <div className="w-full max-w-md rounded-lg border border-gray-200 p-6">
        <div className="mb-6 flex gap-2" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "create"}
            onClick={() => {
              setMode("create");
              setErrorMessage("");
            }}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium ${
              mode === "create"
                ? "bg-black text-white"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            Create a room
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "join"}
            onClick={() => {
              setMode("join");
              setErrorMessage("");
            }}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium ${
              mode === "join"
                ? "bg-black text-white"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            Join a room
          </button>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayNameState(e.target.value)}
              placeholder="e.g. Alex"
              className="rounded-md border border-gray-300 px-3 py-2"
              maxLength={40}
            />
          </label>

          {mode === "join" && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Room code</span>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="e.g. AB12CD"
                className="rounded-md border border-gray-300 px-3 py-2 font-mono uppercase"
                maxLength={6}
              />
            </label>
          )}

          {errorMessage && (
            <p className="text-sm text-red-600">{errorMessage}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {submitting
              ? "Please wait…"
              : mode === "create"
                ? "Create room"
                : "Join room"}
          </button>
        </form>

        {createdRoom && (
          <div className="mt-6 rounded-md bg-gray-50 p-4 text-sm">
            <p className="font-medium">Room created!</p>
            <p className="mt-1">
              Code:{" "}
              <span className="font-mono font-bold">
                {createdRoom.roomCode}
              </span>
            </p>
            <p className="mt-1 break-all text-gray-600">
              Share this link: {inviteLink}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
