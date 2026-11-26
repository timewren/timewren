import * as Notifications from 'expo-notifications';
import { ANDROID_CHANNEL_ID } from '~/features/notifications/push-registration';
import { errorMessage } from '~/lib/api';
import { queryClient } from '~/lib/api/provider';
import { trpcClient } from '~/lib/api/trpc';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { storage } from '~/lib/storage';
import { currentWeekStart } from './week-review-logic';

/**
 * Ugens afslutning som rituel: en påmindelse søndag aften med ÉN tryk til
 * `closeWeek` — samme kæde som skærmens knap, uden at brugeren skal huske
 * skærmen.
 *
 * To ting gør det mere end en dyb-link:
 *
 *  1. **Ugen følger leveringen, ikke trykket.** Notifikationen bærer
 *     `notification.date` — tidspunktet den blev leveret. Uden det ville et
 *     tryk tirsdag formiddag lukke den tomme uge, der lige var begyndt, mens
 *     den uge brugeren faktisk ville lukke stod åben.
 *  2. **Ét kald pr. uge.** `time.closeWeek` er idempotent på serveren
 *     (`ON CONFLICT DO NOTHING` på `(userId, weekStart)`), så et dobbelttryk
 *     ikke kan oprette to lukninger. Låsen her er ikke for serverens skyld —
 *     den er for at **kvitteringen kun vises én gang**, og fordi et genleveret
 *     notifikationssvar (kold start efter et dræb) ellers ville sende det
 *     samme kald igen og vise «Ugen er lukket» for hver genstart.
 */

export const WEEK_CLOSE_REMINDER_ID = 'week-close-reminder';
/** expo-notifications: 1 = søndag … 7 = lørdag. Søndag aften er ugeafslutningen. */
export const WEEK_CLOSE_WEEKDAY = 1;
export const WEEK_CLOSE_HOUR = 18;
export const WEEK_CLOSE_MINUTE = 0;
/** Bindestregen er forbudt i kategorier (expo's egen advarsel), så: underscores. */
export const WEEK_CLOSE_CATEGORY_ID = 'week_close';
export const WEEK_CLOSE_ACTION = 'week_close_action';
export const WEEK_CLOSE_DATA_TYPE = 'week_review';

const WEEK_CLOSE_KEY = 'notifications.weekCloseReminder';

export function isWeekCloseReminderEnabled(): boolean {
  return storage.getBoolean(WEEK_CLOSE_KEY) === true;
}

export function weekCloseReminderTrigger(): Notifications.WeeklyTriggerInput {
  return {
    type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
    weekday: WEEK_CLOSE_WEEKDAY,
    hour: WEEK_CLOSE_HOUR,
    minute: WEEK_CLOSE_MINUTE,
    channelId: ANDROID_CHANNEL_ID,
  };
}

/** Kategorien med «Luk ugen»-knappen. Også Android: expo læser knapperne fra kategorien dér. */
async function ensureCategory(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(WEEK_CLOSE_CATEGORY_ID, [
    {
      identifier: WEEK_CLOSE_ACTION,
      buttonTitle: translate('week_review.close'),
      options: { isDestructive: false },
    },
  ], {});
}

/**
 * Mandagen i den uge notifikationen blev leveret i.
 *
 * Søndag aften er ugeafslutningen, og søndagen er stadig DEN uge (mandag-først),
 * så en levering søndag kl. 18 lukker den uge, der slutter samme aften.
 */
export function weekStartFromDelivery(deliveredAt: number | undefined): string {
  if (typeof deliveredAt !== 'number' || !Number.isFinite(deliveredAt) || deliveredAt <= 0)
    return currentWeekStart();
  return currentWeekStart(new Date(deliveredAt));
}

/** Er trykket på knappen (og ikke bare et tryk på notifikationen)? */
export function isWeekCloseAction(response: { actionIdentifier?: string } | null | undefined): boolean {
  return response?.actionIdentifier === WEEK_CLOSE_ACTION;
}

async function scheduleWeekCloseReminder(): Promise<void> {
  await ensureCategory();
  await Notifications.scheduleNotificationAsync({
    identifier: WEEK_CLOSE_REMINDER_ID,
    content: {
      title: translate('notifications.week_close_title'),
      body: translate('notifications.week_close_body'),
      data: { type: WEEK_CLOSE_DATA_TYPE },
      categoryIdentifier: WEEK_CLOSE_CATEGORY_ID,
    },
    trigger: weekCloseReminderTrigger(),
  });
}

async function cancelWeekCloseReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(WEEK_CLOSE_REMINDER_ID);
}

/** Slå ugeafslutnings-påmindelsen til/fra. Kaster ved manglende tilladelse. */
export async function setWeekCloseReminderEnabled(enabled: boolean): Promise<void> {
  if (!enabled) {
    storage.remove(WEEK_CLOSE_KEY);
    await cancelWeekCloseReminder();
    return;
  }
  const perm = await Notifications.getPermissionsAsync();
  const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted)
    throw new Error('permission_denied');
  // Annullér først, så en re-planlægning aldrig efterlader to søndagspåmindelser.
  await cancelWeekCloseReminder();
  await scheduleWeekCloseReminder();
  storage.set(WEEK_CLOSE_KEY, true);
}

/** Ved app-start: sørg for at den planlagte påmindelse matcher det gemte valg. */
export async function syncWeekCloseReminder(): Promise<void> {
  if (!isWeekCloseReminderEnabled())
    return;
  try {
    await cancelWeekCloseReminder();
    await scheduleWeekCloseReminder();
  }
  catch {
    // Tilladelse trukket tilbage — valget bevares, planlægning prøves næste gang.
  }
}

/**
 * Ét kald ad gangen pr. uge. Genkaldet får FØRSTE kalds svar i stedet for sit
 * eget: serverens `ON CONFLICT DO NOTHING` gør et gensendt kald harmløst, men
 * det ville vise kvitteringen igen — og ved en kold start er det præcis det
 * samme notifikationssvar, der afleveres igen.
 */
const inFlight = new Map<string, Promise<boolean>>();

export function closeWeekFromReminder(weekStart: string): Promise<boolean> {
  const running = inFlight.get(weekStart);
  if (running)
    return running;
  const run = runCloseWeek(weekStart).finally(() => inFlight.delete(weekStart));
  inFlight.set(weekStart, run);
  return run;
}

async function runCloseWeek(weekStart: string): Promise<boolean> {
  try {
    await trpcClient.time.closeWeek.mutate({ weekStart });
    // `closeWeek` svarer `{ success: true }` også når ON CONFLICT greb, så
    // svaret er ikke bevis på en ny lukning — ugeoverblikket afgør det.
    void queryClient.invalidateQueries({ queryKey: ['time', 'getWeekReview'] });
    showMessage({ message: translate('week_review.closed_ok'), type: 'success' });
    return true;
  }
  catch (error) {
    // Uden net er der intet at gemme: ugeafslutningen er en markering, ikke
    // tid, så der tages ingen kø-vej. Skærmen kan prøve igen.
    showMessage({ message: errorMessage(error), type: 'danger' });
    return false;
  }
}
