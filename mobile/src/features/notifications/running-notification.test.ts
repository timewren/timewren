import type { TimerPersisted } from '~/features/timer/timer-logic';
import { Platform } from 'react-native';
import {
  _resetRunningNotificationForTests,
  dismissRunningTimer,
  dismissStaleRunningTimers,
  formatRunningElapsed,
  isStopAction,
  presentRunningTimer,
  RUNNING_CATEGORY_ID,
  RUNNING_CHANNEL_ID,
  RUNNING_STOP_ACTION,
  runningTimerContent,
} from './running-notification';

jest.mock('~/lib/i18n', () => ({ translate: (key: string) => key }));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { LOW: 4, DEFAULT: 5 },
  AndroidNotificationPriority: { LOW: 'low', DEFAULT: 'default' },
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationCategoryAsync: jest.fn(async () => null),
  scheduleNotificationAsync: jest.fn(async () => 'running-1'),
  dismissNotificationAsync: jest.fn(async () => {}),
  getPresentedNotificationsAsync: jest.fn(async () => []),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

type Mocked = {
  setNotificationChannelAsync: jest.Mock;
  setNotificationCategoryAsync: jest.Mock;
  scheduleNotificationAsync: jest.Mock;
  dismissNotificationAsync: jest.Mock;
  getPresentedNotificationsAsync: jest.Mock;
};
const notifications = jest.requireMock('expo-notifications') as Mocked;

const START = '2026-09-29T08:00:00.000Z';

function state(patch: Partial<TimerPersisted> = {}): TimerPersisted {
  return {
    startTime: START,
    baseSeconds: 0,
    version: 1,
    pendingSync: false,
    sessionId: null,
    projectId: 'p1',
    clientId: 'c1',
    taskId: null,
    description: '',
    projectName: 'Acme',
    clientName: 'Kunde A',
    ...patch,
  };
}

function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

describe('running-notification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetRunningNotificationForTests();
    setPlatform('android');
  });

  describe('formatRunningElapsed', () => {
    it('viser m:s under en time og h:m:s over', () => {
      expect(formatRunningElapsed(0)).toBe('0:00');
      expect(formatRunningElapsed(65)).toBe('1:05');
      expect(formatRunningElapsed(59 * 60)).toBe('59:00');
      expect(formatRunningElapsed(3600)).toBe('1:00:00');
      expect(formatRunningElapsed(3661)).toBe('1:01:01');
    });

    it('går aldrig under nul (ugyldig start-tidspunkt)', () => {
      expect(formatRunningElapsed(-90)).toBe('0:00');
    });
  });

  describe('runningTimerContent', () => {
    const now = new Date('2026-09-29T09:30:20.000Z').getTime();

    it('foretager egen beskrivelse → projekt → kunde → intern', () => {
      expect(runningTimerContent(state({ description: '  Kode  ' }), now).body).toBe('Kode');
      expect(runningTimerContent(state(), now).body).toBe('Acme');
      expect(runningTimerContent(state({ projectName: null }), now).body).toBe('Kunde A');
      expect(runningTimerContent(state({ projectName: null, clientName: null }), now).body).toBe('timer.internal');
    });

    it('skriver forløbet tid i overskriften, udledt af starttidspunktet', () => {
      expect(runningTimerContent(state(), now).title).toBe('timer.running · 1:30:20');
    });

    it('lægger baseSeconds (webens pause) foran den lokale session', () => {
      const s = state({ baseSeconds: 3600 });
      expect(runningTimerContent(s, new Date(START).getTime()).title).toBe('timer.running · 1:00:00');
    });
  });

  describe('presentRunningTimer', () => {
    it('viser en sticky notifikation på lav kanal med stop-kategori', async () => {
      await presentRunningTimer(state(), new Date('2026-09-29T08:00:00.000Z').getTime());
      expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
        RUNNING_CHANNEL_ID,
        expect.objectContaining({ importance: 4 }),
      );
      const request = notifications.scheduleNotificationAsync.mock.calls[0]![0];
      expect(request).toMatchObject({
        trigger: null,
        content: {
          title: 'timer.running · 0:00',
          body: 'Acme',
          sticky: true,
          priority: 'low',
          categoryIdentifier: RUNNING_CATEGORY_ID,
          data: { type: 'timer_running' },
        },
      });
    });

    it('fjerner den forrige notifikation, så der aldrig er to', async () => {
      await presentRunningTimer(state());
      expect(notifications.dismissNotificationAsync).not.toHaveBeenCalled();
      await presentRunningTimer(state());
      expect(notifications.dismissNotificationAsync).toHaveBeenCalledWith('running-1');
      expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    });

    it('laver intet på iOS, hvor kategorien nævner stop-knappen', async () => {
      setPlatform('ios');
      await presentRunningTimer(state());
      expect(notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
      expect(notifications.setNotificationCategoryAsync).toHaveBeenCalledWith(
        RUNNING_CATEGORY_ID,
        [expect.objectContaining({ identifier: RUNNING_STOP_ACTION })],
        {},
      );
    });

    it('sluger fejl (manglende tilladelse) i stedet for at kaste', async () => {
      notifications.scheduleNotificationAsync.mockRejectedValueOnce(new Error('permission_denied'));
      await expect(presentRunningTimer(state())).resolves.toBeUndefined();
      // Efter en fejl må et senere kald ikke forsøge at fjerne en gammel id.
      await presentRunningTimer(state());
      expect(notifications.dismissNotificationAsync).not.toHaveBeenCalled();
    });
  });

  describe('isStopAction', () => {
    it('genkender kun stop-knappen, ikke et almindeligt tryk', () => {
      expect(isStopAction({ actionIdentifier: RUNNING_STOP_ACTION })).toBe(true);
      expect(isStopAction({ actionIdentifier: 'default' })).toBe(false);
    });
  });
});

describe('dismissRunningTimer', () => {
  it('gør ingenting når der ikke er vist noget', async () => {
    await dismissRunningTimer();
    expect(notifications.dismissNotificationAsync).not.toHaveBeenCalled();
  });

  it('fjerner kun én gang — et dobbeltkald må ikke kaste', async () => {
    await presentRunningTimer(state());
    await dismissRunningTimer();
    await dismissRunningTimer();
    expect(notifications.dismissNotificationAsync).toHaveBeenCalledTimes(1);
  });
});

describe('dismissStaleRunningTimers', () => {
  it('fjerner timernotifikationer fra en tidligere proces, men ikke andre', async () => {
    notifications.dismissNotificationAsync.mockClear();
    notifications.getPresentedNotificationsAsync.mockResolvedValueOnce([
      { request: { identifier: 'gammel-timer', content: { data: { type: 'timer_running' } } } },
      { request: { identifier: 'paamindelse', content: { data: { type: 'reminder' } } } },
    ]);
    await dismissStaleRunningTimers();
    expect(notifications.dismissNotificationAsync).toHaveBeenCalledTimes(1);
    expect(notifications.dismissNotificationAsync).toHaveBeenCalledWith('gammel-timer');
  });

  it('sluger fejl fra det native modul', async () => {
    notifications.getPresentedNotificationsAsync.mockRejectedValueOnce(new Error('ingen modul'));
    await expect(dismissStaleRunningTimers()).resolves.toBeUndefined();
  });
});
