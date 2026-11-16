"use client";

import { useEffect, useState } from "react";
import {
  type ElectricTimerState,
  subscribeElectricTimer,
} from "@/lib/electric/timerSource";

export type { ElectricTimerRow } from "@/lib/electric/timerSource";

/**
 * ElectricSQL spike (issue #260, beta-only) — exposes the current user's own
 * `timer_states` row, live-synced via the shared Electric subscription
 * (`@/lib/electric/timerSource`). OBSERVE-ONLY: it does not drive the timer
 * store. Silently reports `connected: false` when Electric is disabled.
 */
export function useElectricTimer(): ElectricTimerState {
  const [state, setState] = useState<ElectricTimerState>({
    connected: false,
    row: null,
    lastUpdate: null,
  });

  useEffect(() => subscribeElectricTimer(setState), []);

  return state;
}
