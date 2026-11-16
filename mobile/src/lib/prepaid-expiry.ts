/**
 * Klippekort-udløb (mahope/timetrack#738): et kort gælder HELE udløbsdagen i
 * dansk tid — til og med 23:59:59 Europe/Copenhagen på udløbsdatoen.
 *
 * Samme regel som web (`src/lib/prepaid/expiry.ts`). Serveren
 * gemmer udløbsdatoen som UTC-midnat; ældre rækker kan ligge som dansk midnat
 * (22:00Z/23:00Z dagen før). Udløbsdatoen er derfor altid den DANSKE
 * kalenderdato for værdien — uanset hvilken tidszone telefonen står i.
 *
 * Dansk tid regnes uden Intl-tidszoner (Hermes' understøttelse varierer):
 * EU-reglen siger sommertid fra sidste søndag i marts kl. 01:00 UTC til
 * sidste søndag i oktober kl. 01:00 UTC. Paritetstesten mod web-helperen
 * (`prepaid-expiry.test.ts`) holder de to implementationer ens.
 */

export type PrepaidExpiryValue = Date | string | null | undefined;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function toInstant(value: PrepaidExpiryValue): Date | null {
  if (!value)
    return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Sidste søndag i måneden (0-indekseret) kl. 01:00 UTC, som epoch-ms. */
function lastSundayAt0100Utc(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const day = lastDay.getUTCDate() - lastDay.getUTCDay();
  return Date.UTC(year, month, day, 1);
}

/** Københavns UTC-forskydning i ms på tidspunktet: +2 t sommertid, ellers +1 t. */
export function copenhagenOffsetMs(instant: Date): number {
  const t = instant.getTime();
  const year = instant.getUTCFullYear();
  const dstStart = lastSundayAt0100Utc(year, 2);
  const dstEnd = lastSundayAt0100Utc(year, 9);
  return t >= dstStart && t < dstEnd ? 2 * HOUR_MS : HOUR_MS;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Den danske kalenderdato ("yyyy-MM-dd") for et tidspunkt. */
export function toCopenhagenDateStr(instant: Date): string {
  const wall = new Date(instant.getTime() + copenhagenOffsetMs(instant));
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
}

/** Udløbsdatoen som dansk kalenderdato ("yyyy-MM-dd"); null = intet udløb. */
export function prepaidExpiryDateStr(expiry: PrepaidExpiryValue): string | null {
  const instant = toInstant(expiry);
  return instant ? toCopenhagenDateStr(instant) : null;
}

/**
 * Hele kalenderdage fra dagens danske dato til udløbsdatoen: 0 = udløber i
 * dag, 1 = i morgen, negativ = udløbet. null = intet udløb.
 */
export function prepaidDaysUntilExpiry(expiry: PrepaidExpiryValue, now: Date = new Date()): number | null {
  const dateStr = prepaidExpiryDateStr(expiry);
  if (!dateStr)
    return null;
  const today = toCopenhagenDateStr(now);
  return Math.round((Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/** Er kortet udløbet på tidspunktet `now`? Kort uden udløb udløber aldrig. */
export function isPrepaidExpired(expiry: PrepaidExpiryValue, now: Date = new Date()): boolean {
  const days = prepaidDaysUntilExpiry(expiry, now);
  return days !== null && days < 0;
}

/**
 * Udløbsdatoen som lokal Date ved midnat på den danske dato — til visning med
 * date-fns, så telefonens tidszone ikke kan flytte datoen en dag.
 */
export function prepaidExpiryDisplayDate(expiry: PrepaidExpiryValue): Date | null {
  const dateStr = prepaidExpiryDateStr(expiry);
  if (!dateStr)
    return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}
