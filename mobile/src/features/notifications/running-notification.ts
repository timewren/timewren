import type { TimerPersisted } from '~/features/timer/timer-logic';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { computeElapsedSeconds } from '~/features/timer/timer-logic';
import { translate } from '~/lib/i18n';

/**
 * Vedvarende notifikation for den kørende timer, med stop-knap.
 *
 * Ren JS — intet nyt native modul. Derfor kan den ikke være en rigtig
 * forgrundstjeneste: uden `startForegroundService` forsvinder den, når
 * systemet dræber processen. Den er altså ikke-kan-swipbar (`sticky`) så
 * længe appen lever, og den følger med i recovery, fordi timeren ligger i
 * MMKV — appen genopbygger den, så snart den er i forgrunden igen.
 *
 * Den ligger på sin egen kanal med `importance: LOW`: den eksisterende
 * `default`-kanal summer, og en stop-knap må ikke summere.
 */

/** Bindestregen er forbudt i kategorier (expo's egen advarsel), så: underscores. */
export const RUNNING_CATEGORY_ID = 'timer_running';
export const RUNNING_CHANNEL_ID = 'timer_running';
export const RUNNING_STOP_ACTION = 'timer_running_stop';
/** Hvor tit den forløbne tid skrives i notifikationen. */
export const RUNNING_TICK_MS = 60_000;

export const RUNNING_DATA_TYPE = 'timer_running';

/** Forløbet tid som `t:tt` — samme notationsform som appens øvrige klokker. */
export function formatRunningElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/**
 * Overskrift + brødtekst. Brødteksten er bevidst aldrig tom: uden den viser
 * Android-ophent notifikationen intet ud over ikonet, og brugeren kan så ikke
 * se hvad der egentlig er igangværende.
 */
export function runningTimerContent(
  state: Pick<TimerPersisted, 'projectName' | 'clientName' | 'description' | 'startTime' | 'baseSeconds'>,
  now: number = Date.now(),
): { title: string; body: string } {
  const what = state.description.trim() || state.projectName || state.clientName || translate('timer.internal');
  const elapsed = formatRunningElapsed(computeElapsedSeconds(state, now));
  return {
    title: `${translate('timer.running')} · ${elapsed}`,
    body: what,
  };
}

let presentedId: string | null = null;

/**
 * Kategorien med stop-knappen. Begge platforme: expo læser også på Android
 * knapperne fra kategorien (ExpoNotificationBuilder), så uden den havde
 * Android-notifikationen ingen stop-knap.
 */
async function ensureCategory(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(RUNNING_CATEGORY_ID, [
    {
      identifier: RUNNING_STOP_ACTION,
      buttonTitle: translate('timer.stop'),
      options: { isDestructive: true },
    },
  ], {});
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android')
    return;
  await Notifications.setNotificationChannelAsync(RUNNING_CHANNEL_ID, {
    name: translate('notifications.running_channel_name'),
    importance: Notifications.AndroidImportance.LOW,
  });
}

/**
 * Vis (eller opdatér) notifikationen. `{ channelId }` betyder "straks" på
 * samme måde som `trigger: null` (expo-notifications 0.32 har ikke længere
 * `presentNotificationAsync`), men vælger kanalen på Android. Med `null`
 * landede den på expos reservekanal med høj prioritet, så den summede og
 * poppede op hvert minut. iOS ignorerer kanalen.
 *
 * Opdateringen sker ved at fjerne den gamle og vise en ny: en straks-
 * notifikation kan ikke genplanlægges på samme id, og to samtidige
 * notifikationer ville være værre end et kort flimmer.
 */
export async function presentRunningTimer(state: TimerPersisted, now: number = Date.now()): Promise<void> {
  try {
    await dismissRunningTimer();
    await ensureChannel();
    await ensureCategory();
    const { title, body } = runningTimerContent(state, now);
    presentedId = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { type: RUNNING_DATA_TYPE },
        categoryIdentifier: RUNNING_CATEGORY_ID,
        // Android: kan ikke swipes væk, så længe appen lever.
        sticky: true,
        // Vises i liste, men popup'er ikke over skærmen hvert minut.
        priority: Notifications.AndroidNotificationPriority.LOW,
      },
      trigger: { channelId: RUNNING_CHANNEL_ID },
    });
  }
  catch {
    // Uden tilladelse (eller uden native modul) er notifikationen "nice to have".
    presentedId = null;
  }
}

export async function dismissRunningTimer(): Promise<void> {
  if (presentedId === null)
    return;
  const id = presentedId;
  presentedId = null;
  try {
    await Notifications.dismissNotificationAsync(id);
  }
  catch {
    // Allerede væk — intet at fjerne.
  }
}

/**
 * Fjern ALLE viste timernotifikationer — også dem, en tidligere proces viste.
 *
 * `dismissRunningTimer` kender kun id'et fra denne proces. Blev appen dræbt
 * med en timer kørende, og timeren derefter stoppet på web, ligger den gamle
 * notifikation med stop-knap tilbage efter næste start, og ingen fjerner den.
 */
export async function dismissStaleRunningTimers(): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const n of presented) {
      const data = n.request.content.data as { type?: unknown } | null | undefined;
      if (data?.type !== RUNNING_DATA_TYPE)
        continue;
      if (n.request.identifier === presentedId)
        presentedId = null;
      await Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {});
    }
  }
  catch {
    // Uden native modul eller tilladelse er der intet at fjerne.
  }
}

/** Er trykket på stop-knappen (og ikke bare et tryk på notifikationen)? */
export function isStopAction(response: { actionIdentifier: string }): boolean {
  return response.actionIdentifier === RUNNING_STOP_ACTION;
}

/** Kun til tests — `presentedId` er modul-state og skal nulstilles mellem cases. */
export function _resetRunningNotificationForTests() {
  presentedId = null;
}
