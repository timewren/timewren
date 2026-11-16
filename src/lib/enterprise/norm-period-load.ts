// DB-lag for normperiode og flexsaldo (#507). Beregningen er ren og ligger i
// ./norm-period. Her hentes ansættelseshistorik, arbejdsplan (#510),
// fridagskalender (#526), godkendt fravær, afvigelser, tidsposter og optjent
// overtid — et fast antal forespørgsler uanset antal medarbejdere.

import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { loadDayOffLookupsForUsers } from "@/lib/holidays/load";
import {
  addDaysToDateStr,
  copenhagenDayEndExclusive,
  copenhagenDayStart,
  copenhagenToday,
} from "@/lib/time/copenhagen";
import { copenhagenDateSql } from "@/lib/time/date-bounds";
import { absenceCoversDate } from "./absence-registration";
import { loadEmploymentPeriods, normProfileAt } from "./employment";
import {
  type AbsenceKind,
  balanceStart,
  buildPeriodBalances,
  computeNormDay,
  countWorkdays,
  DEFAULT_FLEX_NORM_SETTINGS,
  type FlexNormSettings,
  isNormPeriod,
  isNormYearStart,
  type NormDay,
  type NormTotals,
  normPeriodBounds,
  type PeriodBalance,
  sumNormDays,
} from "./norm-period";
import { calculateDailyNorm, DEFAULT_WORKING_DAYS } from "./timesheet";
import { dateRange } from "./work-plan";
import {
  loadDeviations,
  loadPlanLookups,
  type PlanMember,
} from "./work-plan-load";
import { loadOrgWorkSettings } from "./work-settings";

type Db = PostgresJsDatabase<typeof schema>;

type FlexNormRow = Pick<
  typeof schema.organizations.$inferSelect,
  | "flexNormPeriod"
  | "flexNormYearStart"
  | "flexNormAnnualHours"
  | "flexCarryoverMaxHours"
  | "flexCarryoverMaxDeficitHours"
  | "flexNormStartDate"
>;

function positiveOrNull(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Org-rækken → rene indstillinger (ukendte værdier falder tilbage). */
export function toFlexNormSettings(
  row: FlexNormRow | null | undefined,
): FlexNormSettings {
  if (!row) return DEFAULT_FLEX_NORM_SETTINGS;
  const annual = positiveOrNull(row.flexNormAnnualHours);
  return {
    period: isNormPeriod(row.flexNormPeriod) ? row.flexNormPeriod : "week",
    yearStart: isNormYearStart(row.flexNormYearStart)
      ? row.flexNormYearStart
      : "calendar",
    annualHours: annual && annual > 0 ? annual : null,
    carryoverMaxHours: positiveOrNull(row.flexCarryoverMaxHours),
    carryoverMaxDeficitHours: positiveOrNull(row.flexCarryoverMaxDeficitHours),
    startDate: row.flexNormStartDate ?? null,
  };
}

export async function loadFlexNormSettings(
  db: Db,
  orgId: string,
): Promise<FlexNormSettings> {
  const row = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, orgId),
    columns: {
      flexNormPeriod: true,
      flexNormYearStart: true,
      flexNormAnnualHours: true,
      flexCarryoverMaxHours: true,
      flexCarryoverMaxDeficitHours: true,
      flexNormStartDate: true,
    },
  });
  return toFlexNormSettings(row);
}

/** Godkendt fravær pr. bruger og dato (ferie vinder ved overlap). */
async function loadAbsenceKinds(
  db: Db,
  orgId: string,
  userIds: readonly string[],
  from: string,
  to: string,
  today: string,
): Promise<Map<string, Map<string, AbsenceKind>>> {
  const a = schema.absenceRequests;
  const rows = await db.query.absenceRequests.findMany({
    where: and(
      eq(a.organizationId, orgId),
      inArray(a.userId, [...userIds]),
      eq(a.status, "approved"),
      lte(a.startDate, to),
      or(isNull(a.endDate), gte(a.endDate, from)),
    ),
    columns: { userId: true, startDate: true, endDate: true },
    with: {
      absenceType: { columns: { category: true, deductsVacation: true } },
    },
  });
  const out = new Map<string, Map<string, AbsenceKind>>();
  for (const r of rows) {
    const kind: AbsenceKind =
      r.absenceType?.category === "vacation" || r.absenceType?.deductsVacation
        ? "vacation"
        : "other";
    const map = out.get(r.userId) ?? new Map<string, AbsenceKind>();
    const start = r.startDate < from ? from : r.startDate;
    for (let d = start; d <= to; d = addDaysToDateStr(d, 1)) {
      // Samme dækning som flex-motoren (åben periode = til og med i dag)
      if (!absenceCoversDate(r, d, today)) break;
      if (map.get(d) !== "vacation") map.set(d, kind);
    }
    out.set(r.userId, map);
  }
  return out;
}

/** Sum af tidsposter pr. bruger og dansk dato. */
async function loadEntryHours(
  db: Db,
  orgId: string,
  userIds: readonly string[],
  from: string,
  to: string,
): Promise<Map<string, Map<string, number>>> {
  const te = schema.timeEntries;
  const day = copenhagenDateSql(te.date);
  const rows = await db
    .select({
      userId: te.userId,
      day: sql<string>`${day}::text`,
      hours: sql<string>`COALESCE(SUM(${te.hours}::numeric), 0)`,
    })
    .from(te)
    .where(
      and(
        inArray(te.userId, [...userIds]),
        or(eq(te.organizationId, orgId), isNull(te.organizationId)),
        gte(te.date, copenhagenDayStart(from)),
        lt(te.date, copenhagenDayEndExclusive(to)),
      ),
    )
    .groupBy(te.userId, day);
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const map = out.get(r.userId) ?? new Map<string, number>();
    map.set(r.day, Number(r.hours));
    out.set(r.userId, map);
  }
  return out;
}

/**
 * Optjent overtid (type earned) pr. bruger og dato — ugens mandag, ellers
 * oprettelsesdagen. Trækkes fra flex, så timer over ugetærsklen kun tæller
 * i overtidssaldoen (samme regel som flex.getBalance).
 */
export async function loadEarnedOvertimeByDate(
  db: Db,
  orgId: string,
  userIds: readonly string[],
  from: string,
  to: string,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (userIds.length === 0) return out;
  const ol = schema.overtimeLedger;
  const day = sql`COALESCE(${ol.weekStart}, ${copenhagenDateSql(ol.createdAt)})`;
  const rows = await db
    .select({
      userId: sql<string>`${ol.userId}`,
      day: sql<string>`(${day})::text`,
      hours: sql<string>`COALESCE(SUM(${ol.hours}::numeric), 0)`,
    })
    .from(ol)
    .where(
      and(
        eq(ol.organizationId, orgId),
        eq(ol.type, "earned"),
        inArray(ol.userId, [...userIds]),
        sql`${day} BETWEEN ${from}::date AND ${to}::date`,
      ),
    )
    .groupBy(ol.userId, day);
  for (const r of rows) {
    const map = out.get(r.userId) ?? new Map<string, number>();
    map.set(r.day, Number(r.hours));
    out.set(r.userId, map);
  }
  return out;
}

/**
 * Norm og registreret tid pr. dag for brugerne i [from, to]. Brugere uden
 * medarbejderprofil i org'en udelades.
 */
export async function loadNormDays(
  db: Db,
  params: {
    orgId: string;
    userIds: readonly string[];
    from: string;
    to: string;
    settings: FlexNormSettings;
    today?: string;
  },
): Promise<Map<string, NormDay[]>> {
  const { orgId, from, to, settings } = params;
  const out = new Map<string, NormDay[]>();
  if (params.userIds.length === 0 || from > to) return out;
  const today = params.today ?? copenhagenToday();
  const userIds = [...new Set(params.userIds)];

  const [profiles, periodsByUser, orgSettings] = await Promise.all([
    db.query.employeeProfiles.findMany({
      where: and(
        eq(schema.employeeProfiles.organizationId, orgId),
        inArray(schema.employeeProfiles.userId, userIds),
      ),
      columns: {
        userId: true,
        weeklyHours: true,
        workingDays: true,
        dailyNormHours: true,
        departmentId: true,
      },
    }),
    loadEmploymentPeriods(db, orgId, userIds),
    loadOrgWorkSettings(db, orgId),
  ]);
  if (profiles.length === 0) return out;

  const members: PlanMember[] = profiles.map((p) => ({
    userId: p.userId,
    departmentId: p.departmentId ?? null,
    periods: periodsByUser.get(p.userId) ?? [],
  }));
  const ids = profiles.map((p) => p.userId);
  const [plans, dayOffs, deviations, absences, entries] = await Promise.all([
    loadPlanLookups(db, orgId, members),
    loadDayOffLookupsForUsers(db, orgId, members),
    loadDeviations(db, orgId, ids, from, to),
    loadAbsenceKinds(db, orgId, ids, from, to, today),
    loadEntryHours(db, orgId, ids, from, to),
  ]);

  const fullTime =
    orgSettings.defaultWeeklyHours > 0 ? orgSettings.defaultWeeklyHours : 37;
  // Årsnorm: arbejdsdage i normåret pr. ugemønster (memo)
  const workdayMemo = new Map<string, number>();
  const annualPerWorkday = (
    date: string,
    workingDays: readonly string[],
  ): number | null => {
    if (settings.annualHours == null) return null;
    const year = normPeriodBounds("year", settings.yearStart, date);
    const key = `${year.start}|${[...workingDays].sort().join("")}`;
    let n = workdayMemo.get(key);
    if (n === undefined) {
      n = countWorkdays(year.start, year.end, workingDays);
      workdayMemo.set(key, n);
    }
    return n > 0 ? settings.annualHours / n : 0;
  };

  const dates = dateRange(from, to);
  for (const profile of profiles) {
    const periods = periodsByUser.get(profile.userId) ?? [];
    const plan = plans.get(profile.userId);
    const lookup = dayOffs.get(profile.userId);
    const devs = deviations.get(profile.userId);
    const abs = absences.get(profile.userId);
    const hours = entries.get(profile.userId);
    out.set(
      profile.userId,
      dates.map((date) => {
        const eff = normProfileAt(periods, profile, date);
        const workingDays = eff?.workingDays ?? DEFAULT_WORKING_DAYS;
        const onPlan = !!eff && (plan?.hasPlan(date) ?? false);
        const dev = onPlan ? devs?.get(date) : undefined;
        return computeNormDay({
          date,
          employment: eff
            ? {
                dailyNorm: calculateDailyNorm(eff, orgSettings),
                workingDays,
                grade: Number(eff.weeklyHours ?? fullTime) / fullTime,
              }
            : null,
          plan: onPlan
            ? { onPlan: true, hours: plan?.planFor(date)?.hours ?? null }
            : null,
          dayOff: lookup?.(date) ?? null,
          absence: abs?.get(date) ?? null,
          entryHours: hours?.get(date) ?? 0,
          deviationHours: dev ? Number(dev.hours) : null,
          annualGrossPerWorkday: eff
            ? annualPerWorkday(date, workingDays)
            : null,
        });
      }),
    );
  }
  return out;
}

export interface FlexNormStatus {
  settings: FlexNormSettings;
  today: string;
  /** Løbende uge (mandag–søndag) til og med i dag */
  week: NormTotals & { start: string; end: string };
  /** Løbende kalendermåned til og med i dag */
  month: NormTotals & { start: string; end: string };
  /** Indeværende normperiode */
  current: PeriodBalance;
  /** Afsluttede perioder, nyeste først (højst `history`) */
  previous: PeriodBalance[];
}

/**
 * Saldo pr. bruger: uge, måned og normperiode med overførsel efter org-
 * reglen. `today` kan sættes til en periodes slutdato for at få saldoen
 * som den stod dengang (bruges af periodeafslutningen).
 */
export async function loadFlexNormStatus(
  db: Db,
  params: {
    orgId: string;
    userIds: readonly string[];
    today?: string;
    settings?: FlexNormSettings;
    history?: number;
  },
): Promise<Map<string, FlexNormStatus>> {
  const today = params.today ?? copenhagenToday();
  const settings =
    params.settings ?? (await loadFlexNormSettings(db, params.orgId));
  const start = balanceStart(settings, today);
  const current = normPeriodBounds(settings.period, settings.yearStart, today);
  const week = normPeriodBounds("week", "calendar", today);
  const month = normPeriodBounds("month", "calendar", today);
  const from = [start, week.start, month.start].sort()[0];
  const to = [current.end, week.end, month.end].sort().reverse()[0];

  const [days, earned] = await Promise.all([
    loadNormDays(db, {
      orgId: params.orgId,
      userIds: params.userIds,
      from,
      to,
      settings,
      today,
    }),
    loadEarnedOvertimeByDate(db, params.orgId, params.userIds, from, to),
  ]);

  const out = new Map<string, FlexNormStatus>();
  for (const [userId, list] of days) {
    const earnedByDate = earned.get(userId);
    const balances = buildPeriodBalances(list, settings, today, earnedByDate);
    const windowFrom = (b: { start: string }) =>
      b.start < start ? start : b.start;
    out.set(userId, {
      settings,
      today,
      week: {
        ...week,
        ...sumNormDays(list, {
          from: windowFrom(week),
          to: week.end,
          today,
          earnedOvertimeByDate: earnedByDate,
        }),
      },
      month: {
        ...month,
        ...sumNormDays(list, {
          from: windowFrom(month),
          to: month.end,
          today,
          earnedOvertimeByDate: earnedByDate,
        }),
      },
      current: balances[balances.length - 1],
      previous: balances
        .slice(0, -1)
        .reverse()
        .slice(0, params.history ?? 6),
    });
  }
  return out;
}
