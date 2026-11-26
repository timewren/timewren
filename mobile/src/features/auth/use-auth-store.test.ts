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
const mockOrder: string[] = [];
jest.mock('~/features/notifications/push-registration', () => ({
  releasePushForSignOut: jest.fn(async () => {
    mockOrder.push('push');
  }),
}));
const mockClearQueries = jest.fn();
jest.mock('~/lib/api/provider', () => ({ queryClient: { clear: () => mockClearQueries(), removeQueries: jest.fn(), cancelQueries: jest.fn() } }));

// eslint-disable-next-line import/first
import type { RecentTask } from '~/features/home/quick-start';
// eslint-disable-next-line import/first
import type { AuthSession } from '~/lib/auth/client';
// eslint-disable-next-line import/first
import { readQuickStart, rememberQuickStart } from '~/features/home/quick-start';
// eslint-disable-next-line import/first
import { authClient } from '~/lib/auth/client';
// eslint-disable-next-line import/first
import { __setCookie } from '../../../__mocks__/auth-client';
// eslint-disable-next-line import/first
import { changeActiveOrganization, hydrateAuth, setSession, signOut, useAuthStore } from './use-auth-store';

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
  __setCookie('');
  mockClearQueue.mockClear();
  mockAdoptOwner.mockClear();
  mockSetPendingStop.mockClear();
  mockResetTimer.mockClear();
  mockClearQueries.mockClear();
  useAuthStore.setState({ status: 'idle', session: null });
});

it('ignorerer et forsinket sessionsvar efter et nyere genforsøg', async () => {
  __setCookie('session=test');
  let resolveFirst!: (response: { data: AuthSession; error: null }) => void;
  jest.mocked(authClient.getSession)
    .mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }))
    .mockResolvedValueOnce({ data: null, error: null } as Awaited<ReturnType<typeof authClient.getSession>>);

  const calls = jest.mocked(authClient.getSession).mock.calls.length;
  const first = hydrateAuth();
  // Vent, til det første forsøg venter på serveren, før det nyere starter.
  for (let i = 0; i < 20 && jest.mocked(authClient.getSession).mock.calls.length === calls; i++)
    await Promise.resolve();
  expect(resolveFirst).toBeDefined();
  await hydrateAuth();
  expect(useAuthStore.getState().status).toBe('signOut');

  resolveFirst({ data: sessionFor('bruger-1'), error: null });
  await first;

  expect(useAuthStore.getState().status).toBe('signOut');
  expect(useAuthStore.getState().session).toBeNull();
  expect(mockAdoptOwner).not.toHaveBeenCalled();
  expect(useAuthStore.getState().offlineUserId).toBeNull();
});

it('afviser hydreringen, når sessionscookien ikke kan læses, så opstarten viser fejlskærmen', async () => {
  const error = new Error('SecureStore utilgængelig');
  const cookieSpy = jest.spyOn(require('~/lib/auth/client'), 'getSessionCookie').mockRejectedValueOnce(error);

  await expect(hydrateAuth()).rejects.toBe(error);

  expect(useAuthStore.getState().status).toBe('idle');
  expect(useAuthStore.getState().checking).toBe(false);
  cookieSpy.mockRestore();
});

it('ignorerer en forældet cookiefejl, efter en nyere hydrering er afsluttet', async () => {
  let rejectFirst!: (error: Error) => void;
  const cookieSpy = jest.spyOn(require('~/lib/auth/client'), 'getSessionCookie')
    .mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectFirst = reject;
    }));

  const first = hydrateAuth();
  await hydrateAuth();
  expect(useAuthStore.getState().status).toBe('signOut');

  rejectFirst(new Error('SecureStore utilgængelig'));
  await expect(first).resolves.toBeUndefined();

  expect(useAuthStore.getState().status).toBe('signOut');
  expect(useAuthStore.getState().checking).toBe(false);
  cookieSpy.mockRestore();
});

it('genopbygger navigationen i stedet for at afvise organisationsskiftet, når cookien ikke kan læses bagefter', async () => {
  useAuthStore.setState({ status: 'signIn', session: sessionFor('bruger-1'), checking: false });
  const navigationKey = useAuthStore.getState().navigationKey;
  const change = jest.fn(async () => {});
  const cookieSpy = jest.spyOn(require('~/lib/auth/client'), 'getSessionCookie').mockRejectedValueOnce(new Error('SecureStore utilgængelig'));

  await expect(changeActiveOrganization(change)).resolves.toBeUndefined();

  expect(change).toHaveBeenCalled();
  expect(useAuthStore.getState().status).toBe('signIn');
  expect(useAuthStore.getState().checking).toBe(false);
  expect(useAuthStore.getState().navigationKey).toBe(navigationKey + 1);
  cookieSpy.mockRestore();
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

it('afmelder push, mens login-cookien stadig findes, før serveren logger ud', async () => {
  mockOrder.length = 0;
  jest.mocked(authClient.signOut).mockImplementationOnce(async () => {
    mockOrder.push('signOut');
    return {};
  });
  setSession(sessionFor('bruger-1'));
  await signOut();
  expect(mockOrder).toEqual(['push', 'signOut']);
  expect(useAuthStore.getState().status).toBe('signOut');
});
