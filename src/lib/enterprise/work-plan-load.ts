// DB-lag for den faste arbejdsplan (#510). Beregningen er ren og ligger i
// ./work-plan; her hentes tildelinger, versioner, afvigelser, fridage og
// godkendt fravær — et fast antal forespørgsler uanset antal medarbejdere.

import { and, eq, gte, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { loadDayOffLookupsForUsers } from "@/lib/holidays/load";
import { formatUserLabel } from "@/lib/org-audit";
import { copenhagenToday } from "@/lib/time/copenhagen";
import { expandAbsenceDates } from "./compliance-guard";
import {
  type DeviationLike,
  dateRange,
  makePlanLookup,
  type PlanCoverage,
  type PlanLookup,
  type RegisteredDay,
  registeredDay,
  type WorkPlanAssignmentLike,
  type WorkPlanVersionLike,
} from "./work-plan";

type Db = PostgresJsDatabase<typeof schema>;

export interface PlanMember {
  userId: string;
  /** Nuværende afdeling (profilen) */
  departmentId: string | null;
  /** Ansættelsesperioder med afdeling — afdelingen pr. dato (#465) */
  periods?: ReadonlyArray<{
    validFrom: string | null;
    validTo: string | null;
    departmentId: string | null;
  }>;
}

/**
 * Afdelingen på datoen: perioden der dækker datoen, ellers profilens
 * nuværende afdeling (ingen historik, eller datoen ligger uden for
 * ansættelsen). Så flytter en afdelingsskift ikke fortidige plandage.
 */
export function departmentAtDate(
  member: PlanMember,
  date: string,
): string | null {
  const p = member.periods?.find(
    (x) =>
      (x.validFrom == null || x.validFrom <= date) &&
      (x.validTo == null || x.validTo >= date),
  );
  return p ? p.departmentId : member.departmentId;
}

export interface MemberPlan {
  planFor: PlanLookup;
  hasPlan: PlanCoverage;
}

/** Medlemmer med afdeling fra medarbejderprofilen. */
export async function loadPlanMembers(
  db: Db,
  orgId: string,
  userIds: readonly string[],
): Promise<PlanMember[]> {
  if (userIds.length === 0) return [];
  const [rows, periods] = await Promise.all([
    db.query.employeeProfiles.findMany({
      where: and(
        eq(schema.employeeProfiles.organizationId, orgId),
        inArray(schema.employeeProfiles.userId, [...userIds]),
      ),
      columns: { userId: true, departmentId: true },
    }),
    db.query.employmentPeriods.findMany({
      where: and(
        eq(schema.employmentPeriods.organizationId, orgId),
        inArray(schema.employmentPeriods.userId, [...userIds]),
      ),
      columns: {
        userId: true,
        validFrom: true,
        validTo: true,
        departmentId: true,
      },
    }),
  ]);
  return rows.map((r) => ({
    userId: r.userId,
    departmentId: r.departmentId ?? null,
    periods: periods.filter((p) => p.userId === r.userId),
  }));
}

/** Planopslag pr. bruger (tildeling → version → dag). */
export async function loadPlanLookups(
  db: Db,
  orgId: string,
  members: readonly PlanMember[],
): Promise<Map<string, MemberPlan>> {
  const out = new Map<string, MemberPlan>();
  if (members.length === 0) return out;

  const userIds = members.map((m) => m.userId);
  const deptIds = [
    ...new Set(
      members
        .flatMap((m) => [
          m.departmentId,
          ...(m.periods ?? []).map((p) => p.departmentId),
        ])
        .filter((d): d is string => !!d),
    ),
  ];
  const targets: SQL[] = [inArray(schema.workPlanAssignments.userId, userIds)];
  if (deptIds.length > 0) {
    targets.push(inArray(schema.workPlanAssignments.departmentId, deptIds));
  }
  const assignments = await db.query.workPlanAssignments.findMany({
    where: and(
      eq(schema.workPlanAssignments.organizationId, orgId),
      targets.length === 1 ? targets[0] : or(...targets),
    ),
    columns: {
      planId: true,
      userId: true,
      departmentId: true,
      validFrom: true,
      validTo: true,
    },
  });

  const planIds = [...new Set(assignments.map((a) => a.planId))];
  const versions =
    planIds.length === 0
      ? []
      : await db.query.workPlanVersions.findMany({
          where: and(
            eq(schema.workPlanVersions.organizationId, orgId),
            inArray(schema.workPlanVersions.planId, planIds),
          ),
          columns: {
            planId: true,
            validFrom: true,
            rotationWeeks: true,
            rotationAnchor: true,
            weeks: true,
          },
        });
  const versionsByPlan = new Map<string, WorkPlanVersionLike[]>();
  for (const v of versions) {
    const list = versionsByPlan.get(v.planId) ?? [];
    list.push(v);
    versionsByPlan.set(v.planId, list);
  }

  for (const m of members) {
    out.set(
      m.userId,
      makePlanLookup({
        userId: m.userId,
        departmentAt: (date) => departmentAtDate(m, date),
        assignments: assignments as WorkPlanAssignmentLike[],
        versionsByPlan,
      }),
    );
  }
  return out;
}

/** Afvigelser pr. bruger og dato i perioden, med navnet på den der rettede. */
export async function loadDeviations(
  db: Db,
  orgId: string,
  userIds: readonly string[],
  from: string,
  to: string,
): Promise<Map<string, Map<string, DeviationLike>>> {
  const out = new Map<string, Map<string, DeviationLike>>();
  if (userIds.length === 0) return out;
  const d = schema.workDayDeviations;
  const rows = await db
    .select({
      userId: d.userId,
      date: d.date,
      kind: d.kind,
      startTime: d.startTime,
      endTime: d.endTime,
      breakMinutes: d.breakMinutes,
      hours: d.hours,
      note: d.note,
      updatedAt: d.updatedAt,
      editorName: schema.users.name,
      editorEmail: schema.users.email,
    })
    .from(d)
    .leftJoin(schema.users, eq(schema.users.id, d.updatedBy))
    .where(
      and(
        eq(d.organizationId, orgId),
        inArray(d.userId, [...userIds]),
        gte(d.date, from),
        lte(d.date, to),
      ),
    );
  for (const r of rows) {
    const map = out.get(r.userId) ?? new Map<string, DeviationLike>();
    map.set(r.date, {
      date: r.date,
      kind: r.kind,
      startTime: r.startTime,
      endTime: r.endTime,
      breakMinutes: r.breakMinutes,
      hours: Number(r.hours),
      note: r.note,
      updatedAt: r.updatedAt,
      updatedByLabel: formatUserLabel({
        name: r.editorName,
        email: r.editorEmail,
      }),
    });
    out.set(r.userId, map);
  }
  return out;
}

/** Godkendte heldagsfraværsdage pr. bruger i perioden. */
export async function loadAbsenceDays(
  db: Db,
  orgId: string,
  userIds: readonly string[],
  from: string,
  to: string,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (userIds.length === 0) return out;
  const a = schema.absenceRequests;
  const rows = await db.query.absenceRequests.findMany({
    where: and(
      eq(a.organizationId, orgId),
      inArray(a.userId, [...userIds]),
      eq(a.status, "approved"),
      lte(a.startDate, to),
      or(isNull(a.endDate), gte(a.endDate, from)),
    ),
    columns: {
      userId: true,
      startDate: true,
      endDate: true,
      halfDayStart: true,
      halfDayEnd: true,
      hoursPerDay: true,
    },
  });
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byUser.get(r.userId) ?? [];
    list.push(r);
    byUser.set(r.userId, list);
  }
  const today = copenhagenToday();
  for (const [userId, list] of byUser) {
    out.set(userId, expandAbsenceDates(list, from, to, today));
  }
  return out;
}

/**
 * De registrerede arbejdsdage pr. bruger i [from, to]. Kun brugere med en
 * plan i perioden får en liste; uden plan og uden afvigelser udelades
 * brugeren (arbejdstiden registreres så som almindelige tidsposter).
 */
export async function loadRegisteredDays(
  db: Db,
  orgId: string,
  members: readonly PlanMember[],
  from: string,
  to: string,
): Promise<Map<string, RegisteredDay[]>> {
  const out = new Map<string, RegisteredDay[]>();
  if (members.length === 0 || from > to) return out;
  const userIds = members.map((m) => m.userId);
  const [plans, deviations, absences, dayOffs] = await Promise.all([
    loadPlanLookups(db, orgId, members),
    loadDeviations(db, orgId, userIds, from, to),
    loadAbsenceDays(db, orgId, userIds, from, to),
    loadDayOffLookupsForUsers(db, orgId, members),
  ]);
  const dates = dateRange(from, to);
  for (const m of members) {
    const plan = plans.get(m.userId);
    const devs = deviations.get(m.userId);
    const hasAnyPlan = plan ? dates.some((d) => plan.hasPlan(d)) : false;
    if (!hasAnyPlan && !devs?.size) continue;
    const absent = absences.get(m.userId);
    const lookup = dayOffs.get(m.userId);
    out.set(
      m.userId,
      dates.map((date) =>
        registeredDay({
          date,
          planned: plan?.planFor(date) ?? null,
          dayOff: lookup?.(date) ?? null,
          absence: absent?.has(date) ?? false,
          deviation: devs?.get(date) ?? null,
        }),
      ),
    );
  }
  return out;
}
