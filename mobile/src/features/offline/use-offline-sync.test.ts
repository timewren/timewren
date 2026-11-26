const mockMemory = new Map<string, string>();

jest.mock('~/lib/storage', () => ({
  storage: {
    getString: (k: string) => mockMemory.get(k),
    set: (k: string, v: string) => mockMemory.set(k, v),
    remove: (k: string) => mockMemory.delete(k),
  },
}));

const mockCounter = { n: 0 };
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${++mockCounter.n}` }));

jest.mock('expo-network', () => ({ addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })) }));

const mockDrain = jest.fn(async (_opts: { activeOrgId: string | null | undefined }) => ({ succeeded: 0 }));
jest.mock('./drain', () => ({ drainQueue: (opts: { activeOrgId: string | null | undefined }) => mockDrain(opts) }));

const mockCaps = { isLoading: false, isError: false, orgId: 'org-a' as string | null };
jest.mock('~/features/capabilities/use-capabilities', () => ({ useCapabilities: () => mockCaps }));

jest.mock('~/features/auth/use-auth-store', () => ({ useAuthStore: { use: { status: () => 'signIn' } } }));

jest.mock('~/lib/api', () => {
  const invalidate = jest.fn();
  const utils = { time: { invalidate }, prepaid: { invalidate }, dashboard: { invalidate }, timerSync: { invalidate } };
  return { trpc: { useUtils: () => utils } };
});

jest.mock('~/lib/notify', () => ({ showMessage: jest.fn() }));
jest.mock('~/lib/i18n', () => ({ translate: (key: string) => key }));

// eslint-disable-next-line import/first
import { onlineManager } from '@tanstack/react-query';
// eslint-disable-next-line import/first
import { act, renderHook } from '@testing-library/react-native';
// eslint-disable-next-line import/first
import { offlineQueue, useOfflineQueue } from './queue-store';
// eslint-disable-next-line import/first
import { useOfflineSync } from './use-offline-sync';

const createPayload = { description: 'Web', hours: 1.5, date: '2026-09-06', isBillable: true };

/** Lad effekter og løfter (drain er async) løbe færdig. */
const flush = () => act(() => Promise.resolve());

describe('useOfflineSync', () => {
  beforeEach(() => {
    mockMemory.clear();
    mockDrain.mockClear();
    mockCaps.isLoading = false;
    mockCaps.orgId = 'org-a';
    useOfflineQueue.setState({ items: [], isOnline: false, isSyncing: false, ownerUserId: undefined, activeOrgId: undefined });
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it('sender køen, når forbindelsen kommer tilbage, mens appen er åben', async () => {
    onlineManager.setOnline(false);
    offlineQueue().enqueue({ type: 'time.create', payload: createPayload });
    renderHook(() => useOfflineSync());
    await flush();
    expect(mockDrain).not.toHaveBeenCalled();

    // Provideren melder først online, når sessionen er tjekket — efter
    // expo-network-eventet. Det er dét øjeblik, køen skal sendes.
    await act(async () => {
      onlineManager.setOnline(true);
    });
    expect(mockDrain).toHaveBeenCalledTimes(1);
  });

  it('prøver igen, når organisationen bliver kendt efter kold start', async () => {
    onlineManager.setOnline(true);
    mockCaps.isLoading = true;
    offlineQueue().enqueue({ type: 'time.create', payload: createPayload });
    const { rerender } = renderHook(() => useOfflineSync());
    await flush();
    mockDrain.mockClear();

    mockCaps.isLoading = false;
    rerender({});
    await flush();
    expect(mockDrain).toHaveBeenCalledWith({ activeOrgId: 'org-a' });
  });
});
