import type { QueueItem } from './queue-logic';
import * as React from 'react';
import { useOfflineQueue } from './queue-store';

/** En ventende (endnu ikke synkroniseret) tidsregistrering til visning i lister. */
export type PendingEntry = {
  /** Lokalt kø-id — IKKE et server-id */
  id: string;
  date: string;
  hours: number;
  description: string;
  projectId: string | null;
  clientId: string | null;
  /**
   * Fakturerbarhed som den er sendt med i køen. Uden feltet kunne
   * fakturerbar-filteret på Tid-skærmen ikke finde en ventende intern post,
   * fordi den så ville vise sig under "Kun fakturerbare".
   */
  isBillable: boolean;
  /**
   * En post der endnu ikke er nået serveren kan ikke være skrevet på en
   * faktura, så fakturerings-filteret på Tid-skærmen (jf. `matchesBilled`)
   * skal kunne dømme den. Uden feltet ville «Kun ikke-fakturerede» skjule den
   * ventende post, fordi `undefined` hverken er `true` eller `false`.
   */
  isBilled: false;
  failed: boolean;
  pending: true;
};

export function toPendingEntry(item: QueueItem & { type: 'time.create' }): PendingEntry {
  return {
    id: item.id,
    date: item.payload.date,
    hours: item.payload.hours,
    description: item.payload.description,
    projectId: item.payload.projectId ?? null,
    clientId: item.payload.clientId ?? null,
    // Formularen sender altid en eksplicit værdi, så `true` her er samme
    // fallback som serverens kolonne-default.
    isBillable: item.payload.isBillable ?? true,
    isBilled: false,
    failed: item.failed,
    pending: true,
  };
}

/** Ventende oprettelser for dagen (yyyy-MM-dd), i indsættelsesrækkefølge. */
export function pendingEntriesOn(items: readonly QueueItem[], date: string): PendingEntry[] {
  const out: PendingEntry[] = [];
  for (const item of items) {
    if (item.type === 'time.create' && item.payload.date === date)
      out.push(toPendingEntry(item));
  }
  return out;
}

/** Ventende oprettelser for dagen — flettes ind i Tid-fanens dagsliste og Hjem's "I dag". */
export function usePendingEntries(date: string): PendingEntry[] {
  const items = useOfflineQueue.use.items();
  return React.useMemo(() => pendingEntriesOn(items, date), [items, date]);
}

/** Server-id'er med ventende sletning — så listerne kan skjule dem med det samme. */
export function usePendingDeletes(): Set<string> {
  const items = useOfflineQueue.use.items();
  return React.useMemo(() => {
    const ids = new Set<string>();
    for (const item of items) {
      if (item.type === 'time.delete')
        ids.add(item.payload.id);
    }
    return ids;
  }, [items]);
}

type UpdatableEntry = {
  id: string;
  date: Date | string;
  hours: string | number;
  description?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  isBillable?: boolean | null;
  notes?: string | null;
  startTime?: Date | string | null;
  endTime?: Date | string | null;
  prepaidPackageId?: string | null;
  isPrepaid?: boolean | null;
};

/** En server-post med markeringsfelt — bevarer alle øvrige felter fra `T`. */
export type EntryWithPending<T> = T & { pendingSync?: true };

/**
 * Læg ventende rettelser oven på serverens poster.
 *
 * Uden dette viser en offline-rettelse de gamle værdier, helt uden tegn på
 * at noget venter — brugeren tror sin ændring er væk. `undefined` i et
 * update-payload betyder "uændret", så kun felter der faktisk er sendt
 * overskrives. Rækken markeres med `pendingSync`, så den kan få en badge.
 *
 * Et ventende `toggleBillable` tæller også: brugeren skal se det nye
 * fakturerbar-flag med en "venter"-badge, ikke serverens gamle værdi.
 */
export function applyPendingUpdates<T extends UpdatableEntry>(entries: readonly T[], items: readonly QueueItem[]): Array<EntryWithPending<T>> {
  const updates = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    if (item.type === 'time.update')
      updates.set(item.payload.id, { ...(updates.get(item.payload.id) ?? {}), ...definedOnly(item.payload.data) });
    else if (item.type === 'time.toggleBillable')
      updates.set(item.payload.id, { ...(updates.get(item.payload.id) ?? {}), isBillable: item.payload.isBillable });
  }
  if (updates.size === 0)
    return entries as Array<EntryWithPending<T>>;

  return entries.map((entry) => {
    const patch = updates.get(entry.id);
    return (patch ? { ...entry, ...patch, pendingSync: true } : entry) as EntryWithPending<T>;
  });
}

function definedOnly(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
}

/** Server-poster med ventende rettelser lagt ovenpå. */
export function useEntriesWithPending<T extends UpdatableEntry>(entries: readonly T[]): Array<EntryWithPending<T>> {
  const items = useOfflineQueue.use.items();
  return React.useMemo(() => applyPendingUpdates(entries, items), [entries, items]);
}
