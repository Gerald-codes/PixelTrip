"use client";

/**
 * useActiveGuideRun — the room's AI run while it is in progress, of any type.
 *
 * Polls the latest run every 4s and returns it while it is pending or running,
 * otherwise null. Lets every screen show that MILO is working, whoever started it.
 */
import { useEffect, useState } from "react";

import { getServices } from "@/services";
import type { RunProgress } from "@/services/run.contract";

const POLL_MS = 4000;

export function useActiveGuideRun(roomId: string): RunProgress | null {
  const [run, setRun] = useState<RunProgress | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async (): Promise<void> => {
      try {
        const latest = await getServices().run.getLatestRun(roomId);
        const active =
          latest?.status === "pending" || latest?.status === "running";
        if (!cancelled) setRun(active ? latest : null);
      } catch {
        // Keep the last known state; try again on the next tick.
      }
      if (!cancelled) timer = setTimeout(() => void poll(), POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomId]);

  return run;
}
