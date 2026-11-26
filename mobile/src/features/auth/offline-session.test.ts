import type { AppRouter } from '~/api/app-router';
import { onlineManager, QueryObserver } from '@tanstack/react-query';
import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';
import { offlineReadLink } from '~/lib/api/offline-read-link';
import { offlineReads } from '~/lib/api/offline-read-runtime';
import { queryClient } from '~/lib/api/provider';
import { authClient } from '~/lib/auth/client';
import { changeActiveOrganization, hydrateAuth, setSession, signOut, useAuthStore } from './use-auth-store';

const mockCapabilities = jest.fn();
let mockCookie = 'cookie-a';
let mockSnapshot: string | undefined;

jest.mock('~/lib/auth/client', () => ({
  authClient: { getSession: jest.fn(), signOut: jest.fn() },
  getSessionCookie: () => Promise.resolve(mockCookie),
}));
jest.mock('~/lib/api/offline-read-storage', () => ({
  cookieProof: async (cookie: string) => cookie,
  offlineReadDisk: {
    read: () => mockSnapshot,
    write: (value: string) => { mockSnapshot = value; },
    remove: () => { mockSnapshot = undefined; },
  },
}));
jest.mock('~/lib/api/provider', () => ({ queryClient: new (jest.requireActual('@tanstack/react-query').QueryClient)({
  defaultOptions: { queries: { gcTime: Infinity } },
}) }));
jest.mock('~/lib/api/trpc', () => ({ trpcClient: { mobile: { getCapabilities: { query: () => mockCapabilities() } } } }));
jest.mock('~/features/server/server-config', () => ({ getApiUrl: () => 'https://example.test' }));
jest.mock('~/features/offline/queue-store', () => ({ offlineQueue: () => ({ adoptOwner: jest.fn(), clearAll: jest.fn() }) }));
jest.mock('~/features/home/quick-start', () => ({ forgetQuickStart: jest.fn() }));
jest.mock('~/features/timer/timer-recovery', () => ({ setPendingStop: jest.fn() }));
jest.mock('~/features/timer/timer-store', () => ({ timerActions: () => ({ reset: jest.fn() }) }));

const readKey = ['clients.list', { includeArchived: false }] as const;
const liveKey = ['old-context'];
const clients = [{ id: 'only-a', name: 'A' }];
const session = { user: { id: 'a' }, session: { id: 'id-a', expiresAt: 9e12 } };

function seededDisk() {
  offlineReads.save(offlineReads.activate({
    server: 'https://example.test',
    user: 'a',
    organization: 'org-a',
    session: mockCookie,
    expiresAt: 9e12,
  }), readKey, clients);
  const snapshot = mockSnapshot;
  offlineReads.clear();
  mockSnapshot = snapshot;
}

function sessionReply(data: unknown, error: unknown = null) {
  jest.mocked(authClient.getSession).mockResolvedValue({ data, error } as never);
}

beforeEach(() => {
  mockCookie = 'cookie-a';
  offlineReads.clear();
  queryClient.clear();
  mockCapabilities.mockReset();
  jest.mocked(authClient.getSession).mockReset();
  useAuthStore.setState({ status: 'idle', session: null, checking: false, offlineUserId: null });
  onlineManager.setOnline(false);
});

afterAll(() => onlineManager.setOnline(true));

it('opens the known session offline without a server call and exposes only saved reads', async () => {
  seededDisk();
  await hydrateAuth();
  expect(useAuthStore.getState().status).toBe('signIn');
  expect(useAuthStore.getState().checking).toBe(false);
  expect(offlineReads.read(readKey)?.data).toEqual(clients);
  expect(authClient.getSession).not.toHaveBeenCalled();
  expect(mockCapabilities).not.toHaveBeenCalled();
});

it('opens an offline shell without saved data when a cookie is present', async () => {
  await hydrateAuth();
  expect(useAuthStore.getState().status).toBe('signIn');
  expect(useAuthStore.getState().checking).toBe(false);
  expect(offlineReads.read(readKey)).toBeUndefined();
  expect(authClient.getSession).not.toHaveBeenCalled();
});

it('shows no cached results for a different signed-in account after a restart', async () => {
  seededDisk();
  mockCookie = 'cookie-b';
  await hydrateAuth();
  expect(offlineReads.read(readKey)).toBeUndefined();
  expect(mockSnapshot).toBeUndefined();
});

it('immediately invalidates reads at logout, before the network result', async () => {
  seededDisk();
  await hydrateAuth();
  const logout = signOut();
  expect(useAuthStore.getState().status).toBe('signOut');
  expect(offlineReads.read(readKey)).toBeUndefined();
  await logout;
});

it('clears old data synchronously when another account signs in', async () => {
  seededDisk();
  await hydrateAuth();
  const keyBefore = useAuthStore.getState().navigationKey;
  queryClient.setQueryData(liveKey, clients);
  setSession({ user: { id: 'b' }, session: { id: 'id-b' } } as never);
  expect(queryClient.getQueryData(liveKey)).toBeUndefined();
  expect(offlineReads.read(readKey)).toBeUndefined();
  expect(useAuthStore.getState().navigationKey).toBeGreaterThan(keyBefore);
});

it('blocks before changing organization and ignores revalidation during the change', async () => {
  seededDisk();
  await hydrateAuth();
  onlineManager.setOnline(true);
  sessionReply(session);
  mockCapabilities.mockResolvedValue({ org: { id: 'org-b' } });
  const old = offlineReads.current();
  queryClient.setQueryData(liveKey, clients);
  const change = changeActiveOrganization(async () => {
    expect(useAuthStore.getState().checking).toBe(true);
    expect(queryClient.getQueryData(liveKey)).toBeUndefined();
    expect(offlineReads.read(readKey)).toBeUndefined();
    await hydrateAuth();
    expect(authClient.getSession).not.toHaveBeenCalled();
    offlineReads.save(old, readKey, clients);
  });
  await change;
  expect(offlineReads.current()?.organization).toBe('org-b');
  expect(offlineReads.read(readKey)).toBeUndefined();
});

it.each([401, 403])('rejects an old session on reconnect (%s)', async (status) => {
  seededDisk();
  await hydrateAuth();
  sessionReply(null, { status });
  onlineManager.setOnline(true);
  await hydrateAuth();
  expect(authClient.getSession).toHaveBeenCalledWith(expect.objectContaining({ query: { disableCookieCache: true } }));
  expect(useAuthStore.getState().status).toBe('signOut');
  expect(offlineReads.read(readKey)).toBeUndefined();
  expect(mockSnapshot).toBeUndefined();
});

it('drops the old snapshot when organization access is denied', async () => {
  seededDisk();
  await hydrateAuth();
  sessionReply(session);
  mockCapabilities.mockRejectedValue(new Error('FORBIDDEN'));
  onlineManager.setOnline(true);
  await hydrateAuth();
  expect(offlineReads.current()).toBeUndefined();
  expect(offlineReads.read(readKey)).toBeUndefined();
  expect(mockSnapshot).toBeUndefined();
});

const url = 'https://example.test/api/trpc';
const client = createTRPCClient<AppRouter>({ links: [offlineReadLink(url), httpLink({ url, transformer: superjson })] });
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function respond(payload: object) {
  return { json: async () => payload } as Response;
}

it('refetches active time data after validating the same session and organization', async () => {
  const input = { onlyOwn: true, startDate: '2026-11-16', endDate: '2026-11-22', limit: 1000 } as const;
  const key = ['time.list', input] as const;
  const queryKey = [['time', 'list'], { input, type: 'query' }];
  const cached = { entries: [{ id: 'before', tags: [] }] };
  const fresh = { entries: [{ id: 'after', tags: [] }] };
  seededDisk();
  await hydrateAuth();
  const old = offlineReads.current();
  const keyBefore = useAuthStore.getState().navigationKey;
  offlineReads.save(old, key, cached);
  queryClient.setQueryData(queryKey, cached);
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: ({ signal }) => client.time.list.query(input, { signal }),
    staleTime: 5 * 60_000,
  });
  const stop = observer.subscribe(() => {});
  queryClient.mount();
  try {
    sessionReply(session);
    mockCapabilities.mockResolvedValue({ org: { id: 'org-a' } });
    const fetch = jest.fn(async () => respond({ result: { data: superjson.serialize(fresh) } }));
    globalThis.fetch = fetch;
    const validation = hydrateAuth();
    onlineManager.setOnline(true);
    await validation;
    await queryClient.getQueryCache().find({ queryKey })?.promise;
    expect(useAuthStore.getState().navigationKey).toBe(keyBefore);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/time.list'), expect.objectContaining({
      headers: expect.objectContaining({ 'x-timetrack-org-id': 'org-a' }),
    }));
    expect(observer.getCurrentResult().data).toEqual(fresh);
    offlineReads.save(old, key, cached);
    expect(offlineReads.read(key)?.data).toEqual({ entries: [expect.objectContaining({ id: 'after' })] });
  }
  finally {
    stop();
    queryClient.unmount();
  }
});

it('signs out and clears live and saved data after a non-cached query rejects the session', async () => {
  seededDisk();
  await hydrateAuth();
  queryClient.setQueryData(liveKey, clients);
  globalThis.fetch = jest.fn(async () => respond({
    error: superjson.serialize({ message: 'Session revoked', code: -32001, data: { code: 'UNAUTHORIZED', httpStatus: 401 } }),
  }));
  await expect(client.user.getProfile.query()).rejects.toThrow('Session revoked');
  expect(useAuthStore.getState().status).toBe('signOut');
  expect(queryClient.getQueryData(liveKey)).toBeUndefined();
  expect(offlineReads.read(readKey)).toBeUndefined();
  expect(mockSnapshot).toBeUndefined();
});

it('retains inactive reads through an online restart with the same context', async () => {
  seededDisk();
  sessionReply(session);
  mockCapabilities.mockResolvedValue({ org: { id: 'org-a' } });
  onlineManager.setOnline(true);
  await hydrateAuth();
  expect(mockSnapshot).toBeDefined();
  const snapshot = mockSnapshot;
  offlineReads.clear();
  mockSnapshot = snapshot;
  onlineManager.setOnline(false);
  await hydrateAuth();
  expect(offlineReads.read(readKey)?.data).toEqual(clients);
});

it('restores saved reads when a connected network cannot reach the server', async () => {
  seededDisk();
  jest.mocked(authClient.getSession).mockRejectedValue(new TypeError('Network request failed'));
  onlineManager.setOnline(true);
  await hydrateAuth();
  expect(onlineManager.isOnline()).toBe(false);
  expect(offlineReads.read(readKey)?.data).toEqual(clients);
});

it.each([500, 502, 503, 504])('keeps saved reads after a temporary HTTP %s', async (status) => {
  seededDisk();
  sessionReply(null, { status });
  onlineManager.setOnline(true);
  await hydrateAuth();
  expect(onlineManager.isOnline()).toBe(false);
  expect(offlineReads.read(readKey)?.data).toEqual(clients);
  expect(mockSnapshot).toBeDefined();
});

it.each([200, 401, 503])('keeps saved reads visible while checking a retry that returns HTTP %s', async (status) => {
  seededDisk();
  await hydrateAuth();
  const navigationKey = useAuthStore.getState().navigationKey;
  let reply!: (value: Awaited<ReturnType<typeof authClient.getSession>>) => void;
  jest.mocked(authClient.getSession).mockImplementationOnce(() => new Promise((resolve) => {
    reply = resolve;
  }));
  mockCapabilities.mockResolvedValue({ org: { id: 'org-a' } });
  const retry = hydrateAuth(true);
  for (let i = 0; i < 5; i++)
    await Promise.resolve();
  expect(authClient.getSession).toHaveBeenCalledTimes(1);
  expect(useAuthStore.getState().checking).toBe(false);
  expect(onlineManager.isOnline()).toBe(false);
  expect(offlineReads.read(readKey)?.data).toEqual(clients);
  reply((status === 200 ? { data: session, error: null } : { data: null, error: { status } }) as never);
  await expect(retry).resolves.toBe(status === 503 ? undefined : true);
  expect(onlineManager.isOnline()).toBe(false);
  expect(useAuthStore.getState().checking).toBe(false);
  expect(useAuthStore.getState().status).toBe(status === 401 ? 'signOut' : 'signIn');
  expect(offlineReads.read(readKey)?.data).toEqual(status === 401 ? undefined : clients);
  if (status !== 401)
    expect(useAuthStore.getState().navigationKey).toBe(navigationKey);
});

it.each(['same', 'changed'])('handles a late session denial after %s context revalidation', async (context) => {
  seededDisk();
  await hydrateAuth();
  let rejectSession!: (response: Response) => void;
  globalThis.fetch = jest.fn(() => new Promise<Response>((resolve) => {
    rejectSession = resolve;
  }));
  const pending = expect(client.user.getProfile.query()).rejects.toThrow('Session revoked');
  const previous = offlineReads.current();
  sessionReply(session);
  mockCapabilities.mockResolvedValue({ org: { id: context === 'same' ? 'org-a' : 'org-b' } });
  onlineManager.setOnline(true);
  await hydrateAuth();
  expect(offlineReads.current()).not.toBe(previous);
  rejectSession(respond({
    error: superjson.serialize({ message: 'Session revoked', code: -32001, data: { code: 'UNAUTHORIZED', httpStatus: 401 } }),
  }));
  await pending;
  expect(useAuthStore.getState().status).toBe(context === 'same' ? 'signOut' : 'signIn');
  expect(offlineReads.current()?.organization).toBe(context === 'same' ? undefined : 'org-b');
  expect(mockSnapshot).toBeUndefined();
});
