/**
 * Kontekstuelle nudges (#89 tid → faktura, #90 klippekort-discovery).
 *
 * Ren, deterministisk logik uden DB-/server-imports, så reglerne kan testes
 * isoleret og deles af server (nudges-router) og UI. Ingen AI: tærskler er
 * faste tal, og et nudge vises kun når der er noget konkret at handle på.
 *
 * Datoer er danske kalenderdatoer som "yyyy-MM-dd"-strenge (jf.
 * `src/lib/time/copenhagen.ts`), så resultatet ikke afhænger af proces-TZ.
 */

/** Under så mange ufakturerede timer hos én kunde er et nudge støj. */
export const INVOICE_NUDGE_MIN_HOURS = 5;

/**
 * Så mange dage skal der mindst være gået siden sidste faktura til kunden —
 * eller, hvis kunden aldrig er faktureret, siden den ældste ufakturerede post.
 */
export const INVOICE_NUDGE_MIN_DAYS = 30;

/** "Ikke nu" på et faktura-nudge skjuler det for kunden i så mange dage. */
export const INVOICE_NUDGE_SNOOZE_DAYS = 30;

/** Klippekort-forslag kræver tid i hver af de seneste N hele måneder. */
export const PREPAID_LOOKBACK_MONTHS = 3;

/** Min. timer i en måned før måneden tæller som "aktiv". */
export const PREPAID_MIN_HOURS_PER_MONTH = 1;

/** Gennemsnitlig månedlig tid skal ligge i dette spænd (små, faste opgaver). */
export const PREPAID_MIN_AVG_MONTHLY_HOURS = 2;
export const PREPAID_MAX_AVG_MONTHLY_HOURS = 40;

/** Pakkestørrelser forslaget rundes op til. */
export const PREPAID_PACKAGE_SIZES = [
  5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100,
] as const;

export type NudgeKind = "invoice" | "prepaid";

/** Hvor et nudge blev vist — bruges i målingen. */
export const NUDGE_SURFACES = [
  "client_page",
  "dashboard",
  "klippekort_empty",
] as const;
export type NudgeSurface = (typeof NUDGE_SURFACES)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dateStrToUtcMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Hele dage fra `from` til `to` (begge "yyyy-MM-dd"). */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateStrToUtcMs(to) - dateStrToUtcMs(from)) / 86_400_000);
}

function addDays(dateStr: string, days: number): string {
  return new Date(dateStrToUtcMs(dateStr) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// #89 — faktura-nudge
// ---------------------------------------------------------------------------

export interface InvoiceNudgeInput {
  clientId: string;
  clientName: string;
  /** Ufakturerede timer (kanonisk definition, `invoicing/unbilled.ts`). */
  hours: number;
  /** Ufaktureret værdi i kr. (timer × sats, 0 når satsen mangler). */
  value: number;
  /** Dato for den ældste ufakturerede post. */
  oldestUnbilledDate: string;
  /** Dato for seneste faktura til kunden, `null` hvis aldrig faktureret. */
  lastInvoiceDate: string | null;
}

export interface InvoiceNudge extends InvoiceNudgeInput {
  /** Dage siden sidste faktura (eller ældste ufakturerede post). */
  daysSince: number;
  /** Hvad `daysSince` måles fra. */
  since: "last_invoice" | "oldest_entry";
}

/**
 * Skal kunden have et "Fakturér nu"-nudge? Kun når der både er nok
 * ufaktureret tid OG der er gået lang nok tid — ellers er det larm.
 */
export function evaluateInvoiceNudge(
  input: InvoiceNudgeInput,
  today: string,
): InvoiceNudge | null {
  if (!(input.hours >= INVOICE_NUDGE_MIN_HOURS)) return null;
  const since = input.lastInvoiceDate ? "last_invoice" : "oldest_entry";
  const from = input.lastInvoiceDate ?? input.oldestUnbilledDate;
  if (!DATE_RE.test(from) || !DATE_RE.test(today)) return null;
  const daysSince = daysBetween(from, today);
  if (daysSince < INVOICE_NUDGE_MIN_DAYS) return null;
  return { ...input, daysSince, since };
}

// ---------------------------------------------------------------------------
// #90 — klippekort-forslag
// ---------------------------------------------------------------------------

export interface MonthlyUsage {
  /** "yyyy-MM" */
  month: string;
  hours: number;
  /** timer × sats for måneden (0 når satsen mangler). */
  value: number;
  /**
   * Timer MED sats — så timer uden sats ikke trækker snitsatsen ned.
   * Udeladt = alle timer har sats.
   */
  ratedHours?: number;
}

export interface PrepaidSuggestion {
  /** Foreslået pakkestørrelse i timer. */
  hours: number;
  /** Foreslået timepris (historisk snit, ellers kundens sats), `null` hvis ukendt. */
  hourlyRate: number | null;
  /** hours × hourlyRate, `null` når satsen er ukendt. */
  totalPrice: number | null;
  /** Gennemsnitlig tid pr. måned i perioden. */
  avgMonthlyHours: number;
  /** Ca. hvor mange måneder pakken rækker ved nuværende forbrug. */
  monthsCovered: number;
}

/** De `count` hele måneder før `today`s måned, ældst først ("yyyy-MM"). */
export function lookbackMonths(
  today: string,
  count: number = PREPAID_LOOKBACK_MONTHS,
): string[] {
  const [y, m] = today.split("-").map(Number);
  const months: string[] = [];
  for (let i = count; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

/** Mindste standardpakke der dækker `hours` (loftet er største pakke). */
export function nicePackageHours(hours: number): number {
  for (const size of PREPAID_PACKAGE_SIZES) {
    if (size >= hours) return size;
  }
  return PREPAID_PACKAGE_SIZES[PREPAID_PACKAGE_SIZES.length - 1];
}

/**
 * Foreslå et klippekort når kunden har fast, mindre månedlig tid: tid i hver
 * af de seneste `PREPAID_LOOKBACK_MONTHS` hele måneder og et månedligt snit i
 * et "små opgaver"-spænd. Pakken dækker ca. et kvartals forbrug.
 */
export function suggestPrepaidPackage(
  usage: MonthlyUsage[],
  months: string[],
  fallbackRate: number | null = null,
): PrepaidSuggestion | null {
  if (months.length === 0) return null;
  const byMonth = new Map(usage.map((u) => [u.month, u]));
  let totalHours = 0;
  let totalValue = 0;
  let totalRatedHours = 0;
  for (const month of months) {
    const u = byMonth.get(month);
    if (!u || !(u.hours >= PREPAID_MIN_HOURS_PER_MONTH)) return null;
    totalHours += u.hours;
    totalValue += u.value;
    totalRatedHours += u.ratedHours ?? u.hours;
  }
  const avgMonthlyHours = totalHours / months.length;
  if (
    avgMonthlyHours < PREPAID_MIN_AVG_MONTHLY_HOURS ||
    avgMonthlyHours > PREPAID_MAX_AVG_MONTHLY_HOURS
  ) {
    return null;
  }

  const hours = nicePackageHours(avgMonthlyHours * 3);
  const historicRate =
    totalValue > 0 && totalRatedHours > 0 ? totalValue / totalRatedHours : null;
  const rawRate =
    historicRate ?? (fallbackRate && fallbackRate > 0 ? fallbackRate : null);
  const hourlyRate = rawRate === null ? null : Math.round(rawRate);
  return {
    hours,
    hourlyRate,
    totalPrice: hourlyRate === null ? null : hours * hourlyRate,
    avgMonthlyHours: Math.round(avgMonthlyHours * 10) / 10,
    monthsCovered: Math.round((hours / avgMonthlyHours) * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Afvisning — gemt i users.dismissedBanners (generisk mekanisme, #122)
// ---------------------------------------------------------------------------

export const NUDGE_KEY_PREFIX = "nudge:";

/** Præfiks for alle afvisninger af en nudge-type for én kunde. */
export function nudgeKeyPrefix(kind: NudgeKind, clientId: string): string {
  return `${NUDGE_KEY_PREFIX}${kind}:${clientId}`;
}

/**
 * Nøglen der gemmes ved afvisning. Faktura-nudges snoozes (de bliver relevante
 * igen næste måned); klippekort-forslag afvises permanent for kunden.
 */
export function nudgeDismissKey(
  kind: NudgeKind,
  clientId: string,
  today: string,
): string {
  if (!UUID_RE.test(clientId)) throw new Error("Ugyldigt kunde-id");
  if (kind === "invoice") {
    return `${nudgeKeyPrefix(kind, clientId)}:${addDays(today, INVOICE_NUDGE_SNOOZE_DAYS)}`;
  }
  return nudgeKeyPrefix(kind, clientId);
}

/** Er nudget for kunden afvist (og, for faktura, stadig inden for snooze)? */
export function isNudgeDismissed(
  keys: readonly string[] | null | undefined,
  kind: NudgeKind,
  clientId: string,
  today: string,
): boolean {
  if (!keys || keys.length === 0) return false;
  const prefix = nudgeKeyPrefix(kind, clientId);
  for (const key of keys) {
    if (kind === "prepaid") {
      if (key === prefix) return true;
      continue;
    }
    if (!key.startsWith(`${prefix}:`)) continue;
    const until = key.slice(prefix.length + 1);
    if (DATE_RE.test(until) && until > today) return true;
  }
  return false;
}
