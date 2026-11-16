import { toIntlLocale } from "@/i18n/format-locale";
import { currentSyncLocale, syncT } from "@/i18n/sync-text";

/**
 * Timeseddel-hærdning (#467) — rene helpers uden DB:
 *  - validering af en uge ved indsend (advarsler + blokerende fejl)
 *  - rullende lås ("kan ikke redigere > N hele uger tilbage")
 *  - cellenote ↔ time_entries.description (bagudkompatibel med "Timeseddel")
 */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Timetal med én decimal efter sprogets regler ("7,5" på dansk). */
export function formatHoursDa(value: number): string {
  return value.toLocaleString(toIntlLocale(currentSyncLocale()), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** "Onsdag 3/9" — dansk dagnavn + dato uden år, til fejl- og advarselstekster. */
export function formatDayLabel(date: string): string {
  const d = parseLocalDate(date);
  const weekday = d.toLocaleDateString(toIntlLocale(currentSyncLocale()), {
    weekday: "long",
  });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${d.getDate()}/${d.getMonth() + 1}`;
}

// ---------------------------------------------------------------------------
// Validering ved indsend
// ---------------------------------------------------------------------------

/** Org-indstillinger for validering (organizations.timesheet_*). */
export type TimesheetValidationSettings = {
  /** Maks. registrerede timer pr. dag; over → blokerende fejl. */
  maxHoursPerDay: number;
  /** Advar når en dag/ugen overstiger normen. */
  warnOverNorm: boolean;
  /** Tomme arbejdsdage (uden fravær/helligdag) blokerer indsend i stedet for at advare. */
  blockEmptyWorkdays: boolean;
};

export const DEFAULT_TIMESHEET_VALIDATION_SETTINGS: TimesheetValidationSettings =
  {
    maxHoursPerDay: 24,
    warnOverNorm: true,
    blockEmptyWorkdays: false,
  };

export type TimesheetWeekForValidation = {
  /** Ugens 7 datoer (YYYY-MM-DD), mandag først. */
  days: readonly string[];
  /** Registrerede timer pr. dato (fravær tæller ikke med). */
  totals: Readonly<Record<string, number>>;
  /** Normtid pr. dato — 0 på fridage, helligdage og godkendt heldags-fravær. */
  norms: Readonly<Record<string, number>>;
  /** Ugenorm (dagsnorm × arbejdsdage). */
  weeklyNorm: number;
  /** Datoer der er arbejdsdage for medarbejderen (helligdage fratrukket). */
  workingDates: ReadonlySet<string>;
  /** Datoer med fravær (afventende eller godkendt, hel eller halv dag). */
  absenceDates: ReadonlySet<string>;
};

export type TimesheetValidationResult = {
  /** Blokerer indsend. */
  errors: string[];
  /** Kræver bekræftelse ("indsend alligevel?"). */
  warnings: string[];
};

/**
 * Validér en uge før indsend. Regler:
 *  - dag > maks/dag → fejl
 *  - tom arbejdsdag uden fravær → fejl (blockEmptyWorkdays) ellers advarsel
 *  - dag > dagsnorm og uge > ugenorm → advarsel (warnOverNorm)
 * Rækkefølgen i listerne følger ugen, så dialogen læser naturligt.
 */
export function validateTimesheetWeek(
  week: TimesheetWeekForValidation,
  settings: TimesheetValidationSettings = DEFAULT_TIMESHEET_VALIDATION_SETTINGS,
): TimesheetValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const max =
    settings.maxHoursPerDay > 0
      ? settings.maxHoursPerDay
      : Number.POSITIVE_INFINITY;

  let weekTotal = 0;
  for (const date of week.days) {
    const total = round2(week.totals[date] ?? 0);
    const norm = week.norms[date] ?? 0;
    weekTotal += total;
    const label = formatDayLabel(date);

    if (total > max + 0.005) {
      errors.push(
        syncT("enterprise.timesheet.overMax", {
          label,
          total: formatHoursDa(total),
          max: formatHoursDa(max),
        }),
      );
      continue;
    }

    if (
      total <= 0.005 &&
      week.workingDates.has(date) &&
      !week.absenceDates.has(date)
    ) {
      const text = syncT("enterprise.timesheet.emptyWorkday", { label });
      if (settings.blockEmptyWorkdays) errors.push(text);
      else warnings.push(text);
      continue;
    }

    if (settings.warnOverNorm && norm > 0 && total > norm + 0.005) {
      warnings.push(
        syncT("enterprise.timesheet.overNorm", {
          label,
          total: formatHoursDa(total),
          norm: formatHoursDa(norm),
        }),
      );
    }
  }

  weekTotal = round2(weekTotal);
  if (
    settings.warnOverNorm &&
    week.weeklyNorm > 0 &&
    weekTotal > week.weeklyNorm + 0.005
  ) {
    warnings.push(
      syncT("enterprise.timesheet.weekOverNorm", {
        total: formatHoursDa(weekTotal),
        norm: formatHoursDa(week.weeklyNorm),
      }),
    );
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Rullende lås
// ---------------------------------------------------------------------------

function startOfISOWeekLocal(ref: Date): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return d;
}

/**
 * Første dato der stadig må redigeres, givet "lås efter N hele uger":
 * mandag i indeværende uge minus N uger. N = 0 ⇒ kun indeværende uge er
 * åben. null/negativ ⇒ ingen lås (null).
 */
export function rollingLockBoundary(
  today: Date,
  lockAfterWeeks: number | null | undefined,
): Date | null {
  if (lockAfterWeeks == null || lockAfterWeeks < 0) return null;
  const boundary = startOfISOWeekLocal(today);
  boundary.setDate(boundary.getDate() - Math.floor(lockAfterWeeks) * 7);
  return boundary;
}

/** True hvis datoen ligger før den rullende låsegrænse. */
export function isRollingLocked(
  date: Date | string,
  today: Date,
  lockAfterWeeks: number | null | undefined,
): boolean {
  const boundary = rollingLockBoundary(today, lockAfterWeeks);
  if (!boundary) return false;
  const d = typeof date === "string" ? parseLocalDate(date) : date;
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return local < boundary;
}

export const AUTO_LOCK_WEEKDAY_LABELS: Record<number, string> = {
  1: "mandag",
  2: "tirsdag",
  3: "onsdag",
  4: "torsdag",
  5: "fredag",
  6: "lørdag",
  7: "søndag",
};

/**
 * Auto-lås (#518): "forrige uge låses onsdag". Fra ugedagen `weekday`
 * (ISO, 1 = mandag) er alt før indeværende uges mandag låst; før ugedagen
 * er grænsen forrige uges mandag. null/ugyldig ⇒ ingen auto-lås.
 */
export function autoLockBoundary(
  today: Date,
  weekday: number | null | undefined,
): Date | null {
  if (weekday == null || !Number.isInteger(weekday)) return null;
  if (weekday < 1 || weekday > 7) return null;
  const boundary = startOfISOWeekLocal(today);
  const dow = today.getDay() === 0 ? 7 : today.getDay();
  if (dow < weekday) boundary.setDate(boundary.getDate() - 7);
  return boundary;
}

/** True hvis datoen ligger før auto-låsens grænse. */
export function isAutoLocked(
  date: Date | string,
  today: Date,
  weekday: number | null | undefined,
): boolean {
  const boundary = autoLockBoundary(today, weekday);
  if (!boundary) return false;
  const d = typeof date === "string" ? parseLocalDate(date) : date;
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return local < boundary;
}

/** Ugedagens navn (ISO, 1 = mandag) på kaldets sprog, med småt. */
function weekdayName(weekday: number): string | null {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return null;
  return new Date(2024, 0, weekday).toLocaleDateString(
    toIntlLocale(currentSyncLocale()),
    { weekday: "long" },
  );
}

export function autoLockMessage(weekday: number): string {
  return syncT("enterprise.timesheet.autoLocked", {
    day: weekdayName(weekday) ?? syncT("enterprise.timesheet.automatically"),
  });
}

export function rollingLockMessage(lockAfterWeeks: number): string {
  const n = Math.floor(lockAfterWeeks);
  const weeks = syncT("enterprise.timesheet.weeks", { count: n });
  return syncT("enterprise.timesheet.rollingLocked", { weeks });
}

// ---------------------------------------------------------------------------
// Cellenote ↔ description
// ---------------------------------------------------------------------------

/** Standardbeskrivelsen grid-poster fik før #467 — og stadig får uden note. */
export const TIMESHEET_DEFAULT_DESCRIPTION = "Timeseddel";
export const TIMESHEET_NOTE_MAX_LENGTH = 500;

/** Note fra grid'et → description. Tom/blank note = "Timeseddel". */
export function noteToDescription(note: string | null | undefined): string {
  const trimmed = (note ?? "").trim();
  return trimmed === "" ? TIMESHEET_DEFAULT_DESCRIPTION : trimmed;
}

/** description → note til grid'et. "Timeseddel"/tom = ingen note (null). */
export function descriptionToNote(
  description: string | null | undefined,
): string | null {
  const trimmed = (description ?? "").trim();
  if (trimmed === "" || trimmed === TIMESHEET_DEFAULT_DESCRIPTION) return null;
  return trimmed;
}
