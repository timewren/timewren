import type { AppRouter } from '~/api/app-router';
import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';
import { offlineReadLink } from './offline-read-link';
import { offlineReads } from './offline-read-runtime';

jest.mock('~/lib/auth/client', () => ({
  getSessionCookie: async () => 'better-auth.session_token=synthetic',
}));
jest.mock('./offline-read-storage', () => ({
  cookieProof: async () => 'proof',
  offlineReadDisk: { read: () => undefined, write: jest.fn(), remove: jest.fn() },
}));

const url = 'https://example.test/api/trpc';
const key = ['clients.list', { includeArchived: false }] as const;
const scope = { server: 'https://example.test', user: 'a', organization: 'org-a', session: 'proof', expiresAt: 9e12 };

const client = createTRPCClient<AppRouter>({
  links: [offlineReadLink(url), httpLink({ url, transformer: superjson })],
});

const originalFetch = globalThis.fetch;

beforeEach(() => {
  offlineReads.clear();
  offlineReads.activate(scope);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  offlineReads.clear();
});

function reply(payload: object) {
  return { json: async () => payload } as Response;
}

it('pins the read to the verified organization and saves its projected reply', async () => {
  const clients = [{ id: 'a', name: 'A', email: 'hidden@example.test' }];
  const fetch = jest.fn(async () => reply({ result: { data: superjson.serialize(clients) } }));
  globalThis.fetch = fetch;
  await expect(client.clients.list.query({})).resolves.toEqual(clients);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/clients.list'), expect.objectContaining({
    headers: expect.objectContaining({ 'x-timetrack-org-id': 'org-a' }),
  }));
  expect(offlineReads.read(key)?.data).toEqual([{ id: 'a', name: 'A' }]);
});

it('removes already saved reads on a scoped 403 from the server', async () => {
  offlineReads.save(offlineReads.current(), key, [{ id: 'a', name: 'A' }]);
  globalThis.fetch = jest.fn(async () => reply({
    error: superjson.serialize({ message: 'Access revoked', code: -32003, data: { code: 'FORBIDDEN', httpStatus: 403 } }),
  }));
  await expect(client.clients.list.query({})).rejects.toThrow('Access revoked');
  expect(offlineReads.current()).toBeUndefined();
  expect(offlineReads.read(key)).toBeUndefined();
});

it('removes the snapshot when a non-cached procedure rejects the session', async () => {
  offlineReads.save(offlineReads.current(), key, [{ id: 'a', name: 'A' }]);
  globalThis.fetch = jest.fn(async () => reply({
    error: superjson.serialize({ message: 'Session revoked', code: -32001, data: { code: 'UNAUTHORIZED', httpStatus: 401 } }),
  }));
  await expect(client.user.getProfile.query()).rejects.toThrow('Session revoked');
  expect(offlineReads.read(key)).toBeUndefined();
  expect(offlineReads.current()).toBeUndefined();
});
