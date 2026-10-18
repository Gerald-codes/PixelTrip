"use client";

/**
 * useGuideRun — the latest AI run of a type for the room, polled while `active`.
 *
 * Polls every 2s while the run is pending or running, and every 6s once it has
 * finished (so a retry started by another member is picked up). Stops when the
 * screen no longer needs it. `refresh` re-reads at once (e.g. after a retry).
 */
import { useCallback, useEffect, useState } from "react";

import { getServices } from "@/services";
import type { RunProgress, RunType } from "@/services/run.contract";

const ACTIVE_MS = 2000;
const IDLE_MS = 6000;

export interface GuideRun {
  run: RunProgress | null;
  /** True once the first read has answered, so `run: null` means "no run yet". */
  loaded: boolean;
  refresh: () => void;
}

export function useGuideRun(
  roomId: string,
  runType: RunType,
  active: boolean,
): GuideRun {
  const [run, setRun] = useState<RunProgress | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async (): Promise<void> => {
      let next: RunProgress | null = null;
      try {
        next = await getServices().run.getLatestRun(roomId, runType);
        if (!cancelled) {
          setRun(next);
          setLoaded(true);
        }
      } catch {
        // Keep the last known run; try again on the next tick.
      }
      if (cancelled) return;
      const finished =
        next?.status === "completed" || next?.status === "failed";
      timer = setTimeout(() => void poll(), finished ? IDLE_MS : ACTIVE_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomId, runType, active, tick]);

  return { run, loaded, refresh };
}
