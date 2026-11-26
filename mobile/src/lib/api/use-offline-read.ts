import type { CachedClient, CachedProject, ReadKey } from './offline-read-data';
import * as React from 'react';
import { READ_CACHE_TTL } from './offline-read-cache';
import { offlineReadClient, offlineReads } from './offline-read-runtime';
import { useIsOnline } from './online';
import { trpc } from './trpc';

export function useOfflineRead<T>(key: ReadKey) {
  const online = useIsOnline();
  const cache = offlineReadClient.getQueryCache();
  const entry = React.useSyncExternalStore(
    React.useCallback(listener => cache.subscribe(listener), [cache]),
    () => online ? undefined : offlineReads.read(key),
  );
  const expiresAt = offlineReads.current()?.expiresAt ?? 0;
  const [, tick] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => {
    if (entry) {
      const delay = Math.min(expiresAt, entry.updatedAt + READ_CACHE_TTL) - Date.now();
      const timer = setTimeout(tick, Math.max(0, delay));
      return () => clearTimeout(timer);
    }
  }, [entry, expiresAt]);
  return { offline: !online, cached: entry?.data as T | undefined, savedAt: entry?.updatedAt };
}

export function useClientChoices() {
  const query = trpc.clients.list.useQuery({ includeArchived: false });
  const { offline, cached, savedAt } = useOfflineRead<CachedClient[]>(['clients.list', { includeArchived: false }]);
  return { ...query, data: offline ? cached : query.data, offline, savedAt };
}

export function useProjectChoices() {
  const query = trpc.projects.list.useQuery();
  const { offline, cached, savedAt } = useOfflineRead<CachedProject[]>(['projects.list']);
  return { ...query, data: offline ? cached : query.data, offline, savedAt };
}
