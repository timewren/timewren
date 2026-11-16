import type { TimeEntry } from './use-entries';

/** Fakturerings-status for den mængde, brugeren har valgt. */
export type BilledState = 'empty' | 'all' | 'none' | 'mixed';

/**
 * Fælles status for de valgte poster.
 *
 * `isBilled` er nullable i web's schema, så kun `=== true` er faktureret —
 * samme regel som `matchesBilled` i `entry-filter.ts`. `mixed` er sin egen
 * tilstand og ikke en brugbar tilstand at gætte: på tre poster hvor én er
 * faktureret, må knappen sige hvad trykket gør, og "Fjern markering" ville
 * være en løgn om de to andre.
 */
export function billedStateOf(entries: TimeEntry[]): BilledState {
  if (entries.length === 0)
    return 'empty';
  let billed = 0;
  for (const entry of entries) {
    if (entry.isBilled === true)
      billed += 1;
  }
  if (billed === 0)
    return 'none';
  return billed === entries.length ? 'all' : 'mixed';
}

/** Sandt når trykket på knappen sætter `isBilled = true`. */
export function marksBilled(state: BilledState): boolean {
  return state !== 'all';
}

/**
 * Ny udvalgelse: tryk på en valgt post fjerner den, ellers lægges den til.
 *
 * Returnerer et nyt sæt, fordi React skal se en ny reference — og fordi
 * udvalgelsen er holdt i skærmens state, ikke i en kø eller et lager, der
 * kan overleve en opdatering af listen.
 */
export function toggleSelection(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current);
  if (!next.delete(id))
    next.add(id);
  return next;
}
