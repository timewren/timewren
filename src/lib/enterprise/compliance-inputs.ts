import { and, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { absenceRequests, timeEntries } from "@/lib/db/schema";
import { addDaysToDateStr, copenhagenToday } from "@/lib/time/copenhagen";
import type { DatedTimeEntry } from "./compliance";
import {
  type AbsenceDateRow as AbsenceRow,
  expandAbsenceDates,
  expandNeutralAbsenceDates,
} from "./compliance-guard";
import { usersTimeEntriesInOrg } from "./time-entry-scope";
import { mergeRegisteredIntoEntries, planWallTime } from "./work-plan";
import { loadPlanMembers, loadRegisteredDays } from "./work-plan-load";

function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Fuld klient (ikke tx): planlaget (#510) læser også via select
type Db = Parameters<typeof loadRegisteredDays>[0];

/**
 * Poster + godkendte hele fraværsdage pr. bruger i perioden — to queries
 * uanset antal medarbejdere. Læser kun absence_requests (E3-grænse).
 */
export async function loadComplianceInputs(
  db: Db,
  params: {
    orgId: string;
    userIds: string[];
    from: string;
    to: string;
    forecast?: boolean;
  },
): Promise<{
  entriesByUser: Map<string, DatedTimeEntry[]>;
  absenceByUser: Map<string, Set<string>>;
  neutralAbsenceByUser: Map<string, Set<string>>;
}> {
  const entriesByUser = new Map<string, DatedTimeEntry[]>();
  const absenceByUser = new Map<string, Set<string>>();
  const neutralAbsenceByUser = new Map<string, Set<string>>();
  if (params.userIds.length === 0) {
    return { entriesByUser, absenceByUser, neutralAbsenceByUser };
  }

  const fromDate = parseLocalDate(params.from);
  const toExclusive = parseLocalDate(params.to);
  toExclusive.setDate(toExclusive.getDate() + 1);
  const today = copenhagenToday();

  const [entryRows, absenceRows] = await Promise.all([
    db.query.timeEntries.findMany({
      where: and(
        usersTimeEntriesInOrg(params.userIds, params.orgId),
        gte(timeEntries.date, fromDate),
        lt(timeEntries.date, toExclusive),
      ),
      columns: {
        userId: true,
        date: true,
        startTime: true,
        endTime: true,
        hours: true,
      },
    }),
    db.query.absenceRequests.findMany({
      where: and(
        eq(absenceRequests.organizationId, params.orgId),
        inArray(absenceRequests.userId, params.userIds),
        eq(absenceRequests.status, "approved"),
        lte(absenceRequests.startDate, params.to),
        or(
          isNull(absenceRequests.endDate),
          gte(absenceRequests.endDate, params.from),
        ),
      ),
      columns: {
        userId: true,
        startDate: true,
        endDate: true,
        halfDayStart: true,
        halfDayEnd: true,
        hoursPerDay: true,
      },
      with: { absenceType: { columns: { deductsOvertime: true } } },
    }),
  ]);

  for (const e of entryRows) {
    const list = entriesByUser.get(e.userId) ?? [];
    list.push({
      date: toDateStr(e.date),
      hours: Number(e.hours) || 0,
      startTime: e.startTime ?? null,
      endTime: e.endTime ?? null,
    });
    entriesByUser.set(e.userId, list);
  }
  const absenceRowsByUser = new Map<
    string,
    Array<AbsenceRow & { deductsOvertime: boolean }>
  >();
  for (const a of absenceRows) {
    const list = absenceRowsByUser.get(a.userId) ?? [];
    list.push({
      ...a,
      deductsOvertime: a.absenceType?.deductsOvertime ?? false,
    });
    absenceRowsByUser.set(a.userId, list);
  }
  for (const [userId, rows] of absenceRowsByUser) {
    absenceByUser.set(
      userId,
      expandAbsenceDates(rows, params.from, params.to, today),
    );
    neutralAbsenceByUser.set(
      userId,
      expandNeutralAbsenceDates(rows, params.from, params.to, today),
    );
  }

  // Fast arbejdsplan (#510): dage efter plan (eller rettet afvigelse) tæller
  // med planens tid, når den er større end de registrerede tidsposter.
  let planTo = today;
  if (params.forecast || params.to < today) planTo = params.to;
  if (params.from <= planTo) {
    const members = await loadPlanMembers(db, params.orgId, params.userIds);
    const registered = await loadRegisteredDays(
      db,
      params.orgId,
      members,
      params.from,
      planTo,
    );
    for (const [userId, days] of registered) {
      entriesByUser.set(
        userId,
        mergeRegisteredIntoEntries(
          entriesByUser.get(userId) ?? [],
          days,
          params.forecast ? addDaysToDateStr(params.to, 1) : today,
          planWallTime,
          params.forecast,
        ),
      );
    }
  }
  return { entriesByUser, absenceByUser, neutralAbsenceByUser };
}
