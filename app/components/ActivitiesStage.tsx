"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { StageProps } from "@/app/components/StageRouter";
import { createAnonSupabase } from "@/lib/supabase";
import type { ActivityPreference, TripRoom, User } from "@/lib/types";

/** Valid values for the `type` field — mirrors the API route. */
type ActivityType = "activity" | "food" | "sight" | "experience" | "avoid";
/** Valid values for the `priority` field. */
type Priority = "must_have" | "optional";

// ─── Color maps ───────────────────────────────────────────────────────────────

/** Pixel-art badge bg (+ optional text override) per activity type. */
const TYPE_BADGE: Record<ActivityType, string> = {
  activity: "bg-[#38BDF8] text-pt-text-primary",
  food: "bg-[#FB923C] text-pt-text-primary",
  sight: "bg-[#4ADE80] text-pt-text-primary",
  experience: "bg-[var(--pt-agent-atlas)] text-white",
  avoid: "bg-red-400 text-white",
};

const TYPE_LABELS: Record<ActivityType, string> = {
  activity: "Activity",
  food: "Food",
  sight: "Sight",
  experience: "Experience",
  avoid: "Avoid",
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function ActivitiesStage({
  room,
  identity,
  members,
  onRoomUpdated,
}: StageProps) {
  const isHost = identity.userId === room.hostUserId;

  // ── All preferences (all users in this room) ─────────────────────────────
  const [allPreferences, setAllPreferences] = useState<ActivityPreference[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchPreferences = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(
        `/api/activity-preferences?roomId=${encodeURIComponent(room.id)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Failed to load preferences");
      }
      const data = (await res.json()) as ActivityPreference[];
      setAllPreferences(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load preferences",
      );
    }
  }, [room.id]);

  const fetchPreferencesRef = useRef(fetchPreferences);
  fetchPreferencesRef.current = fetchPreferences;

  // Initial fetch + 4s polling so all clients see each other's submissions
  useEffect(() => {
    void fetchPreferencesRef.current();
    const interval = setInterval(() => void fetchPreferencesRef.current(), 4000);
    return () => clearInterval(interval);
  }, [room.id]);

  // Also refresh immediately when a member joins/updates (member-joined broadcast)
  useEffect(() => {
    const supabase = createAnonSupabase();
    const ch = supabase.channel(`room:${room.id}:members`);
    ch.on("broadcast", { event: "member-joined" }, () => {
      void fetchPreferencesRef.current();
    }).subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [room.id]);

  // ── Derived slices ────────────────────────────────────────────────────────
  const myPreferences = allPreferences.filter(
    (p) => p.userId === identity.userId,
  );
  const othersPreferences = allPreferences.filter(
    (p) => p.userId !== identity.userId,
  );

  // Group others' preferences by userId
  const othersByUser = othersPreferences.reduce<
    Record<string, ActivityPreference[]>
  >((acc, p) => {
    if (!acc[p.userId]) acc[p.userId] = [];
    acc[p.userId].push(p);
    return acc;
  }, {});

  // Members who have submitted at least one preference
  const membersWithPreferences = new Set(allPreferences.map((p) => p.userId));

  // ── Add form state ────────────────────────────────────────────────────────
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<ActivityType>("activity");
  const [newPriority, setNewPriority] = useState<Priority>("optional");
  const [newNotes, setNewNotes] = useState("");
  const [newCost, setNewCost] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || submitting) return;

    // Validate cost if provided
    let costValue: number | undefined;
    if (newCost.trim() !== "") {
      const parsed = Number(newCost.trim());
      if (!Number.isFinite(parsed) || parsed < 0) {
        setAddError("Estimated cost must be a positive number");
        return;
      }
      costValue = parsed;
    }

    setSubmitting(true);
    setAddError(null);
    try {
      const res = await fetch("/api/activity-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: room.id,
          userId: identity.userId,
          title: newTitle.trim(),
          type: newType,
          priority: newPriority,
          notes: newNotes.trim() || undefined,
          estimatedCost: costValue,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Failed to add preference");
      }
      const created = (await res.json()) as ActivityPreference;
      setAllPreferences((prev) => [...prev, created]);
      // Clear form
      setNewTitle("");
      setNewType("activity");
      setNewPriority("optional");
      setNewNotes("");
      setNewCost("");
    } catch (err) {
      setAddError(
        err instanceof Error ? err.message : "Failed to add preference",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    try {
      const res = await fetch(
        `/api/activity-preferences?id=${encodeURIComponent(id)}&userId=${encodeURIComponent(identity.userId)}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "Failed to delete preference");
      }
      setAllPreferences((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // Silently ignore — the item stays in the list
    }
  }

  // ── Stage advance (host only) ────────────────────────────────────────────
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
        throw new Error(
          body?.message ?? body?.error ?? "Failed to advance stage",
        );
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

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      {/* Stage header */}
      <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-6 shadow-pixel-card">
        <p className="text-sm font-bold uppercase tracking-wide text-pt-text-primary">
          Current stage
        </p>
        <h2 className="mt-1 text-2xl font-bold text-pt-text-primary">
          Activity wishlist
        </h2>
        <p className="mt-2 text-pt-text-primary">
          Add the things you want to do, eat, see, or avoid on this trip. The
          AI will use everyone&apos;s wishlist to build a fair itinerary.
        </p>
      </div>

      {loadError && (
        <div className="border-4 border-red-600 bg-red-50 p-4 text-sm font-semibold text-red-700 shadow-pixel-card">
          {loadError}
        </div>
      )}

      {/* Add form */}
      <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-6 shadow-pixel-card">
        <h3 className="mb-4 text-lg font-bold text-pt-text-primary">
          Add to your wishlist
        </h3>
        <form onSubmit={(e) => void handleAdd(e)} className="flex flex-col gap-4">
          {/* Title */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="activity-title"
              className="text-xs font-bold uppercase tracking-wide text-pt-text-primary"
            >
              Title <span aria-hidden="true">*</span>
            </label>
            <input
              id="activity-title"
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Ramen at a local spot"
              className="border-2 border-pt-text-primary border-opacity-20 bg-pt-card px-3 py-2 text-sm font-semibold text-pt-text-primary placeholder-[var(--pt-bg-card)]/40 focus:outline-none focus:ring-2 focus:ring-[#38BDF8]"
            />
          </div>

          {/* Type select */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="activity-type"
              className="text-xs font-bold uppercase tracking-wide text-pt-text-primary"
            >
              Type
            </label>
            <select
              id="activity-type"
              value={newType}
              onChange={(e) => setNewType(e.target.value as ActivityType)}
              className="border-2 border-pt-text-primary border-opacity-20 bg-pt-card px-3 py-2 text-sm font-semibold text-pt-text-primary focus:outline-none focus:ring-2 focus:ring-[#38BDF8]"
            >
              <option value="activity">🏃 Activity</option>
              <option value="food">🍜 Food</option>
              <option value="sight">📸 Sight</option>
              <option value="experience">✨ Experience</option>
              <option value="avoid">🚫 Avoid</option>
            </select>
          </div>

          {/* Priority toggle */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-pt-text-primary">
              Priority
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNewPriority("must_have")}
                className={`border-2 border-pt-text-primary border-opacity-20 px-4 py-1.5 text-sm font-bold shadow-[3px_3px_0px_var(--pt-bg-card)] transition-colors active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
                  newPriority === "must_have"
                    ? "bg-[#4ADE80] text-pt-text-primary"
                    : "bg-pt-card text-pt-text-primary hover:bg-[#4ADE80]/20"
                }`}
              >
                ★ Must have
              </button>
              <button
                type="button"
                onClick={() => setNewPriority("optional")}
                className={`border-2 border-pt-text-primary border-opacity-20 px-4 py-1.5 text-sm font-bold shadow-[3px_3px_0px_var(--pt-bg-card)] transition-colors active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
                  newPriority === "optional"
                    ? "bg-[#38BDF8] text-pt-text-primary"
                    : "bg-pt-card text-pt-text-primary hover:bg-[#38BDF8]/20"
                }`}
              >
                Optional
              </button>
            </div>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="activity-notes"
              className="text-xs font-bold uppercase tracking-wide text-pt-text-primary"
            >
              Notes{" "}
              <span className="font-normal normal-case tracking-normal text-pt-text-primary/60">
                (optional)
              </span>
            </label>
            <input
              id="activity-notes"
              type="text"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Any details or context…"
              className="border-2 border-pt-text-primary border-opacity-20 bg-pt-card px-3 py-2 text-sm font-semibold text-pt-text-primary placeholder-[var(--pt-bg-card)]/40 focus:outline-none focus:ring-2 focus:ring-[#38BDF8]"
            />
          </div>

          {/* Estimated cost */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="activity-cost"
              className="text-xs font-bold uppercase tracking-wide text-pt-text-primary"
            >
              Estimated cost per person{" "}
              <span className="font-normal normal-case tracking-normal text-pt-text-primary/60">
                (optional, USD)
              </span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-pt-text-primary">$</span>
              <input
                id="activity-cost"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={newCost}
                onChange={(e) => setNewCost(e.target.value)}
                placeholder="0"
                className="w-28 border-2 border-pt-text-primary border-opacity-20 bg-pt-card px-3 py-2 text-sm font-semibold text-pt-text-primary placeholder-[var(--pt-bg-card)]/40 focus:outline-none focus:ring-2 focus:ring-[#38BDF8]"
              />
              <span className="text-xs font-semibold text-pt-text-primary/60">
                Feeds the group budget bar
              </span>
            </div>
          </div>

          {addError && (
            <p className="text-sm font-semibold text-red-600">{addError}</p>
          )}

          <button
            type="submit"
            disabled={submitting || !newTitle.trim()}
            className="self-start border-4 border-pt-text-primary border-opacity-20 bg-[#38BDF8] px-5 py-2 font-bold text-pt-text-primary shadow-pixel-card hover:bg-[#0ea5e9] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Adding…" : "Add to wishlist"}
          </button>
        </form>
      </div>

      {/* My wishlist */}
      <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-6 shadow-pixel-card">
        <h3 className="mb-3 text-lg font-bold text-pt-text-primary">
          Your wishlist{" "}
          <span className="text-sm font-semibold text-pt-text-primary/70">
            ({myPreferences.length})
          </span>
        </h3>
        {myPreferences.length === 0 ? (
          <p className="text-sm font-semibold text-pt-text-primary/60">
            Nothing added yet — use the form above to get started.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {myPreferences.map((p) => (
              <PreferenceRow
                key={p.id}
                preference={p}
                onDelete={() => void handleDelete(p.id)}
                canDelete
              />
            ))}
          </ul>
        )}
      </div>

      {/* Others' wishlists */}
      {Object.keys(othersByUser).length > 0 && (
        <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-6 shadow-pixel-card">
          <h3 className="mb-4 text-lg font-bold text-pt-text-primary">
            Group wishlist
          </h3>
          <div className="flex flex-col gap-4">
            {Object.entries(othersByUser).map(([userId, prefs]) => {
              const member = members.find((m) => m.id === userId);
              const name = member?.displayName ?? "A member";
              return (
                <div key={userId}>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-pt-text-primary">
                    {name}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {prefs.map((p) => (
                      <PreferenceRow
                        key={p.id}
                        preference={p}
                        canDelete={false}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Host info panel */}
      {isHost && (
        <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-4 shadow-pixel-card">
          <p className="text-sm font-bold text-pt-text-primary">
            <span className="text-lg">{membersWithPreferences.size}</span>
            {" / "}
            <span className="text-lg">{members.length}</span>{" "}
            {members.length === 1 ? "member has" : "members have"} submitted at
            least one preference
          </p>
        </div>
      )}

      {/* Advance / waiting */}
      {isHost ? (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => void handleAdvance()}
            disabled={advancing}
            className="border-4 border-pt-text-primary border-opacity-20 bg-[#FB923C] px-4 py-2 font-bold text-pt-text-primary shadow-pixel-card hover:bg-[#f97316] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {advancing ? "Advancing…" : "Advance to itinerary"}
          </button>
          {advanceError && (
            <p className="text-sm font-semibold text-red-600">{advanceError}</p>
          )}
        </div>
      ) : (
        <div className="border-4 border-pt-text-primary border-opacity-20 bg-[var(--pt-bg-card)] p-4 shadow-pixel-card">
          <p className="text-sm font-semibold text-pt-text-primary">
            Waiting for the host to advance to the itinerary stage…
          </p>
        </div>
      )}
    </section>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface PreferenceRowProps {
  preference: ActivityPreference;
  canDelete: boolean;
  onDelete?: () => void;
}

function PreferenceRow({ preference, canDelete, onDelete }: PreferenceRowProps) {
  const typeCls = TYPE_BADGE[preference.type as ActivityType] ?? "bg-gray-200 text-pt-text-primary";
  const typeLabel = TYPE_LABELS[preference.type as ActivityType] ?? preference.type;

  return (
    <li className="flex items-start justify-between gap-3 border-2 border-pt-text-primary border-opacity-20 bg-pt-card p-3 shadow-pixel-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Priority badge */}
          {preference.priority === "must_have" && (
            <span className="border border-[#4ADE80] bg-[#4ADE80]/20 px-1.5 py-0.5 text-xs font-bold text-pt-text-primary">
              ★ Must have
            </span>
          )}
          {/* Type badge */}
          <span
            className={`border border-pt-text-primary border-opacity-20 px-1.5 py-0.5 text-xs font-bold shadow-pixel-bubble ${typeCls}`}
          >
            {typeLabel}
          </span>
          {/* Title */}
          <span className="text-sm font-bold text-pt-text-primary">
            {preference.title}
          </span>
          {/* Cost badge */}
          {preference.estimatedCost !== null && (
            <span className="border border-[#FB923C] bg-[#FB923C]/20 px-1.5 py-0.5 text-xs font-bold text-pt-text-primary">
              ${preference.estimatedCost}
            </span>
          )}
        </div>
        {preference.notes && (
          <p className="text-xs font-semibold text-pt-text-primary/70">
            {preference.notes}
          </p>
        )}
      </div>

      {canDelete && onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Remove "${preference.title}"`}
          className="shrink-0 border-2 border-pt-text-primary border-opacity-20 bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700 shadow-pixel-sm hover:bg-red-100 active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
        >
          ×
        </button>
      )}
    </li>
  );
}

// ─── Broadcast helper ─────────────────────────────────────────────────────────

/**
 * Broadcast a `stage-change` event so every connected client re-fetches the
 * room. Mirrors the helper in `GroupProfileStage` / `DestinationsStage`.
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
