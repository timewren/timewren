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

jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', WEEKLY: 'weekly' },
  scheduleNotificationAsync: jest.fn(async (_req: unknown) => 'id'),
  cancelScheduledNotificationAsync: jest.fn(async (_id: string) => {}),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false })),
}));

jest.mock('./push-registration', () => ({ ANDROID_CHANNEL_ID: 'default' }));

// eslint-disable-next-line import/first
import {
  cancelTimerReminder,
  dailyReminderTriggers,
  isDailyReminderEnabled,
  scheduleTimerReminder,
  setDailyReminderEnabled,
  syncDailyReminder,
  TIMER_REMINDER_ID,
  timerReminderTrigger,
} from './reminders';

type Mocked = {
  scheduleNotificationAsync: jest.Mock<Promise<string>, [unknown]>;
  cancelScheduledNotificationAsync: jest.Mock<Promise<void>, [string]>;
  getPermissionsAsync: jest.Mock<Promise<{ granted: boolean }>, []>;
};
const { scheduleNotificationAsync, cancelScheduledNotificationAsync, getPermissionsAsync } = jest.requireMock('expo-notifications') as Mocked;

describe('reminders', () => {
  beforeEach(() => {
    mockMemory.clear();
    jest.clearAllMocks();
    getPermissionsAsync.mockResolvedValue({ granted: true });
  });

  it('timer-påmindelsen er én gang om 2 timer', () => {
    expect(timerReminderTrigger()).toEqual({ type: 'timeInterval', seconds: 7200, repeats: false, channelId: 'default' });
  });

  it('daglig påmindelse = mandag-fredag kl. 17:00 (expo: 1 = søndag)', () => {
    const triggers = dailyReminderTriggers();
    expect(triggers.map(t => t.trigger.weekday)).toEqual([2, 3, 4, 5, 6]);
    expect(triggers.every(t => t.trigger.hour === 17 && t.trigger.minute === 0 && t.trigger.type === 'weekly')).toBe(true);
    expect(new Set(triggers.map(t => t.identifier)).size).toBe(5);
  });

  it('scheduleTimerReminder annullerer først, så der aldrig er to', async () => {
    await scheduleTimerReminder();
    expect(cancelScheduledNotificationAsync).toHaveBeenCalledWith(TIMER_REMINDER_ID);
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationAsync.mock.calls[0]![0]).toMatchObject({ identifier: TIMER_REMINDER_ID, content: { data: { type: 'timer' } } });
    await cancelTimerReminder();
    expect(cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('setDailyReminderEnabled(true) planlægger 5 og gemmer valget', async () => {
    await setDailyReminderEnabled(true);
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(5);
    expect(isDailyReminderEnabled()).toBe(true);
  });

  it('setDailyReminderEnabled(false) annullerer 5 og glemmer valget', async () => {
    await setDailyReminderEnabled(true);
    jest.clearAllMocks();
    await setDailyReminderEnabled(false);
    expect(cancelScheduledNotificationAsync).toHaveBeenCalledTimes(5);
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(isDailyReminderEnabled()).toBe(false);
  });

  it('kaster uden tilladelse og gemmer ikke valget', async () => {
    getPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(setDailyReminderEnabled(true)).rejects.toThrow('permission_denied');
    expect(isDailyReminderEnabled()).toBe(false);
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('syncDailyReminder planlægger kun når valget er gemt', async () => {
    await syncDailyReminder();
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    mockMemory.set('notifications.dailyReminder', true);
    await syncDailyReminder();
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(5);
  });
});
