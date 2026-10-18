"use client";

/**
 * FlightStageContent — LOGISTICS as a chatbot-style flow (left column only; the
 * shell owns the persistent sidebar). Mirrors DestinationStageContent.
 *
 * The screen opens on a confirm step: the guide shows the trip's dates and the
 * party leader either starts the flight search or changes the dates first
 * (TripDatesDialog). While the guide works, the party sees its real steps
 * (GuideThinking) over placeholder cards; then the flights arrive live as
 * FlightMatchCards, members vote, and a tie goes to the owner via the shared
 * TiebreakPanel. A failed or empty run shows why, with a retry or a change of
 * dates for the owner.
 *
 * Changing the dates closes the flight vote without locking a flight; flights
 * from that closed vote were for the old dates, so they are not shown.
 */
import { useEffect, useState, type ReactElement } from "react";

import { PixelButton } from "@/components/PixelButton";
import { ApiError } from "@/lib/errors";
import { getServices } from "@/services";
import type { LogisticsState } from "@/services/flight.contract";
import type { RoomMember, RoomSession } from "@/types";

import { useGuideRun } from "../hooks/useGuideRun";
import { useTripDates } from "../hooks/useTripDates";
import { formatTripDates } from "./DestinationMatchCard";
import { FlightMatchCard } from "./FlightMatchCard";
import { GuideThinking } from "./GuideThinking";
import { SkeletonCards } from "./SkeletonCards";
import { GuideMessage, GuideSay, StageChat } from "./StageChat";
import { TiebreakPanel } from "./TiebreakPanel";
import { TripDatesDialog } from "./TripDatesDialog";
import { WaitingForParty } from "./WaitingForParty";

export interface FlightStageContentProps {
  session: RoomSession;
  members: RoomMember[];
}

const EMPTY: LogisticsState = {
  loading: true,
  options: [],
  selectedFlight: null,
  vote: null,
  tiePending: false,
  tiebreak: null,
  guideNote: null,
};

export function FlightStageContent({
  session,
  members,
}: FlightStageContentProps): ReactElement {
  const isOwner = session.member.role === "owner";
  const roomId = session.room.id;
  const memberId = session.member.id;

  const [state, setState] = useState<LogisticsState>(EMPTY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);
  const [voted, setVoted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [tieError, setTieError] = useState<string | null>(null);

  const [changingDates, setChangingDates] = useState(false);
  const tripDates = useTripDates(roomId);

  // A closed vote with no locked flight means the leader changed the dates.
  const datesChanged =
    state.vote?.status === "closed" &&
    state.selectedFlight === null &&
    !state.tiePending;
  const hasFlights = state.options.length > 0 && !datesChanged;
  const { run, loaded, refresh } = useGuideRun(roomId, "logistics", !hasFlights);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = getServices().flight.subscribeLogistics(
      roomId,
      (next) => {
        if (!cancelled) setState(next);
      },
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [roomId]);

  const advicePending = state.tiePending && state.tiebreak?.pending === true;
  const tieRun = useGuideRun(roomId, "tiebreak", advicePending);
  const [retryingAdvice, setRetryingAdvice] = useState(false);
  const retryAdvice = async (): Promise<void> => {
    setRetryingAdvice(true);
    try {
      await getServices().run.startRun(roomId, memberId, "tiebreak");
    } catch {
      // The leader can still choose without the advice.
    } finally {
      setRetryingAdvice(false);
      tieRun.refresh();
    }
  };

  const search = async (retry: boolean): Promise<void> => {
    setRetrying(true);
    try {
      const tripId = await getServices().destination.getTripId(roomId);
      if (tripId) {
        await getServices().flight.startLogistics({ tripId, memberId, retry });
      }
    } catch {
      // The run status will still show the failure.
    } finally {
      setRetrying(false);
      refresh();
    }
  };

  const handleVote = async (): Promise<void> => {
    if (!state.vote || selectedId === null || voting) return;
    setVoting(true);
    setError(null);
    try {
      await getServices().flight.castVote({
        voteSessionId: state.vote.voteSessionId,
        memberId,
        optionId: selectedId,
      });
      setVoted(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not cast your vote. Please try again.",
      );
    } finally {
      setVoting(false);
    }
  };

  const handleBreakTie = async (optionId: string): Promise<void> => {
    if (!state.tiebreak || deciding) return;
    setDeciding(true);
    setTieError(null);
    try {
      await getServices().flight.breakTie({
        voteSessionId: state.tiebreak.voteSessionId,
        memberId,
        optionId,
      });
    } catch (err) {
      setTieError(
        err instanceof ApiError
          ? err.message
          : "Could not lock in the choice. Please try again.",
      );
    } finally {
      setDeciding(false);
    }
  };

  const viewer = members.find((m) => m.id === memberId);
  const viewerReady = voted || viewer?.stageReady === true;
  const finishedEmpty = !hasFlights && run?.status === "completed";
  // Nothing searched yet: the leader confirms the dates before the first search.
  const awaitingStart = !hasFlights && loaded && run === null;
  const canChangeDates = isOwner && tripDates?.canChange === true;
  const tripRange = formatTripDates(tripDates?.tripStart, tripDates?.tripEnd);
  const changeDatesButton = canChangeDates ? (
    <PixelButton
      variant="secondary"
      label="CHANGE DATES"
      disabled={retrying}
      onClick={() => setChangingDates(true)}
    />
  ) : null;

  return (
    <StageChat>
      <GuideSay text="Destination locked! Now let's find the party's way there." />
      <GuideSay text="I'll search flights that fit the trip's dates and your budget." />

      {state.tiePending && state.tiebreak ? (
        <GuideMessage>
          <TiebreakPanel
            tiebreak={state.tiebreak}
            isOwner={isOwner}
            deciding={deciding}
            error={tieError}
            onBreakTie={(optionId) => {
              void handleBreakTie(optionId);
            }}
            thinking={
              <GuideThinking
                runType="tiebreak"
                run={tieRun.run}
                isOwner={isOwner}
                retrying={retryingAdvice}
                onRetry={() => {
                  void retryAdvice();
                }}
              />
            }
          />
        </GuideMessage>
      ) : hasFlights && viewerReady ? (
        <GuideMessage>
          <WaitingForParty members={members} what="flight vote" />
        </GuideMessage>
      ) : hasFlights ? (
        <GuideMessage>
          <div className="flex flex-col gap-16">
            <p className="font-body">
              Here are the best flights for the party. Pick the one that suits
              you, then lock in your vote.
            </p>
            <div className="flex flex-col gap-16">
              {state.options.map((option) => (
                <FlightMatchCard
                  key={option.id}
                  option={option}
                  selected={selectedId === option.id}
                  onToggle={(id) =>
                    setSelectedId((prev) => (prev === id ? null : id))
                  }
                />
              ))}
            </div>
            {error !== null ? (
              <p role="alert" className="font-body text-alert">
                {error}
              </p>
            ) : null}
            <PixelButton
              variant="primary"
              type="button"
              label={voting ? "CASTING…" : "LOCK IN VOTE"}
              disabled={selectedId === null || voting || state.vote === null}
              onClick={() => {
                void handleVote();
              }}
            />
          </div>
        </GuideMessage>
      ) : awaitingStart ? (
        <GuideMessage>
          <div className="flex flex-col gap-16" data-testid="confirm-dates">
            {tripDates?.tripDays != null && tripRange ? (
              <p className="font-body">
                The plan is{" "}
                <strong className="font-display text-accent">
                  {tripDates.tripDays} DAYS
                </strong>
                , {tripRange}. {isOwner ? "Shall I search flights for those dates?" : ""}
              </p>
            ) : (
              <p className="font-body">
                {isOwner ? "Ready when you are." : "Almost ready."}
              </p>
            )}
            {isOwner ? (
              <div className="flex flex-wrap gap-16">
                <PixelButton
                  variant="primary"
                  label={retrying ? "STARTING…" : "SEARCH FLIGHTS"}
                  disabled={retrying}
                  onClick={() => {
                    void search(false);
                  }}
                />
                {changeDatesButton}
              </div>
            ) : (
              <p className="font-body text-subtle">
                Waiting for the party leader to confirm the dates and start the
                flight search.
              </p>
            )}
          </div>
        </GuideMessage>
      ) : finishedEmpty ? (
        <GuideMessage>
          <div className="flex flex-col gap-16">
            <p className="font-body">
              {state.guideNote ??
                "I couldn't find flights that fit the party this time."}
            </p>
            {isOwner ? (
              <div className="flex flex-wrap gap-16">
                <PixelButton
                  variant="primary"
                  label={retrying ? "SEARCHING AGAIN…" : "SEARCH AGAIN"}
                  disabled={retrying}
                  onClick={() => {
                    void search(true);
                  }}
                />
                {changeDatesButton}
              </div>
            ) : (
              <p className="font-body text-subtle">
                The party leader can ask the guide to search again.
              </p>
            )}
          </div>
        </GuideMessage>
      ) : (
        <GuideMessage>
          <div className="flex flex-col gap-16">
            <GuideThinking
              runType="logistics"
              run={run}
              isOwner={isOwner}
              retrying={retrying}
              onRetry={() => {
                void search(true);
              }}
            />
            {run?.status !== "failed" ? <SkeletonCards count={3} /> : null}
          </div>
        </GuideMessage>
      )}
      {changingDates && tripDates && canChangeDates ? (
        <TripDatesDialog
          roomId={roomId}
          memberId={memberId}
          dates={tripDates}
          onClose={() => setChangingDates(false)}
          onSaved={refresh}
        />
      ) : null}
    </StageChat>
  );
}

export default FlightStageContent;
