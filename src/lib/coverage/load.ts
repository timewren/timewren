// DB-lag for dækningsgraden (#679): hvilken arbejdstid gælder for brugeren,
// og hvilke tidsposter falder i perioden. Selve beregningen er ren og ligger
// i ./coverage.

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import {
  getEmploymentBatch,
  makeDayResolver,
} from "@/lib/enterprise/employment";
import {
  loadPlanLookups,
  type MemberPlan,
} from "@/lib/enterprise/work-plan-load";
import { loadOrgWorkSettings } from "@/lib/enterprise/work-settings";
import { type DayOffLookup, workShareOn } from "@/lib/holidays/danish";
import { loadDayOffLookupsForUsers } from "@/lib/holidays/load";
import { dateUpperBound } from "@/lib/time/date-bounds";
import {
  type CoverageEntry,
  entryDateStr,
  isoWeekdayOf,
  resolveWorkSchedule,
  scheduleHoursFor,
  type WorkSchedule,
} from "./coverage";

type Db = PostgresJsDatabase<typeof schema>;

export type WorkTimeSource = "user" | "hr";

export interface WorkTimeContext {
  /** "hr" = normtiden fra HR-modulets medarbejderprofil (genbrugt) */
  source: WorkTimeSource;
  /** Brugerens eget ugeskema (vises/redigeres i indstillinger) */
  schedule: WorkSchedule;
  /** Arbejdstid på datoen — fridage/helligdage (#526) er trukket fra */
  hoursFor: (date: string) => number;
  timezone: string;
  reminderThreshold: number | null;
}

/**
 * Arbejdstid for brugeren. Er brugeren aktiv medarbejder i en org med
 * enterprise-modulet, genbruges HR-normtiden (ansættelsesperioder, dagsnorm,
 * arbejdsdage) så dækningsgraden matcher flex/timesedler. Ellers bruges
 * brugerens eget ugeskema (standard 37 t man-fre). I begge tilfælde trækkes
 * fridage og helligdage fra brugerens fridagskalender fra (#526): hel
 * fridag = 0 t, halv = halvdelen. Kalenderen er afdelingens > org'ens >
 * brugerens egen — den egne kun for den, der ikke er medarbejder med
 * HR-normtid (#742).
 */
export async function loadWorkTimeContext(
  db: Db,
  userId: string,
  orgId: string | null,
  opts: { enterpriseEnabled: boolean },
): Promise<WorkTimeContext> {
  const contexts = await loadWorkTimeContexts(db, [userId], orgId, opts);
  const context = contexts.get(userId);
  if (!context) throw new Error("Arbejdstidsgrundlaget mangler");
  return context;
}

/** Fælles opslag for et helt team, uanset antallet af medlemmer. */
export async function loadWorkTimeContexts(
  db: Db,
  userIds: readonly string[],
  orgId: string | null,
  opts: { enterpriseEnabled: boolean },
): Promise<Map<string, WorkTimeContext>> {
  const out = new Map<string, WorkTimeContext>();
  if (userIds.length === 0) return out;
  const [users, profiles, employment, orgSettings] = await Promise.all([
    db.query.users.findMany({
      where: inArray(schema.users.id, [...userIds]),
      columns: {
        id: true,
        workSchedule: true,
        workingDays: true,
        timezone: true,
        coverageReminderThreshold: true,
      },
    }),
    orgId
      ? db.query.employeeProfiles.findMany({
          where: and(
            eq(schema.employeeProfiles.organizationId, orgId),
            inArray(schema.employeeProfiles.userId, [...userIds]),
          ),
          columns: {
            userId: true,
            isActive: true,
            weeklyHours: true,
            workingDays: true,
            dailyNormHours: true,
            breakMinutes: true,
            departmentId: true,
          },
        })
      : [],
    orgId && opts.enterpriseEnabled
      ? getEmploymentBatch(db, orgId, userIds)
      : null,
    orgId && opts.enterpriseEnabled ? loadOrgWorkSettings(db, orgId) : null,
  ]);
  const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
  const members = userIds.map((userId) => {
    const profile = profileByUser.get(userId);
    return {
      userId,
      departmentId: profile?.departmentId ?? null,
      isEmployee: profile?.isActive === true,
      periods: employment?.periodsFor(userId),
    };
  });
  const [calendars, plans] = await Promise.all([
    loadDayOffLookupsForUsers(db, orgId, members),
    orgId && opts.enterpriseEnabled
      ? loadPlanLookups(
          db,
          orgId,
          members.filter((m) => m.isEmployee),
        )
      : new Map<string, MemberPlan>(),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  for (const userId of userIds) {
    const user = userById.get(userId);
    const profile = profileByUser.get(userId);
    const schedule = resolveWorkSchedule(user?.workSchedule, user?.workingDays);
    const base = {
      schedule,
      timezone: user?.timezone || "Europe/Copenhagen",
      reminderThreshold: user?.coverageReminderThreshold ?? null,
    };
    const calendar = calendars.get(userId);
    if (!calendar) throw new Error("Fridagskalenderen mangler");
    if (profile?.isActive && opts.enterpriseEnabled && employment) {
      const resolve = makeDayResolver(
        employment.periodsFor(userId),
        profile,
        orgSettings,
      );
      const plan = plans.get(userId);
      out.set(userId, {
        ...base,
        source: "hr",
        hoursFor: withDaysOff(calendar, (date) => {
          const day = resolve(date);
          if (!day) return 0;
          if (plan?.hasPlan(date)) return plan.planFor(date)?.hours ?? 0;
          return day.workingDays.includes(isoWeekdayOf(date))
            ? day.dailyNorm
            : 0;
        }),
      });
    } else {
      out.set(userId, {
        ...base,
        source: "user",
        hoursFor: withDaysOff(calendar, scheduleHoursFor(schedule)),
      });
    }
  }
  return out;
}

/** Arbejdstid med fridagene trukket fra (hel fridag 0, halv fridag ½). */
export function withDaysOff(
  lookup: DayOffLookup,
  hoursFor: (date: string) => number,
): (date: string) => number {
  return (date) => {
    const hours = hoursFor(date);
    return hours > 0 ? hours * workShareOn(lookup, date) : hours;
  };
}

/** Er enterprise-modulet slået til for org'en? (til cron uden tRPC-ctx) */
export async function isEnterpriseEnabled(
  db: Db,
  orgId: string | null,
): Promise<boolean> {
  if (!orgId) return false;
  const row = await db.query.organizationModules.findFirst({
    where: and(
      eq(schema.organizationModules.organizationId, orgId),
      eq(schema.organizationModules.moduleKey, "enterprise"),
      eq(schema.organizationModules.isEnabled, true),
    ),
    columns: { organizationId: true },
  });
  return !!row;
}

/**
 * Brugerens egne tidsposter i [start, end] (ren dato, begge inklusive).
 * Kunde = postens kunde, ellers projektets kunde; ingen af delene = intern
 * tid. Filtreres på org når brugeren har en (userId-fallback ellers).
 */
export async function loadCoverageEntries(
  db: Db,
  params: { userId: string; orgId: string | null; start: string; end: string },
): Promise<CoverageEntry[]> {
  const { timeEntries, projects, clients } = schema;
  const rows = await db
    .select({
      date: timeEntries.date,
      hours: timeEntries.hours,
      isBillable: timeEntries.isBillable,
      entryClientId: timeEntries.clientId,
      projectClientId: projects.clientId,
      clientName: clients.name,
    })
    .from(timeEntries)
    .leftJoin(projects, eq(timeEntries.projectId, projects.id))
    // Postens egen kunde vinder over projektets
    .leftJoin(
      clients,
      sql`${clients.id} = COALESCE(${timeEntries.clientId}, ${projects.clientId})`,
    )
    .where(
      and(
        eq(timeEntries.userId, params.userId),
        ...(params.orgId ? [eq(timeEntries.organizationId, params.orgId)] : []),
        gte(timeEntries.date, new Date(params.start)),
        dateUpperBound(timeEntries.date, params.end),
      ),
    );

  return rows.map((r) => ({
    date: entryDateStr(r.date),
    hours: Number(r.hours),
    isBillable: r.isBillable,
    clientId: r.entryClientId ?? r.projectClientId ?? null,
    clientName: r.clientName ?? null,
  }));
}
