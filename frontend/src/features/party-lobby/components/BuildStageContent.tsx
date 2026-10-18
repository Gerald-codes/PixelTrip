"use client";

/**
 * BUILD stage: the guide turns the locked destination, flight, dates, budget,
 * and party preferences into a readable day-by-day quest log.
 */
import { useEffect, useState, type ReactElement } from "react";

import { PixelButton } from "@/components/PixelButton";
import { ApiError } from "@/lib/errors";
import { getServices } from "@/services";
import type { LockedChoice } from "@/services/selection.contract";
import type { ItineraryVersion } from "@/types";
import type { RoomMember, RoomSession } from "@/types";

import { useGuideRun } from "../hooks/useGuideRun";
import { GuideThinking } from "./GuideThinking";
import { GuideMessage, GuideSay, StageChat } from "./StageChat";
import { WaitingForParty } from "./WaitingForParty";
import { TAG_PILL } from "../lib/tagStyles";
import { DEMO_CHANGES } from "../lib/demoScenario";
import {
  buildCalendar,
  buildPlainText,
  canExportCalendar,
  downloadFile,
  exportFileName,
} from "../lib/itineraryExport";

export interface BuildStageContentProps {
  session: RoomSession;
  members: RoomMember[];
  selectedFlight?: LockedChoice | null;
  /** REFINE begins immediately after persistence; show the saved plan first. */
  canStartRun?: boolean;
}

function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatMoment(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function flightTimes(flight?: LockedChoice | null): {
  departure: string | null;
  arrival: string | null;
  returnDeparture: string | null;
  returnArrival: string | null;
} {
  const data = flight?.data ?? {};
  return {
    departure: formatMoment(data.depart_at ?? data.departAt),
    arrival: formatMoment(data.arrive_at ?? data.arriveAt),
    returnDeparture: formatMoment(data.return_at ?? data.returnAt),
    returnArrival: formatMoment(data.return_arrive_at ?? data.returnArriveAt),
  };
}

function downloadMarkdown(version: ItineraryVersion, flight?: LockedChoice | null): void {
  const lines = [`# ${version.itinerary.title}`, "", version.itinerary.summary, ""];
  const times = flightTimes(flight);
  for (const day of version.itinerary.days) {
    lines.push(`## Day ${day.day}${day.date ? ` — ${day.date}` : ""}`, "");
    if (day.day === 1 && flight && (times.departure || times.arrival)) {
      lines.push(`- **Outbound flight:** ${flight.title}`);
      if (times.departure) lines.push(`  - Departure: ${times.departure}`);
      if (times.arrival) lines.push(`  - Arrival: ${times.arrival}`);
    }
    for (const item of day.items) {
      lines.push(`- ${item.time ? `**${item.time}** ` : ""}**${item.title}**`);
      if (item.location) lines.push(`  - Location: ${item.location}`);
      if (item.description) lines.push(`  - ${item.description}`);
    }
    if (day.day === version.itinerary.days.length && flight && (times.returnDeparture || times.returnArrival)) {
      lines.push(`- **Return flight:** ${flight.title}`);
      if (times.returnDeparture) lines.push(`  - Departure: ${times.returnDeparture}`);
      if (times.returnArrival) lines.push(`  - Arrival: ${times.returnArrival}`);
    }
    lines.push("");
  }
  downloadFile(lines.join("\n"), exportFileName(version.itinerary.title, "md"), "text/markdown;charset=utf-8");
}

function downloadText(version: ItineraryVersion, flight?: LockedChoice | null): void {
  const summary = flight ? { title: flight.title, ...flightTimes(flight) } : null;
  downloadFile(buildPlainText(version, summary), exportFileName(version.itinerary.title, "txt"), "text/plain;charset=utf-8");
}

function downloadCalendar(version: ItineraryVersion, flight?: LockedChoice | null): void {
  downloadFile(buildCalendar(version, flight), exportFileName(version.itinerary.title, "ics"), "text/calendar;charset=utf-8");
}

function ItinerarySkeleton(): ReactElement {
  return (
    <div aria-hidden className="flex flex-col gap-16">
      {[1, 2, 3].map((day) => (
        // The bars stay put; a pale band sweeps across the card, clipped to it.
        <div
          key={day}
          className="relative flex flex-col gap-16 overflow-hidden border-4 border-primary-dark bg-bg-alt p-16"
        >
          <span className="h-16 w-1/3 bg-muted" />
          <span className="h-16 w-5/6 bg-muted" />
          <span className="h-16 w-full bg-muted" />
          <span className="h-16 w-2/3 bg-muted" />
          <span
            className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-ink opacity-10 animate-pixel-scan motion-reduce:animate-none"
            style={{ animationDelay: `${day * 0.2}s` }}
          />
        </div>
      ))}
    </div>
  );
}

function DayCard({
  day,
  flight,
  lastDay,
  comment,
  onCommentChange,
  onApprove,
  onRefine,
  decision,
  locked,
  allowReview,
  isDemo,
}: {
  day: ItineraryVersion["itinerary"]["days"][number];
  flight?: LockedChoice | null;
  lastDay: boolean;
  comment: string;
  onCommentChange: (value: string) => void;
  onApprove: () => void;
  onRefine: () => void;
  decision: "keep" | "change" | null;
  locked: boolean;
  allowReview: boolean;
  isDemo?: boolean;
}): ReactElement {
  const times = flightTimes(flight);
  return (
    <article className="flex flex-col gap-16 border-4 border-primary-dark bg-ink p-8 text-bg">
      <header className="flex items-center justify-between gap-16 border-2 border-primary-dark bg-primary px-16 py-8 text-bg">
        <h3 className="font-display">DAY {day.day}</h3>
        {formatDate(day.date) ? (
          <span className="font-body">{formatDate(day.date)}</span>
        ) : null}
      </header>
      <ol className="flex flex-col gap-8 px-8 pb-8">
        {day.day === 1 && flight && (times.departure || times.arrival) ? (
          <li className="border-l-4 border-primary bg-bg p-8 font-body text-ink">
            <strong>OUTBOUND FLIGHT · {flight.title}</strong>
            {times.departure ? <p>Departure: {times.departure}</p> : null}
            {times.arrival ? <p>Arrival: {times.arrival}</p> : null}
          </li>
        ) : null}
        {day.items.map((item, index) => (
          <li key={`${day.day}-${item.title}-${index}`} className="border-l-4 border-success bg-bg p-8">
            <div className="flex flex-wrap items-baseline gap-8">
              {item.time ? <span className="font-display text-accent">{item.time}</span> : null}
              <h4 className="font-display text-ink">{item.title}</h4>
            </div>
            {item.location ? <p className="font-body text-primary">{item.location}</p> : null}
            {item.description ? <p className="mt-8 font-body leading-relaxed text-ink">{item.description}</p> : null}
            {item.tags?.length ? (
              <ul className="mt-8 flex flex-wrap gap-8">
                {item.tags.map((tag) => (
                  <li key={tag} className={TAG_PILL}>
                    {tag}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
        {lastDay && flight && (times.returnDeparture || times.returnArrival) ? (
          <li className="border-l-4 border-primary bg-bg p-8 font-body text-ink">
            <strong>RETURN FLIGHT · {flight.title}</strong>
            {times.returnDeparture ? <p>Departure: {times.returnDeparture}</p> : null}
            {times.returnArrival ? <p>Arrival: {times.returnArrival}</p> : null}
          </li>
        ) : null}
      </ol>
      {allowReview ? <section className="flex flex-col gap-8 border-t-2 border-muted bg-bg-alt p-16 text-ink">
        <h4 className="font-display text-accent">DAY {day.day} REVIEW</h4>
        {isDemo ? <select
          aria-label={`Prepared change for day ${day.day}`}
          value={comment}
          onChange={(event) => onCommentChange(event.target.value)}
          disabled={locked}
          className="border-2 border-muted bg-bg px-8 py-8 font-body text-ink"
        >
          <option value="">Choose a prepared change</option>
          <option value={DEMO_CHANGES[day.day]}>{DEMO_CHANGES[day.day]}</option>
        </select> : <textarea
          value={comment}
          onChange={(event) => onCommentChange(event.target.value)}
          rows={3}
          disabled={locked}
          placeholder="Tell MILO what to change on this day…"
          className="border-2 border-muted bg-bg px-8 py-8 font-body text-ink focus-visible:border-accent focus-visible:outline-none"
        />}
        <div className="grid gap-8 sm:grid-cols-2">
          <PixelButton
            variant="primary"
            label={decision === "keep" ? "✓ KEEPING THIS DAY" : "LOOKS GOOD — KEEP THIS DAY"}
            disabled={locked}
            onClick={onApprove}
          />
          <PixelButton
            variant="option"
            label={decision === "change" ? "✓ CHANGES REQUESTED" : "REQUEST CHANGES TO THIS DAY"}
            disabled={locked || (isDemo && !comment)}
            onClick={onRefine}
          />
        </div>
        {decision ? <p className="font-body text-success">Choice saved for the final lock-in.</p> : null}
      </section> : null}
    </article>
  );
}

export function BuildStageContent({
  session,
  canStartRun = true,
  members,
  selectedFlight = null,
}: BuildStageContentProps): ReactElement {
  const roomId = session.room.id;
  const memberId = session.member.id;
  const isWrap = session.room.planningStage === "wrap";
  const isRefineStage = session.room.planningStage === "refine";
  const [tripId, setTripId] = useState<string | null>(null);
  const [version, setVersion] = useState<ItineraryVersion | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<number, string>>({});
  const [decisions, setDecisions] = useState<Record<number, "keep" | "change">>({});
  const [locallyLocked, setLocked] = useState(false);
  const locked = locallyLocked || members.some((m) => m.id === memberId && m.stageReady);
  const [reviewing, setReviewing] = useState(false);
  const [refining, setRefining] = useState(false);
  const runType = refining ? "refinement" : "itinerary";
  const { run, refresh } = useGuideRun(roomId, runType, version === null || refining);
  const refinementState = useGuideRun(roomId, "refinement", !isWrap);
  const sharedRefinementActive =
    refinementState.run?.status === "pending" || refinementState.run?.status === "running";
  const showingRefinement = refining || sharedRefinementActive;

  const loadVersion = async (): Promise<void> => {
    if (!tripId) return;
    try {
      const current = await getServices().itinerary.getCurrent(tripId);
      if (current) {
        if (version && current.version > version.version) {
          setRefining(false);
          setDecisions({});
          setComments({});
          setLocked(false);
        }
        setVersion(current);
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const start = async (): Promise<void> => {
      try {
        const resolvedTripId = await getServices().destination.getTripId(roomId);
        if (!resolvedTripId || cancelled) return;
        setTripId(resolvedTripId);
        const current = await getServices().itinerary.getCurrent(resolvedTripId);
        if (current) {
          setVersion(current);
          return;
        }
        if (canStartRun && session.member.role === "owner") {
          await getServices().run.startRun(roomId, memberId, "itinerary");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not start the quest log.");
        }
      }
    };
    void start();
    return () => {
      cancelled = true;
    };
  }, [roomId, memberId, session.member.role, canStartRun]);

  useEffect(() => {
    if (!tripId || (!canStartRun && !isRefineStage && !showingRefinement) || (version && !isRefineStage && !showingRefinement)) return;
    const timer = setInterval(() => void loadVersion(), 2000);
    return () => clearInterval(timer);
  }, [tripId, version, canStartRun, isRefineStage, showingRefinement]);

  const reviewDay = (day: number, decision: "keep" | "change"): void => {
    setDecisions((previous) => ({ ...previous, [day]: decision }));
  };

  const lockReview = async (): Promise<void> => {
    if (!tripId || !version?.id || locked || reviewing) return;
    const days = version.itinerary.days;
    if (days.some((day) => !decisions[day.day])) {
      setError("Choose keep or request changes for every day before locking in.");
      return;
    }
    setReviewing(true);
    setError(null);
    try {
      const changeDays = days.filter((day) => decisions[day.day] === "change");
      for (const day of changeDays) {
        await getServices().itinerary.submitFeedback({
          tripId,
          itineraryVersionId: version.id,
          memberId,
          target: { day: day.day },
          comment: comments[day.day]?.trim() || "Please improve this day to better fit the party.",
        });
      }
      const result = await getServices().itinerary.review({
        tripId,
        versionId: version.id,
        memberId,
        decision: changeDays.length > 0 ? "refine" : "approve",
      });
      setLocked(true);
      if (result.needsRefinement) {
        await getServices().run.startRun(roomId, memberId, "refinement");
        setRefining(true);
        refresh();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not lock in your review.");
    } finally {
      setReviewing(false);
    }
  };

  const retry = async (): Promise<void> => {
    setRetrying(true);
    setError(null);
    try {
      await getServices().run.startRun(roomId, memberId, runType);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not ask MILO to try again.");
    } finally {
      setRetrying(false);
    }
  };

  const isWaitingForReview = locked && !showingRefinement && !isWrap;

  return (
    <StageChat>
      <GuideSay
        text={
          canStartRun
            ? "The route is chosen! Now I shall turn your choices into a quest log."
            : "The quest log is ready! Read through the party's plan before we improve it together."
        }
      />
      {canStartRun ? (
        <GuideSay text="I am balancing the flight times, budget, travel style, and everyone's must-see moments." />
      ) : null}
      {isWaitingForReview ? (
        <GuideMessage>
          <WaitingForParty members={members} what="their itinerary review" />
        </GuideMessage>
      ) : showingRefinement ? (
        <GuideMessage>
          <div className="flex flex-col gap-16">
            <GuideThinking
              runType="refinement"
              run={refinementState.run ?? run}
              isOwner={session.member.role === "owner"}
              retrying={retrying}
              onRetry={() => void retry()}
            />
            {run?.status !== "failed" ? <ItinerarySkeleton /> : null}
            {error ? <p role="alert" className="font-body text-alert">{error}</p> : null}
          </div>
        </GuideMessage>
      ) : version ? (
        <GuideMessage>
          <div className="flex flex-col gap-16">
            <div className="border-4 border-accent bg-bg-alt p-16">
              <p className="font-display text-accent">{version.itinerary.title}</p>
              <p className="mt-8 font-body text-ink">{version.itinerary.summary}</p>
            </div>
            <div className="flex flex-col gap-16">
              {version.itinerary.days.map((day, index) => (
                <DayCard
                  key={day.day}
                  day={day}
                  flight={selectedFlight}
                  lastDay={index === version.itinerary.days.length - 1}
                  comment={comments[day.day] ?? ""}
                  onCommentChange={(value) => setComments((previous) => ({ ...previous, [day.day]: value }))}
                  onApprove={() => reviewDay(day.day, "keep")}
                  onRefine={() => reviewDay(day.day, "change")}
                  decision={decisions[day.day] ?? null}
                  locked={locked}
                  allowReview={session.room.planningStage !== "wrap"}
                  isDemo={session.room.demoScenario === "vietnam-five-days"}
                />
              ))}
            </div>
            {isWrap ? (
              <section aria-label="Export the adventure" className="flex flex-col gap-8">
                <div className="flex flex-wrap gap-16">
                  <PixelButton
                    variant="primary"
                    label="EXPORT AS MARKDOWN"
                    onClick={() => downloadMarkdown(version, selectedFlight)}
                  />
                  <PixelButton
                    variant="primary"
                    label="EXPORT AS TEXT"
                    onClick={() => downloadText(version, selectedFlight)}
                  />
                  <PixelButton
                    variant="primary"
                    label="ADD TO CALENDAR"
                    disabled={!canExportCalendar(version)}
                    onClick={() => downloadCalendar(version, selectedFlight)}
                  />
                </div>
                {!canExportCalendar(version) ? (
                  <p className="font-body text-ink">
                    The calendar file needs trip dates, and this adventure has none yet.
                  </p>
                ) : null}
              </section>
            ) : null}
            {!isWrap ? (
              <section className="flex flex-col gap-16 border-4 border-accent bg-bg-alt p-16">
                <p className="font-body">
                  Choose an answer for every day, then lock in your complete review.
                </p>
                <PixelButton
                  variant="primary"
                  label={reviewing ? "LOCKING IN…" : locked ? "REVIEW LOCKED IN" : "LOCK IN MY REVIEW"}
                  disabled={locked || reviewing}
                  onClick={() => void lockReview()}
                />
                {locked ? <WaitingForParty members={members} what="their itinerary review" /> : null}
              </section>
            ) : null}
            {error ? <p role="alert" className="font-body text-alert">{error}</p> : null}
          </div>
        </GuideMessage>
      ) : (
        <GuideMessage>
          <div className="flex flex-col gap-16">
            <GuideThinking
              runType={runType}
              run={run}
              isOwner={session.member.role === "owner"}
              retrying={retrying}
              onRetry={() => void retry()}
            />
            {run?.status !== "failed" ? <ItinerarySkeleton /> : null}
            {error ? <p role="alert" className="font-body text-alert">{error}</p> : null}
            {!canStartRun ? (
              <p className="font-body text-subtle">
                The plan was saved. The party can now review each day before adding feedback.
              </p>
            ) : !run && session.member.role !== "owner" ? (
              <p className="font-body text-subtle">The party leader will ask MILO to draft the quest log.</p>
            ) : null}
          </div>
        </GuideMessage>
      )}
    </StageChat>
  );
}

export default BuildStageContent;
