import { QueryClient } from '@tanstack/react-query';
import { createOfflineReadCache, READ_CACHE_TTL } from './offline-read-cache';

const scope = { server: 'https://example.test', user: 'a', organization: 'one', session: 'proof', expiresAt: 9e12 };
const key = ['clients.list', { includeArchived: false }] as const;
const clients = [{ id: '1', name: 'Kunde', email: 'private@example.test' }];
let stored: string | undefined;
const disk = {
  read: () => stored,
  write: (value: string) => { stored = value; },
  remove: () => { stored = undefined; },
};

beforeEach(() => {
  stored = undefined;
});

it('restores projected data into a new QueryClient with the original fetch timestamp', () => {
  const writer = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
  const owner = writer.activate(scope);
  writer.save(owner, key, clients);
  const restarted = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
  expect(restarted.restore(scope.server, scope.session)).toEqual(scope);
  expect(restarted.read(key)?.data).toEqual([{ id: '1', name: 'Kunde' }]);
  expect(restarted.read(key)?.updatedAt).toBeGreaterThan(0);
});

it('has no offline data without a matching snapshot', () => {
  const cache = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
  expect(cache.restore(scope.server, scope.session)).toBeNull();
  expect(cache.read(key)).toBeUndefined();
});

it.each([
  { organization: 'two' },
  { user: 'b' },
  { server: 'https://other.test' },
  { session: 'different' },
])('discards data and ignores late writes on context change %o', (change) => {
  const cache = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
  const owner = cache.activate(scope);
  cache.save(owner, key, clients);
  cache.activate({ ...scope, ...change });
  cache.save(owner, key, clients);
  expect(cache.read(key)).toBeUndefined();
  expect(stored).toBeUndefined();
});

it('rejects a snapshot for a different server or cookie at cold start', () => {
  const writer = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
  writer.save(writer.activate(scope), key, clients);
  const restarted = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
  expect(restarted.restore('https://other.test', scope.session)).toBeNull();
  writer.save(writer.current(), key, clients);
  expect(restarted.restore(scope.server, 'unknown')).toBeNull();
});

it('removes the snapshot on logout or access rejection', () => {
  const cache = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
  const owner = cache.activate(scope);
  cache.save(owner, key, clients);
  cache.clear();
  cache.save(owner, key, clients);
  expect(cache.read(key)).toBeUndefined();
  expect(stored).toBeUndefined();
});

it('expires entries individually and rejects an expired session', () => {
  const clock = jest.spyOn(Date, 'now');
  try {
    clock.mockReturnValue(1000);
    const writer = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
    writer.save(writer.activate({ ...scope, expiresAt: 2 * READ_CACHE_TTL }), key, clients);
    clock.mockReturnValue(1000 + READ_CACHE_TTL);
    const restarted = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
    expect(restarted.restore(scope.server, scope.session)).not.toBeNull();
    expect(restarted.read(key)).toBeUndefined();
    clock.mockReturnValue(2 * READ_CACHE_TTL);
    expect(restarted.restore(scope.server, scope.session)).toBeNull();
  }
  finally {
    clock.mockRestore();
  }
});

it('preserves dates and drops non-display fields from registered time', () => {
  const cache = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
  const period = { onlyOwn: true, startDate: '2026-11-16', endDate: '2026-11-22', limit: 1000 };
  const timeKey = ['time.list', period] as const;
  const date = new Date('2026-11-19');
  cache.save(cache.activate(scope), timeKey, { entries: [{
    id: 'entry-1',
    date,
    hours: '2',
    description: 'Rapport',
    isBillable: true,
    client: { name: 'Kunde', email: 'protected@example.test' },
    tags: [{ name: 'Arbejde', id: 'private' }],
    notes: 'Private details',
  }] });
  const restarted = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
  restarted.restore(scope.server, scope.session);
  expect(restarted.latestPeriod()).toEqual(period);
  expect(restarted.read(timeKey)?.data).toEqual({ entries: [expect.objectContaining({
    id: 'entry-1',
    date,
    hours: '2',
    client: { name: 'Kunde' },
    tags: [{ name: 'Arbejde' }],
  })] });
  expect(stored).not.toContain('Private details');
  expect(stored).not.toContain('protected@example.test');
});

it('keeps a bounded set of requests and excludes unapproved queries', () => {
  const cache = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
  const owner = cache.activate(scope);
  const period = { onlyOwn: true, startDate: '2026-11-16', endDate: '2026-11-22', limit: 1000 };
  cache.save(owner, ['time.list', { ...period, onlyOwn: false }], { entries: [] });
  cache.save(owner, ['clients.list', { includeArchived: true }] as never, clients);
  cache.save(owner, ['user.getProfile'] as never, { email: 'profile@example.test' });
  expect(stored).toBeUndefined();
  cache.save(owner, ['time.list', period], { entries: [] });
  for (let index = 0; index <= 16; index++)
    cache.save(owner, ['time.list', { ...period, projectId: String(index) }], { entries: [] });
  expect(cache.read(['time.list', { ...period, projectId: '0' }])).toBeUndefined();
  expect(cache.read(['time.list', { ...period, projectId: '16' }])).toBeDefined();
  const restarted = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
  restarted.restore(scope.server, scope.session);
  expect(restarted.latestPeriod()).toEqual({ ...period, projectId: '16' });
});

it('excludes the old organization before hydrating an online-verified context', () => {
  const writer = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
  writer.save(writer.activate(scope), key, clients);
  const restarted = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
  expect(restarted.restore(scope.server, scope.session, { ...scope, organization: 'two' })).toBeNull();
  expect(restarted.read(key)).toBeUndefined();
  expect(stored).toBeUndefined();
});

it('stores a revalidated session expiry without changing the fetch timestamp', () => {
  const writer = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
  writer.save(writer.activate(scope), key, clients);
  const updatedAt = writer.read(key)?.updatedAt;
  const renewed = { ...scope, expiresAt: Date.now() + 1000 };
  writer.activate(renewed);
  const restarted = createOfflineReadCache(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), disk);
  expect(restarted.restore(scope.server, scope.session)).toEqual(renewed);
  expect(restarted.read(key)?.updatedAt).toBe(updatedAt);
});
