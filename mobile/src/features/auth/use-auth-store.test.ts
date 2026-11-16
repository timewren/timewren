const mockMemory = new Map<string, string>();

jest.mock('~/lib/storage', () => ({
  storage: {
    getString: (k: string) => mockMemory.get(k),
    set: (k: string, v: string) => mockMemory.set(k, v),
    remove: (k: string) => mockMemory.delete(k),
  },
  getItem: <T>(k: string): T | null => (mockMemory.has(k) ? JSON.parse(mockMemory.get(k) as string) : null),
  setItem: async (k: string, v: unknown) => {
    mockMemory.set(k, JSON.stringify(v));
  },
  removeItem: async (k: string) => {
    mockMemory.delete(k);
  },
}));

const mockClearQueue = jest.fn();
const mockAdoptOwner = jest.fn();
jest.mock('~/features/offline/queue-store', () => ({ offlineQueue: () => ({ clearAll: mockClearQueue, adoptOwner: mockAdoptOwner }) }));
const mockSetPendingStop = jest.fn();
jest.mock('~/features/timer/timer-recovery', () => ({ setPendingStop: (...a: unknown[]) => mockSetPendingStop(...a) }));
const mockResetTimer = jest.fn();
jest.mock('~/features/timer/timer-store', () => ({ timerActions: () => ({ reset: (...a: unknown[]) => mockResetTimer(...a) }) }));
const mockClearQueries = jest.fn();
jest.mock('~/lib/api/provider', () => ({ queryClient: { clear: () => mockClearQueries() } }));
const mockSetMonitoringUser = jest.fn();
jest.mock('~/lib/monitoring', () => ({ setMonitoringUser: (...a: unknown[]) => mockSetMonitoringUser(...a) }));

// eslint-disable-next-line import/first
import type { RecentTask } from '~/features/home/quick-start';
// eslint-disable-next-line import/first
import type { AuthSession } from '~/lib/auth/client';
// eslint-disable-next-line import/first
import { readQuickStart, rememberQuickStart } from '~/features/home/quick-start';
// eslint-disable-next-line import/first
import { hydrateAuth, setSession, signOut, useAuthStore } from './use-auth-store';

const task = {
  clientId: 'c1',
  projectId: 'p1',
  taskId: 't1',
  description: 'Web',
  clientName: 'Kunde A',
  projectName: 'Projekt B',
} as unknown as RecentTask;

// `AuthSession` er udledt af better-auth og typiserer ikke i testmiljøet.
function sessionFor(userId: string): AuthSession {
  return { user: { id: userId } } as unknown as AuthSession;
}

beforeEach(() => {
  mockMemory.clear();
  mockClearQueue.mockClear();
  mockAdoptOwner.mockClear();
  mockSetPendingStop.mockClear();
  mockResetTimer.mockClear();
  mockClearQueries.mockClear();
  mockSetMonitoringUser.mockClear();
  useAuthStore.setState({ status: 'idle', session: null });
});

describe('signOut', () => {
  it('glemmer den hurtige start, så næste konto ikke starter den forrige kundes arbejde', async () => {
    rememberQuickStart(task);
    expect(readQuickStart()).not.toBeNull();

    await signOut();

    expect(readQuickStart()).toBeNull();
  });

  it('ryder stadig offline-køen og sessionen', async () => {
    rememberQuickStart(task);
    await signOut();
    expect(mockClearQueue).toHaveBeenCalled();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().status).toBe('signOut');
  });
});

describe('session, der forsvinder under os', () => {
  // Review-fund 29/9: oprydningen lå kun i `signOut`, men en udløbet eller
  // tilbagekaldt cookie går gennem `setSession(null)` — bl.a. fra `hydrate()`
  // når der ikke er cookie. Uden rydningen arvede næste konto på enheden
  // brugernes navne, stop-journal og timertilstand.
  it('ryder det brugerbundede state, selv uden cookie ved kold start', async () => {
    rememberQuickStart(task);
    setSession(sessionFor('bruger-1'));

    await hydrateAuth();

    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().status).toBe('signOut');
    expect(readQuickStart()).toBeNull();
    expect(mockSetPendingStop).toHaveBeenCalledWith(null);
    expect(mockResetTimer).toHaveBeenCalled();
    expect(mockClearQueries).toHaveBeenCalled();
    expect(mockSetMonitoringUser).toHaveBeenLastCalledWith(null);
  });

  it('beholder den usendte offline-kø — en udløbet session er ikke et valg', async () => {
    setSession(sessionFor('bruger-1'));

    await hydrateAuth();

    expect(mockClearQueue).not.toHaveBeenCalled();
  });

  it('giver køen tilbage til samme bruger, men ikke til en anden konto', () => {
    setSession(sessionFor('bruger-1'));
    setSession(sessionFor('bruger-1'));
    expect(mockAdoptOwner).toHaveBeenLastCalledWith('bruger-1');

    setSession(sessionFor('bruger-2'));
    expect(mockAdoptOwner).toHaveBeenLastCalledWith('bruger-2');
  });
});
