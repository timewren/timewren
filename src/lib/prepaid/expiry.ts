/**
 * Klippekort-udløb (#736): et kort gælder HELE udløbsdagen i dansk tid —
 * til og med 23:59:59 Europe/Copenhagen på udløbsdatoen.
 *
 * `prepaid_packages.expiry_date` er en timestamp uden tidszone, og datoen
 * gemmes som UTC-midnat (`entryDateFromStr`). Ældre rækker kan også ligge
 * som dansk midnat (22:00Z/23:00Z dagen før — `new Date(y, m, d)` i en
 * proces med TZ=Europe/Copenhagen) eller et vilkårligt klokkeslæt (kopi,
 * API). Udløbsdatoen er derfor altid den DANSKE kalenderdato for værdien:
 * både UTC-midnat (01:00/02:00 dansk) og dansk midnat lander på den
 * tilsigtede dato, så ingen datamigration er nødvendig.
 *
 * Brug disse funktioner overalt hvor udløb sammenlignes med "nu" — aldrig
 * `expiryDate < new Date()`, der lod kortet udløbe ved STARTEN af dagen.
 */
import {
  addDaysToDateStr,
  copenhagenDayEndExclusive,
  copenhagenDayStart,
  copenhagenToday,
  entryDateFromStr,
  toCopenhagenDateStr,
} from "@/lib/time/copenhagen";

export type PrepaidExpiryValue = Date | string | null | undefined;

const DAY_MS = 24 * 60 * 60 * 1000;

function toInstant(value: PrepaidExpiryValue): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Udløbsdatoen som dansk kalenderdato ("yyyy-MM-dd"); null = intet udløb. */
export function prepaidExpiryDateStr(
  expiry: PrepaidExpiryValue,
): string | null {
  const instant = toInstant(expiry);
  return instant ? toCopenhagenDateStr(instant) : null;
}

/**
 * Første øjeblik kortet ER udløbet: dansk midnat efter udløbsdatoen
 * (eksklusiv grænse). null = intet udløb.
 */
export function prepaidValidUntil(expiry: PrepaidExpiryValue): Date | null {
  const dateStr = prepaidExpiryDateStr(expiry);
  return dateStr ? copenhagenDayEndExclusive(dateStr) : null;
}

/** Er kortet udløbet på tidspunktet `now`? Kort uden udløb udløber aldrig. */
export function isPrepaidExpired(
  expiry: PrepaidExpiryValue,
  now: Date = new Date(),
): boolean {
  const validUntil = prepaidValidUntil(expiry);
  return validUntil !== null && now.getTime() >= validUntil.getTime();
}

/**
 * Grænse til databaseforespørgsler: et kort med `expiry_date < grænsen` er
 * udløbet, `>=` er gyldigt. Grænsen er starten af dagens danske dato —
 * eksakt ækvivalent med `isPrepaidExpired`, fordi den danske dato for en
 * værdi er >= D netop når værdien er >= dansk midnat på D.
 */
export function prepaidExpiredBefore(now: Date = new Date()): Date {
  return copenhagenDayStart(copenhagenToday(now));
}

/**
 * Eksklusiv grænse til forespørgsler "udløber senest om `days` dage":
 * `expiry_date < grænsen` ⇔ udløbsdatoen ligger på eller før i dag + days.
 */
export function prepaidExpiresWithinBefore(
  days: number,
  now: Date = new Date(),
): Date {
  return copenhagenDayStart(addDaysToDateStr(copenhagenToday(now), days + 1));
}

/**
 * Hele kalenderdage fra dagens danske dato til udløbsdatoen: 0 = udløber i
 * dag, 1 = i morgen, negativ = udløbet for så mange dage siden. null = intet
 * udløb.
 */
export function prepaidDaysUntilExpiry(
  expiry: PrepaidExpiryValue,
  now: Date = new Date(),
): number | null {
  const dateStr = prepaidExpiryDateStr(expiry);
  if (!dateStr) return null;
  const today = copenhagenToday(now);
  return Math.round(
    (Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      DAY_MS,
  );
}

/**
 * Udløbsdatoen for en kopi af et kort (#738): samme gyldighed i hele
 * kalenderdage som originalen (dansk købsdato → dansk udløbsdato), regnet fra
 * dagens danske dato og gemt som UTC-midnat på datoen — ikke "nu + samme antal
 * millisekunder", der tog klokkeslættet med og kunne lande en dag forkert hen
 * over et skift mellem sommer- og vintertid. null = originalen har intet udløb.
 */
export function duplicatedPrepaidExpiry(
  purchaseDate: PrepaidExpiryValue,
  expiryDate: PrepaidExpiryValue,
  now: Date = new Date(),
): Date | null {
  const expiryStr = prepaidExpiryDateStr(expiryDate);
  if (!expiryStr) return null;
  const purchaseStr = prepaidExpiryDateStr(purchaseDate) ?? expiryStr;
  const validDays = Math.max(
    0,
    Math.round(
      (Date.parse(`${expiryStr}T00:00:00Z`) -
        Date.parse(`${purchaseStr}T00:00:00Z`)) /
        DAY_MS,
    ),
  );
  return entryDateFromStr(addDaysToDateStr(copenhagenToday(now), validDays));
}

/**
 * Dansk tekst til et ikke-udløbet kort: "udløber i dag", "udløber i morgen"
 * eller "udløber om N dage". Til udløbne kort (days < 0) gives "udløbet".
 */
export function prepaidExpiryPhrase(days: number): string {
  if (days < 0) return "udløbet";
  if (days === 0) return "udløber i dag";
  if (days === 1) return "udløber i morgen";
  return `udløber om ${days} dage`;
}

/** `prepaidExpiryPhrase` med stort begyndelsesbogstav, til badges. */
export function prepaidExpiryLabel(days: number): string {
  const phrase = prepaidExpiryPhrase(days);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * Udløbsdatoen formateret (dansk som standard), uafhængigt af processens
 * tidszone. `locale` er en Intl-kode som "en-GB".
 */
export function formatPrepaidExpiry(
  expiry: PrepaidExpiryValue,
  options: Intl.DateTimeFormatOptions = {},
  locale = "da-DK",
): string {
  const instant = toInstant(expiry);
  if (!instant) return "";
  return instant.toLocaleDateString(locale, {
    ...options,
    timeZone: "Europe/Copenhagen",
  });
}
