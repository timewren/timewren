"use client";

import { useEffect, useState } from "react";
import {
  createSharedTabOwnership,
  hasWebLocksSupport,
  type TabOwnershipState,
} from "@/lib/timer/tab-owner";

export type TimerTabOwnership = TabOwnershipState;

/** Fanens ene ejerskabs-anmodning, delt af alle hook-instanser i fanen. */
let sharedOwnership: ReturnType<typeof createSharedTabOwnership> | null = null;

/**
 * Er denne fane den udpegede ejer af timerens baggrunds-skrivninger i denne
 * browser-profil? Se lib/timer/tab-owner.ts for mekanismen (Web Locks).
 * Browsere uden understøttelse (gammel browser/SSR) er altid ejer fra start —
 * dagens adfærd, alle faner er ejere.
 */
export function useTimerTabOwner(): TimerTabOwnership {
  const [ownership, setOwnership] = useState<TimerTabOwnership>(() => ({
    isOwner: !hasWebLocksSupport(),
    handover: false,
  }));

  useEffect(() => {
    if (!hasWebLocksSupport()) {
      setOwnership({ isOwner: true, handover: false });
      return;
    }
    sharedOwnership ??= createSharedTabOwnership(navigator.locks);
    const unsubscribe = sharedOwnership.subscribe(setOwnership);
    // En overdragelse er en hændelse, ikke en tilstand: en instans, der
    // monteres, efter fanen blev ejer, overtager intet (isAdoptionRef).
    setOwnership({ isOwner: sharedOwnership.get().isOwner, handover: false });
    return unsubscribe;
  }, []);

  return ownership;
}
