"use client";

import { RoomStage, type TripRoom, type User } from "@/lib/types";

import AvailabilityStage from "./AvailabilityStage";
import DestinationVoteStage from "./DestinationVoteStage";
import DestinationsStage from "./DestinationsStage";
import GroupProfileStage from "./GroupProfileStage";
import LobbyStage from "./LobbyStage";

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
 * StageRouter renders exactly one stage component for the room's
 * `currentStage`, passing the current room, the viewer's identity, and the
 * current member list (DB-backed).
 */
export interface StageProps {
  room: TripRoom;
  identity: Identity;
  members: User[];
}

/**
 * Lightweight placeholder for stages whose real component has not been built
 * yet. Replace each placeholder with the real `*Stage` component as it lands in
 * later tasks.
 */
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

/**
 * Renders the active stage component based on `room.currentStage`.
 *
 * The switch is exhaustive over {@link RoomStage}: the `never` fallthrough makes
 * the compiler flag any stage that is added to the enum but not handled here, so
 * no stage can be silently orphaned.
 */
export default function StageRouter({ room, identity, members }: StageProps) {
  switch (room.currentStage) {
    case RoomStage.LOBBY:
      return <LobbyStage room={room} identity={identity} members={members} />;
    case RoomStage.AVAILABILITY:
      return (
        <AvailabilityStage
          room={room}
          identity={identity}
          members={members}
        />
      );
    case RoomStage.GROUP_PROFILE:
      return (
        <GroupProfileStage
          room={room}
          identity={identity}
          members={members}
        />
      );
    case RoomStage.DESTINATIONS:
      return (
        <DestinationsStage
          room={room}
          identity={identity}
          members={members}
        />
      );
    case RoomStage.DESTINATION_VOTE:
      return (
        <DestinationVoteStage
          room={room}
          identity={identity}
          members={members}
        />
      );
    case RoomStage.PERSONA:
    case RoomStage.FLIGHTS:
    case RoomStage.FLIGHT_VOTE:
    case RoomStage.ACTIVITIES:
    case RoomStage.ITINERARY:
    case RoomStage.FEEDBACK:
    case RoomStage.NEGOTIATION:
    case RoomStage.FINAL:
      // Placeholders for now; each will be swapped for its real *Stage
      // component (which conforms to StageProps) in later tasks.
      return <StagePlaceholder stage={room.currentStage} />;
    default:
      return assertNeverStage(room.currentStage);
  }
}

/**
 * Compile-time exhaustiveness guard. If a new {@link RoomStage} is added without
 * a matching case above, TypeScript will error here.
 */
function assertNeverStage(stage: never): never {
  throw new Error(`Unhandled room stage: ${String(stage)}`);
}
