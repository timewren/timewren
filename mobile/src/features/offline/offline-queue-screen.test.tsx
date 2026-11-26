import type { AlertButton } from 'react-native';
import type { QueueItem } from './queue-logic';
import * as React from 'react';
import { Alert } from 'react-native';
import { translate } from '~/lib/i18n';
import { act, cleanup, fireEvent, render, screen } from '~/lib/test-utils';
import { OfflineQueueScreen } from './offline-queue-screen';
import { offlineQueue, useOfflineQueue } from './queue-store';

const mockSync = jest.fn(async () => {});
jest.mock('./use-offline-sync', () => ({ useOfflineSync: () => ({ sync: mockSync }) }));
jest.mock('~/features/capabilities/use-capabilities', () => ({ useCapabilities: () => ({ isLoading: false, isError: false, orgId: null }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), canGoBack: () => true }) }));

function failedCreate(): QueueItem {
  return {
    id: 'q1',
    type: 'time.create',
    payload: { description: 'Møde', hours: 1, date: '2026-11-20', isBillable: true },
    createdAt: '2026-11-20T10:00:00.000Z',
    attempts: 1,
    lastError: 'FORBIDDEN',
    failed: true,
    nextAttemptAt: Number.MAX_SAFE_INTEGER,
  } as QueueItem;
}

describe('offlineQueueScreen', () => {
  beforeEach(() => {
    useOfflineQueue.setState({ items: [failedCreate()], isOnline: true, isSyncing: false });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('beder om bekræftelse, før en usendt ændring kasseres', () => {
    render(<OfflineQueueScreen />);
    fireEvent.press(screen.getByTestId('offline-discard-q1'));

    // Ét tryk må ikke slette tid, der aldrig nåede serveren.
    expect(offlineQueue().items).toHaveLength(1);
    expect(Alert.alert).toHaveBeenCalledWith(translate('offline.discard_title'), translate('offline.discard_body'), expect.any(Array));

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as AlertButton[];
    act(() => buttons.find(b => b.style === 'destructive')?.onPress?.());
    expect(offlineQueue().items).toHaveLength(0);
  });

  it('lader "Synkronisér nu" prøve fejlede ændringer igen', () => {
    render(<OfflineQueueScreen />);
    const button = screen.getByTestId('offline-sync-now');
    expect(button.props.accessibilityState?.disabled).toBe(false);
    fireEvent.press(button);
    expect(offlineQueue().items[0].failed).toBe(false);
    expect(mockSync).toHaveBeenCalled();
  });
});
