import { QueryClient } from '@tanstack/react-query';
import { createOfflineReadCache } from './offline-read-cache';
import { offlineReadDisk } from './offline-read-storage';

export const offlineReadClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
export const offlineReads = createOfflineReadCache(offlineReadClient, offlineReadDisk);

type Denial = 'UNAUTHORIZED' | 'FORBIDDEN';
const accessListeners = new Set<(code: Denial) => void>();

export function subscribeToReadAccessDenials(listener: (code: Denial) => void) {
  accessListeners.add(listener);
}

export function denyReadAccess(owner: symbol | undefined, code: Denial) {
  if (!owner || owner !== offlineReads.accessOwner())
    return;
  offlineReads.clear();
  for (const listener of accessListeners)
    listener(code);
}
