import type { Href } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import * as React from 'react';
import { AppState } from 'react-native';
import { stopTimerNow } from '~/features/timer/stop-timer';
import { isTimerRunning } from '~/features/timer/timer-logic';
import { getTimerState } from '~/features/timer/timer-store';
import { closeWeekFromReminder, isWeekCloseAction, syncWeekCloseReminder, weekStartFromDelivery } from '~/features/week-review/week-close';
import { hasDeclinedPush, registerForPush } from './push-registration';
import { syncDailyReminder } from './reminders';
import { routeForNotification } from './route-mapping';
import { dismissStaleRunningTimers, isStopAction, RUNNING_DATA_TYPE } from './running-notification';

// Vis notifikationer også når appen er i forgrunden.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // Den vedvarende timernotifikation opdateres hvert minut, så den må aldrig
    // popup'e over skærmen — kun ligge i listen.
    const isRunning = (notification.request.content.data as { type?: unknown } | undefined)?.type === RUNNING_DATA_TYPE;
    return {
      shouldShowBanner: !isRunning,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    };
  },
});

let registeredThisSession = false;

/** Ved login: registrér push én gang pr. app-session — medmindre brugeren tidligere har sagt nej. */
export function useRegisterPushAfterLogin(signedIn: boolean) {
  React.useEffect(() => {
    if (!signedIn || registeredThisSession || hasDeclinedPush())
      return;
    registeredThisSession = true;
    void registerForPush().then((result) => {
      if (result.status === 'error')
        console.warn('[push] registrering fejlede:', result.message);
    });
    void syncDailyReminder();
    void syncWeekCloseReminder();
  }, [signedIn]);
}

export function openFromResponse(response: Notifications.NotificationResponse | null) {
  if (!response)
    return;
  // Stop-knappen er en HANDLING, ikke en navigation: den skal gemme tiden,
  // også når appen er dræbt og kun genoplives af trykket. `getLast…` rammer
  // samme vej, så det virker ved kold start som ved baggrund.
  if (isStopAction(response)) {
    // Svaret ryddes FØRST, når kæden har nået at lægge tiden sikkert. Ryddes
    // det straks, kan processen dø i de få millisekunder før `setPendingStop`
    // når AsyncStorage — og så er trykket væk for evigt, mens serveren kører
    // timeren videre. Et genleveret svar er derimod harmløst: stop-kæden er
    // idempotent (stop-lås, journalens `stoppedAt` og `findSavedEntry`), så et
    // genkald rammer den post, et tidligere kald eventuelt allerede gemte.
    // Ryddes også ved afvisning — ellers blev et dødt kald hængende i køen.
    // Stop-kæden tjekker selv mod serveren, at det er den samme session, før
    // noget stoppes. Kører der bagefter intet lokalt (stoppet her, stoppet på
    // en anden enhed, eller intet at stoppe), må notifikationen ikke hænge.
    void stopTimerNow().then(rydSvar, rydSvar).finally(() => {
      if (!isTimerRunning(getTimerState()))
        void dismissStaleRunningTimers();
    });
    return;
  }
  // Samme regel som stop-knappen: «Luk ugen» er en handling, og den skal ramme
  // den uge notifikationen blev LEVERET i — et tryk tirsdag på søndagens
  // påmindelse må ikke lukke den tomme uge, der lige begyndte. Genlevering er
  // harmløs: låsen i `closeWeekFromReminder` giver genkaldet første kalds svar.
  if (isWeekCloseAction(response)) {
    void closeWeekFromReminder(weekStartFromDelivery(response.notification.date)).then(rydSvar, rydSvar);
    return;
  }
  // Navigation: ryd straks, ellers afleverer expo det SAMME svar ved hver
  // kold start, så appen ville navigere tilbage til den skærm igen uden at
  // brugeren har trykket på noget.
  Notifications.clearLastNotificationResponse();
  const data = response.notification.request.content.data as Record<string, unknown> | null;
  router.push(routeForNotification(data) as Href);
}

function rydSvar() {
  Notifications.clearLastNotificationResponse();
}

function clearBadge() {
  Notifications.setBadgeCountAsync(0).catch(() => {});
}

/** Tryk på notifikation → naviger ud fra `data.url`/`data.type`. Badge nulstilles når appen åbnes. */
export function useNotificationResponses() {
  React.useEffect(() => {
    clearBadge();
    // Kold start fra en notifikation
    Notifications.getLastNotificationResponseAsync().then(openFromResponse).catch(() => {});
    const responseSub = Notifications.addNotificationResponseReceivedListener(openFromResponse);
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active')
        clearBadge();
    });
    return () => {
      responseSub.remove();
      appSub.remove();
    };
  }, []);
}

/** Samlet opsætning — monteres i (app)-layoutet. */
export function useNotifications(signedIn: boolean) {
  useRegisterPushAfterLogin(signedIn);
  useNotificationResponses();
}

/** Kun til tests. */
export function _resetRegistrationForTests() {
  registeredThisSession = false;
}
