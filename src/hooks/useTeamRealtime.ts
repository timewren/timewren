"use client";

import { useEffect, useRef } from "react";

const REALTIME_ENABLED = process.env.NEXT_PUBLIC_REALTIME_ENABLED === "true";

/**
 * Calls `onTeamEvent` whenever a "team" timer event arrives over SSE (any org
 * member's timer changed). Used by the team-live view to refresh instantly
 * instead of waiting for its polling interval. No-op when realtime is disabled.
 */
export function useTeamRealtime(onTeamEvent: () => void): void {
  const ref = useRef(onTeamEvent);
  ref.current = onTeamEvent;

  useEffect(() => {
    if (
      !REALTIME_ENABLED ||
      typeof window === "undefined" ||
      typeof EventSource === "undefined"
    ) {
      return;
    }
    const es = new EventSource("/api/realtime");
    es.addEventListener("team", () => ref.current());
    return () => es.close();
  }, []);
}
