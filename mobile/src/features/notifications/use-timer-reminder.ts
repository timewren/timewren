import * as React from 'react';
import { isTimerRunning } from '~/features/timer/timer-logic';
import { useTimerStore } from '~/features/timer/timer-store';
import { cancelTimerReminder, scheduleTimerReminder } from './reminders';

/**
 * "Timer kører stadig" 2 timer efter start — og 2 timer efter seneste
 * interaktion (skift af projekt/beskrivelse). Abonnerer på timer-storen,
 * så timer-API'et er uændret. Annulleres når timeren stopper/kasseres.
 */
export function useTimerReminder() {
  React.useEffect(() => {
    let wasRunning = isTimerRunning(useTimerStore.getState());
    let lastStart = useTimerStore.getState().startTime;
    let lastSelection = selectionKey();

    if (wasRunning)
      void scheduleTimerReminder();

    return useTimerStore.subscribe((state) => {
      const running = isTimerRunning(state);
      const selection = selectionKey();
      const interacted = running && (state.startTime !== lastStart || selection !== lastSelection);
      if (running && (!wasRunning || interacted))
        void scheduleTimerReminder();
      else if (!running && wasRunning)
        void cancelTimerReminder();
      wasRunning = running;
      lastStart = state.startTime;
      lastSelection = selection;
    });
  }, []);
}

function selectionKey(): string {
  const s = useTimerStore.getState();
  return `${s.projectId}|${s.clientId}|${s.taskId}|${s.description}`;
}
