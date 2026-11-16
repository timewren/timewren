/**
 * Bygger rapport-datasættet (E4, #462) fra DB for én org, én periode og ét
 * scope. Timer aggregeres i SQL pr. (medarbejder, dag, projekt, aktivitet,
 * kilde, status) så der aldrig er en trunkering på aggregatet — kun
 * detaljerækker (loadTimeDetails) cappes.
 *
 * Normtid kommer ALTID fra calculateDailyNorm + loadOrgWorkSettings.
 */

import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { db as dbClient } from "@/lib/db";
import {
  absenceRequests,
  absenceTypes,
  activityTypes,
  checkIns,
  employeeProfiles,
  flexEntries,
  orgClosurePeriods,
  overtimeLedger,
  payrollMappingRules,
  payrollWageTypes,
  projects,
  timeEntries,
  vacationBalances,
} from "@/lib/db/schema";
import { toLocalDateStr } from "@/lib/format";
import { daysOffInRange, isPayrollHoliday } from "@/lib/holidays/danish";
import { loadDayOffLookupsForUsers, loadDaysOff } from "@/lib/holidays/load";
import { localizeDayOffName } from "@/lib/holidays/names";
import { copenhagenToday, toCopenhagenDateStr } from "@/lib/time/copenhagen";
import { copenhagenDateSql } from "@/lib/time/date-bounds";
import { effectiveEndDate } from "../absence-registration";
import { presenceByUserDay } from "../breaks";
import { loadEmploymentPeriods } from "../employment";
import type {
  DayCondition,
  MappingSource,
  WageTypeKind,
  WageTypeUnit,
} from "../payroll/mapping";
import { parseLocalDate, periodLengthDays } from "../period";
import { profileScopeCondition, type VisibleScope } from "../scope";
import { usersTimeEntriesInOrg } from "../time-entry-scope";
import {
  calculateDailyNorm,
  DEFAULT_WORKING_DAYS,
  resolveBreakMinutes,
  unpaidBreakDeduction,
} from "../timesheet";
import { vacationPeriodForYear } from "../vacation-period";
import { loadOrgWorkSettings } from "../work-settings";
import { vacationYearFor } from "./aggregate";
import type {
  AbsenceFact,
  AbsencePeriod,
  CalendarDay,
  DatasetEmployee,
  EnterpriseDataset,
  TimeFact,
} from "./types";

type Db = typeof dbClient;

/** Hård grænse for detaljerækker (aggregatet er aldrig cappet). */
export const MAX_DETAIL_ROWS = 20_000;

export type BuildDatasetParams = {
  orgId: string;
  from: string;
  to: string;
  scope: VisibleScope;
  /** Dags dato — åbne fraværsperioder tæller til og med denne (test-hook) */
  today?: string;
  /** Org'ens ferieår-start (#461): 1 = kalenderår, 9 = 1/9–31/8 */
  vacationYearStartMonth?: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = parseLocalDate(from);
  const end = parseLocalDate(to);
  while (cur <= end) {
    out.push(toLocalDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function isoDayOf(date: string): string {
  const d = parseLocalDate(date);
  return d.getDay() === 0 ? "7" : String(d.getDay());
}

/**
 * Udfold en fraværsanmodning til én fakta pr. arbejdsdag inden for
 * [from, to]. Ren funktion (testbar): hel dag = 1 (dagsnorm timer), halv
 * start/slut = 0,5, delvis (hoursPerDay) = timer/dagsnorm.
 */
export function expandAbsenceRequest(params: {
  request: {
    id: string;
    userId: string;
    absenceTypeId: string;
    startDate: string;
    endDate: string | null;
    halfDayStart: boolean;
    halfDayEnd: boolean;
    hoursPerDay: string | number | null;
    status: string;
    source: string;
  };
  type: {
    name: string;
    category: string;
    vacationPool: string;
    deductsVacation: boolean;
    deductsOvertime?: boolean;
  };
  employee: { dailyNorm: number; workingDays: string[] };
  fullDayHolidays: Set<string>;
  from: string;
  to: string;
  today: string;
}): AbsenceFact[] {
  const { request, type, employee, fullDayHolidays, from, to, today } = params;
  const effEnd = effectiveEndDate(request.startDate, request.endDate, today);
  const start = request.startDate > from ? request.startDate : from;
  const end = effEnd < to ? effEnd : to;
  if (start > end) return [];
  const partial = request.hoursPerDay != null ? Number(request.hoursPerDay) : 0;
  const out: AbsenceFact[] = [];
  for (const date of eachDay(start, end)) {
    if (!employee.workingDays.includes(isoDayOf(date))) continue;
    if (fullDayHolidays.has(date)) continue;
    let days = 1;
    let hours = employee.dailyNorm;
    if (partial > 0 && employee.dailyNorm > 0) {
      days = Math.min(1, partial / employee.dailyNorm);
      hours = Math.min(partial, employee.dailyNorm);
    } else if (
      (date === request.startDate && request.halfDayStart) ||
      (date === effEnd && request.halfDayEnd)
    ) {
      days = 0.5;
      hours = employee.dailyNorm / 2;
    }
    out.push({
      userId: request.userId,
      date,
      requestId: request.id,
      absenceTypeId: request.absenceTypeId,
      absenceTypeName: type.name,
      category: type.category,
      vacationPool: type.vacationPool,
      deductsVacation: type.deductsVacation,
      deductsOvertime: type.deductsOvertime ?? false,
      status: request.status,
      source: request.source,
      days: round2(days),
      hours: round2(hours),
      isOpen: !request.endDate,
    });
  }
  return out;
}

export async function buildEnterpriseDataset(
  db: Db,
  params: BuildDatasetParams,
): Promise<EnterpriseDataset> {
  const { orgId, from, to, scope } = params;
  const today = params.today ?? copenhagenToday();
  const fromDate = parseLocalDate(from);
  const toExclusive = parseLocalDate(to);
  toExclusive.setDate(toExclusive.getDate() + 1);

  const [
    profiles,
    orgSettings,
    holidayRows,
    closureRows,
    typeRows,
    activityRows,
    wageTypeRows,
    ruleRows,
  ] = await Promise.all([
    db.query.employeeProfiles.findMany({
      where: and(
        eq(employeeProfiles.organizationId, orgId),
        profileScopeCondition(scope),
      ),
      with: {
        user: { columns: { id: true, name: true, email: true } },
        department: { columns: { id: true, name: true } },
      },
      orderBy: [asc(employeeProfiles.createdAt)],
    }),
    loadOrgWorkSettings(db, orgId),
    // Org'ens fridagskalender (#526) — fælles kalender for rapporten
    loadDaysOff(db, {
      orgId,
      userId: null,
      departmentId: null,
      start: from,
      end: to,
    }),
    db.query.orgClosurePeriods.findMany({
      where: and(
        eq(orgClosurePeriods.organizationId, orgId),
        lte(orgClosurePeriods.startDate, to),
        gte(orgClosurePeriods.endDate, from),
      ),
      columns: { startDate: true, endDate: true },
    }),
    db.query.absenceTypes.findMany({
      where: eq(absenceTypes.organizationId, orgId),
      columns: {
        id: true,
        name: true,
        category: true,
        vacationPool: true,
        deductsVacation: true,
        deductsOvertime: true,
        payrollCode: true,
      },
    }),
    db.query.activityTypes.findMany({
      where: eq(activityTypes.organizationId, orgId),
      columns: { id: true, name: true, payrollCode: true },
    }),
    db.query.payrollWageTypes.findMany({
      where: eq(payrollWageTypes.organizationId, orgId),
      columns: {
        id: true,
        code: true,
        name: true,
        unit: true,
        kind: true,
        isArchived: true,
      },
    }),
    db.query.payrollMappingRules.findMany({
      where: eq(payrollMappingRules.organizationId, orgId),
      columns: {
        id: true,
        wageTypeId: true,
        source: true,
        activityTypeId: true,
        absenceTypeId: true,
        dayCondition: true,
        priority: true,
        isArchived: true,
      },
    }),
  ]);

  // Ansættelseshistorik (#465): ét batch-opslag, normen pr. periode
  // færdigberegnes her så aggregeringen forbliver ren
  const employmentByUser = await loadEmploymentPeriods(
    db,
    orgId,
    profiles.map((p) => p.userId),
  );
  const employees: DatasetEmployee[] = profiles.map((p) => ({
    userId: p.userId,
    profileId: p.id,
    name: p.user?.name ?? "Ukendt",
    email: p.user?.email ?? "",
    departmentId: p.departmentId,
    departmentName: p.department?.name ?? "",
    employmentType: p.employmentType,
    weeklyHours: Number(p.weeklyHours) || 0,
    dailyNorm: calculateDailyNorm(p, orgSettings),
    workingDays: p.workingDays ?? DEFAULT_WORKING_DAYS,
    isActive: p.isActive,
    startDate: p.startDate,
    endDate: p.endDate,
    employeeNumber: p.employeeNumber ?? "",
    externalPayrollId: p.externalPayrollId ?? "",
    employment: (employmentByUser.get(p.userId) ?? []).map((ep) => ({
      validFrom: ep.validFrom,
      validTo: ep.validTo,
      weeklyHours: Number(ep.weeklyHours) || 0,
      dailyNorm: calculateDailyNorm(ep, orgSettings),
      workingDays: ep.workingDays ?? DEFAULT_WORKING_DAYS,
      departmentId: ep.departmentId,
    })),
  }));
  const employeeByUser = new Map(employees.map((e) => [e.userId, e]));
  const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
  const userIds = employees.map((e) => e.userId);

  // Kalender
  const holidayByDate = new Map(holidayRows.map((h) => [h.date, h]));
  const closureDates = new Set<string>();
  for (const c of closureRows) {
    const s = c.startDate > from ? c.startDate : from;
    const e = c.endDate < to ? c.endDate : to;
    if (s <= e) for (const d of eachDay(s, e)) closureDates.add(d);
  }
  const calendar: CalendarDay[] = eachDay(from, to).map((date) => {
    const h = holidayByDate.get(date);
    return {
      date,
      isHoliday: !!h,
      isPayrollHoliday: isPayrollHoliday(h ?? null),
      isHalfHoliday: !!h?.isHalfDay,
      holidayName: h ? localizeDayOffName(h.name) : null,
      isClosure: closureDates.has(date),
    };
  });
  // Pr. medarbejder (#526): afdelingens/egen kalender kan afvige fra org'ens
  const dayOffLookups = await loadDayOffLookupsForUsers(
    db,
    orgId,
    profiles.map((p) => ({ userId: p.userId, departmentId: p.departmentId })),
  );
  const daysOffByUser: Record<string, Record<string, boolean>> = {};
  const payrollHolidaysByUser: Record<string, string[]> = {};
  const fullDayOffByUser = new Map<string, Set<string>>();
  for (const [userId, lookup] of dayOffLookups) {
    const map: Record<string, boolean> = {};
    const full = new Set<string>();
    const payroll: string[] = [];
    for (const d of daysOffInRange(lookup, from, to)) {
      map[d.date] = d.isHalfDay;
      if (!d.isHalfDay) full.add(d.date);
      if (isPayrollHoliday(d)) payroll.push(d.date);
    }
    daysOffByUser[userId] = map;
    payrollHolidaysByUser[userId] = payroll;
    fullDayOffByUser.set(userId, full);
  }
  const fullDayHolidays = new Set(
    holidayRows.filter((h) => !h.isHalfDay).map((h) => h.date),
  );

  const empty: EnterpriseDataset = {
    orgId,
    from,
    to,
    today,
    employees,
    calendar,
    daysOffByUser,
    payrollHolidaysByUser,
    time: [],
    absence: [],
    absencePeriods: [],
    flex: [],
    overtime: [],
    checkIns: [],
    vacationBalances: [],
    absenceTypes: typeRows.map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      payrollCode: t.payrollCode ?? "",
    })),
    activityTypes: activityRows.map((a) => ({
      id: a.id,
      name: a.name,
      payrollCode: a.payrollCode ?? "",
    })),
    breakPolicy: orgSettings.breakPolicy,
    payroll: {
      wageTypes: wageTypeRows.map((w) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        unit: w.unit as WageTypeUnit,
        kind: w.kind as WageTypeKind,
        isArchived: w.isArchived,
      })),
      rules: ruleRows.map((r) => ({
        id: r.id,
        wageTypeId: r.wageTypeId,
        source: r.source as MappingSource,
        activityTypeId: r.activityTypeId,
        absenceTypeId: r.absenceTypeId,
        dayCondition: r.dayCondition as DayCondition,
        priority: r.priority,
        isArchived: r.isArchived,
      })),
    },
  };
  if (userIds.length === 0) return empty;

  const vacationYearStartMonth = params.vacationYearStartMonth ?? 1;
  const firstVacationYear = vacationYearFor(from, vacationYearStartMonth);
  const lastVacationYear = vacationYearFor(to, vacationYearStartMonth);
  // Match på period_start, ikke year: efter skift af ferieår-start kan et
  // kalenderår og et 1/9-ferieår dele startår (#461) — kun perioder der
  // følger org'ens aktuelle indstilling tælles med.
  const vacationPeriodStarts: string[] = [];
  for (let y = firstVacationYear; y <= lastVacationYear; y++) {
    vacationPeriodStarts.push(
      vacationPeriodForYear(y, vacationYearStartMonth).start,
    );
  }

  const [
    timeRows,
    absenceRows,
    flexRows,
    overtimeRows,
    checkInRows,
    balanceRows,
  ] = await Promise.all([
    // Timer aggregeret i SQL — ingen cap
    db
      .select({
        userId: timeEntries.userId,
        day: sql<string>`to_char(${copenhagenDateSql(timeEntries.date)}, 'YYYY-MM-DD')`,
        projectId: timeEntries.projectId,
        projectName: projects.name,
        activityTypeId: timeEntries.activityTypeId,
        activityTypeName: activityTypes.name,
        payrollCode: activityTypes.payrollCode,
        source: timeEntries.source,
        approvalStatus: timeEntries.approvalStatus,
        hours: sql<string>`COALESCE(SUM(${timeEntries.hours}), 0)`,
      })
      .from(timeEntries)
      .leftJoin(projects, eq(timeEntries.projectId, projects.id))
      .leftJoin(activityTypes, eq(timeEntries.activityTypeId, activityTypes.id))
      .where(
        and(
          usersTimeEntriesInOrg(userIds, orgId),
          gte(timeEntries.date, fromDate),
          lt(timeEntries.date, toExclusive),
        ),
      )
      .groupBy(
        timeEntries.userId,
        copenhagenDateSql(timeEntries.date),
        timeEntries.projectId,
        projects.name,
        timeEntries.activityTypeId,
        activityTypes.name,
        activityTypes.payrollCode,
        timeEntries.source,
        timeEntries.approvalStatus,
      ),
    db.query.absenceRequests.findMany({
      where: and(
        eq(absenceRequests.organizationId, orgId),
        inArray(absenceRequests.userId, userIds),
        inArray(absenceRequests.status, ["approved", "pending"]),
        lte(absenceRequests.startDate, to),
        // Åben periode (endDate NULL, #460) tæller til og med i dag
        or(isNull(absenceRequests.endDate), gte(absenceRequests.endDate, from)),
      ),
      columns: {
        id: true,
        userId: true,
        absenceTypeId: true,
        startDate: true,
        endDate: true,
        halfDayStart: true,
        halfDayEnd: true,
        hoursPerDay: true,
        status: true,
        source: true,
      },
    }),
    db.query.flexEntries.findMany({
      where: and(
        eq(flexEntries.organizationId, orgId),
        inArray(flexEntries.userId, userIds),
        gte(flexEntries.date, from),
        lte(flexEntries.date, to),
      ),
      columns: {
        userId: true,
        date: true,
        expectedHours: true,
        actualHours: true,
        delta: true,
      },
    }),
    db.query.overtimeLedger.findMany({
      where: and(
        eq(overtimeLedger.organizationId, orgId),
        inArray(overtimeLedger.userId, userIds),
        gte(overtimeLedger.createdAt, fromDate),
        lt(overtimeLedger.createdAt, toExclusive),
      ),
      columns: {
        userId: true,
        type: true,
        hours: true,
        weekStart: true,
        createdAt: true,
      },
    }),
    db.query.checkIns.findMany({
      where: and(
        eq(checkIns.organizationId, orgId),
        inArray(checkIns.userId, userIds),
        gte(checkIns.checkedInAt, fromDate),
        lt(checkIns.checkedInAt, toExclusive),
        isNotNull(checkIns.checkedOutAt),
      ),
      columns: { userId: true, checkedInAt: true, checkedOutAt: true },
    }),
    db.query.vacationBalances.findMany({
      where: and(
        eq(vacationBalances.organizationId, orgId),
        inArray(vacationBalances.userId, userIds),
        inArray(vacationBalances.periodStart, vacationPeriodStarts),
      ),
    }),
  ]);

  const time: TimeFact[] = timeRows.map((r) => ({
    userId: r.userId,
    date: r.day,
    projectId: r.projectId,
    projectName: r.projectName ?? "",
    activityTypeId: r.activityTypeId,
    activityTypeName: r.activityTypeName ?? "",
    payrollCode: r.payrollCode ?? "",
    source: r.source ?? "manual",
    approvalStatus: r.approvalStatus ?? "not_required",
    hours: round2(Number(r.hours) || 0),
  }));

  const typeById = new Map(typeRows.map((t) => [t.id, t]));
  const absence: AbsenceFact[] = [];
  const absencePeriods: AbsencePeriod[] = [];
  for (const r of absenceRows) {
    const employee = employeeByUser.get(r.userId);
    const type = typeById.get(r.absenceTypeId);
    if (!employee || !type) continue;
    absence.push(
      ...expandAbsenceRequest({
        request: r,
        type,
        employee,
        fullDayHolidays: fullDayOffByUser.get(r.userId) ?? fullDayHolidays,
        from,
        to,
        today,
      }),
    );
    const effEnd = effectiveEndDate(r.startDate, r.endDate, today);
    absencePeriods.push({
      requestId: r.id,
      userId: r.userId,
      absenceTypeId: r.absenceTypeId,
      absenceTypeName: type.name,
      category: type.category,
      status: r.status,
      startDate: r.startDate,
      effectiveEndDate: effEnd,
      calendarDays: periodLengthDays(r.startDate, effEnd),
      isOpen: !r.endDate,
    });
  }

  // Check-ind: tilstedeværelse pr. bruger/dag + ubetalt pausefradrag (#449)
  const presence = presenceByUserDay(checkInRows);
  const checkInFacts = Array.from(presence.entries()).map(([key, hours]) => {
    const sep = key.indexOf("|");
    const userId = key.slice(0, sep);
    const date = key.slice(sep + 1);
    const breakDeducted =
      orgSettings.breakPolicy === "unpaid_excluded"
        ? unpaidBreakDeduction(
            resolveBreakMinutes(profileByUser.get(userId), orgSettings),
            hours,
          )
        : 0;
    return {
      userId,
      date,
      hours: round2(hours),
      breakDeductedHours: round2(breakDeducted),
    };
  });

  return {
    ...empty,
    time,
    absence,
    absencePeriods,
    flex: flexRows.map((f) => ({
      userId: f.userId,
      date: f.date,
      expectedHours: Number(f.expectedHours) || 0,
      actualHours: Number(f.actualHours) || 0,
      delta: Number(f.delta) || 0,
    })),
    overtime: overtimeRows.map((o) => ({
      // aldrig null her: forespørgslen filtrerer på userIds (#499, SET NULL)
      userId: o.userId as string,
      date: o.weekStart ?? toCopenhagenDateStr(o.createdAt),
      type: o.type,
      hours: Number(o.hours) || 0,
    })),
    checkIns: checkInFacts,
    vacationBalances: balanceRows.map((b) => ({
      userId: b.userId,
      year: b.year,
      totalDays: Number(b.totalDays) || 0,
      usedDays: Number(b.usedDays) || 0,
      remainingDays: Number(b.remainingDays) || 0,
      extraTotalDays: Number(b.extraTotalDays) || 0,
      extraUsedDays: Number(b.extraUsedDays) || 0,
      extraRemainingDays: Number(b.extraRemainingDays) || 0,
    })),
  };
}

export type TimeDetailRow = {
  name: string;
  email: string;
  department: string;
  date: string;
  hours: number;
  project: string;
  activity: string;
  payrollCode: string;
  description: string;
  source: string;
  approvalStatus: string;
};

/**
 * Detaljerækker (én pr. tidspost) — cappes ved MAX_DETAIL_ROWS og markerer
 * `truncated`. Aggregatet påvirkes ikke (det kommer fra datasættet).
 */
export async function loadTimeDetails(
  db: Db,
  params: {
    orgId: string;
    from: string;
    to: string;
    employees: DatasetEmployee[];
    includeRejected: boolean;
    onlyApproved: boolean;
    projectIds?: string[];
    activityTypeIds?: string[];
  },
): Promise<{ rows: TimeDetailRow[]; truncated: boolean }> {
  const userIds = params.employees.map((e) => e.userId);
  if (userIds.length === 0) return { rows: [], truncated: false };
  const fromDate = parseLocalDate(params.from);
  const toExclusive = parseLocalDate(params.to);
  toExclusive.setDate(toExclusive.getDate() + 1);

  const conditions = [
    usersTimeEntriesInOrg(userIds, params.orgId),
    gte(timeEntries.date, fromDate),
    lt(timeEntries.date, toExclusive),
  ];
  if (params.onlyApproved) {
    conditions.push(eq(timeEntries.approvalStatus, "approved"));
  } else if (!params.includeRejected) {
    conditions.push(sql`${timeEntries.approvalStatus} <> 'rejected'`);
  }
  if (params.projectIds && params.projectIds.length > 0) {
    conditions.push(inArray(timeEntries.projectId, params.projectIds));
  }
  if (params.activityTypeIds && params.activityTypeIds.length > 0) {
    conditions.push(
      inArray(timeEntries.activityTypeId, params.activityTypeIds),
    );
  }

  const rows = await db.query.timeEntries.findMany({
    where: and(...conditions),
    columns: {
      userId: true,
      date: true,
      hours: true,
      description: true,
      source: true,
      approvalStatus: true,
    },
    with: {
      project: { columns: { name: true } },
      activityType: { columns: { name: true, payrollCode: true } },
    },
    orderBy: [asc(timeEntries.date)],
    limit: MAX_DETAIL_ROWS + 1,
  });
  const truncated = rows.length > MAX_DETAIL_ROWS;
  const byUser = new Map(params.employees.map((e) => [e.userId, e]));
  return {
    truncated,
    rows: (truncated ? rows.slice(0, MAX_DETAIL_ROWS) : rows).map((e) => {
      const emp = byUser.get(e.userId);
      return {
        name: emp?.name ?? "Ukendt",
        email: emp?.email ?? "",
        department: emp?.departmentName ?? "",
        date: toCopenhagenDateStr(e.date),
        hours: Number(e.hours) || 0,
        project: e.project?.name ?? "",
        activity: e.activityType?.name ?? "",
        payrollCode: e.activityType?.payrollCode ?? "",
        description: e.description ?? "",
        source: e.source ?? "manual",
        approvalStatus: e.approvalStatus,
      };
    }),
  };
}
