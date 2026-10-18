"use client";

/**
 * DestinationStageContent — DISCOVER as a chatbot-style flow (left column only;
 * the shell owns the persistent sidebar).
 *
 * MILO (the NPC guide) frames the stage in chat bubbles, then presents the AI's
 * destination matches as rich cards (fit score, why-it-fits, tags, trade-off).
 * The owner's entry starts the discovery run; recommendations + the vote arrive
 * live via Supabase Realtime through the destination service. Members pick one
 * and submit a vote; after voting they see the waiting panel.
 */
import { useEffect, useState, type ReactElement } from "react";

import { PixelButton } from "@/components/PixelButton";
import { getServices } from "@/services";
import { ApiError } from "@/lib/errors";
import type { DiscoverState } from "@/services/destination.contract";
import type { RoomMember, RoomSession } from "@/types";

import { useGuideRun } from "../hooks/useGuideRun";
import { GuideThinking } from "./GuideThinking";
import { SkeletonCards } from "./SkeletonCards";
import { WaitingForParty } from "./WaitingForParty";
import { DestinationMatchCard } from "./DestinationMatchCard";
import { StageChat, GuideSay, GuideMessage } from "./StageChat";
import { TiebreakPanel } from "./TiebreakPanel";

export interface DestinationStageContentProps {
  session: RoomSession;
  members: RoomMember[];
  onDiscoverChange?: (state: DiscoverState) => void;
}

export function DestinationStageContent({
  session,
  members,
  onDiscoverChange,
}: DestinationStageContentProps): ReactElement {
  const isOwner = session.member.role === "owner";
  const roomId = session.room.id;
  const memberId = session.member.id;

  const [discover, setDiscover] = useState<DiscoverState>({
    loading: true,
    options: [],
    selectedDestination: null,
    vote: null,
    tiePending: false,
    tiebreak: null,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);
  const [voted, setVoted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Owner's tie-break submission state.
  const [deciding, setDeciding] = useState(false);
  const [tieError, setTieError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const service = getServices().destination;

    const kickOff = async (): Promise<void> => {
      if (!isOwner) return;
      try {
        const tripId = await service.getTripId(roomId);
        if (tripId && !cancelled) {
          await service.startDiscovery({ tripId, memberId });
        }
      } catch {
        // Subscription still surfaces whatever the AI posts.
      }
    };
    void kickOff();

    const unsubscribe = service.subscribeDiscover(roomId, (state) => {
      if (!cancelled) {
        setDiscover(state);
        onDiscoverChange?.(state);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [roomId, memberId, isOwner, onDiscoverChange]);

  const vote = discover.vote;
  const { run, refresh } = useGuideRun(
    roomId,
    "discovery",
    discover.options.length === 0,
  );

  const advicePending = discover.tiePending && discover.tiebreak?.pending === true;
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

  const handleRetry = async (): Promise<void> => {
    setRetrying(true);
    try {
      const service = getServices().destination;
      const tripId = await service.getTripId(roomId);
      if (tripId)
        await service.startDiscovery({ tripId, memberId, retry: true });
    } catch {
      // The run status will still show the failure.
    } finally {
      setRetrying(false);
      refresh();
    }
  };

  const viewer = members.find((m) => m.id === memberId);
  const viewerReady = voted || viewer?.stageReady === true;

  const handleVote = async (): Promise<void> => {
    if (!vote || selectedId === null || voting) return;
    setVoting(true);
    setError(null);
    try {
      await getServices().destination.castVote({
        voteSessionId: vote.voteSessionId,
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
    if (!discover.tiebreak || deciding) return;
    setDeciding(true);
    setTieError(null);
    try {
      await getServices().destination.breakTie({
        voteSessionId: discover.tiebreak.voteSessionId,
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

  // Prefer rich recommendation items (carry description/meta); fall back to the
  // vote options (id + label only) if the recommendation message is not in yet.
  const matches =
    discover.options.length > 0
      ? discover.options.map((o) => ({
          id: o.id,
          title: o.title,
          description: o.description,
          meta: o.meta,
        }))
      : (vote?.options ?? []).map((o) => ({ id: o.id, title: o.label }));

  const hasMatches = matches.length > 0;
  const finishedEmpty = !hasMatches && run?.status === "completed";

  return (
    <StageChat>
      <GuideSay text="The party is formed! Let's find where your journey begins." />

      {discover.tiePending && discover.tiebreak ? (
        <GuideMessage>
          <TiebreakPanel
            tiebreak={discover.tiebreak}
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
      ) : viewerReady ? (
        <GuideMessage>
          <WaitingForParty members={members} what="destination vote" />
        </GuideMessage>
      ) : (
        <GuideMessage>
          <div className="flex flex-col gap-16">
            {hasMatches ? (
              <p className="font-body">
                Here are your best destination matches. Pick the one that
                excites you most, then lock in your vote.
              </p>
            ) : null}

            {finishedEmpty ? (
              <div className="flex flex-col gap-16 border-2 border-dashed border-muted p-16">
                <p className="font-body">
                  {discover.guideNote ??
                    "The guide couldn't find destinations this time."}
                </p>
                {isOwner ? (
                  <PixelButton
                    variant="primary"
                    label={retrying ? "ASKING AGAIN…" : "ASK AGAIN"}
                    disabled={retrying}
                    onClick={() => {
                      void handleRetry();
                    }}
                  />
                ) : (
                  <p className="font-body text-subtle">
                    The party leader can ask the guide again.
                  </p>
                )}
              </div>
            ) : !hasMatches ? (
              <div className="flex flex-col gap-16">
                <GuideThinking
                  runType="discovery"
                  run={run}
                  isOwner={isOwner}
                  retrying={retrying}
                  onRetry={() => {
                    void handleRetry();
                  }}
                />
                {run?.status !== "failed" ? <SkeletonCards count={3} /> : null}
              </div>
            ) : (
              <div className="flex flex-col gap-16">
                {matches.map((option) => (
                  <DestinationMatchCard
                    key={option.id}
                    option={option}
                    selected={selectedId === option.id}
                    onToggle={(id) =>
                      setSelectedId((prev) => (prev === id ? null : id))
                    }
                  />
                ))}
              </div>
            )}

            {error !== null ? (
              <p role="alert" className="font-body text-alert">
                {error}
              </p>
            ) : null}

            {hasMatches ? (
              <PixelButton
                variant="primary"
                type="button"
                label={voting ? "CASTING…" : "LOCK IN VOTE"}
                disabled={selectedId === null || voting || vote === null}
                onClick={() => {
                  void handleVote();
                }}
              />
            ) : null}
          </div>
        </GuideMessage>
      )}
    </StageChat>
  );
}

export default DestinationStageContent;
