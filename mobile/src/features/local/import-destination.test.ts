import superjson from 'superjson';
import { openImportDestination } from './import-destination';
import { localStore } from './local-store';

jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000001' }));
jest.mock('expo-application', () => ({ nativeBuildVersion: '1' }));
jest.mock('~/features/server/server-config', () => ({ getApiUrl: () => 'https://server-a.example' }));
jest.mock('~/lib/auth/client', () => ({ getSessionCookie: async () => 'cookie-a' }));
jest.mock('~/lib/i18n', () => ({ translate: (key: string) => key }));
jest.mock('~/lib/storage', () => ({ storage: { getString: () => undefined, set: jest.fn() } }));

beforeEach(() => localStore().clearAll());
afterEach(() => jest.restoreAllMocks());

function mockTransport(respectsOrgHeader: boolean) {
  let activeOrg = 'org-a';
  const writes: string[] = [];
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    const paths = String(url).split('/api/trpc/')[1]!.split('?')[0]!.split(',');
    const headers = new Headers(options?.headers);
    const requestedOrg = respectsOrgHeader ? headers.get('x-timetrack-org-id') : null;
    const results = paths.map((path) => {
      if (requestedOrg && requestedOrg !== 'org-a')
        return { error: superjson.serialize({ message: 'Forbidden', code: -32003, data: { code: 'FORBIDDEN' } }) };
      const org = requestedOrg ?? activeOrg;
      if (path === 'tags.create')
        writes.push(org);
      const data = path === 'user.getProfile' ? { id: 'user-a' } : { org: { id: org } };
      return { result: { data: superjson.serialize(data) } };
    });
    return new Response(JSON.stringify(results));
  });
  function switchOrg() {
    activeOrg = 'org-b';
  }
  return { fetch, writes, switchOrg };
}

it('sender den bundne organisation og cookie, også ved et skift lige før skrivningen', async () => {
  const transport = mockTransport(true);
  const { client, call } = await openImportDestination();

  await expect(call(() => {
    transport.switchOrg();
    return client.tags.create.mutate({ name: 'Møde', color: '#2563eb' });
  })).rejects.toThrow('destination_changed');

  expect(transport.writes).toEqual(['org-a']);
  const mutation = transport.fetch.mock.calls.find(([url]) => String(url).includes('/tags.create'));
  const headers = new Headers(mutation?.[1]?.headers);
  expect(headers.get('x-timetrack-org-id')).toBe('org-a');
  expect(headers.get('cookie')).toBe('cookie-a');
  expect(mutation?.[1]?.credentials).toBe('omit');
});

it('afviser en server, der ignorerer organisationsheaderen, før journal og skrivninger', async () => {
  const transport = mockTransport(false);

  await expect(openImportDestination()).rejects.toThrow('unsupported_server');
  expect(localStore().importDestination).toBeNull();
  expect(transport.writes).toEqual([]);
});
