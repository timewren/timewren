import type { TimerPersisted, TimerSelection } from './timer-logic';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { storage } from '~/lib/storage';
import { createSelectors } from '~/lib/utils';
import { EMPTY_TIMER } from './timer-logic';

export const TIMER_STORAGE_KEY = 'timer-state';

type TimerActions = {
  /** Erstat hele den persisterede tilstand (start, adoption, reconcile). */
  replace: (next: TimerPersisted) => void;
  setSelection: (patch: Partial<TimerSelection>) => void;
  setVersion: (version: number) => void;
  /** Ryd timeren, men behold serverens version. */
  reset: (version?: number) => void;
};

export type TimerStore = TimerPersisted & TimerActions;

const PERSIST_KEYS: readonly (keyof TimerPersisted)[] = [
  'startTime',
  'baseSeconds',
  'version',
  'pendingSync',
  'sessionId',
  'projectId',
  'clientId',
  'taskId',
  'description',
  'projectName',
  'clientName',
];

/** Kun rå tilstand gemmes — aldrig funktioner, aldrig udledt forløbet tid. */
export function pickPersisted(state: TimerPersisted): TimerPersisted {
  const out = {} as Record<keyof TimerPersisted, unknown>;
  for (const key of PERSIST_KEYS)
    out[key] = state[key];
  // En tilstand gemt før sessions-id'et fandtes, har ikke feltet.
  out.sessionId ??= null;
  return out as TimerPersisted;
}

const mmkvStorage = {
  getItem: (name: string) => storage.getString(name) ?? null,
  setItem: (name: string, value: string) => storage.set(name, value),
  removeItem: (name: string) => storage.remove(name),
};

const _useTimerStore = create<TimerStore>()(
  persist(
    set => ({
      ...EMPTY_TIMER,
      replace: next => set(pickPersisted(next)),
      setSelection: patch => set(patch),
      setVersion: version => set({ version }),
      reset: version => set(state => ({ ...EMPTY_TIMER, version: version ?? state.version })),
    }),
    {
      name: TIMER_STORAGE_KEY,
      storage: createJSONStorage(() => mmkvStorage),
      partialize: state => pickPersisted(state),
    },
  ),
);

export const useTimerStore = createSelectors(_useTimerStore);

export const getTimerState = () => pickPersisted(_useTimerStore.getState());
export const timerActions = (): TimerActions => _useTimerStore.getState();
