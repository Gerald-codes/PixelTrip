"use client";

import { RoomStage, type CharacterProfile, type TripRoom, type User } from "@/lib/types";

import ActivitiesStage from "./ActivitiesStage";
import AvailabilityStage from "./AvailabilityStage";
import FeedbackStage from "./FeedbackStage";
import DestinationVoteStage from "./DestinationVoteStage";
import DestinationsStage from "./DestinationsStage";
import FlightStage from "./FlightStage";
import FlightVoteStage from "./FlightVoteStage";
import GroupProfileStage from "./GroupProfileStage";
import ItineraryStage from "./ItineraryStage";
import LobbyStage from "./LobbyStage";
import NegotiationStage from "./NegotiationStage";
import FinalStage from "./FinalStage";

/**
 * The browser-side identity of the current user (no auth — a localStorage UUID
 * plus a display name). Produced by `lib/identity.ts` and threaded through every
 * stage so components can attribute actions to the right user.
 */
export interface Identity {
  userId: string;
  displayName: string;
}

/**
 * The contract every `*Stage` component must conform to.
 *
 * `onRoomUpdated` — called with the fresh TripRoom after any mutation so
 *   page.tsx updates local state immediately, without waiting on a broadcast.
 *
 * `onGoBack` — host-only callback wired from page.tsx. Sends a backward PATCH
 *   and calls onRoomUpdated. Undefined for non-host clients.
 *
 * `characterProfiles` — optional array of character profiles for all room
 *   members. Stage components that don't need it can safely ignore this prop.
 */
export interface StageProps {
  room: TripRoom;
  identity: Identity;
  members: User[];
  onRoomUpdated: (updated: TripRoom) => void;
  onGoBack?: () => Promise<void>;
  characterProfiles?: CharacterProfile[];
}

function StagePlaceholder({ stage }: { stage: RoomStage }) {
  return (
    <section className="mx-auto max-w-2xl rounded-lg border border-dashed border-gray-300 p-8 text-center">
      <p className="text-sm uppercase tracking-wide text-gray-500">
        Current stage
      </p>
      <h2 className="mt-1 text-2xl font-bold">{stage}</h2>
      <p className="mt-4 text-gray-600">
        This stage is not built yet. It will be wired in by a later task.
      </p>
    </section>
  );
}

export default function StageRouter({
  room,
  identity,
  members,
  onRoomUpdated,
  onGoBack,
  characterProfiles,
}: StageProps) {
  const props = { room, identity, members, onRoomUpdated, onGoBack, characterProfiles };

  switch (room.currentStage) {
    case RoomStage.LOBBY:
      return <LobbyStage {...props} />;
    case RoomStage.AVAILABILITY:
      return <AvailabilityStage {...props} />;
    case RoomStage.GROUP_PROFILE:
      return <GroupProfileStage {...props} />;
    case RoomStage.DESTINATIONS:
      return <DestinationsStage {...props} />;
    case RoomStage.DESTINATION_VOTE:
      return <DestinationVoteStage {...props} />;
    case RoomStage.FLIGHTS:
      return <FlightStage {...props} />;
    case RoomStage.FLIGHT_VOTE:
      return <FlightVoteStage {...props} />;
    case RoomStage.ACTIVITIES:
      return <ActivitiesStage {...props} />;
    case RoomStage.ITINERARY:
      return <ItineraryStage {...props} />;
    case RoomStage.FEEDBACK:
      return <FeedbackStage {...props} />;
    case RoomStage.NEGOTIATION:
      return <NegotiationStage {...props} />;
    case RoomStage.FINAL:
      return <FinalStage {...props} />;
    case RoomStage.PERSONA:
      return <StagePlaceholder stage={room.currentStage} />;
    default:
      return assertNeverStage(room.currentStage);
  }
}

function assertNeverStage(stage: never): never {
  throw new Error(`Unhandled room stage: ${String(stage)}`);
}
