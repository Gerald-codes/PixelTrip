"use client";

/**
 * useRoomSelections — the room's locked destination and flight, live, for the
 * sidebar in every stage (a refresh mid-trip still shows what was chosen).
 */
import { useEffect, useState } from "react";

import { getServices } from "@/services";
import type { RoomSelections } from "@/services/selection.contract";

const NONE: RoomSelections = { destination: null, flight: null };

export function useRoomSelections(
  roomId: string | null | undefined,
): RoomSelections {
  const [selections, setSelections] = useState<RoomSelections>(NONE);

  useEffect(() => {
    if (!roomId) {
      setSelections(NONE);
      return;
    }
    return getServices().selection.subscribeSelections(roomId, setSelections);
  }, [roomId]);

  return selections;
}
