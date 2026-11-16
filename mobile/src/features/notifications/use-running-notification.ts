import type { TimerPersisted } from '~/features/timer/timer-logic';
import * as React from 'react';
import { isTimerRunning } from '~/features/timer/timer-logic';
import { useTimerStore } from '~/features/timer/timer-store';
import { dismissRunningTimer, dismissStaleRunningTimers, presentRunningTimer, RUNNING_TICK_MS } from './running-notification';

/**
 * Holder den vedvarende notifikation i live spejl med timeren.
 *
 * Abonnerer på timer-storen (samme mønster som `use-timer-reminder`), så
 * timer-API'et er uændret: start → notifikation med stop-knap, stop →
 * notifikationen væk. Montér i layoutet, ikke på hemskærmen, ellers dør den
 * ved navigation.
 */
export function useRunningNotification(): void {
  React.useEffect(() => {
    let wasRunning = isTimerRunning(useTimerStore.getState());
    let lastSelection = selectionKey();
    let tick: ReturnType<typeof setInterval> | null = null;

    function stopTicking() {
      if (tick === null)
        return;
      clearInterval(tick);
      tick = null;
    }

    function show(state: TimerPersisted) {
      // Uden tilladelse er det her, `presentRunningTimer` tier stille.
      void presentRunningTimer(state);
      stopTicking();
      // Skriv den forløbne tid ind en gang i minuttet. Baggrundstimer er
      // dæmpet af OS, så teksten kan blive ældre — notifikationen består
      // stadig, og genopbygges ved næste forgrund.
      tick = setInterval(() => void presentRunningTimer(useTimerStore.getState()), RUNNING_TICK_MS);
    }

    if (wasRunning)
      show(useTimerStore.getState());
    // Ingen timer kører: en notifikation fra en tidligere proces (stoppet på
    // en anden enhed, mens appen var dræbt) må ikke blive liggende med stop-knap.
    else
      void dismissStaleRunningTimers();

    const unsubscribe = useTimerStore.subscribe((state) => {
      const running = isTimerRunning(state);
      const selection = selectionKey();
      const changed = selection !== lastSelection;
      lastSelection = selection;
      if (running && (!wasRunning || changed)) {
        show(state);
      }
      else if (!running && wasRunning) {
        stopTicking();
        void dismissRunningTimer().then(dismissStaleRunningTimers);
      }
      wasRunning = running;
    });

    return () => {
      stopTicking();
      unsubscribe();
    };
  }, []);
}

function selectionKey(): string {
  const s = useTimerStore.getState();
  return `${s.startTime}|${s.projectId}|${s.clientId}|${s.taskId}|${s.description}`;
}
