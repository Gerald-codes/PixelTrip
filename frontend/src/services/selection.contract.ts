/**
 * Selection service contract — the room's locked choices (destination, flight),
 * for the sidebar in every stage. Mirrors the `selections` table.
 */
import type { Unsubscribe } from "@/types";

export interface LockedChoice {
  id: string;
  title: string;
  data?: Record<string, unknown>;
}

export interface RoomSelections {
  destination: LockedChoice | null;
  flight: LockedChoice | null;
}

export interface SelectionService {
  /** Push the room's selections now and whenever a vote locks a new one. */
  subscribeSelections(
    roomId: string,
    onChange: (selections: RoomSelections) => void,
  ): Unsubscribe;
}
