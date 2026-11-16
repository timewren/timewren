const mockClear = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setBadgeCountAsync: jest.fn(async () => true),
  clearLastNotificationResponse: () => mockClear(),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...(args as [])) } }));

const mockStopTimer = jest.fn(async () => true);
jest.mock('~/features/timer/stop-timer', () => ({ stopTimerNow: () => mockStopTimer() }));

jest.mock('./push-registration', () => ({ hasDeclinedPush: () => false, registerForPush: jest.fn(async () => ({ status: 'error' as const, message: '' })) }));
jest.mock('./reminders', () => ({ syncDailyReminder: jest.fn(async () => {}) }));

const mockCloseWeek = jest.fn(async (_weekStart: string) => true);
jest.mock('~/features/week-review/week-close', () => ({
  closeWeekFromReminder: (weekStart: string) => mockCloseWeek(weekStart),
  isWeekCloseAction: (r: { actionIdentifier?: string }) => r?.actionIdentifier === 'week_close_action',
  syncWeekCloseReminder: jest.fn(async () => {}),
  weekStartFromDelivery: () => '2026-10-26',
}));

// eslint-disable-next-line import/first
import type { NotificationResponse } from 'expo-notifications';
// eslint-disable-next-line import/first
import { openFromResponse } from './use-notifications';

function response(data: Record<string, unknown>, actionIdentifier = '', date = 0): NotificationResponse {
  return { actionIdentifier, notification: { date, request: { content: { data } } } } as unknown as NotificationResponse;
}

describe('openFromResponse', () => {
  beforeEach(() => {
    mockClear.mockClear();
    mockPush.mockClear();
    mockStopTimer.mockClear();
  });

  it('rydder det sidste notifikationssvar, så en kold start ikke gentager handlingen', () => {
    openFromResponse(response({ url: '/time' }));
    expect(mockClear).toHaveBeenCalled();
  });

  it('rydder det svar også når trykket var på stop-knappen — når stoppet er gemt', async () => {
    openFromResponse(response({ type: 'timer_running' }, 'timer_running_stop'));
    expect(mockStopTimer).toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockClear).toHaveBeenCalled();
  });

  it('gør intet, når der ikke var noget svar', () => {
    openFromResponse(null);
    expect(mockClear).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('openFromResponse — «Luk ugen» på påmindelsen', () => {
  beforeEach(() => {
    mockClear.mockClear();
    mockPush.mockClear();
    mockCloseWeek.mockClear();
    mockCloseWeek.mockResolvedValue(true);
  });

  it('lukker den LEVEREDE uge, ikke den uge der er begyndt nu', async () => {
    openFromResponse(response({ type: 'week_review' }, 'week_close_action', 1));
    await Promise.resolve();
    expect(mockCloseWeek).toHaveBeenCalledWith('2026-10-26');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('rydder svaret først når kæden er færdig — ellers går trykket tabt i et dræb', async () => {
    let finish = () => {};
    mockCloseWeek.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      finish = () => resolve(true);
    }));

    openFromResponse(response({ type: 'week_review' }, 'week_close_action', 1));

    expect(mockClear).not.toHaveBeenCalled();
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockClear).toHaveBeenCalled();
  });

  it('rydder svaret, selv om lukningen afvises', async () => {
    mockCloseWeek.mockRejectedValueOnce(new Error('dødt kald'));
    openFromResponse(response({ type: 'week_review' }, 'week_close_action', 1));
    await Promise.resolve();
    await Promise.resolve();
    expect(mockClear).toHaveBeenCalled();
  });

  it('et tryk på notifikationen (ikke knappen) åbner ugeafslutningen', () => {
    openFromResponse(response({ type: 'week_review' }, '', 1));
    expect(mockPush).toHaveBeenCalledWith('/week-review');
    expect(mockCloseWeek).not.toHaveBeenCalled();
  });
});

describe('openFromResponse — stop svarer ikke til tabt tid', () => {
  beforeEach(() => {
    mockClear.mockClear();
    mockPush.mockClear();
    mockStopTimer.mockClear();
  });

  it('beholder svaret, indtil tiden er lagt sikkert — en kold start genkører stoppet', async () => {
    // Appen genoplives kun af trykket. Dør processen, før kæden er færdig,
    // må svaret stadig ligge der, så næste start prøver igen.
    let finish = () => {};
    mockStopTimer.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      finish = () => resolve(true);
    }));

    openFromResponse(response({ type: 'timer_running' }, 'timer_running_stop'));

    expect(mockStopTimer).toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();

    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockClear).toHaveBeenCalled();
  });

  it('rydder svaret, selv om stop-kæden afvises', async () => {
    mockStopTimer.mockRejectedValueOnce(new Error('dødt kald'));

    openFromResponse(response({ type: 'timer_running' }, 'timer_running_stop'));
    await Promise.resolve();
    await Promise.resolve();

    expect(mockClear).toHaveBeenCalled();
  });
});
