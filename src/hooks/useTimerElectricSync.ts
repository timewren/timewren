"use client";

import { useEffect, useRef, useState } from "react";
import { subscribeElectricTimer } from "@/lib/electric/timerSource";

/**
 * ElectricSQL live reconcile (issue #260, beta spike — Fase 1).
 *
 * Uses the shared Electric timer subscription (`@/lib/electric/timerSource`)
 * and, whenever the user's timer row version changes (i.e. the timer was
 * started/stopped/updated on ANOTHER tab, device or the extension), triggers
 * `onChange` — the SAME reconcile the SSE path uses (`checkAndRecoverFromServer`).
 *
 * Design: Electric is a fast INVALIDATION signal, not the source of truth. The
 * authoritative timer state is still pulled from the server via tRPC inside the
 * reconcile — Electric just pokes it faster than polling, exactly like SSE.
 * This reuses the battle-tested reconcile instead of mutating the store
 * directly, so it's low-risk and additive; it silently no-ops when Electric is
 * disabled (proxy 503/404). Mirrors `useTimerRealtime`.
 */
export function useTimerElectricSync(onChange: () => void): {
  connected: boolean;
} {
  const [connected, setConnected] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    // Version of the row when we last saw it. null = haven't seen the initial
    // snapshot yet, so the first emission just establishes the baseline and
    // never triggers a (spurious) reconcile on mount.
    let lastVersion: number | null = null;

    return subscribeElectricTimer((s) => {
      setConnected(s.connected);
      if (!s.connected) return;
      const version = s.row?.version ?? 0;
      if (lastVersion === null) {
        lastVersion = version;
        return;
      }
      if (version !== lastVersion) {
        lastVersion = version;
        onChangeRef.current();
      }
    });
  }, []);

  return { connected };
}
