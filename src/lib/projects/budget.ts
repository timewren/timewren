/**
 * Månedsbudget pr. projekt — én kilde til tærskler og månedsgrænser (#592).
 *
 * Før dette lå tærsklerne tre steder med to forskellige tal (75/90 i
 * `projects.list` + `MonthlyBudgetSection`, 80/100 i `ProjectBudgetBar`), og
 * månedsgrænsen var implementeret to gange i samme router (`Date.UTC` hhv.
 * `date_trunc`). Her er begge dele samlet.
 *
 * Tærskler (besluttet): grøn < 80 %, gul 80–99 %, rød ≥ 100 %.
 *
 * Ren TS uden React og uden DB, så både tRPC-routere, cron, rapportmotoren og
 * klientkomponenter kan importere den.
 */

export const BUDGET_TIMEZONE = "Europe/Copenhagen";

/** Gul fra og med denne procent. */
export const BUDGET_WARNING_PERCENT = 80;
/** Rød fra og med denne procent (= budgettet er brugt op). */
export const BUDGET_CRITICAL_PERCENT = 100;

export type BudgetHealthStatus = "green" | "yellow" | "red";

export interface MonthlyBudgetStatus {
  /** Afrundet til hele procent — kun til visning. */
  percentage: number;
  /** Timer tilbage; negativ når budgettet er overskredet. Én decimal. */
  remaining: number;
  healthStatus: BudgetHealthStatus;
}

/**
 * Farvestatus ud fra en *uafrundet* procent. Afrundingen sker først til
 * visning, så 99,6 % ikke bliver rød fordi den vises som "100 %".
 */
export function budgetHealthStatus(percentage: number): BudgetHealthStatus {
  if (percentage >= BUDGET_CRITICAL_PERCENT) return "red";
  if (percentage >= BUDGET_WARNING_PERCENT) return "yellow";
  return "green";
}

/**
 * Status for et månedsbudget. `budgetHours <= 0` betyder "intet budget" og
 * giver 0 % / grøn, så kaldere kan undlade at forgrene på det.
 */
export function monthlyBudgetStatus(
  budgetHours: number,
  usedHours: number,
): MonthlyBudgetStatus {
  const raw = budgetHours > 0 ? (usedHours / budgetHours) * 100 : 0;
  return {
    percentage: Math.round(raw),
    remaining: Math.round((budgetHours - usedHours) * 10) / 10,
    healthStatus: budgetHealthStatus(raw),
  };
}

// --- Månedsgrænser i Europe/Copenhagen -------------------------------------

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUDGET_TIMEZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Vægurets dele i København for et givet tidspunkt. */
function zonedParts(date: Date): ZonedParts {
  const map: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // Intl kan give "24" for midnat i hour12:false
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Zonens offset i ms på det givne tidspunkt (+1 t om vinteren, +2 t om sommeren). */
function zoneOffsetMs(date: Date): number {
  const p = zonedParts(date);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * UTC-tidspunktet for lokal midnat i København på den givne dato.
 * To gennemløb, fordi offsettet selv afhænger af resultatet (DST-skiftet).
 */
function zonedMidnightUtc(year: number, month: number, day: number): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  let ts = guess - zoneOffsetMs(new Date(guess));
  ts = guess - zoneOffsetMs(new Date(ts));
  return new Date(ts);
}

export interface MonthBounds {
  /** Inklusiv nedre grænse. */
  start: Date;
  /** Eksklusiv øvre grænse (= starten på næste måned). */
  next: Date;
}

/**
 * Kalendermåneden omkring `date`, afgrænset af lokal midnat i København.
 *
 * `time_entries.date` er en `timestamp` uden tidszone med UTC-semantik, så en
 * post registreret 31. januar kl. 23:30 dansk tid ligger på 22:30Z og hører
 * dermed til januar. Med rene UTC-grænser ville en post kl. 00:30 dansk tid
 * den 1. februar (23:30Z den 31.) derimod være talt med i januar.
 */
export function monthBoundsCopenhagen(date: Date = new Date()): MonthBounds {
  const p = zonedParts(date);
  const start = zonedMidnightUtc(p.year, p.month, 1);
  const nextYear = p.month === 12 ? p.year + 1 : p.year;
  const nextMonth = p.month === 12 ? 1 : p.month + 1;
  return { start, next: zonedMidnightUtc(nextYear, nextMonth, 1) };
}

/** Månedsnøgle "YYYY-MM" for et tidspunkt, set fra København. */
export function monthKeyCopenhagen(date: Date = new Date()): string {
  const p = zonedParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** Månedsgrænser `offset` måneder før den måned `date` ligger i. */
export function monthBoundsCopenhagenOffset(
  date: Date,
  offset: number,
): MonthBounds {
  const p = zonedParts(date);
  const anchor = new Date(Date.UTC(p.year, p.month - 1 + offset, 15, 12));
  return monthBoundsCopenhagen(anchor);
}

// --- Advarsels-niveauer (cron) ---------------------------------------------

/** 0 = ingen advarsel; ellers den krydsede tærskel. */
export type BudgetAlertLevel = 0 | 80 | 100;

/** Højeste tærskel forbruget har nået. */
export function budgetAlertLevel(percentage: number): BudgetAlertLevel {
  if (percentage >= BUDGET_CRITICAL_PERCENT) return BUDGET_CRITICAL_PERCENT;
  if (percentage >= BUDGET_WARNING_PERCENT) return BUDGET_WARNING_PERCENT;
  return 0;
}

/**
 * Hvilket niveau der skal advares om nu, givet hvad der sidst blev advaret om
 * i samme måned. `null` = ingen ny advarsel.
 *
 * Kun opad: falder forbruget igen (en post slettes), sendes der ikke en ny
 * advarsel, og det gemte niveau holdes — ellers ville en sletning + gen-
 * registrering give dubletter.
 */
export function budgetAlertCrossing(
  percentage: number,
  lastNotifiedLevel: number,
): BudgetAlertLevel | null {
  const level = budgetAlertLevel(percentage);
  if (level === 0) return null;
  if (level <= lastNotifiedLevel) return null;
  return level;
}
