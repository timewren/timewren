/**
 * Genstempling af tidsposter når en planlagt satsændring oprettes eller
 * annulleres. Ren beslutningslogik — databasearbejdet ligger i
 * scheduled-service.ts.
 */

import {
  getRateFromCache,
  type RateLookupCache,
} from "@/lib/trpc/routers/time";
import { toRateDateKey } from "./scheduled";

export interface RestampCandidate {
  id: string;
  projectId: string | null;
  clientId: string | null;
  date: Date | string;
  billableRate: string | null;
}

function sameRate(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Number(a) === Number(b);
}

/**
 * Hvilke poster skal have ny sats, og hvilken?
 *
 * En post genstemples kun når
 *  - den er dateret på/efter ændringens dato,
 *  - satsen faktisk ændrer sig for den (medlems- og projektsatser kan slå
 *    en klientændring ihjel), og
 *  - den gemte sats er den sats hierarkiet gav FØR ændringen. Afviger den,
 *    er satsen sat manuelt (eksplicit override) og røres ikke.
 *
 * @returns Map fra ny sats ("null" for ingen sats) til post-id'er.
 */
export function planRestamp(
  entries: readonly RestampCandidate[],
  before: RateLookupCache,
  after: RateLookupCache,
  fromDate: string,
): Map<string, string[]> {
  const updates = new Map<string, string[]>();
  for (const entry of entries) {
    const dateKey = toRateDateKey(entry.date);
    if (!dateKey || dateKey < fromDate) continue;

    const previous = getRateFromCache(
      before,
      entry.projectId,
      entry.clientId,
      dateKey,
    );
    const next = getRateFromCache(
      after,
      entry.projectId,
      entry.clientId,
      dateKey,
    );
    if (sameRate(previous, next)) continue;
    if (!sameRate(entry.billableRate, previous)) continue;

    const key = next ?? "null";
    const ids = updates.get(key) ?? [];
    ids.push(entry.id);
    updates.set(key, ids);
  }
  return updates;
}

export function countPlanned(plan: Map<string, string[]>): number {
  let total = 0;
  for (const ids of plan.values()) total += ids.length;
  return total;
}
