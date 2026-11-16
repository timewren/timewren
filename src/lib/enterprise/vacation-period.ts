/**
 * Ferieår-perioder (#461, E3) — REN modul uden DB-imports, så både
 * server (vacation.ts, cron) og klient (rapport-builderen via E4's
 * reporting/config.ts) bruger PRÆCIS samme definition af ferieåret.
 */

export type VacationPeriod = {
  /** YYYY-MM-DD, første dag i ferieåret */
  start: string;
  /** YYYY-MM-DD, sidste dag i ferieåret */
  end: string;
  /** Ferieårets startår — gemmes i vacation_balances.year */
  year: number;
  /** "2026" (kalenderår) eller "Ferieår 2025/26" */
  label: string;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function normalizeStartMonth(startMonth: number): number {
  return Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12
    ? startMonth
    : 1;
}

/**
 * Hvilket ferieår en dato hører til, givet org'ens startmåned. Startmåned 1 =
 * kalenderår (uændret adfærd for freelance-orgs); 9 = ferielovens 1/9–31/8,
 * så 15/3-2026 → 1/9-2025..31/8-2026. Én helper for hele systemet.
 */
export function vacationPeriodFor(
  date: string,
  startMonth = 1,
): VacationPeriod {
  const y = Number.parseInt(date.slice(0, 4), 10);
  const m = Number.parseInt(date.slice(5, 7), 10);
  const sm = normalizeStartMonth(startMonth);
  const startYear = m >= sm ? y : y - 1;
  return vacationPeriodForYear(startYear, sm);
}

/** Ferieåret med det givne startår (kalenderår når startMonth = 1). */
export function vacationPeriodForYear(
  startYear: number,
  startMonth = 1,
): VacationPeriod {
  const sm = normalizeStartMonth(startMonth);
  const start = `${startYear}-${pad2(sm)}-01`;
  const end =
    sm === 1
      ? `${startYear}-12-31`
      : `${startYear + 1}-${pad2(sm - 1)}-${pad2(lastDayOfMonth(startYear + 1, sm - 1))}`;
  const label =
    sm === 1
      ? String(startYear)
      : `Ferieår ${startYear}/${String(startYear + 1).slice(2)}`;
  return { start, end, year: startYear, label };
}

/** Ferieårets startår for en dato (kalenderår når startMonth = 1). */
export function vacationYearOf(date: string, startMonth = 1): number {
  return vacationPeriodFor(date, startMonth).year;
}

/** Ferieåret der følger lige efter `period`. */
export function nextVacationPeriod(
  period: Pick<VacationPeriod, "end">,
  startMonth: number,
): VacationPeriod {
  const [y, m, d] = period.end.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1);
  const iso = `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`;
  return vacationPeriodFor(iso, startMonth);
}

/** "2026" eller "Ferieår 2025/26" ud fra periodens startdato. */
export function periodLabelFor(periodStart: string): string {
  const startMonth = Number.parseInt(periodStart.slice(5, 7), 10);
  return vacationPeriodFor(periodStart, startMonth).label;
}
