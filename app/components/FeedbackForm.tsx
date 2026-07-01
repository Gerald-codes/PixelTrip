"use client";

import { useState, useRef, KeyboardEvent } from "react";
import type { Itinerary, ItineraryFeedback } from "@/lib/types";

// ── Props ──────────────────────────────────────────────────────────────────

interface FeedbackFormProps {
  itinerary: Itinerary;
  userId: string;
  existing: ItineraryFeedback | null;
  onSubmitted: (feedback: ItineraryFeedback) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Flatten all days' items into a deduplicated list of titles. */
function extractItemTitles(itinerary: Itinerary): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const day of itinerary.days) {
    const allItems = [
      ...(day.morning ?? []),
      ...(day.afternoon ?? []),
      ...(day.evening ?? []),
      ...(day.night ?? []),
    ];
    for (const item of allItems) {
      if (item.title && !seen.has(item.title)) {
        seen.add(item.title);
        titles.push(item.title);
      }
    }
  }
  return titles;
}

/** Derive slider thumb/track colour class from score. */
function scoreColor(score: number): string {
  if (score <= 4) return "bg-red-500";
  if (score <= 6) return "bg-[#FB923C]";
  return "bg-[#4ADE80]";
}

function scoreTextColor(score: number): string {
  if (score <= 4) return "text-red-600";
  if (score <= 6) return "text-[#FB923C]";
  return "text-[#4ADE80]";
}

// ── Sub-components ─────────────────────────────────────────────────────────

interface TagInputProps {
  label: string;
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  disabled?: boolean;
  maxCount?: number;
}

function TagInput({ label, tags, onAdd, onRemove, disabled = false, maxCount }: TagInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const atLimit = maxCount !== undefined && tags.length >= maxCount;

  function handleAdd() {
    const trimmed = value.trim();
    if (!trimmed || atLimit) return;
    onAdd(trimmed);
    setValue("");
    inputRef.current?.focus();
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-bold uppercase tracking-wide text-[#1E3A5F]">
          {label}
        </label>
        {maxCount !== undefined && (
          <span className="text-xs font-bold text-[#1E3A5F] opacity-60">
            ({tags.length}/{maxCount})
          </span>
        )}
      </div>

      {/* Existing tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2" role="list" aria-label={`${label} tags`}>
          {tags.map((tag) => (
            <span
              key={tag}
              role="listitem"
              className="inline-flex items-center gap-1 border-2 border-[#1E3A5F] bg-[#FEF3C7] px-2.5 py-1 text-sm font-medium text-[#1E3A5F] shadow-[2px_2px_0px_#1E3A5F]"
            >
              {tag}
              <button
                type="button"
                onClick={() => onRemove(tag)}
                aria-label={`Remove ${tag}`}
                className="ml-1 text-[#1E3A5F] hover:text-red-600 font-bold leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
          disabled={disabled || atLimit}
          placeholder={atLimit ? "Limit reached" : "Type and press Enter…"}
          className="flex-1 border-2 border-[#1E3A5F] bg-[#FEF3C7] px-3 py-2 text-sm font-medium text-[#1E3A5F] placeholder-[#1E3A5F]/40 shadow-[2px_2px_0px_#1E3A5F] outline-none focus:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={`Add to ${label}`}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled || atLimit || value.trim() === ""}
          className="border-2 border-[#1E3A5F] bg-[#38BDF8] px-4 py-2 text-sm font-bold text-[#1E3A5F] shadow-[2px_2px_0px_#1E3A5F] hover:bg-[#7dd3fc] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label={`Add tag to ${label}`}
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function FeedbackForm({
  itinerary,
  userId,
  existing,
  onSubmitted,
}: FeedbackFormProps) {
  // ── State ────────────────────────────────────────────────────────────────
  const [score, setScore] = useState<number>(existing?.score ?? 7);
  const [likedItems, setLikedItems] = useState<string[]>(existing?.likedItems ?? []);
  const [dislikedItems, setDislikedItems] = useState<string[]>(existing?.dislikedItems ?? []);
  const [requestedAdditions, setRequestedAdditions] = useState<string[]>(
    existing?.requestedAdditions ?? [],
  );
  const [requestedRemovals, setRequestedRemovals] = useState<string[]>(
    existing?.requestedRemovals ?? [],
  );
  const [importantRequests, setImportantRequests] = useState<string[]>(
    existing?.importantRequests ?? [],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Derived ──────────────────────────────────────────────────────────────
  const allTitles = extractItemTitles(itinerary);

  function toggleLiked(title: string) {
    setLikedItems((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title],
    );
  }

  function toggleDisliked(title: string) {
    setDislikedItems((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title],
    );
  }

  // ── Submit ───────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itineraryId: itinerary.id,
          userId,
          score,
          likedItems,
          dislikedItems,
          requestedAdditions,
          requestedRemovals,
          importantRequests,
        }),
      });

      if (!res.ok) {
        let msg = `Error ${res.status}`;
        try {
          const json = (await res.json()) as { error?: string };
          if (json.error) msg = json.error;
        } catch {
          // ignore parse failure
        }
        setError(msg);
        return;
      }

      const feedback = (await res.json()) as ItineraryFeedback;
      onSubmitted(feedback);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const thumbColor = scoreColor(score);
  const scoreLabel = scoreTextColor(score);

  return (
    <form
      onSubmit={(e) => { void handleSubmit(e); }}
      className="flex flex-col gap-6"
      aria-label="Itinerary feedback form"
      noValidate
    >
      {/* ── Error banner ── */}
      {error && (
        <div
          role="alert"
          className="border-2 border-red-600 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 shadow-[2px_2px_0px_#1E3A5F]"
        >
          ⚠️ {error}
        </div>
      )}

      {/* ── Score slider ── */}
      <fieldset className="border-2 border-[#1E3A5F] bg-white p-4 shadow-[2px_2px_0px_#1E3A5F]">
        <legend className="px-1 text-sm font-bold uppercase tracking-wide text-[#1E3A5F]">
          Overall Score
        </legend>
        <div className="mt-3 flex flex-col gap-3">
          {/* Numeric display */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F] opacity-60">
              1 — Poor
            </span>
            <span
              className={`text-2xl font-black tabular-nums ${scoreLabel}`}
              aria-live="polite"
              aria-label={`Score: ${score} out of 10`}
            >
              {score} / 10
            </span>
            <span className="text-xs font-bold uppercase tracking-wide text-[#1E3A5F] opacity-60">
              10 — Excellent
            </span>
          </div>

          {/* Slider track with colour fill */}
          <div className="relative h-4">
            {/* Filled portion */}
            <div
              className={`absolute inset-y-0 left-0 ${thumbColor} border-2 border-[#1E3A5F] transition-all`}
              style={{ width: `${((score - 1) / 9) * 100}%` }}
              aria-hidden="true"
            />
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="Score"
              aria-valuemin={1}
              aria-valuemax={10}
              aria-valuenow={score}
              aria-valuetext={`${score} out of 10`}
            />
            {/* Track outline */}
            <div className="absolute inset-0 border-2 border-[#1E3A5F] pointer-events-none" />
          </div>

          {/* Pip labels */}
          <div className="flex justify-between px-0.5">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScore(n)}
                className={`w-6 h-6 text-xs font-bold border-2 border-[#1E3A5F] transition-colors shadow-[1px_1px_0px_#1E3A5F] ${
                  score === n
                    ? `${thumbColor} text-[#1E3A5F]`
                    : "bg-[#FEF3C7] text-[#1E3A5F] hover:bg-[#FDE68A]"
                }`}
                aria-label={`Set score to ${n}`}
                aria-pressed={score === n}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </fieldset>

      {/* ── Liked / Disliked multi-select chips ── */}
      {allTitles.length > 0 && (
        <fieldset className="border-2 border-[#1E3A5F] bg-white p-4 shadow-[2px_2px_0px_#1E3A5F]">
          <legend className="px-1 text-sm font-bold uppercase tracking-wide text-[#1E3A5F]">
            What did you think of each item?
          </legend>
          <p className="mt-1 mb-3 text-xs text-[#1E3A5F] opacity-60">
            Click items to mark them as liked (green) or disliked (red). Items can only be in one
            group.
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Itinerary items">
            {allTitles.map((title) => {
              const isLiked = likedItems.includes(title);
              const isDisliked = dislikedItems.includes(title);

              let chipClass =
                "border-2 border-[#1E3A5F] bg-[#FEF3C7] text-[#1E3A5F] hover:bg-[#FDE68A]";
              let ariaLabel = `${title} — not rated`;
              if (isLiked) {
                chipClass =
                  "border-2 border-[#1E3A5F] bg-[#4ADE80] text-[#1E3A5F] ring-2 ring-[#4ADE80]";
                ariaLabel = `${title} — liked`;
              } else if (isDisliked) {
                chipClass =
                  "border-2 border-[#1E3A5F] bg-red-400 text-white ring-2 ring-red-400";
                ariaLabel = `${title} — disliked`;
              }

              return (
                <div key={title} className="flex gap-0.5">
                  {/* 👍 Like toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      if (isDisliked) setDislikedItems((p) => p.filter((t) => t !== title));
                      toggleLiked(title);
                    }}
                    aria-label={`${isLiked ? "Unlike" : "Like"} ${title}`}
                    aria-pressed={isLiked}
                    className={`px-2.5 py-1 text-xs font-bold shadow-[2px_2px_0px_#1E3A5F] transition-colors ${chipClass}`}
                  >
                    {isLiked ? "👍 " : ""}{title}
                  </button>

                  {/* 👎 Dislike toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      if (isLiked) setLikedItems((p) => p.filter((t) => t !== title));
                      toggleDisliked(title);
                    }}
                    aria-label={`${isDisliked ? "Remove dislike from" : "Dislike"} ${title}`}
                    aria-pressed={isDisliked}
                    className={`px-2 py-1 text-xs font-bold border-2 border-[#1E3A5F] shadow-[2px_2px_0px_#1E3A5F] transition-colors ${
                      isDisliked ? "bg-red-400 text-white" : "bg-[#FEF3C7] text-[#1E3A5F] hover:bg-red-100"
                    }`}
                  >
                    👎
                  </button>
                </div>
              );
            })}
          </div>

          {/* Summary line */}
          {(likedItems.length > 0 || dislikedItems.length > 0) && (
            <p className="mt-3 text-xs text-[#1E3A5F] opacity-70">
              {likedItems.length > 0 && (
                <span className="text-[#16a34a] font-bold">
                  👍 {likedItems.length} liked
                </span>
              )}
              {likedItems.length > 0 && dislikedItems.length > 0 && " · "}
              {dislikedItems.length > 0 && (
                <span className="text-red-600 font-bold">
                  👎 {dislikedItems.length} disliked
                </span>
              )}
            </p>
          )}
        </fieldset>
      )}

      {/* ── Requested additions ── */}
      <div className="border-2 border-[#1E3A5F] bg-white p-4 shadow-[2px_2px_0px_#1E3A5F]">
        <TagInput
          label="Requested Additions"
          tags={requestedAdditions}
          onAdd={(t) => setRequestedAdditions((p) => [...p, t])}
          onRemove={(t) => setRequestedAdditions((p) => p.filter((x) => x !== t))}
          disabled={submitting}
        />
      </div>

      {/* ── Requested removals ── */}
      <div className="border-2 border-[#1E3A5F] bg-white p-4 shadow-[2px_2px_0px_#1E3A5F]">
        <TagInput
          label="Requested Removals"
          tags={requestedRemovals}
          onAdd={(t) => setRequestedRemovals((p) => [...p, t])}
          onRemove={(t) => setRequestedRemovals((p) => p.filter((x) => x !== t))}
          disabled={submitting}
        />
      </div>

      {/* ── Important requests (capped at 3) ── */}
      <div className="border-2 border-[#1E3A5F] bg-white p-4 shadow-[2px_2px_0px_#1E3A5F]">
        <TagInput
          label="Important Requests"
          tags={importantRequests}
          onAdd={(t) => setImportantRequests((p) => [...p, t])}
          onRemove={(t) => setImportantRequests((p) => p.filter((x) => x !== t))}
          disabled={submitting}
          maxCount={3}
        />
        <p className="mt-2 text-xs text-[#1E3A5F] opacity-60">
          Your top priorities for the next revision. Capped at 3 so the AI can focus on what matters most.
        </p>
      </div>

      {/* ── Submit ── */}
      <button
        type="submit"
        disabled={submitting}
        className="border-4 border-[#1E3A5F] bg-[#FB923C] shadow-[4px_4px_0px_#1E3A5F] px-6 py-3 text-base font-black uppercase tracking-wide text-[#1E3A5F] hover:bg-[#fdba74] disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-start"
      >
        {submitting ? "Submitting…" : existing ? "Update Feedback" : "Submit Feedback"}
      </button>
    </form>
  );
}
