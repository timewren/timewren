/**
 * Ren aggregering af rapport-datasættet (E4, #462): dimensioner × mål med
 * filtre. Ingen DB, ingen I/O — testes direkte.
 *
 * Hver fakta-type bidrager kun til de dimensioner den kender (fravær har
 * intet projekt, ferieregnskab ingen uge) — ukendte dimensioner bliver null
 * i nøglen, så rækker fra forskellige kilder aldrig blandes forkert sammen.
 * Aggregatet beregnes ALTID på hele datasættet (aldrig på trunkerede
 * detaljerækker — det var bug'en i den gamle lønrapport).
 */

import { resolveEmploymentAt } from "../employment";
import { mapFactsToWageLines, wageTypeLabel } from "../payroll/mapping";
import { vacationPeriodForYear, vacationYearOf } from "../vacation-period";
import { isoWeekNumber, isoWeekYear } from "../week";
import type { ReportDimension, ReportFilters } from "./config";
import type {
  AbsenceFact,
  AbsencePeriod,
  DatasetEmployee,
  EnterpriseDataset,
} from "./types";

export const LONG_TERM_SICK_DAYS = 30;

export const NO_DEPARTMENT_LABEL = "(uden afdeling)";
export const NO_PROJECT_LABEL = "(uden projekt)";
export const NO_ACTIVITY_LABEL = "(uden aktivitet)";

export type AggregateOptions = {
  dimensions: ReportDimension[];
  filters: ReportFilters;
  /** 1 = kalenderår (default); 9 = ferieår 1/9–31/8 */
  vacationYearStartMonth?: number;
  /** Grænse for langtidssygdom i kalenderdage (default 30) */
  longTermSickDays?: number;
};

export type CellValue = number | string | boolean | null;

export type AggregatedRow = {
  /** Dimensionsnøgler (id'er) — null når dimensionen ikke gælder rækken */
  keys: Partial<Record<ReportDimension, string | null>>;
  /** Visningsværdier for dimensionerne */
  labels: Partial<Record<ReportDimension, string>>;
  /** Medarbejder-/aktivitetsattributter når rækken er entydig */
  attributes: {
    email: string;
    employmentType: string;
    weeklyHours: number | null;
    dailyNorm: number | null;
    employeeNumber: string;
    payrollCode: string;
  };
  values: Record<string, CellValue>;
  pivots: {
    hoursByActivity: Record<string, number>;
    absenceDaysByType: Record<string, number>;
    absenceHoursByType: Record<string, number>;
    /** Antal pr. lønart (E5) — label "0100 Normaltimer (timer)" */
    quantityByWageType: Record<string, number>;
  };
};

export type AggregateResult = {
  rows: AggregatedRow[];
  totals: AggregatedRow;
  /** Navne til pivot-kolonner (sorteret, "(uden …)" sidst) */
  pivotNames: {
    activities: string[];
    absenceTypes: string[];
    wageTypes: string[];
  };
  employeeCount: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Ferieår for en dato: startåret (kalenderår når startMonth = 1). Samme helper som vacation.ts (#461). */
export function vacationYearFor(date: string, startMonth = 1): number {
  return vacationYearOf(date, startMonth);
}

export function vacationYearLabel(startYear: number, startMonth = 1): string {
  if (startMonth <= 1) return String(startYear);
  return `${startYear}/${String(startYear + 1).slice(2)}`;
}

/** Fra/til for et ferieår (startår). */
export function vacationYearRange(
  startYear: number,
  startMonth = 1,
): { from: string; to: string } {
  const period = vacationPeriodForYear(startYear, startMonth);
  return { from: period.start, to: period.end };
}

export function isoWeekKey(date: string): string {
  const d = parseDate(date);
  return `${isoWeekYear(d)}-W${String(isoWeekNumber(d)).padStart(2, "0")}`;
}

type TimeKeys = {
  day: string;
  week: string;
  month: string;
  vacationYear: string;
};

function timeKeysFor(date: string, startMonth: number): TimeKeys {
  return {
    day: date,
    week: isoWeekKey(date),
    month: date.slice(0, 7),
    vacationYear: String(vacationYearFor(date, startMonth)),
  };
}

type Accumulator = {
  keys: Partial<Record<ReportDimension, string | null>>;
  labels: Partial<Record<ReportDimension, string>>;
  employees: Set<string>;
  payrollCodes: Set<string>;
  hours: number;
  normHours: number;
  workDays: number;
  flexDelta: number;
  breakDeductedHours: number;
  checkInHours: number;
  absenceDays: number;
  absenceHours: number;
  absencePeriodIds: Set<string>;
  sickDays: number;
  sickHours: number;
  sickPeriodIds: Set<string>;
  longTermSickUsers: Set<string>;
  overtimeEarned: number;
  overtimeUsed: number;
  overtimePaidOut: number;
  vacationAllotted: number;
  vacationUsed: number;
  vacationRemaining: number;
  extraVacationAllotted: number;
  extraVacationUsed: number;
  extraVacationRemaining: number;
  vacationDaysInPeriod: number;
  hoursByActivity: Record<string, number>;
  absenceDaysByType: Record<string, number>;
  absenceHoursByType: Record<string, number>;
  quantityByWageType: Record<string, number>;
  // Compliance (E11, #469): timer pr. medarbejder-dag/-uge i gruppen
  dayHours: Map<string, number>;
  weekHours: Map<string, number>;
  weekDays: Map<string, Set<string>>;
  /** medarbejder|uge med mindst én hel fraværsdag (= hvile) */
  absenceUserWeeks: Set<string>;
  /**
   * medarbejder|uge → andel af ugens arbejdsdage med godkendt fravær, der er
   * neutralt i 48 t-gennemsnittet (§ 4, #728 — alt undtagen afspadsering)
   */
  neutralWeekShare: Map<string, number>;
};

function newAccumulator(
  keys: Partial<Record<ReportDimension, string | null>>,
  labels: Partial<Record<ReportDimension, string>>,
): Accumulator {
  return {
    keys,
    labels,
    employees: new Set(),
    payrollCodes: new Set(),
    hours: 0,
    normHours: 0,
    workDays: 0,
    flexDelta: 0,
    breakDeductedHours: 0,
    checkInHours: 0,
    absenceDays: 0,
    absenceHours: 0,
    absencePeriodIds: new Set(),
    sickDays: 0,
    sickHours: 0,
    sickPeriodIds: new Set(),
    longTermSickUsers: new Set(),
    overtimeEarned: 0,
    overtimeUsed: 0,
    overtimePaidOut: 0,
    vacationAllotted: 0,
    vacationUsed: 0,
    vacationRemaining: 0,
    extraVacationAllotted: 0,
    extraVacationUsed: 0,
    extraVacationRemaining: 0,
    vacationDaysInPeriod: 0,
    hoursByActivity: {},
    absenceDaysByType: {},
    absenceHoursByType: {},
    quantityByWageType: {},
    dayHours: new Map(),
    weekHours: new Map(),
    weekDays: new Map(),
    absenceUserWeeks: new Set(),
    neutralWeekShare: new Map(),
  };
}

/** Hvilke medarbejdere passerer rapportens medarbejder-/afdelingsfiltre? */
/**
 * Dagsnorm og arbejdsdage for en medarbejder på en dato (#465): den
 * ansættelsesperiode der dækker datoen; uden historik profilens nuværende
 * værdier; null = ikke ansat på datoen.
 */
export function employmentNormOn(
  e: Pick<DatasetEmployee, "employment" | "dailyNorm" | "workingDays">,
  date: string,
): { dailyNorm: number; workingDays: string[] } | null {
  if (e.employment.length === 0) {
    return { dailyNorm: e.dailyNorm, workingDays: e.workingDays };
  }
  const period = resolveEmploymentAt(e.employment, date);
  return period
    ? { dailyNorm: period.dailyNorm, workingDays: period.workingDays }
    : null;
}

export function filterEmployees(
  employees: DatasetEmployee[],
  filters: ReportFilters,
): DatasetEmployee[] {
  const depts = new Set(filters.departmentIds);
  const users = new Set(filters.userIds);
  return employees.filter((e) => {
    if (!filters.includeInactive && !e.isActive) return false;
    if (depts.size > 0 && (!e.departmentId || !depts.has(e.departmentId))) {
      return false;
    }
    if (users.size > 0 && !users.has(e.userId)) return false;
    return true;
  });
}

export function timeFactPasses(
  fact: {
    approvalStatus: string;
    projectId: string | null;
    activityTypeId: string | null;
  },
  filters: ReportFilters,
): boolean {
  if (fact.approvalStatus === "rejected" && !filters.includeRejected) {
    return false;
  }
  if (filters.onlyApproved && fact.approvalStatus !== "approved") return false;
  if (
    filters.projectIds.length > 0 &&
    (!fact.projectId || !filters.projectIds.includes(fact.projectId))
  ) {
    return false;
  }
  if (
    filters.activityTypeIds.length > 0 &&
    (!fact.activityTypeId ||
      !filters.activityTypeIds.includes(fact.activityTypeId))
  ) {
    return false;
  }
  return true;
}

export function absenceFactPasses(
  fact: Pick<
    AbsenceFact | AbsencePeriod,
    "absenceTypeId" | "category" | "status"
  >,
  filters: ReportFilters,
): boolean {
  if (
    !filters.absenceStatuses.includes(fact.status as "approved" | "pending")
  ) {
    return false;
  }
  if (
    filters.absenceTypeIds.length > 0 &&
    !filters.absenceTypeIds.includes(fact.absenceTypeId)
  ) {
    return false;
  }
  if (
    filters.absenceCategories.length > 0 &&
    !filters.absenceCategories.includes(
      fact.category as ReportFilters["absenceCategories"][number],
    )
  ) {
    return false;
  }
  return true;
}

function sortLabel(a: string, b: string): number {
  return a.localeCompare(b, "da");
}

function sortPivotNames(names: Iterable<string>): string[] {
  return Array.from(names).sort((a, b) => {
    const aNone = a.startsWith("(uden");
    const bNone = b.startsWith("(uden");
    if (aNone !== bNone) return aNone ? 1 : -1;
    return sortLabel(a, b);
  });
}

export function aggregateDataset(
  dataset: EnterpriseDataset,
  options: AggregateOptions,
): AggregateResult {
  const dims = options.dimensions;
  const startMonth = options.vacationYearStartMonth ?? 1;
  const longTermDays = options.longTermSickDays ?? LONG_TERM_SICK_DAYS;
  const filters = options.filters;

  const employees = filterEmployees(dataset.employees, filters);
  const employeeByUser = new Map(employees.map((e) => [e.userId, e]));
  // 48 t-neutralitet (#728): arbejdsdage (uden helligdage) pr. medarbejder-
  // uge og dage med registreret arbejde — en arbejdet dag er ikke neutral
  const workDaysPerUserWeek = new Map<string, number>();
  const workedUserDays = new Set(
    dataset.time.filter((t) => t.hours > 0).map((t) => `${t.userId}|${t.date}`),
  );

  const buckets = new Map<string, Accumulator>();
  const totals = newAccumulator({}, {});
  const activityNames = new Set<string>();
  const absenceTypeNames = new Set<string>();
  const wageTypeNames = new Set<string>();

  type PartialKeys = Partial<Record<ReportDimension, string | null>>;
  type PartialLabels = Partial<Record<ReportDimension, string>>;

  /** Find/opret bucket for en fakta med de dimensionsværdier den kender. */
  function bucketFor(
    available: PartialKeys,
    labels: PartialLabels,
  ): Accumulator {
    const keys: PartialKeys = {};
    const lbl: PartialLabels = {};
    const parts: string[] = [];
    for (const dim of dims) {
      const v = available[dim] ?? null;
      keys[dim] = v;
      lbl[dim] = labels[dim] ?? "";
      parts.push(v ?? " ");
    }
    const id = parts.join("|");
    let acc = buckets.get(id);
    if (!acc) {
      acc = newAccumulator(keys, lbl);
      buckets.set(id, acc);
    }
    return acc;
  }

  function employeeKeys(e: DatasetEmployee): {
    keys: PartialKeys;
    labels: PartialLabels;
  } {
    return {
      keys: { employee: e.userId, department: e.departmentId ?? "" },
      labels: {
        employee: e.name,
        department: e.departmentName || NO_DEPARTMENT_LABEL,
      },
    };
  }

  function withTime(
    base: { keys: PartialKeys; labels: PartialLabels },
    date: string,
  ): { keys: PartialKeys; labels: PartialLabels } {
    const t = timeKeysFor(date, startMonth);
    return {
      keys: { ...base.keys, ...t },
      labels: {
        ...base.labels,
        day: t.day,
        week: t.week,
        month: t.month,
        vacationYear: vacationYearLabel(Number(t.vacationYear), startMonth),
      },
    };
  }

  function apply(
    target: { keys: PartialKeys; labels: PartialLabels },
    userId: string,
    fn: (acc: Accumulator) => void,
  ) {
    const acc = bucketFor(target.keys, target.labels);
    acc.employees.add(userId);
    totals.employees.add(userId);
    fn(acc);
    fn(totals);
  }

  // 1) Medarbejder × dag — normtid og arbejdsdage (uden helligdage; halv
  //    helligdag = halv norm, samme regel som recalculateFlexDay)
  for (const e of employees) {
    const base = employeeKeys(e);
    for (const day of dataset.calendar) {
      if (e.startDate && day.date < e.startDate) continue;
      if (e.endDate && day.date > e.endDate) continue;
      // Ansættelseshistorik (#465): norm/arbejdsdage som de gjaldt på dagen;
      // uden dækkende periode (fratrådt, hul) tæller dagen ikke
      const norm = employmentNormOn(e, day.date);
      if (!norm) continue;
      const d = parseDate(day.date);
      const isoDay = d.getDay() === 0 ? "7" : String(d.getDay());
      if (!norm.workingDays.includes(isoDay)) continue;
      // Medarbejderens egen fridagskalender (#526) vinder over den fælles
      const own = dataset.daysOffByUser?.[e.userId];
      const halfOff = own ? own[day.date] === true : day.isHalfHoliday;
      const fullOff = own
        ? own[day.date] === false
        : day.isHoliday && !day.isHalfHoliday;
      if (fullOff) continue;
      const workWeekKey = `${e.userId}|${isoWeekKey(day.date)}`;
      workDaysPerUserWeek.set(
        workWeekKey,
        (workDaysPerUserWeek.get(workWeekKey) ?? 0) + 1,
      );
      const factor = halfOff ? 0.5 : 1;
      apply(withTime(base, day.date), e.userId, (acc) => {
        acc.workDays += factor;
        acc.normHours += norm.dailyNorm * factor;
      });
    }
  }

  // 2) Timer
  for (const f of dataset.time) {
    const e = employeeByUser.get(f.userId);
    if (!e) continue;
    if (!timeFactPasses(f, filters)) continue;
    const activityLabel = f.activityTypeId
      ? f.activityTypeName
      : NO_ACTIVITY_LABEL;
    if (f.activityTypeId) activityNames.add(activityLabel);
    const base = employeeKeys(e);
    const target = withTime(
      {
        keys: {
          ...base.keys,
          project: f.projectId ?? "",
          activityType: f.activityTypeId ?? "",
        },
        labels: {
          ...base.labels,
          project: f.projectId ? f.projectName : NO_PROJECT_LABEL,
          activityType: activityLabel,
        },
      },
      f.date,
    );
    const dayKey = `${f.userId}|${f.date}`;
    const weekKey = `${f.userId}|${isoWeekKey(f.date)}`;
    apply(target, f.userId, (acc) => {
      acc.hours += f.hours;
      acc.hoursByActivity[activityLabel] =
        (acc.hoursByActivity[activityLabel] ?? 0) + f.hours;
      if (f.payrollCode) acc.payrollCodes.add(f.payrollCode);
      if (f.hours > 0) {
        acc.dayHours.set(dayKey, (acc.dayHours.get(dayKey) ?? 0) + f.hours);
        acc.weekHours.set(weekKey, (acc.weekHours.get(weekKey) ?? 0) + f.hours);
        let days = acc.weekDays.get(weekKey);
        if (!days) {
          days = new Set();
          acc.weekDays.set(weekKey, days);
        }
        days.add(f.date);
      }
    });
  }
  // "(uden aktivitet)" som pivot-kolonne kun når org'en bruger aktiviteter
  if (
    activityNames.size > 0 &&
    (totals.hoursByActivity[NO_ACTIVITY_LABEL] ?? 0) > 0
  ) {
    activityNames.add(NO_ACTIVITY_LABEL);
  }

  // 3) Fravær pr. dag
  for (const f of dataset.absence) {
    const e = employeeByUser.get(f.userId);
    if (!e) continue;
    if (!absenceFactPasses(f, filters)) continue;
    if (f.date < dataset.from || f.date > dataset.to) continue;
    absenceTypeNames.add(f.absenceTypeName);
    const base = employeeKeys(e);
    const target = withTime(
      {
        keys: { ...base.keys, absenceType: f.absenceTypeId },
        labels: { ...base.labels, absenceType: f.absenceTypeName },
      },
      f.date,
    );
    const sick = f.category === "sickness";
    const absenceWeekKey = `${f.userId}|${isoWeekKey(f.date)}`;
    apply(target, f.userId, (acc) => {
      // Hel fraværsdag = hviledøgn i ugen (24 t ugehvile) og en uge i
      // 48 t-nævneren
      if (f.days >= 1) acc.absenceUserWeeks.add(absenceWeekKey);
      // Neutralt fravær (§ 4) tages ud af 48 t-nævneren — forholdsmæssigt
      if (
        f.status === "approved" &&
        !f.deductsOvertime &&
        !workedUserDays.has(`${f.userId}|${f.date}`)
      ) {
        const share =
          f.days /
          (workDaysPerUserWeek.get(absenceWeekKey) ||
            e.workingDays.length ||
            5);
        acc.neutralWeekShare.set(
          absenceWeekKey,
          (acc.neutralWeekShare.get(absenceWeekKey) ?? 0) + share,
        );
      }
      acc.absenceDays += f.days;
      acc.absenceHours += f.hours;
      acc.absencePeriodIds.add(f.requestId);
      acc.absenceDaysByType[f.absenceTypeName] =
        (acc.absenceDaysByType[f.absenceTypeName] ?? 0) + f.days;
      acc.absenceHoursByType[f.absenceTypeName] =
        (acc.absenceHoursByType[f.absenceTypeName] ?? 0) + f.hours;
      if (sick) {
        acc.sickDays += f.days;
        acc.sickHours += f.hours;
        acc.sickPeriodIds.add(f.requestId);
      }
      if (f.deductsVacation && f.vacationPool === "vacation") {
        acc.vacationDaysInPeriod += f.days;
      }
    });
  }

  // 4) Fraværsperioder — langtidssygdom (sammenhængende > 30 dage)
  for (const p of dataset.absencePeriods) {
    const e = employeeByUser.get(p.userId);
    if (!e) continue;
    if (!absenceFactPasses(p, filters)) continue;
    if (p.category !== "sickness") continue;
    if (p.calendarDays <= longTermDays) continue;
    // Perioden hører til bucket'en for sin første dag inden for rapportperioden
    const anchor = p.startDate < dataset.from ? dataset.from : p.startDate;
    if (anchor > dataset.to) continue;
    const base = employeeKeys(e);
    const target = withTime(
      {
        keys: { ...base.keys, absenceType: p.absenceTypeId },
        labels: { ...base.labels, absenceType: p.absenceTypeName },
      },
      anchor,
    );
    apply(target, p.userId, (acc) => {
      acc.longTermSickUsers.add(p.userId);
      acc.sickPeriodIds.add(p.requestId);
      acc.absencePeriodIds.add(p.requestId);
    });
  }

  // 5) Flex
  for (const f of dataset.flex) {
    const e = employeeByUser.get(f.userId);
    if (!e) continue;
    apply(withTime(employeeKeys(e), f.date), f.userId, (acc) => {
      acc.flexDelta += f.delta;
    });
  }

  // 6) Overtid
  for (const f of dataset.overtime) {
    const e = employeeByUser.get(f.userId);
    if (!e) continue;
    apply(withTime(employeeKeys(e), f.date), f.userId, (acc) => {
      if (f.type === "earned") acc.overtimeEarned += f.hours;
      else if (f.type === "used") acc.overtimeUsed += Math.abs(f.hours);
      else if (f.type === "paid_out") acc.overtimePaidOut += Math.abs(f.hours);
    });
  }

  // 7) Check-ind
  for (const f of dataset.checkIns) {
    const e = employeeByUser.get(f.userId);
    if (!e) continue;
    apply(withTime(employeeKeys(e), f.date), f.userId, (acc) => {
      acc.checkInHours += f.hours;
      acc.breakDeductedHours += f.breakDeductedHours;
    });
  }

  // 8) Ferieregnskab (pr. ferieår — ingen dag/uge/måned)
  for (const b of dataset.vacationBalances) {
    const e = employeeByUser.get(b.userId);
    if (!e) continue;
    const base = employeeKeys(e);
    const target = {
      keys: { ...base.keys, vacationYear: String(b.year) },
      labels: {
        ...base.labels,
        vacationYear: vacationYearLabel(b.year, startMonth),
      },
    };
    apply(target, b.userId, (acc) => {
      acc.vacationAllotted += b.totalDays;
      acc.vacationUsed += b.usedDays;
      acc.vacationRemaining += b.remainingDays;
      acc.extraVacationAllotted += b.extraTotalDays;
      acc.extraVacationUsed += b.extraUsedDays;
      acc.extraVacationRemaining += b.extraRemainingDays;
    });
  }

  // 9) Lønarter (E5) — samme filtrerede fakta som ovenfor gennem
  //    mapping-motoren; linjer bucketes på de dimensioner kilden kender.
  const passedTime = dataset.time.filter(
    (f) => employeeByUser.has(f.userId) && timeFactPasses(f, filters),
  );
  const passedAbsence = dataset.absence.filter(
    (f) =>
      employeeByUser.has(f.userId) &&
      absenceFactPasses(f, filters) &&
      f.date >= dataset.from &&
      f.date <= dataset.to,
  );
  const inScope = <T extends { userId: string }>(xs: T[]) =>
    xs.filter((x) => employeeByUser.has(x.userId));
  const mapped = mapFactsToWageLines({
    config: dataset.payroll,
    calendar: dataset.calendar,
    time: passedTime,
    absence: passedAbsence,
    overtime: inScope(dataset.overtime),
    flex: inScope(dataset.flex),
    checkIns: inScope(dataset.checkIns),
    absenceTypes: dataset.absenceTypes,
  });
  for (const l of mapped.lines) {
    const e = employeeByUser.get(l.userId);
    if (!e) continue;
    const label = wageTypeLabel(l);
    wageTypeNames.add(label);
    const base = employeeKeys(e);
    const keys: PartialKeys = { ...base.keys };
    const labels: PartialLabels = { ...base.labels };
    if (l.source === "activity") {
      keys.project = l.projectId ?? "";
      keys.activityType = l.activityTypeId ?? "";
      labels.project = l.projectId ? l.projectName : NO_PROJECT_LABEL;
      labels.activityType = l.activityTypeId
        ? l.activityTypeName
        : NO_ACTIVITY_LABEL;
    } else if (l.source === "absence") {
      keys.absenceType = l.absenceTypeId;
      labels.absenceType = l.absenceTypeName;
    }
    apply(withTime({ keys, labels }, l.date), l.userId, (acc) => {
      acc.quantityByWageType[label] =
        (acc.quantityByWageType[label] ?? 0) + l.quantity;
    });
  }

  const activityList = sortPivotNames(activityNames);
  const absenceTypeList = sortPivotNames(absenceTypeNames);
  const wageTypeList = sortPivotNames(wageTypeNames);

  function finalize(acc: Accumulator): AggregatedRow {
    const single =
      acc.employees.size === 1
        ? employeeByUser.get(Array.from(acc.employees)[0])
        : undefined;
    const sickPct =
      acc.workDays > 0
        ? Math.round((acc.sickDays / acc.workDays) * 1000) / 10
        : null;
    const pivot = (src: Record<string, number>) =>
      Object.fromEntries(Object.entries(src).map(([k, v]) => [k, round2(v)]));
    // Compliance (E11, #469)
    let maxDayHours = 0;
    let longDays = 0;
    for (const h of acc.dayHours.values()) {
      if (h > maxDayHours) maxDayHours = h;
      if (h > 13 + 0.005) longDays += 1;
    }
    let weeksOver48h = 0;
    let fullWeeks = 0;
    for (const [key, h] of acc.weekHours) {
      if (h > 48 + 0.005) weeksOver48h += 1;
      if (
        (acc.weekDays.get(key)?.size ?? 0) >= 7 &&
        !acc.absenceUserWeeks.has(key)
      ) {
        fullWeeks += 1;
      }
    }
    // 48 t-nævneren: neutralt fravær (ferie, sygdom m.m.) indgår hverken i
    // timer eller uger (arbejdstidslovens § 4, 2. pkt., #728). En uge tæller
    // dog mindst med de dage, der faktisk er arbejdet.
    let userWeeks = 0;
    for (const key of new Set([
      ...acc.weekHours.keys(),
      ...acc.absenceUserWeeks,
    ])) {
      const neutral = Math.min(1, acc.neutralWeekShare.get(key) ?? 0);
      const worked = (acc.weekDays.get(key)?.size ?? 0) / 7;
      userWeeks += Math.max(1 - neutral, worked);
    }
    const avgWeeklyHours =
      userWeeks > 0.005 ? round2(acc.hours / userWeeks) : null;
    return {
      keys: acc.keys,
      labels: acc.labels,
      attributes: {
        email: single?.email ?? "",
        employmentType: single?.employmentType ?? "",
        weeklyHours: single?.weeklyHours ?? null,
        dailyNorm: single?.dailyNorm ?? null,
        employeeNumber: single?.employeeNumber ?? "",
        payrollCode:
          acc.payrollCodes.size === 1 ? Array.from(acc.payrollCodes)[0] : "",
      },
      values: {
        hours: round2(acc.hours),
        normHours: round2(acc.normHours),
        workDays: round2(acc.workDays),
        employeeCount: acc.employees.size,
        flexDelta: round2(acc.flexDelta),
        breakDeductedHours: round2(acc.breakDeductedHours),
        checkInHours: round2(acc.checkInHours),
        workedDays: acc.dayHours.size,
        maxDayHours: round2(maxDayHours),
        longDays,
        avgWeeklyHours,
        weeksOver48h,
        fullWeeks,
        absenceDays: round2(acc.absenceDays),
        absenceHours: round2(acc.absenceHours),
        absencePeriods: acc.absencePeriodIds.size,
        sickDays: round2(acc.sickDays),
        sickHours: round2(acc.sickHours),
        sickPeriods: acc.sickPeriodIds.size,
        sickPct,
        longTermSick: acc.longTermSickUsers.size > 0,
        longTermSickCount: acc.longTermSickUsers.size,
        overtimeEarned: round2(acc.overtimeEarned),
        overtimeUsed: round2(acc.overtimeUsed),
        overtimePaidOut: round2(acc.overtimePaidOut),
        overtimeNet: round2(
          acc.overtimeEarned - acc.overtimeUsed - acc.overtimePaidOut,
        ),
        vacationAllotted: round2(acc.vacationAllotted),
        vacationUsed: round2(acc.vacationUsed),
        vacationRemaining: round2(acc.vacationRemaining),
        extraVacationAllotted: round2(acc.extraVacationAllotted),
        extraVacationUsed: round2(acc.extraVacationUsed),
        extraVacationRemaining: round2(acc.extraVacationRemaining),
        vacationDaysInPeriod: round2(acc.vacationDaysInPeriod),
      },
      pivots: {
        hoursByActivity: pivot(acc.hoursByActivity),
        absenceDaysByType: pivot(acc.absenceDaysByType),
        absenceHoursByType: pivot(acc.absenceHoursByType),
        quantityByWageType: pivot(acc.quantityByWageType),
      },
    };
  }

  const rows = Array.from(buckets.values())
    .map(finalize)
    .sort((a, b) => {
      for (const dim of dims) {
        const ka = a.keys[dim] ?? "";
        const kb = b.keys[dim] ?? "";
        const la = a.labels[dim] ?? "";
        const lb = b.labels[dim] ?? "";
        // Tidsdimensioner sorteres på nøglen (kronologisk), resten på label
        const timeDim =
          dim === "day" ||
          dim === "week" ||
          dim === "month" ||
          dim === "vacationYear";
        const cmp = timeDim
          ? ka.localeCompare(kb)
          : la.startsWith("(uden") !== lb.startsWith("(uden")
            ? la.startsWith("(uden")
              ? 1
              : -1
            : sortLabel(la, lb);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });

  return {
    rows,
    totals: finalize(totals),
    pivotNames: {
      activities: activityList,
      absenceTypes: absenceTypeList,
      wageTypes: wageTypeList,
    },
    employeeCount: employees.length,
  };
}
