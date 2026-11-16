import type { DateRange } from './period';
import { toISODate } from '~/lib/format';

/**
 * Projekt- og fakturerbar-filteret på Tid-skærmen.
 *
 * Projektet filtreres af serveren, fakturerbarhed lokalt — se `matchesBillable`
 * for hvorfor den ikke kan sendes med i query-inputtet.
 *
 * `ALL_PROJECTS` er en tom streng, så den kan være værdien i `Select` for
 * "intet filter valgt" uden en `null`-gren. Denne fil er bevidst ren for
 * trpc/React, så query-inputtet kan testes uden at trpc-provideren hænger.
 */
export const ALL_PROJECTS = '';
export const ALL_BILLABLE = 'all';
export const ALL_BILLED = 'all';

export type BillableMode = 'all' | 'billable' | 'non-billable';
export type BilledMode = 'all' | 'billed' | 'unbilled';

export type EntryFilter = { projectId: string; billable: BillableMode; billed: BilledMode };

export const NO_FILTER: EntryFilter = { projectId: ALL_PROJECTS, billable: ALL_BILLABLE, billed: ALL_BILLED };

/** Matcher serverens `isBillable`-kolonne: kun `false` er ikke-fakturerbar. */
type Billable = { isBillable: boolean | null | undefined };
type Billed = { isBilled: boolean | null | undefined };

/**
 * Er posten fakturerbar — præcis som badgen i `entry-row.tsx` dømmer det?
 *
 * Filteret er **lokalt** og ikke `isBillable: true` i query-inputtet, selv om
 * serveren har feltet (`time.ts:579-580` gør `eq(timeEntries.isBillable, …)`).
 * Kolonnen er erklæret *nullable* — `boolean("is_billable").default(true)` uden
 * `.notNull()` i web's `schema.ts` — og den findes i ingen af de 117
 * migrationer, så om der faktisk står `NULL` i produktion kan ikke bevises her.
 * Web's egen ufakturerede-sum (time.ts:2400) skriver udtrykkelig, at den gamle
 * `isBillable=true`-filtrering tabte `isBillable NULL`, altså er NULL en reel
 * mulighed de regner med.
 *
 * Konsekvensen ved at sende `true` med: SQL `= true` matcher ikke NULL, så
 * "Kun fakturerbare" ville få de poster til at forsvinde, som rækken lige over
 * dem viser UDEN "Ikke fakturerbar"-badge. Et filter må aldrig skjule en post
 * ud fra det billede, appen selv maler af den.
 */
export function matchesBillable(isBillable: boolean | null | undefined, mode: BillableMode): boolean {
  if (mode === 'all')
    return true;
  const nonBillable = isBillable === false;
  return mode === 'non-billable' ? nonBillable : !nonBillable;
}

/** Snævær den viste liste. Returnerer en kopi, så `useMemo` ikke muterer. */
export function applyBillableFilter<T extends Billable>(entries: readonly T[], mode: BillableMode): T[] {
  return mode === 'all' ? [...entries] : entries.filter(e => matchesBillable(e.isBillable, mode));
}

/**
 * Er posten faktureret — altså skrevet på en faktura?
 *
 * Samme lokale greb som `matchesBillable`, af samme grund: `is_billed` er
 * `boolean("is_billed").default(false)` **uden** `.notNull()` i web's `schema.ts`,
 * så kolonnen er nullable, og SQL `is_billed = false` matcher ikke NULL. Serveren
 * har dog et `isBilled`-filter i `time.list` (`time.ts:516`, `eq(...)` ved
 * `:578-580`) — det må ikke bruges, fordi en post med NULL ville forsvinde under
 * «Kun ikke-fakturerede» lige under en række, der viser den som ikke-faktureret.
 *
 * Kun `true` er faktureret. `bulkMarkBilled` sætter kolonnen eksplicit, og
 * `invoices.markEntriesBilled` gør det samme, så `false` er den normale værdi.
 */
export function matchesBilled(isBilled: boolean | null | undefined, mode: BilledMode): boolean {
  if (mode === 'all')
    return true;
  const billed = isBilled === true;
  return mode === 'billed' ? billed : !billed;
}

/** Begge lokale filtre i ét kald, så skærmen ikke kan glemme det ene. */
export function applyLocalFilters<T extends Billable & Billed>(entries: readonly T[], filter: EntryFilter): T[] {
  return entries.filter(e => matchesBillable(e.isBillable, filter.billable) && matchesBilled(e.isBilled, filter.billed));
}

/**
 * Skal skærmen sige "der er tider, de matcher bare ikke filteret"?
 *
 * Uden den ville et filter, der skjuler alt, vise dagens normale tom-tilstand
 * ("Ingen registreringer" + "Registrér tid") — altså påstå at dagen er tom,
 * når den har poster. `visible` er den filtrerede liste; i dagsvisningen teller
 * de ventende offline-oprettelser med, for de ville være synlige i rækken.
 */
export function filterHidesAll(input: { active: boolean; visible: number; pending: number }): boolean {
  return input.active && input.visible === 0 && input.pending === 0;
}

export function hasActiveFilter(filter: EntryFilter): boolean {
  return filter.projectId !== ALL_PROJECTS || filter.billable !== ALL_BILLABLE || filter.billed !== ALL_BILLED;
}

/**
 * Hent op til 1000 egne poster i intervallet — nok til en måned.
 *
 * `projectId: undefined` (ikke bare en tom streng) er det samme som intet
 * filter for serveren, så query-nøglen skelner mellem "Alle projekter" og et
 * valgt projekt — ellers deler de to tilstande TanStacks cache, og et filter
 * virker først efter en manuel genindlæsning.
 *
 * `billable` og `billed` er bevidst **ikke** her: de er lokale filtre over de
 * poster der allerede er hentet (se `matchesBillable` og `matchesBilled`), så
 * de må ikke ændre query-nøglen eller slå et nyt kald.
 */
export function entriesQueryInput(range: DateRange, filter: EntryFilter = NO_FILTER) {
  return {
    startDate: toISODate(range.start),
    endDate: toISODate(range.end),
    limit: 1000,
    onlyOwn: true,
    projectId: filter.projectId || undefined,
  } as const;
}
