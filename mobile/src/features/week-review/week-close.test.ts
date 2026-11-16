const mockMemory = new Map<string, unknown>();

jest.mock('~/lib/storage', () => ({
  storage: {
    getString: (k: string) => mockMemory.get(k) as string | undefined,
    getBoolean: (k: string) => mockMemory.get(k) as boolean | undefined,
    set: (k: string, v: unknown) => mockMemory.set(k, v),
    remove: (k: string) => mockMemory.delete(k),
  },
}));

jest.mock('~/lib/i18n', () => ({ translate: (key: string) => key }));

jest.mock('react-native-flash-message', () => ({ showMessage: jest.fn() }));

jest.mock('~/lib/api/provider', () => ({
  queryClient: { invalidateQueries: jest.fn(async () => {}) },
}));

jest.mock('~/lib/api', () => ({ errorMessage: (e: unknown) => (e as Error)?.message ?? 'fejl' }));

const mockMutate = jest.fn(async (_input: unknown) => ({ success: true }));
jest.mock('~/lib/api/trpc', () => ({
  trpcClient: { time: { closeWeek: { mutate: (input: unknown) => mockMutate(input) } } },
}));

jest.mock('~/features/notifications/push-registration', () => ({ ANDROID_CHANNEL_ID: 'default' }));

jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', WEEKLY: 'weekly' },
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  setNotificationCategoryAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false })),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AccessibilityInfo: { announceForAccessibility: jest.fn() },
}));

// eslint-disable-next-line import/first
import { showMessage } from 'react-native-flash-message';
// eslint-disable-next-line import/first
import { queryClient } from '~/lib/api/provider';
// eslint-disable-next-line import/first
import {
  closeWeekFromReminder,
  isWeekCloseAction,
  isWeekCloseReminderEnabled,
  setWeekCloseReminderEnabled,
  syncWeekCloseReminder,
  WEEK_CLOSE_ACTION,
  WEEK_CLOSE_REMINDER_ID,
  weekCloseReminderTrigger,
  weekStartFromDelivery,
} from './week-close';
// eslint-disable-next-line import/first
import { currentWeekStart } from './week-review-logic';

type Mocked = {
  scheduleNotificationAsync: jest.Mock<Promise<string>, [unknown]>;
  cancelScheduledNotificationAsync: jest.Mock<Promise<void>, [string]>;
  getPermissionsAsync: jest.Mock<Promise<{ granted: boolean }>, []>;
  requestPermissionsAsync: jest.Mock<Promise<{ granted: boolean }>, []>;
};
const { scheduleNotificationAsync, cancelScheduledNotificationAsync, getPermissionsAsync, requestPermissionsAsync } = jest.requireMock('expo-notifications') as Mocked;

const toasts = () => (showMessage as unknown as jest.Mock).mock.calls.map(c => (c[0] as { message: string }).message);

function response(actionIdentifier: string, date: unknown) {
  return { actionIdentifier, notification: { date } } as unknown as Parameters<typeof isWeekCloseAction>[0];
}

/** Søndag 1/11 2026 kl. 18:00 i Europe/Copenhagen. */
const SUNDAY_EVENING = new Date('2026-11-01T17:00:00.000Z');

describe('ugeafslutning — påmindelsen', () => {
  beforeEach(() => {
    mockMemory.clear();
    jest.clearAllMocks();
    getPermissionsAsync.mockResolvedValue({ granted: true });
  });

  it('kører søndag aften kl. 18 (expo: 1 = søndag)', () => {
    expect(weekCloseReminderTrigger()).toEqual({ type: 'weekly', weekday: 1, hour: 18, minute: 0, channelId: 'default' });
  });

  it('slås til: planlægger én og gemmer valget', async () => {
    await setWeekCloseReminderEnabled(true);
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationAsync.mock.calls[0]![0]).toMatchObject({
      identifier: WEEK_CLOSE_REMINDER_ID,
      content: { data: { type: 'week_review' } },
    });
    expect(isWeekCloseReminderEnabled()).toBe(true);
  });

  it('slås fra: annullerer og glemmer valget', async () => {
    await setWeekCloseReminderEnabled(true);
    jest.clearAllMocks();
    await setWeekCloseReminderEnabled(false);
    expect(cancelScheduledNotificationAsync).toHaveBeenCalledWith(WEEK_CLOSE_REMINDER_ID);
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(isWeekCloseReminderEnabled()).toBe(false);
  });

  it('kaster uden tilladelse og gemmer ikke valget', async () => {
    getPermissionsAsync.mockResolvedValue({ granted: false });
    requestPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(setWeekCloseReminderEnabled(true)).rejects.toThrow('permission_denied');
    expect(isWeekCloseReminderEnabled()).toBe(false);
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('planlægger igen ved app-start, så valget overlever en geninstallation', async () => {
    await syncWeekCloseReminder();
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    mockMemory.set('notifications.weekCloseReminder', true);
    await syncWeekCloseReminder();
    expect(cancelScheduledNotificationAsync).toHaveBeenCalledWith(WEEK_CLOSE_REMINDER_ID);
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('gør intet, når tilladelsen er trukket tilbage — valget bevares', async () => {
    mockMemory.set('notifications.weekCloseReminder', true);
    scheduleNotificationAsync.mockRejectedValueOnce(new Error('no permission'));
    await expect(syncWeekCloseReminder()).resolves.toBeUndefined();
    expect(isWeekCloseReminderEnabled()).toBe(true);
  });
});

describe('ugeafslutning — hvilken uge trykket lukker', () => {
  it('en søndag-aften-notification lukker den uge, der er ved at slutte', () => {
    expect(weekStartFromDelivery(SUNDAY_EVENING.getTime())).toBe('2026-10-26');
  });

  it('trykkes den FØLGENDE mandag, er det stadig den leverede uge', () => {
    // Notifikationen blev leveret søndag 1/11 aften. Uden leveringstidspunktet
    // ville et tryk tirsdag lukke en tom, ny uge (2/11) og lade den gamle stå.
    const leveret = SUNDAY_EVENING.getTime();
    expect(weekStartFromDelivery(leveret)).toBe('2026-10-26');
    // Samme levering, tirsdag: en tidsbestemt uge kan ikke flytte sig.
    expect(weekStartFromDelivery(leveret)).not.toBe(weekStartFromDelivery(new Date('2026-11-03T09:00:00.000Z').getTime()));
  });

  it('leveringsdag i en DST-uge gælder: ugeafslutningen følger kalenderen', () => {
    // Danmark skifter til vintertid søndag 25/10 2026 kl. 03:00.
    expect(weekStartFromDelivery(new Date('2026-10-25T17:00:00.000Z').getTime())).toBe('2026-10-19');
  });

  it('uden gyldigt tidspunkt falder tilbage til den aktuelle uge — som skærmens knap', () => {
    const nu = currentWeekStart();
    expect(weekStartFromDelivery(undefined)).toBe(nu);
    expect(weekStartFromDelivery(Number.NaN)).toBe(nu);
  });
});

describe('ugeafslutning — tryk på knappen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMutate.mockResolvedValue({ success: true });
  });

  it('kendes kun på vores egen handling', () => {
    expect(isWeekCloseAction(response(WEEK_CLOSE_ACTION, 0))).toBe(true);
    expect(isWeekCloseAction(response('timer_running_stop', 0))).toBe(false);
    expect(isWeekCloseAction(response('', 0))).toBe(false);
  });

  it('lukker ugen, kvitterer og genindlæser ugeoverblikket', async () => {
    expect(await closeWeekFromReminder('2026-10-26')).toBe(true);
    expect(mockMutate).toHaveBeenCalledWith({ weekStart: '2026-10-26' });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['time', 'getWeekReview'] });
    expect(toasts()).toEqual(['week_review.closed_ok']);
  });

  it('et dobbelttryk lukker ÉN uge — det andet kald får det første svar', async () => {
    let release = () => {};
    mockMutate.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ success: true });
    }));

    const first = closeWeekFromReminder('2026-10-26');
    const second = closeWeekFromReminder('2026-10-26');
    expect(mockMutate).toHaveBeenCalledTimes(1);

    release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual(['week_review.closed_ok']);
  });

  it('to forskellige uger lukkes uafhængigt', async () => {
    await closeWeekFromReminder('2026-10-26');
    await closeWeekFromReminder('2026-11-02');
    expect(mockMutate).toHaveBeenCalledTimes(2);
  });

  it('et nyt kald efter at det første er færdigt, går igen til serveren', async () => {
    await closeWeekFromReminder('2026-10-26');
    await closeWeekFromReminder('2026-10-26');
    expect(mockMutate).toHaveBeenCalledTimes(2);
  });

  it('uden net melder fejlen og lover intet', async () => {
    mockMutate.mockRejectedValue(new Error('Network request failed'));
    expect(await closeWeekFromReminder('2026-10-26')).toBe(false);
    expect(toasts()).toEqual(['Network request failed']);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it('et afvist kald rydder låsen, så et senere tryk kan prøve igen', async () => {
    mockMutate.mockRejectedValueOnce(new Error('Ugyldig uge'));
    expect(await closeWeekFromReminder('2026-10-26')).toBe(false);
    expect(await closeWeekFromReminder('2026-10-26')).toBe(true);
    expect(mockMutate).toHaveBeenCalledTimes(2);
  });
});
