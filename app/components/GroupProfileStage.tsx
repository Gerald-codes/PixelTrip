"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { StageProps } from "@/app/components/StageRouter";
import { createAnonSupabase } from "@/lib/supabase";
import type { GroupProfile } from "@/lib/types";

/**
 * GroupProfileStage — shows the AI-generated combined travel profile and the
 * group's tension points before destinations are surfaced. This is the priming
 * for Demo Moment 1 ("Why this place?") — the group sees where they overlap
 * and where they clash, so the destination recommendations land in context.
 *
 * Behaviour:
 * - On mount, fetch the persisted profile via
 *   `GET /api/agents/group-profile?roomId=...`.
 *   - 200 → render the profile.
 *   - 404 → host sees a "Generate group profile" button that POSTs to the
 *           same route; non-hosts see a waiting message.
 * - When the agent POST returns `{ error, retryable }`, the error is shown
 *   inline with a Retry button only when `retryable` is true.
 * - Host-only "Advance stage" button at the bottom (enabled only when a
 *   profile exists) PATCHes the stage endpoint and broadcasts `stage-change`
 *   so every client re-renders.
 */
export default function GroupProfileStage({
  room,
  identity,
  members,
}: StageProps) {
  const isHost = identity.userId === room.hostUserId;

  // ── Profile fetch ────────────────────────────────────────────────────────────
  const [profile, setProfile] = useState<GroupProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);

  // `notFound` is a *normal* state (no profile yet) — distinct from a real
  // error. The host sees a generate button; everyone else sees a waiting note.
  const [notFound, setNotFound] = useState(false);

  const fetchProfile = useCallback(async (): Promise<void> => {
    setProfileLoading(true);
    setProfileLoadError(null);
    try {
      const res = await fetch(
        `/api/agents/group-profile?roomId=${encodeURIComponent(room.id)}`,
        { cache: "no-store" },
      );
      if (res.status === 404) {
        setProfile(null);
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Failed to load group profile");
      }
      const data = (await res.json()) as GroupProfile;
      setProfile(data);
      setNotFound(false);
    } catch (err) {
      setProfileLoadError(
        err instanceof Error ? err.message : "Failed to load group profile",
      );
    } finally {
      setProfileLoading(false);
    }
  }, [room.id]);

  const fetchProfileRef = useRef(fetchProfile);
  fetchProfileRef.current = fetchProfile;

  // Keep a ref of the current profile so the poll interval can read it
  // without retriggering the effect.
  const profileRef = useRef<GroupProfile | null>(null);
  profileRef.current = profile;

  // Initial fetch + light polling so non-host clients pick up the profile
  // shortly after the host generates it. (We intentionally don't bake a
  // dedicated realtime channel for this — polling every 3s is plenty.)
  useEffect(() => {
    void fetchProfileRef.current();
    const interval = setInterval(() => {
      // Only keep polling while no profile has been loaded yet; once we have
      // one, the data is stable until the next stage.
      if (!profileRef.current) {
        void fetchProfileRef.current();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // ── Generate (host only) ─────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateRetryable, setGenerateRetryable] = useState(false);

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    setGenerateError(null);
    setGenerateRetryable(false);
    try {
      const res = await fetch("/api/agents/group-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; retryable?: boolean }
          | null;
        setGenerateRetryable(body?.retryable === true);
        throw new Error(body?.error ?? "Failed to generate group profile");
      }
      const data = (await res.json()) as GroupProfile;
      setProfile(data);
      setNotFound(false);
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : "Failed to generate group profile",
      );
    } finally {
      setGenerating(false);
    }
  }

  // ── Stage advance (host only) ────────────────────────────────────────────────
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
      await broadcastStageChange(room.id);
    } catch (err) {
      setAdvanceError(
        err instanceof Error ? err.message : "Failed to advance stage",
      );
    } finally {
      setAdvancing(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="rounded-lg border border-gray-200 p-6">
        <p className="text-sm uppercase tracking-wide text-gray-500">
          Current stage
        </p>
        <h2 className="mt-1 text-2xl font-bold">Group profile</h2>
        <p className="mt-2 text-gray-600">
          Here&apos;s how the AI sees your group — overlapping window, common
          interests, and the friction points to keep in mind before we pick a
          destination.
        </p>
        <p className="mt-2 text-xs text-gray-500">
          {members.length} {members.length === 1 ? "member" : "members"} in this
          room.
        </p>
      </div>

      {profileLoading && !profile ? (
        <div className="rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-500">Loading group profile…</p>
        </div>
      ) : profileLoadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="text-sm text-red-700">{profileLoadError}</p>
          <button
            type="button"
            onClick={() => void fetchProfile()}
            className="mt-3 rounded-md border border-red-300 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-100"
          >
            Try again
          </button>
        </div>
      ) : profile ? (
        <ProfileView profile={profile} />
      ) : notFound ? (
        <div className="rounded-lg border border-gray-200 p-6">
          {isHost ? (
            <>
              <h3 className="text-lg font-semibold">
                Generate the group profile
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                The AI will summarise your group from everyone&apos;s personas,
                availability, and destination interests.
              </p>
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={generating}
                className="mt-4 rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generating ? "Generating…" : "Generate group profile"}
              </button>
              {generateError && (
                <div className="mt-3 flex flex-col items-start gap-2">
                  <p className="text-sm text-red-600">{generateError}</p>
                  {generateRetryable && (
                    <button
                      type="button"
                      onClick={() => void handleGenerate()}
                      disabled={generating}
                      className="rounded-md border border-red-300 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {generating ? "Retrying…" : "Retry"}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-600">
              Waiting for the host to generate the group profile…
            </p>
          )}
        </div>
      ) : null}

      {isHost ? (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => void handleAdvance()}
            disabled={advancing || !profile}
            className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {advancing ? "Advancing…" : "Advance stage"}
          </button>
          {!profile && (
            <p className="text-xs text-gray-500">
              Generate the group profile before advancing.
            </p>
          )}
          {advanceError && (
            <p className="text-sm text-red-600">{advanceError}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          Waiting for the host to advance to the next stage…
        </p>
      )}
    </section>
  );
}

// ─── Presentational pieces ────────────────────────────────────────────────────

function ProfileView({ profile }: { profile: GroupProfile }) {
  return (
    <>
      <div className="rounded-lg border border-gray-200 p-6">
        <h3 className="mb-4 text-lg font-semibold">Combined profile</h3>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Budget range" value={profile.budgetRange} />
          <Field
            label="Dominant pace"
            value={
              <span className="capitalize">{profile.dominantPace}</span>
            }
          />
          <Field
            label="Travel window"
            value={
              profile.travelWindow ? (
                <>
                  <span className="font-mono">
                    {profile.travelWindow.startDate}
                  </span>{" "}
                  →{" "}
                  <span className="font-mono">
                    {profile.travelWindow.endDate}
                  </span>
                </>
              ) : (
                <span className="text-gray-500">No common window yet</span>
              )
            }
          />
          <Field
            label="Dominant traits"
            value={
              profile.dominantPersonaTraits.length > 0 ? (
                <TagList tags={profile.dominantPersonaTraits} tone="neutral" />
              ) : (
                <span className="text-gray-500">None identified</span>
              )
            }
          />
        </dl>

        <div className="mt-6">
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Common interests
          </p>
          <div className="mt-2">
            {profile.commonInterests.length > 0 ? (
              <TagList tags={profile.commonInterests} tone="info" />
            ) : (
              <p className="text-sm text-gray-500">
                No shared interests surfaced.
              </p>
            )}
          </div>
        </div>
      </div>

      <div
        role="alert"
        className="rounded-lg border border-amber-300 bg-amber-50 p-6"
      >
        <div className="flex items-center gap-2">
          <span aria-hidden="true">⚠️</span>
          <h3 className="text-lg font-semibold text-amber-900">
            Tension points
          </h3>
        </div>
        <p className="mt-1 text-sm text-amber-800">
          Worth flagging before we pick a destination so we can plan around
          them.
        </p>
        {profile.tensionPoints.length > 0 ? (
          <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm text-amber-900">
            {profile.tensionPoints.map((point, i) => (
              <li key={`${point}-${i}`}>{point}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-amber-900">
            None — this group is well aligned.
          </p>
        )}
      </div>
    </>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-gray-900">{value}</dd>
    </div>
  );
}

function TagList({
  tags,
  tone,
}: {
  tags: string[];
  tone: "info" | "neutral";
}) {
  const toneClass =
    tone === "info"
      ? "bg-blue-100 text-blue-800"
      : "bg-gray-100 text-gray-800";
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((tag, i) => (
        <li
          key={`${tag}-${i}`}
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClass}`}
        >
          {tag}
        </li>
      ))}
    </ul>
  );
}

/**
 * Broadcast a `stage-change` event so every connected client re-fetches the
 * room. Mirrors the helper in LobbyStage / AvailabilityStage.
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
