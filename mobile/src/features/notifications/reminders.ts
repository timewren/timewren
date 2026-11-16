import * as Notifications from 'expo-notifications';
import { translate } from '~/lib/i18n';
import { storage } from '~/lib/storage';
import { ANDROID_CHANNEL_ID } from './push-registration';

/**
 * Lokale påmindelser — deterministiske, ingen server:
 *  (a) "Timer kører stadig" 2 timer efter start/seneste interaktion
 *  (b) valgfri daglig "Har du registreret tid i dag?" kl. 17 på hverdage
 */

export const TIMER_REMINDER_ID = 'timer-still-running';
export const TIMER_REMINDER_SECONDS = 2 * 60 * 60;
export const DAILY_REMINDER_PREFIX = 'daily-time-reminder-';
export const DAILY_REMINDER_HOUR = 17;
export const DAILY_REMINDER_MINUTE = 0;
/** expo-notifications: 1 = søndag … 7 = lørdag. Hverdage = mandag-fredag. */
export const WEEKDAYS = [2, 3, 4, 5, 6] as const;

const DAILY_REMINDER_KEY = 'notifications.dailyReminder';

export function isDailyReminderEnabled(): boolean {
  return storage.getBoolean(DAILY_REMINDER_KEY) === true;
}

export function dailyReminderIdentifier(weekday: number): string {
  return `${DAILY_REMINDER_PREFIX}${weekday}`;
}

/** Trigger for timer-påmindelsen: én gang, 2 timer frem. */
export function timerReminderTrigger(): Notifications.TimeIntervalTriggerInput {
  return {
    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds: TIMER_REMINDER_SECONDS,
    repeats: false,
    channelId: ANDROID_CHANNEL_ID,
  };
}

/** Ugentlige triggers for hver hverdag kl. 17:00. */
export function dailyReminderTriggers(): { identifier: string; trigger: Notifications.WeeklyTriggerInput }[] {
  return WEEKDAYS.map(weekday => ({
    identifier: dailyReminderIdentifier(weekday),
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday,
      hour: DAILY_REMINDER_HOUR,
      minute: DAILY_REMINDER_MINUTE,
      channelId: ANDROID_CHANNEL_ID,
    },
  }));
}

/** (Gen)planlæg "Timer kører stadig" 2 timer frem — kaldes ved start og ved hver interaktion. */
export async function scheduleTimerReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(TIMER_REMINDER_ID);
    await Notifications.scheduleNotificationAsync({
      identifier: TIMER_REMINDER_ID,
      content: {
        title: translate('notifications.timer_running_title'),
        body: translate('notifications.timer_running_body'),
        data: { type: 'timer' },
      },
      trigger: timerReminderTrigger(),
    });
  }
  catch {
    // Uden tilladelse kan der ikke planlægges — påmindelsen er "nice to have".
  }
}

export async function cancelTimerReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(TIMER_REMINDER_ID);
  }
  catch {
    // Ingen planlagt = intet at annullere.
  }
}

async function scheduleDailyReminders(): Promise<void> {
  for (const { identifier, trigger } of dailyReminderTriggers()) {
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: translate('notifications.daily_title'),
        body: translate('notifications.daily_body'),
        data: { type: 'time' },
      },
      trigger,
    });
  }
}

async function cancelDailyReminders(): Promise<void> {
  for (const weekday of WEEKDAYS)
    await Notifications.cancelScheduledNotificationAsync(dailyReminderIdentifier(weekday));
}

/** Slå den daglige påmindelse til/fra — gemmer valget og (af)planlægger. Kaster ved manglende tilladelse. */
export async function setDailyReminderEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    const perm = await Notifications.getPermissionsAsync();
    const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted)
      throw new Error('permission_denied');
    await cancelDailyReminders();
    await scheduleDailyReminders();
    storage.set(DAILY_REMINDER_KEY, true);
    return;
  }
  storage.remove(DAILY_REMINDER_KEY);
  await cancelDailyReminders();
}

/** Ved app-start: sørg for at planlagte påmindelser matcher det gemte valg (fx efter geninstallation/OS-oprydning). */
export async function syncDailyReminder(): Promise<void> {
  if (!isDailyReminderEnabled())
    return;
  try {
    await cancelDailyReminders();
    await scheduleDailyReminders();
  }
  catch {
    // Tilladelse trukket tilbage — valget bevares, planlægning prøves næste gang.
  }
}
