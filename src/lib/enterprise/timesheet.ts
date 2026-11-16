/**
 * Pure helpers for the enterprise timesheet grid — Danish number input
 * ("7,4" and "7.4" both accepted, plus "2:30"/"2t30"/"30m") and compact hour
 * formatting.
 */

import {
  DEFAULT_TIMESHEET_VALIDATION_SETTINGS,
  type TimesheetValidationSettings,
} from "./timesheet-validation";

const MAX_HOURS = 24;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Format hours for an editable cell: empty for 0, trailing zeros trimmed,
 * Danish comma (2.5 → "2,5", 7.4 → "7,4", 8 → "8").
 */
export function formatHoursInput(value: number): string {
  if (!value) return "";
  return value
    .toFixed(2)
    .replace(/\.?0+$/, "")
    .replace(".", ",");
}

/** Alias kept for existing call sites. */
export const formatHours = formatHoursInput;

/** Format hours for totals rows: always one decimal, Danish comma. */
export function formatTotal(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

/**
 * Parse a cell input into decimal hours. Empty string means 0 (clear the
 * cell). Returns null for invalid input (garbage, negative, > 24).
 *
 * Accepted formats (case-insensitive, whitespace tolerated):
 *   "2", "2,5", "2.5"        → decimal hours (comma/punktum = decimal)
 *   "2:30"                   → 2 timer 30 minutter (kolon = minutter)
 *   "2t30", "2h30", "2t30m"  → 2 timer 30 minutter
 *   "2t", "2h"               → 2 timer
 *   "30m", "90m"             → minutter
 */
export function parseHours(input: string): number | null {
  const trimmed = input.trim().toLowerCase().replace(/\s+/g, "");
  if (trimmed === "") return 0;

  let value: number;

  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(trimmed);
  const hoursMinutes = /^(\d{1,2})[th](\d{1,2})?m?$/.exec(trimmed);
  const minutesOnly = /^(\d{1,4})m$/.exec(trimmed);
  const decimal = /^\d+([.,]\d+)?$/.test(trimmed);

  if (colon) {
    const minutes = Number(colon[2]);
    if (minutes >= 60) return null;
    value = Number(colon[1]) + minutes / 60;
  } else if (hoursMinutes) {
    const minutes = hoursMinutes[2] ? Number(hoursMinutes[2]) : 0;
    if (minutes >= 60) return null;
    value = Number(hoursMinutes[1]) + minutes / 60;
  } else if (minutesOnly) {
    value = Number(minutesOnly[1]) / 60;
  } else if (decimal) {
    value = Number(trimmed.replace(",", "."));
  } else {
    return null;
  }

  if (Number.isNaN(value) || value < 0 || value > MAX_HOURS) return null;
  return round2(value);
}

export type BreakPolicy = "none" | "paid_included" | "unpaid_excluded";

export const BREAK_POLICIES: readonly BreakPolicy[] = [
  "none",
  "paid_included",
  "unpaid_excluded",
] as const;

/** Organisationens arbejdstids-indstillinger (#449) — hentes én gang pr. request. */
export type OrgWorkSettings = {
  /** Fuldtids-ugetimer; skaleringsgrundlag for deltid. */
  defaultWeeklyHours: number;
  /** Fuldtids-dagsnorm (fx 8,0 når pausen er betalt). null = ugetimer/arbejdsdage. */
  dailyNormHours: number | null;
  breakMinutesPerDay: number;
  breakPolicy: BreakPolicy;
  /** Timeseddel-validering ved indsend (#467). */
  timesheetValidation: TimesheetValidationSettings;
  /** Rullende lås: registreringer ældre end N hele uger er låst (null = ingen). */
  timesheetLockAfterWeeks: number | null;
  /** Auto-lås (#518): ISO-ugedag hvor forrige uge låses (null = ingen). */
  timesheetAutoLockWeekday: number | null;
};

export const DEFAULT_ORG_WORK_SETTINGS: OrgWorkSettings = {
  defaultWeeklyHours: 37,
  dailyNormHours: null,
  breakMinutesPerDay: 0,
  breakPolicy: "none",
  timesheetValidation: DEFAULT_TIMESHEET_VALIDATION_SETTINGS,
  timesheetLockAfterWeeks: null,
  timesheetAutoLockWeekday: null,
};

export const DEFAULT_WORKING_DAYS = ["1", "2", "3", "4", "5"];

/** Det udsnit af employee_profiles normtiden afhænger af. */
export type NormProfile = {
  weeklyHours: number | string | null | undefined;
  workingDays: string[] | null | undefined;
  /** Medarbejder-override af dagsnormen (#449). */
  dailyNormHours?: number | string | null;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Dagsnorm — ÉT beregningspunkt for hele enterprise-modulet (#449):
 *   1. profilens egen dagsnorm, hvis sat;
 *   2. ellers org'ens fuldtids-dagsnorm skaleret med ugetimer/org-ugetimer
 *      (8,0 × 30/37 = 6,5), afrundet til 0,1;
 *   3. ellers ugetimer / antal arbejdsdage (37/5 = 7,4, 2 decimaler).
 * Uden arbejdsdage er normen altid 0.
 */
export function calculateDailyNorm(
  profile: NormProfile,
  org: OrgWorkSettings | null | undefined = DEFAULT_ORG_WORK_SETTINGS,
): number {
  const workingDays = profile.workingDays ?? DEFAULT_WORKING_DAYS;
  if (workingDays.length === 0) return 0;

  const override = Number(profile.dailyNormHours);
  if (profile.dailyNormHours != null && override > 0) return round1(override);

  const weeklyHours = Number(profile.weeklyHours ?? 37);
  const settings = org ?? DEFAULT_ORG_WORK_SETTINGS;
  if (settings.dailyNormHours != null && settings.dailyNormHours > 0) {
    const base =
      settings.defaultWeeklyHours > 0 ? settings.defaultWeeklyHours : 37;
    return round1(settings.dailyNormHours * (weeklyHours / base));
  }

  return round2(weeklyHours / workingDays.length);
}

/** Ugenorm = dagsnorm × antal arbejdsdage (1 decimal). */
export function calculateWeeklyNorm(
  profile: NormProfile,
  org?: OrgWorkSettings | null,
): number {
  const workingDays = profile.workingDays ?? DEFAULT_WORKING_DAYS;
  return round1(calculateDailyNorm(profile, org) * workingDays.length);
}

/** Pause i minutter: profil-override, ellers org'ens. */
export function resolveBreakMinutes(
  profile: { breakMinutes?: number | null } | null | undefined,
  org: OrgWorkSettings,
): number {
  const override = profile?.breakMinutes;
  if (override != null && override >= 0) return override;
  return Math.max(0, org.breakMinutesPerDay);
}

/** Grænse (timer) for hvornår en ubetalt pause trækkes fra — dansk praksis. */
export const UNPAID_BREAK_THRESHOLD_HOURS = 6;

/**
 * Ubetalt pause (`unpaid_excluded`): en dags samlede tilstedeværelse over
 * 6 t fratrækkes pausen. Returnerer netto-timer — aldrig negative, og aldrig
 * et fradrag på en dag ≤ 6 t. Ren funktion; kaldes ved check-ud og i
 * lønrapporten, aldrig på timeseddel-celler.
 */
export function applyUnpaidBreak(
  breakMinutes: number,
  totalHours: number,
): number {
  if (!(totalHours > 0)) return 0;
  if (!(breakMinutes > 0) || totalHours <= UNPAID_BREAK_THRESHOLD_HOURS) {
    return round2(totalHours);
  }
  return round2(Math.max(0, totalHours - breakMinutes / 60));
}

/** Timer fratrukket som ubetalt pause for en dags samlede tilstedeværelse. */
export function unpaidBreakDeduction(
  breakMinutes: number,
  totalHours: number,
): number {
  if (!(totalHours > 0)) return 0;
  return round2(totalHours - applyUnpaidBreak(breakMinutes, totalHours));
}

/**
 * Timer tastet i en fraværscelle → fraværsdage (#433). Grid'et kender kun
 * hele og halve dage: ≥ dagsnorm er en hel dag, alt derimellem er en halv
 * dag, 0 rydder cellen. Uden dagsnorm (ingen arbejdsdage) tæller enhver
 * positiv indtastning som en hel dag.
 */
export function hoursToAbsenceDays(
  hours: number,
  dailyNorm: number,
): { days: 0 | 0.5 | 1; halfDay: boolean } {
  if (!(hours > 0)) return { days: 0, halfDay: false };
  if (dailyNorm <= 0 || hours >= dailyNorm - 0.005) {
    return { days: 1, halfDay: false };
  }
  return { days: 0.5, halfDay: true };
}

export type AbsenceRowStatus = "pending" | "approved";

export type AbsenceRowCell = {
  hours: number;
  status: AbsenceRowStatus;
  requestId: string;
  /** Del af en flerdages periode — kan kun rettes under Fravær. */
  multiDay: boolean;
  /** Fast ferie (lukkeperiode, #436) — låst for medarbejderen. */
  closure: boolean;
};

export type AbsenceRow = {
  absenceTypeId: string;
  name: string;
  color: string;
  requiresApproval: boolean;
  days: Record<string, AbsenceRowCell>;
};

type AbsenceRowType = {
  id: string;
  name: string;
  color: string | null;
  requiresApproval: boolean;
  isDefault: boolean;
};

type AbsenceRowRequest = {
  id: string;
  absenceTypeId: string;
  startDate: string;
  endDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  status: string;
  /** "manual" | "timesheet" | "closure" (udeladt = manual) */
  source?: string | null;
};

/**
 * Hvilken dækkende anmodning må en fraværscelle skrive i (#457)? Kun
 * grid'ets egne 1-dags poster (source=timesheet) af samme type kan
 * overtages. Enhver anden aktiv anmodning på dagen (manuel, lukkeperiode,
 * anden type) er "fremmed" og skal afvises FØR update/insert, så cellen
 * aldrig overskriver en anmodning oprettet under Fravær.
 */
export function pickAbsenceCellRequest<
  T extends { absenceTypeId: string; source?: string | null },
>(
  covering: readonly T[],
  absenceTypeId: string,
): { existing: T | undefined; foreign: T | undefined } {
  const isTimesheet = (r: T) => (r.source ?? "manual") === "timesheet";
  return {
    existing: covering.find(
      (r) => isTimesheet(r) && r.absenceTypeId === absenceTypeId,
    ),
    foreign: covering.find(
      (r) => !isTimesheet(r) || r.absenceTypeId !== absenceTypeId,
    ),
  };
}

/**
 * Byg én grid-række pr. fraværstype (isDefault først, derefter navn) med
 * timer pr. dag: hel dag = dagens norm, halv dag = norm/2. Normen pr. dag
 * kommer fra `norms` (halveret på halvdags-helligdage, ansættelseshistorik)
 * så cellen viser det samme som setAbsenceCell regner med (#457);
 * `dailyNorm` er fallback for dage uden opslag. Fravær vises kun på
 * arbejdsdage (uden helligdag); flerdages perioder er read-only.
 * Afviste/annullerede anmodninger ignoreres.
 */
export function buildAbsenceRows(params: {
  types: AbsenceRowType[];
  requests: AbsenceRowRequest[];
  days: string[];
  dailyNorm: number;
  /** Fraværsuafhængig norm pr. dag (YYYY-MM-DD → timer). */
  norms?: Record<string, number>;
  workingDates: Set<string>;
}): AbsenceRow[] {
  const { types, requests, days, dailyNorm, norms, workingDates } = params;
  const sorted = [...types].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name, "da");
  });
  const rows = new Map<string, AbsenceRow>(
    sorted.map((t) => [
      t.id,
      {
        absenceTypeId: t.id,
        name: t.name,
        color: t.color ?? "#6b7280",
        requiresApproval: t.requiresApproval,
        days: {},
      },
    ]),
  );

  for (const req of requests) {
    if (req.status !== "pending" && req.status !== "approved") continue;
    const row = rows.get(req.absenceTypeId);
    if (!row) continue;
    const multiDay = req.startDate !== req.endDate;
    const closure = req.source === "closure";
    for (const dateStr of days) {
      if (dateStr < req.startDate || dateStr > req.endDate) continue;
      // Fravær vises aldrig på fridage/helligdage — heller ikke 1-dags
      // anmodninger (#452); setAbsenceCell afviser alligevel at oprette dem dér.
      if (!workingDates.has(dateStr)) continue;
      const isHalf =
        (dateStr === req.startDate && req.halfDayStart) ||
        (dateStr === req.endDate && req.halfDayEnd);
      const norm = norms?.[dateStr] ?? dailyNorm;
      row.days[dateStr] = {
        hours: round2(isHalf ? norm / 2 : norm),
        status: req.status,
        requestId: req.id,
        multiDay,
        closure,
      };
    }
  }

  return Array.from(rows.values());
}

/**
 * Afspadsering (#452): en godkendt anmodning af en type med
 * `deductsOvertime` trækker dage × dagsnorm fra overtidssaldoen. Returnerer
 * den negative overtime_ledger-post (hours som numeric-streng) — eller null
 * når der intet er at trække. ÉT beregningspunkt for approveRequest og
 * setAbsenceCell, så reverseApproved altid kan finde posten via
 * absenceRequestId.
 */
export function overtimeDeductionForAbsence(params: {
  days: number;
  dailyNorm: number;
  startDate: string;
  endDate: string;
}): { hours: string; note: string } | null {
  const { days, dailyNorm, startDate, endDate } = params;
  if (!(days > 0) || !(dailyNorm > 0)) return null;
  const hours = round2(days * dailyNorm);
  if (!(hours > 0)) return null;
  const period =
    startDate === endDate ? startDate : `${startDate} – ${endDate}`;
  return {
    hours: (-hours).toFixed(2),
    note: `Afspadsering ${period} (${days.toFixed(2).replace(".", ",")} dage)`,
  };
}

export type WeekCell = {
  projectId: string;
  /** Aktivitetstype (#459) — null for poster uden aktivitet */
  activityTypeId: string | null;
  dayOffset: number;
  hours: number;
};

/**
 * Aggregér en uges tidsposter til skabelon-/kopierings-celler pr.
 * (projekt, aktivitet, dag). Poster uden projekt ("Uden projekt"-rækken)
 * springes over; celler med 0 timer udelades. Kaldes med poster der
 * allerede er org-scopet (se `ownTimeEntriesInOrg`) — filtrerer ikke selv.
 */
export function cellsFromWeekEntries(
  entries: Array<{
    projectId: string | null;
    activityTypeId?: string | null;
    date: Date;
    hours: string | number | null;
  }>,
  weekStartDate: Date,
): WeekCell[] {
  const cells = new Map<string, WeekCell>();
  for (const e of entries) {
    if (!e.projectId) continue;
    const offset = Math.floor(
      (e.date.getTime() - weekStartDate.getTime()) / 86_400_000,
    );
    const activityTypeId = e.activityTypeId ?? null;
    const key = `${e.projectId}|${activityTypeId ?? ""}|${offset}`;
    const cell = cells.get(key) ?? {
      projectId: e.projectId,
      activityTypeId,
      dayOffset: offset,
      hours: 0,
    };
    cell.hours += Number(e.hours) || 0;
    cells.set(key, cell);
  }

  return Array.from(cells.values())
    .map((c) => ({ ...c, hours: round2(c.hours) }))
    .filter((c) => c.hours > 0);
}

/** Skabelon-celle som gemt i timesheet_templates.template_data. */
export type TemplateCell = {
  projectId: string;
  /** Mangler på skabeloner fra før #459 */
  activityTypeId?: string | null;
  /** 1 = mandag … 7 = søndag */
  dayOfWeek: number;
  hours: number;
};

/** Ugeceller → skabelondata. Aktiviteten følger med (#459/#475). */
export function templateDataFromCells(
  cells: readonly WeekCell[],
): TemplateCell[] {
  return cells.map((c) => ({
    projectId: c.projectId,
    activityTypeId: c.activityTypeId,
    dayOfWeek: c.dayOffset + 1,
    hours: c.hours,
  }));
}

/** Skabelondata → ugeceller. Skabeloner fra før #459 får activityTypeId null. */
export function cellsFromTemplateData(
  data: readonly TemplateCell[],
): WeekCell[] {
  return data.map((c) => ({
    projectId: c.projectId,
    activityTypeId: c.activityTypeId ?? null,
    dayOffset: c.dayOfWeek - 1,
    hours: c.hours,
  }));
}

/** Nøgle for optaget-tjek og konsolidering: (projekt, aktivitet, dag). */
export function weekCellKey(
  projectId: string | null,
  activityTypeId: string | null,
  dayOffset: number,
): string {
  return `${projectId ?? "none"}|${activityTypeId ?? ""}|${dayOffset}`;
}

/**
 * Planlæg udfyldning af en uge (kopiér uge / skabelon): hvilke celler
 * indsættes, og hvor mange springes over. Ren funktion så garantien
 * "aktiviteten bevares, optagede celler røres ikke" kan testes uden DB.
 *
 * - Celler med 0 timer eller uden for ugen ignoreres stille.
 * - Ukendt projekt, eller aktivitet der ikke længere er tilladt, springes over.
 * - Celler hvis (projekt, aktivitet, dag) allerede har timer, springes over.
 */
export function planWeekFill(params: {
  cells: readonly WeekCell[];
  occupied: ReadonlySet<string>;
  knownProjectIds: ReadonlySet<string>;
  isActivityAllowed: (projectId: string, activityTypeId: string) => boolean;
}): { toInsert: WeekCell[]; skipped: number } {
  const { cells, knownProjectIds, isActivityAllowed } = params;
  const occupied = new Set(params.occupied);
  const toInsert: WeekCell[] = [];
  let skipped = 0;
  for (const cell of cells) {
    if (cell.hours <= 0 || cell.dayOffset < 0 || cell.dayOffset > 6) continue;
    if (!knownProjectIds.has(cell.projectId)) {
      skipped++;
      continue;
    }
    if (
      cell.activityTypeId &&
      !isActivityAllowed(cell.projectId, cell.activityTypeId)
    ) {
      skipped++;
      continue;
    }
    const key = weekCellKey(
      cell.projectId,
      cell.activityTypeId,
      cell.dayOffset,
    );
    if (occupied.has(key)) {
      skipped++;
      continue;
    }
    occupied.add(key);
    toInsert.push({ ...cell, hours: round2(cell.hours) });
  }
  return { toInsert, skipped };
}

export type GridPos = { row: number; col: number };

/**
 * Tastaturnavigation i grid'et: pil op/ned (og Enter) flytter række;
 * pil venstre/højre flytter dag KUN når caret står i respektive kant,
 * så normal tekst-navigation i feltet bevares. Returnerer null = bliv.
 */
export function nextFocusCell(
  pos: GridPos,
  key: string,
  shape: { rowCount: number; colCount: number },
  caretAtStart = false,
  caretAtEnd = false,
): GridPos | null {
  switch (key) {
    case "ArrowDown":
    case "Enter":
      return pos.row < shape.rowCount - 1
        ? { row: pos.row + 1, col: pos.col }
        : null;
    case "ArrowUp":
      return pos.row > 0 ? { row: pos.row - 1, col: pos.col } : null;
    case "ArrowRight":
      if (!caretAtEnd) return null;
      return pos.col < shape.colCount - 1
        ? { row: pos.row, col: pos.col + 1 }
        : null;
    case "ArrowLeft":
      if (!caretAtStart) return null;
      return pos.col > 0 ? { row: pos.row, col: pos.col - 1 } : null;
    default:
      return null;
  }
}
