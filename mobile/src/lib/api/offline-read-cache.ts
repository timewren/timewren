import type { QueryClient } from '@tanstack/react-query';
import type { ReadKey } from './offline-read-data';
import { hashKey } from '@tanstack/react-query';
import superjson from 'superjson';
import { projectRead, readKey } from './offline-read-data';

export const READ_CACHE_TTL = 24 * 60 * 60 * 1000;
const MAX_QUERIES = 16;
const MAX_LENGTH = 512_000;
const VERSION = 1;
const PREFIX = 'offline-read';

export type ReadScope = {
  server: string;
  user: string;
  organization: string;
  session: string;
  expiresAt: number;
};

type ReadIdentity = Pick<ReadScope, 'user' | 'organization'>;

type Entry = { key: ReadKey; data: unknown; updatedAt: number };
type Snapshot = { version: number; scope: ReadScope; entries: Entry[] };
type Disk = { read: () => string | undefined; write: (value: string) => void; remove: () => void };

export function snapshotKey(key: ReadKey) {
  return [PREFIX, ...key];
}

function fresh(entry: Entry) {
  return entry.updatedAt > Date.now() - READ_CACHE_TTL && entry.updatedAt <= Date.now();
}

function sameContext(a: ReadScope | undefined, b: ReadScope) {
  return a?.server === b.server && a.user === b.user && a.organization === b.organization && a.session === b.session;
}

export function createOfflineReadCache(client: QueryClient, disk: Disk) {
  let scope: ReadScope | undefined;
  // Access denials remain relevant across revalidation of the same context.
  // Successful reads still belong to the exact scope that started them.
  let accessOwner: symbol | undefined;
  let entries: Entry[] = [];

  function clear() {
    scope = undefined;
    accessOwner = undefined;
    entries = [];
    client.removeQueries({ queryKey: [PREFIX] });
    disk.remove();
  }

  function activate(next: ReadScope) {
    if (!sameContext(scope, next)) {
      clear();
    }
    else if (scope?.expiresAt !== next.expiresAt && entries.length) {
      const raw = superjson.stringify({ version: VERSION, scope: next, entries });
      if (raw.length <= MAX_LENGTH)
        disk.write(raw);
      else
        disk.remove();
    }
    scope = next;
    accessOwner ??= Symbol('offline read access');
    return next;
  }

  function restore(server: string, session: string, identity?: ReadIdentity) {
    const matches = (owner: ReadScope) => owner.server === server && owner.session === session
      && owner.user && owner.organization && owner.expiresAt > Date.now()
      && (!identity || (owner.user === identity.user && owner.organization === identity.organization));
    if (scope && matches(scope))
      return scope;
    try {
      const raw = disk.read();
      if (raw && raw.length <= MAX_LENGTH) {
        const saved = superjson.parse<Snapshot>(raw);
        const owner = saved.scope;
        if (saved.version === VERSION && matches(owner)) {
          scope = owner;
          accessOwner = Symbol('offline read access');
          entries = saved.entries.filter(entry => fresh(entry) && !!readKey(entry.key[0], entry.key[1])).slice(0, MAX_QUERIES);
          if (entries.length === 0)
            disk.remove();
          else if (entries.length !== saved.entries.length)
            disk.write(superjson.stringify({ version: VERSION, scope, entries }));
          for (const entry of entries)
            client.setQueryData(snapshotKey(entry.key), entry, { updatedAt: entry.updatedAt });
          return scope;
        }
      }
    }
    catch {
      // En beskadiget cache kan aldrig bruges til at gendanne kontekst eller data.
    }
    clear();
    return null;
  }

  function save(owner: ReadScope | undefined, key: ReadKey, data: unknown) {
    if (!owner || owner !== scope || owner.expiresAt <= Date.now() || !readKey(key[0], key[1]))
      return;
    const entry = { key, data: projectRead(key, data), updatedAt: Date.now() };
    const queryKey = snapshotKey(key);
    const hash = hashKey(queryKey);
    const previous = entries.filter(candidate => hashKey(snapshotKey(candidate.key)) !== hash);
    const recent = previous.filter(fresh);
    const fits = superjson.stringify({ version: VERSION, scope, entries: [entry] }).length <= MAX_LENGTH;
    entries = fits ? [entry, ...recent].slice(0, MAX_QUERIES) : recent;
    while (entries.length > 0) {
      const raw = superjson.stringify({ version: VERSION, scope, entries });
      if (raw.length <= MAX_LENGTH) {
        disk.write(raw);
        break;
      }
      entries.pop();
    }
    if (!entries.length)
      disk.remove();
    for (const evicted of previous.filter(candidate => !entries.includes(candidate)))
      client.removeQueries({ queryKey: snapshotKey(evicted.key), exact: true });
    if (entries.includes(entry))
      client.setQueryData(queryKey, entry, { updatedAt: entry.updatedAt });
    else
      client.removeQueries({ queryKey, exact: true });
  }

  function read(key: ReadKey) {
    const entry = client.getQueryData<Entry>(snapshotKey(key));
    return scope && scope.expiresAt > Date.now() && entry && fresh(entry) ? entry : undefined;
  }

  function latestPeriod() {
    const periods = entries.filter(entry => entry.key[0] === 'time.list' && read(entry.key));
    const entry = periods.find(entry => entry.key[0] === 'time.list' && !entry.key[1].projectId) ?? periods[0];
    return entry?.key[0] === 'time.list' ? entry.key[1] : undefined;
  }

  return { activate, clear, current: () => scope, accessOwner: () => accessOwner, latestPeriod, read, restore, save };
}
