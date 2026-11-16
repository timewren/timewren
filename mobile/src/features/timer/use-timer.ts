import type { TimerPersisted, TimerSelection } from './timer-logic';
import type { StartOptions } from './use-timer-commands';
import * as React from 'react';
import { AppState } from 'react-native';
import { trpc } from '~/lib/api';
import { reconcileTimerNow } from './stop-timer';
import { isTimerRunning } from './timer-logic';
import { timerActions, useTimerStore } from './timer-store';
import { useTimerCommands } from './use-timer-commands';

export type { StartOptions } from './use-timer-commands';

export type UseTimer = {
  isRunning: boolean;
  timer: TimerPersisted;
  /** Igangværende netværkskald (start/stop/kassér) */
  isBusy: boolean;
  start: (opts?: StartOptions) => Promise<boolean>;
  stop: () => Promise<boolean>;
  discard: () => Promise<void>;
  /** Lokal opdatering af beskrivelsen (synk med `switchTo` ved blur) */
  updateDescription: (description: string) => void;
  /** Skift kunde/projekt/beskrivelse på en kørende timer */
  switchTo: (selection: Partial<TimerSelection>) => Promise<void>;
  /** Hent serverens tilstand og adoptér den */
  reconcile: () => Promise<void>;
};

/** Afstem med serveren ved mount og hver gang appen kommer i forgrunden. */
function useReconcileOnForeground(reconcile: () => Promise<void>) {
  React.useEffect(() => {
    void reconcile();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active')
        void reconcile();
    });
    return () => sub.remove();
  }, [reconcile]);
}

export function useTimer(): UseTimer {
  const timer = useTimerStore(s => s);
  const utils = trpc.useUtils();
  const [isBusy, setIsBusy] = React.useState(false);

  const reconcile = React.useCallback(() => reconcileTimerNow(), []);
  useReconcileOnForeground(reconcile);

  const commands = useTimerCommands({ reconcile, setBusy: setIsBusy, utils });

  const updateDescription = React.useCallback((description: string) => {
    timerActions().setSelection({ description });
  }, []);

  return {
    isRunning: isTimerRunning(timer),
    timer,
    isBusy,
    updateDescription,
    reconcile,
    ...commands,
  };
}
