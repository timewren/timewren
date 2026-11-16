import type { RouterOutputs } from '~/api/app-router';
import type { StartOptions } from '~/features/timer/use-timer';
import { selectionNames } from '~/features/timer/timer-logic';
import { getItem, removeItem, setItem } from '~/lib/storage';

/**
 * Ét-tryk registrering: den senest brugte kunde/projekt skal kunne starte
 * timeren direkte fra Hjem — også uden net, hvor `time.getRecent` ikke kan
 * hentes. Derfor gemmes den nyeste post lokalt, og valget genbruges som
 * `StartOptions` af `useTimer().start`.
 */

export type RecentTask = RouterOutputs['time']['getRecent'][number];

/** Kun det `start` faktisk bruger — displaynavne følger med for etiketten. */
export type QuickStartSelection = Required<Pick<StartOptions, 'clientId' | 'projectId' | 'taskId' | 'description' | 'clientName' | 'projectName'>>;

export const QUICK_START_KEY = 'home.quickStart';
export const RECENT_LIMIT = 5;

export function toQuickStart(task: RecentTask): QuickStartSelection {
  return {
    clientId: task.clientId,
    projectId: task.projectId,
    taskId: task.taskId,
    description: task.description,
    clientName: task.clientName,
    projectName: task.projectName,
  };
}

/**
 * Uden kunde og projekt bliver en hurtig start en anonym "intern"-
 * registrering, som er svær at rette senere — så den tilbydes ikke.
 */
export function isQuickStartable(selection: QuickStartSelection | null): selection is QuickStartSelection {
  return !!selection && (selection.clientId !== null || selection.projectId !== null);
}

/** "Kunde · Projekt", som i Seneste-kortet; beskrivelsen er sidste udløbsvej. */
export function quickStartLabel(selection: QuickStartSelection, fallback: string): string {
  return selectionNames(selection) || selection.description || fallback;
}

export function rememberQuickStart(task: RecentTask): void {
  void setItem(QUICK_START_KEY, toQuickStart(task));
}

/** MMKV kan rumme hvad som helst — et kasseret eller ændret format må ikke starte en tom timer. */
export function readQuickStart(): QuickStartSelection | null {
  const stored = getItem<QuickStartSelection>(QUICK_START_KEY);
  if (!stored || typeof stored !== 'object' || !isQuickStartable(stored))
    return null;
  return stored;
}

export function forgetQuickStart(): void {
  void removeItem(QUICK_START_KEY);
}
