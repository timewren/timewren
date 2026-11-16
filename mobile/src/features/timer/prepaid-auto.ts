import { trpcClient } from '~/lib/api/trpc';

/**
 * Hvilket klippekort skal et timer-stop trække fra?
 *
 * Port af web's `pickAutoDeductPackage` (`src/lib/prepaid/auto-select.ts`) —
 * reglen SKAL være den samme, så samme timer trækker fra samme kort, uanset om
 * der trykkes stop på web, i extensionen eller på telefonen. Serveren trækker
 * aldrig uden et eksplicit `prepaidPackageId`, så uden dette blev tid fra
 * mobilen aldrig trukket på kortet, og kunden kunne blive faktureret for
 * forudbetalte timer.
 *
 * Regel: kun aktive kort med auto-træk og saldo, som ikke er udløbet i dansk
 * tid. Det kort, der udløber først, vælges; kort uden udløb kommer sidst. Ved
 * samme udløb vælges det ældste købte (FIFO). Kender vi ikke købsdatoen,
 * bruges serverens rækkefølge (nyeste først) baglæns — altså også ældste først.
 */
export type AutoDeductCandidate = {
  id: string;
  autoDeduct?: boolean | null;
  remainingHours: string | number | null;
  expiryDate?: Date | string | null;
  isActive?: boolean | null;
  purchaseDate?: Date | string | null;
};

function toMs(value: Date | string | null | undefined): number | null {
  if (!value)
    return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

const COPENHAGEN_DAY = (() => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  catch {
    return null;
  }
})();

/** Den danske kalenderdag som `yyyy-MM-dd` (sammenlignes som tekst). */
function copenhagenDay(ms: number): string {
  const date = new Date(ms);
  if (!COPENHAGEN_DAY)
    return date.toISOString().slice(0, 10);
  const parts = COPENHAGEN_DAY.formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Kortet gælder hele udløbsdagen i dansk tid (web #736). */
export function isPrepaidExpired(expiry: Date | string | null | undefined, now: Date = new Date()): boolean {
  const ms = toMs(expiry);
  if (ms === null)
    return false;
  return copenhagenDay(now.getTime()) > copenhagenDay(ms);
}

function remainingOf(p: AutoDeductCandidate): number {
  return typeof p.remainingHours === 'number' ? p.remainingHours : Number.parseFloat(p.remainingHours || '0');
}

function compareCandidates(
  a: { p: AutoDeductCandidate; index: number },
  b: { p: AutoDeductCandidate; index: number },
): number {
  const ea = toMs(a.p.expiryDate);
  const eb = toMs(b.p.expiryDate);
  if (ea !== eb) {
    if (ea === null)
      return 1;
    if (eb === null)
      return -1;
    return ea - eb;
  }
  const pa = toMs(a.p.purchaseDate);
  const pb = toMs(b.p.purchaseDate);
  if (pa !== null && pb !== null && pa !== pb)
    return pa - pb;
  if (pa !== null && pb === null)
    return -1;
  if (pa === null && pb !== null)
    return 1;
  // Ingen købsdato at skelne på: listen kommer nyeste-først, så det sidste
  // element er det ældste.
  return b.index - a.index;
}

export function pickAutoDeductPackage<T extends AutoDeductCandidate>(
  packages: readonly T[] | null | undefined,
  now: Date = new Date(),
): T | null {
  if (!packages?.length)
    return null;
  const candidates = packages
    .map((p, index) => ({ p, index }))
    .filter(({ p }) => p.autoDeduct === true
      && p.isActive !== false
      && remainingOf(p) > 0
      && !isPrepaidExpired(p.expiryDate, now));
  if (candidates.length === 0)
    return null;
  return [...candidates].sort(compareCandidates)[0].p;
}

/**
 * Klippekortet til et timer-stop på kunden — eller null.
 *
 * Opslaget må aldrig vælte et stop: fejler det (net, adgang, modulet slået
 * fra), gemmes tiden uden kort, præcis som før.
 */
export async function resolveAutoPrepaidId(clientId: string | null, now: Date = new Date()): Promise<string | null> {
  if (!clientId)
    return null;
  try {
    const packages = await trpcClient.prepaid.getActiveForClient.query({ clientId });
    return pickAutoDeductPackage(packages, now)?.id ?? null;
  }
  catch {
    return null;
  }
}

/**
 * Afviste serveren posten på grund af klippekortet (udløbet, opbrugt med
 * politikken "block", inaktivt)? Samme skeln som extensionens
 * `isPrepaidDeductionError` — serverens beskeder nævner altid klippekortet.
 */
export function isPrepaidDeductionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /klippekort/i.test(message);
}
