"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { StageProps } from "@/app/components/StageRouter";
import { createAnonSupabase } from "@/lib/supabase";
import type { GroupProfile, TripRoom } from "@/lib/types";

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
  onRoomUpdated,
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
          | { error?: string; message?: string }
          | null;
        throw new Error(body?.message ?? body?.error ?? "Failed to advance stage");
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

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="border-4 border-[#1E3A5F] bg-[#FEF3C7] p-6 shadow-[4px_4px_0px_#1E3A5F]">
        <p className="text-sm font-bold uppercase tracking-wide text-[#1E3A5F]">
          Current stage
        </p>
        <h2 className="mt-1 text-2xl font-bold text-[#1E3A5F]">Group profile</h2>
        <p className="mt-2 text-[#1E3A5F]">
          Here&apos;s how the AI sees your group — overlapping window, common
          interests, and the friction points to keep in mind before we pick a
          destination.
        </p>
        <p className="mt-2 text-xs font-semibold text-[#1E3A5F]">
          {members.length} {members.length === 1 ? "member" : "members"} in this
          room.
        </p>
      </div>

      {profileLoading && !profile ? (
        <div className="border-4 border-[#1E3A5F] bg-[#FEF3C7] p-6 shadow-[4px_4px_0px_#1E3A5F]">
          <p className="text-sm font-semibold text-[#1E3A5F]">Loading group profile…</p>
        </div>
      ) : profileLoadError ? (
        <div className="border-4 border-red-600 bg-red-50 p-6 shadow-[4px_4px_0px_#1E3A5F]">
          <p className="text-sm font-semibold text-red-700">{profileLoadError}</p>
          <button
            type="button"
            onClick={() => void fetchProfile()}
            className="mt-3 border-2 border-red-600 bg-red-50 px-3 py-1 text-sm font-bold text-red-700 shadow-[3px_3px_0px_#991B1B] hover:bg-red-100 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
          >
            Try again
          </button>
        </div>
      ) : profile ? (
        <ProfileView profile={profile} />
      ) : notFound ? (
        <div className="border-4 border-[#1E3A5F] bg-[#FEF3C7] p-6 shadow-[4px_4px_0px_#1E3A5F]">
          {isHost ? (
            <>
              <h3 className="text-lg font-bold text-[#1E3A5F]">
                Generate the group profile
              </h3>
              <p className="mt-1 text-sm text-[#1E3A5F]">
                The AI will summarise your group from everyone&apos;s personas,
                availability, and destination interests.
              </p>
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={generating}
                className="mt-4 border-4 border-[#1E3A5F] bg-[#38BDF8] px-4 py-2 font-bold text-[#1E3A5F] shadow-[4px_4px_0px_#1E3A5F] hover:bg-[#0ea5e9] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? "Generating…" : "Generate group profile"}
              </button>
              {generateError && (
                <div className="mt-3 flex flex-col items-start gap-2">
                  <p className="text-sm font-semibold text-red-600">{generateError}</p>
                  {generateRetryable && (
                    <button
                      type="button"
                      onClick={() => void handleGenerate()}
                      disabled={generating}
                      className="border-2 border-red-600 bg-red-50 px-3 py-1 text-sm font-bold text-red-700 shadow-[3px_3px_0px_#991B1B] hover:bg-red-100 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {generating ? "Retrying…" : "Retry"}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm font-semibold text-[#1E3A5F]">
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
            className="border-4 border-[#1E3A5F] bg-[#FB923C] px-4 py-2 font-bold text-[#1E3A5F] shadow-[4px_4px_0px_#1E3A5F] hover:bg-[#f97316] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {advancing ? "Advancing…" : "Advance stage"}
          </button>
          {!profile && (
            <p className="text-xs font-semibold text-[#1E3A5F]">
              Generate the group profile before advancing.
            </p>
          )}
          {advanceError && (
            <p className="text-sm font-semibold text-red-600">{advanceError}</p>
          )}
        </div>
      ) : (
        <p className="text-sm font-semibold text-[#1E3A5F]">
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
      <div className="border-4 border-[#1E3A5F] bg-[#FEF3C7] p-6 shadow-[4px_4px_0px_#1E3A5F]">
        <h3 className="mb-4 text-lg font-bold text-[#1E3A5F]">Combined profile</h3>
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
                  <span className="font-mono font-bold">
                    {profile.travelWindow.startDate}
                  </span>{" "}
                  →{" "}
                  <span className="font-mono font-bold">
                    {profile.travelWindow.endDate}
                  </span>
                </>
              ) : (
                <span className="font-semibold text-[#1E3A5F] opacity-60">No common window yet</span>
              )
            }
          />
          <Field
            label="Dominant traits"
            value={
              profile.dominantPersonaTraits.length > 0 ? (
                <TagList tags={profile.dominantPersonaTraits} tone="neutral" />
              ) : (
                <span className="font-semibold text-[#1E3A5F] opacity-60">None identified</span>
              )
            }
          />
        </dl>

        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F]">
            Common interests
          </p>
          <div className="mt-2">
            {profile.commonInterests.length > 0 ? (
              <TagList tags={profile.commonInterests} tone="info" />
            ) : (
              <p className="text-sm font-semibold text-[#1E3A5F] opacity-60">
                No shared interests surfaced.
              </p>
            )}
          </div>
        </div>
      </div>

      <div
        role="alert"
        className="border-4 border-[#FB923C] bg-amber-50 p-6 shadow-[4px_4px_0px_#1E3A5F]"
      >
        <div className="flex items-center gap-2">
          <span aria-hidden="true">⚠️</span>
          <h3 className="text-lg font-bold text-[#1E3A5F]">
            Tension points
          </h3>
        </div>
        <p className="mt-1 text-sm font-semibold text-[#1E3A5F]">
          Worth flagging before we pick a destination so we can plan around
          them.
        </p>
        {profile.tensionPoints.length > 0 ? (
          <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm text-[#1E3A5F]">
            {profile.tensionPoints.map((point, i) => (
              <li key={`${point}-${i}`}>{point}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm font-semibold text-[#1E3A5F]">
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
      <dt className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F]">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-[#1E3A5F]">{value}</dd>
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
      ? "bg-[#38BDF8] text-[#1E3A5F] border-2 border-[#1E3A5F]"
      : "bg-[#4ADE80] text-[#1E3A5F] border-2 border-[#1E3A5F]";
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((tag, i) => (
        <li
          key={`${tag}-${i}`}
          className={`px-2.5 py-0.5 text-xs font-bold shadow-[2px_2px_0px_#1E3A5F] ${toneClass}`}
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
