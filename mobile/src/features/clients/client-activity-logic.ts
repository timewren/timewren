import type { InvoiceStatus } from '~/features/invoices/invoice-logic';
import { effectiveStatus } from '~/features/invoices/invoice-logic';

/**
 * «Senest set»-kortet på kundedetaljen (feature-kø F3): sidste registrerede
 * tid, seneste faktura og forfalde beløb samlet ét sted.
 *
 * Kilderne er de kald skærmen **allerede** har, så kortet tilføjer ingen ny
 * trafik: `clients.listWithStats` svarer `lastActivityDate`, `overdueCount` og
 * `overdueAmount` pr. kunde, og `invoices.list` kommer med kunden.
 */

/** Kun de felter fra `clients.listWithStats`'s `stats`, som kortet bruger. */
export type ActivityStats = {
  lastActivityDate?: string | null;
  overdueCount?: number | null;
  overdueAmount?: string | number | null;
} | null | undefined;

export type ActivityInvoice = {
  id: string;
  invoiceNumber?: string | null;
  status?: string | null;
  dueDate?: Date | string | null;
  amount?: string | number | null;
  createdAt?: Date | string | null;
};

export type LastInvoice = {
  id: string;
  number: string | null;
  amount: number;
  status: InvoiceStatus;
  dueDate: string | null;
};

export type ClientActivity = {
  /** ISO-dato for den seneste tidspost, eller `null` hvis kunden ingen har. */
  lastEntryDate: string | null;
  overdueCount: number;
  overdueAmount: number;
  lastInvoice: LastInvoice | null;
};

function toNumber(v: string | number | null | undefined): number {
  const n = typeof v === 'string' ? Number.parseFloat(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Dato-tidsstemplet i ms, eller 0 når serveren ikke har sendt en brugbar. */
function time(v: Date | string | null | undefined): number {
  if (!v)
    return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Den seneste faktura i listen.
 *
 * Der filtreres **ikke** på status: serveren sorterer efter `createdAt`
 * nyeste først, så den nyeste ligger altid i en kort liste, og en kladde eller
 * en slettet faktura er ærlige svar — begge har en dansk statusetiket. At
 * springe kladder over ville give en påstand om en kunde, der har fakturaer,
 * men hverken er korrekt dækket af de hentede rækker eller nødvendig: et kort
 * med titlen «seneste faktura» skal fortælle, hvad der ligger senest.
 *
 * `createdAt` sorteres dog igen her, så funktionen ikke stoler blindt på
 * rækkefølgen den får.
 */
export function lastInvoice(invoices: readonly ActivityInvoice[], now: Date = new Date()): LastInvoice | null {
  const sorted = [...invoices].sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const newest = sorted[0];
  if (!newest)
    return null;
  return {
    id: newest.id,
    number: newest.invoiceNumber ?? null,
    amount: toNumber(newest.amount),
    // Samme visningsstatus som fakturalisten: en sendt faktura, hvis
    // forfaldsdatoen er passeret, er forfalden — uanset cron'en endnu ikke
    // har flyttet den.
    status: effectiveStatus({ status: newest.status ?? null, dueDate: newest.dueDate ?? null, amount: toNumber(newest.amount) }, now),
    dueDate: newest.dueDate ? new Date(newest.dueDate).toISOString() : null,
  };
}

/**
 * Fakturaer der er forfalde at se på, men som serverens `overdueCount` ikke
 * tæller endnu: status `sent` med overskredet forfaldsdato.
 *
 * Cron'en `invoice-overdue` flytter dem til `overdue` én gang dagligt kl. 06:15,
 * så serverens tal er tomme indtil da. Uden denne tilføjelse sagde kortet to
 * ting om den samme kunde i samme skærmbillede: badgen «Forfalden» på den
 * seneste faktura (den bruger `effectiveStatus`) og «Ingen forfaldne» på
 * linjen under (den bruger serverens tal). Kun de fakturaer serveren **ikke**
 * tæller tælles her, så intet kan tælles to gange.
 *
 * Kortet henter kun de 10 nyeste fakturaer, så en ældre `sent`-faktura med
 * overskredet forfaldsdato kan mangle i tillægget. Den kan dog aldrig skabe
 * en modsigelse: badgen viser altid en af de hentede fakturaer.
 */
function notYetCounted(invoices: readonly ActivityInvoice[], now: Date): { count: number; amount: number } {
  let count = 0;
  let amount = 0;
  for (const inv of invoices) {
    // Serveren tæller denne allerede — en ekstra tælling ville være værre
    // end en under tælling, fordi beløbet så er dobbelt så stort.
    if ((inv.status ?? 'draft') === 'overdue')
      continue;
    const status = effectiveStatus({ status: inv.status ?? null, dueDate: inv.dueDate ?? null, amount: toNumber(inv.amount) }, now);
    if (status === 'overdue') {
      count += 1;
      amount += toNumber(inv.amount);
    }
  }
  return { count, amount };
}

/**
 * Samler kortets tre linjer.
 *
 * `overdueCount`/`overdueAmount` kommer fra serveren og er derfor **hele**
 * sandheden om forfaldne fakturaer. De tæller kun status `overdue`, altså dem
 * cron'en har flyttet — derfor lægges de `sent`-fakturaer med overskredet
 * forfaldsdato oveni (se `notYetCounted`), så linjen og badgen på den seneste
 * faktura fortæller det samme. Derfor hedder linjen «forfalde» og ikke
 * «skyldig»: tallene dækker præcis den mængde, de kommer fra.
 */
export function clientActivity(stats: ActivityStats, invoices: readonly ActivityInvoice[], now: Date = new Date()): ClientActivity {
  const extra = notYetCounted(invoices, now);
  return {
    lastEntryDate: stats?.lastActivityDate ?? null,
    overdueCount: toNumber(stats?.overdueCount ?? 0) + extra.count,
    overdueAmount: toNumber(stats?.overdueAmount ?? 0) + extra.amount,
    lastInvoice: lastInvoice(invoices, now),
  };
}

/**
 * Er der noget forfalden?
 *
 * Tæller på **beløb** såvel som antal. Serveren svarer begge delene fra samme
 * forespørgsel, så de burde altid følges ad — men hvis de engang ikke gør det,
 * må et beløb på 500 kr. aldrig males som «ingen forfaldne».
 */
export function hasOverdue(activity: ClientActivity): boolean {
  return activity.overdueCount > 0 || activity.overdueAmount > 0;
}

/** Sandt, når der intet er at vise — så kortet siger det i stedet for nul. */
export function isEmptyActivity(activity: ClientActivity): boolean {
  return !activity.lastEntryDate && !activity.lastInvoice && !hasOverdue(activity);
}
