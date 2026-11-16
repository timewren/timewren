import { TRPCError } from "@trpc/server";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import type { db as defaultDb } from "@/lib/db";
import { members, timeEntries, users } from "@/lib/db/schema";
import { parseLocalDateStr, toLocalDateStr } from "@/lib/format";
import { canViewAllOrgTime } from "@/lib/permissions/server";
import {
  buildDayTimeline,
  type DayTimeline,
  type DayTimelineEntryRow,
  type DayTimelineInterval,
  type DayTimelineSegmentRow,
  loadDayTimelineRows,
} from "@/lib/time/day-timeline";
import { parseDbTimestamp } from "@/lib/time/db-timestamp";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";

type Db = typeof defaultDb;

/**
 * Spildtidsloggen læser hele organisationens posteringer for perioden og
 * aggregerer i Node uden LIMIT. Et år er rigeligt til enhver analyse og
 * holder hukommelsesforbruget forudsigeligt.
 */
const MAX_WASTE_LOG_DAYS = 366;

export interface WasteLogEntryContext {
  projectName: string | null;
  clientName: string | null;
  description: string | null;
}

export interface WasteLogRow {
  userId: string;
  userName: string;
  date: string; // YYYY-MM-DD
  gapMinutes: number;
  /** Registreringen pausen kommer EFTER. */
  afterEntry: (WasteLogEntryContext & { end: string | null }) | null;
  /** Registreringen pausen kommer FØR. */
  beforeEntry: (WasteLogEntryContext & { start: string | null }) | null;
}

export interface WasteLogUserDay {
  date: string;
  gapMinutes: number;
  gapCount: number;
  workedMinutes: number;
  spanMinutes: number;
  untimedEntries: number;
}

export interface WasteLogUser {
  userId: string;
  userName: string;
  gapMinutes: number;
  gapCount: number;
  /** Registreringer uden start/slut — der kan ikke beregnes pauser for dem. */
  untimedEntries: number;
  days: WasteLogUserDay[];
}

/**
 * De medlemmer en logbogs-visning må dække: hele org'en når man er
 * ejer/admin, ellers kun brugeren selv. Delt af weekOverview og wasteLog, så
 * de to aldrig viser forskellige personlister.
 */
async function resolveVisibleMembers(
  db: Db,
  orgId: string | null,
  self: { id: string; name?: string | null; email?: string | null },
): Promise<{ userId: string; name: string }[]> {
  if (!orgId) {
    return [{ userId: self.id, name: self.name || self.email || "Mig" }];
  }
  const rows = await db
    .select({
      userId: members.userId,
      name: users.name,
      email: users.email,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.organizationId, orgId));
  return rows
    .map((r) => ({ userId: r.userId, name: r.name || r.email || "Ukendt" }))
    .sort((a, b) => a.name.localeCompare(b.name, "da"));
}

/**
 * Adgangskontrol for dayDetail: alle må se deres egen logbog; kun
 * org-ejere/admins må se andres, og kun for brugere der er medlem af
 * den aktive org (ingen læsning på tværs af organisationer).
 */
export async function assertDayDetailAccess(
  db: Db,
  orgId: string | null,
  sessionUserId: string,
  targetUserId: string,
): Promise<void> {
  if (targetUserId === sessionUserId) return;

  const canSeeAll = await canViewAllOrgTime(db, orgId, sessionUserId);
  if (!orgId || !canSeeAll) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "logbook.ownOnly"),
    });
  }

  const membership = await db
    .select({ userId: members.userId })
    .from(members)
    .where(
      and(eq(members.organizationId, orgId), eq(members.userId, targetUserId)),
    )
    .limit(1);
  if (membership.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "logbook.notInYourOrg"),
    });
  }
}

/**
 * Gap/pause-kernen bor i src/lib/time/day-timeline.ts, så Logbogen,
 * Teamoverblikket og spildtidsloggen regner pauser ens. Logbogen beholder den
 * historiske adfærd: ingen min-gap og intet rejected-filter.
 */
export type DayDetailEntryRow = DayTimelineEntryRow;
export type DayDetailSegmentRow = DayTimelineSegmentRow;
export type DayDetailInterval = DayTimelineInterval;
export type DayDetail = DayTimeline;
export const buildDayDetails = buildDayTimeline;

/**
 * Logbog: hvornår er der logget tid pr. person pr. dag — første start, sidste
 * slut og total. Org-ejere/admins ser alle medlemmer; menige medlemmer og
 * solo-brugere ser kun sig selv.
 *
 * "Kommer/går" udledes af time_entries.startTime/endTime. De felter udfyldes
 * kun af timer-, check-in- og enkelte manuelle registreringer, så svaret
 * medtager hvor mange af dagens registreringer der havde tidspunkter
 * (timedCount vs entriesCount) — UI'et kan så vise totalen ærligt uden at
 * påstå præcise komme/gå-tider for rene varighedsregistreringer.
 */
export const logbookRouter = router({
  weekOverview: protectedProcedure
    .input(
      z.object({
        // Mandag i den ønskede uge, YYYY-MM-DD
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const weekStart = new Date(input.weekStart);
      // Eksklusiv grænse på næste mandag (UTC, som weekStart) — så søndagens
      // poster med klokkeslæt efter midnat også kommer med.
      const weekEndExclusive = new Date(weekStart);
      weekEndExclusive.setUTCDate(weekEndExclusive.getUTCDate() + 7);

      const canSeeAll = await canViewAllOrgTime(ctx.db, ctx.orgId, userId);

      // Resolve visible members
      const memberList = await resolveVisibleMembers(
        ctx.db,
        ctx.orgId && canSeeAll ? ctx.orgId : null,
        {
          id: userId,
          name: ctx.session.user.name,
          email: ctx.session.user.email,
        },
      );

      const memberIds = memberList.map((m) => m.userId);
      if (memberIds.length === 0) {
        return { members: [], canSeeAll };
      }

      const scopeFilter = ctx.orgId
        ? eq(timeEntries.organizationId, ctx.orgId)
        : eq(timeEntries.userId, userId);

      const rows = await ctx.db
        .select({
          userId: timeEntries.userId,
          date: timeEntries.date,
          firstStart: sql<string | null>`MIN(${timeEntries.startTime})`,
          lastEnd: sql<string | null>`MAX(${timeEntries.endTime})`,
          totalHours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
          entriesCount: sql<number>`COUNT(*)::int`,
          timedCount: sql<number>`COUNT(${timeEntries.startTime})::int`,
        })
        .from(timeEntries)
        .where(
          and(
            scopeFilter,
            inArray(timeEntries.userId, memberIds),
            gte(timeEntries.date, weekStart),
            lt(timeEntries.date, weekEndExclusive),
          ),
        )
        .groupBy(timeEntries.userId, timeEntries.date);

      type DayCell = {
        firstStart: string | null;
        lastEnd: string | null;
        totalHours: number;
        entriesCount: number;
        timedCount: number;
      };

      const byMember = new Map<string, Record<string, DayCell>>();
      for (const row of rows) {
        if (!row.userId) continue;
        const dateKey = toLocalDateStr(row.date);
        const days = byMember.get(row.userId) ?? {};
        days[dateKey] = {
          // Rå MIN/MAX giver en nøgen UTC-streng — se parseDbTimestamp
          firstStart: parseDbTimestamp(row.firstStart)?.toISOString() ?? null,
          lastEnd: parseDbTimestamp(row.lastEnd)?.toISOString() ?? null,
          totalHours:
            Math.round(parseFloat(row.totalHours as unknown as string) * 100) /
            100,
          entriesCount: row.entriesCount,
          timedCount: row.timedCount,
        };
        byMember.set(row.userId, days);
      }

      return {
        canSeeAll,
        members: memberList.map((m) => ({
          userId: m.userId,
          name: m.name,
          days: byMember.get(m.userId) ?? {},
        })),
      };
    }),

  /**
   * Drill-down pr. medarbejder: alle intervaller (inkl. segmenter) for hele
   * ugen man-søn, med pauser (gaps) mellem tidsstemplede intervaller.
   */
  dayDetail: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        // Mandag i den ønskede uge, YYYY-MM-DD (samme format som weekOverview)
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ ctx, input }) => {
      const sessionUserId = ctx.session.user.id;
      await assertDayDetailAccess(
        ctx.db,
        ctx.orgId,
        sessionUserId,
        input.userId,
      );

      const weekStart = new Date(input.weekStart);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const { entries, segments } = await loadDayTimelineRows(ctx.db, {
        orgId: ctx.orgId,
        userIds: [input.userId],
        from: weekStart,
        to: weekEnd,
      });

      // Logbogen beholder sin historiske adfærd: alle huller >0 min tæller,
      // og afviste registreringer vises som hidtil.
      const days = buildDayDetails(entries, segments, {
        minGapMinutes: 0,
        excludeRejected: false,
      });

      return { days };
    }),

  /**
   * Spildtidslog (kunde A): akkumulerede pauser for hele organisationen
   * i en periode. "10 timer spildtid om ugen er 10.000 kr" — tallet skal kunne
   * ses pr. medarbejder og pr. dag.
   *
   * Kun org-ejere/admins: det er et lederoverblik over kolleger. Bevidst IKKE
   * resolveTimeOwnershipFilter (den er owner-only og tiltænkt skrivning).
   *
   * untimedEntries rapporteres eksplicit: for en bruger der kun registrerer
   * varigheder (ingen start/slut) kan der ikke beregnes pauser, og totalen
   * ville ellers lyve ved at vise 0.
   */
  wasteLog: orgAdminProcedure
    .input(
      z
        .object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          // Huller under tærsklen er støj (skift mellem to opgaver). Default 15
          // min er org-beslutningen; UI'et tilbyder 5/15/30.
          minGapMinutes: z.number().int().min(0).max(240).default(15),
        })
        .superRefine((value, ctx) => {
          const from = parseLocalDateStr(value.from);
          const to = parseLocalDateStr(value.to);
          if (to < from) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["to"],
              message: st("logbook.endAfterStart"),
            });
            return;
          }
          // Hele org'ens posteringer materialiseres i Node uden LIMIT, så en
          // 10-års periode ville trække alt ind i hukommelsen. Et år dækker
          // enhver realistisk spildtidsanalyse.
          const days =
            Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
          if (days > MAX_WASTE_LOG_DAYS) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["to"],
              message: st("logbook.periodMaxDays", {
                days: MAX_WASTE_LOG_DAYS,
              }),
            });
          }
        }),
    )
    .query(async ({ ctx, input }) => {
      const sessionUserId = ctx.session.user.id;
      // orgAdminProcedure lukker menige medlemmer ude; canViewAllOrgTime er
      // den samme kilde som Logbogens org-scope, så de to aldrig divergerer.
      const canSeeAll = await canViewAllOrgTime(
        ctx.db,
        ctx.orgId,
        sessionUserId,
      );
      if (!canSeeAll) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "logbook.noAccessWaste"),
        });
      }

      // Perioden er allerede valideret i input-skemaet (rækkefølge + længde).
      const from = parseLocalDateStr(input.from);
      const to = parseLocalDateStr(input.to);

      const memberList = await resolveVisibleMembers(ctx.db, ctx.orgId, {
        id: sessionUserId,
        name: ctx.session.user.name,
        email: ctx.session.user.email,
      });
      const nameByUser = new Map(memberList.map((m) => [m.userId, m.name]));
      const memberIds = memberList.map((m) => m.userId);
      if (memberIds.length === 0) {
        return {
          minGapMinutes: input.minGapMinutes,
          rows: [],
          byUser: [],
          byDay: [],
          totals: { gapMinutes: 0, gapCount: 0, untimedEntries: 0 },
        };
      }

      const { entries, segments } = await loadDayTimelineRows(ctx.db, {
        orgId: ctx.orgId,
        userIds: memberIds,
        from,
        to,
        excludeRejected: true,
      });

      const entriesByUser = new Map<string, DayTimelineEntryRow[]>();
      for (const e of entries) {
        if (!e.userId) continue;
        const list = entriesByUser.get(e.userId) ?? [];
        list.push(e);
        entriesByUser.set(e.userId, list);
      }

      const rows: WasteLogRow[] = [];
      const byUser: WasteLogUser[] = [];
      const dayTotals = new Map<
        string,
        { gapMinutes: number; gapCount: number }
      >();

      for (const member of memberList) {
        const userEntries = entriesByUser.get(member.userId) ?? [];
        const days = buildDayTimeline(userEntries, segments, {
          minGapMinutes: input.minGapMinutes,
          excludeRejected: true,
        });

        let userGapMinutes = 0;
        let userGapCount = 0;
        let userUntimed = 0;
        const userDays: WasteLogUserDay[] = [];

        for (const day of days) {
          for (const gap of day.gapDetails) {
            const after = day.intervals[gap.afterIndex];
            const before = day.intervals[gap.beforeIndex];
            rows.push({
              userId: member.userId,
              userName: member.name,
              date: day.date,
              gapMinutes: gap.minutes,
              afterEntry: after
                ? {
                    end: after.end,
                    projectName: after.projectName,
                    clientName: after.clientName,
                    description: after.description,
                  }
                : null,
              beforeEntry: before
                ? {
                    start: before.start,
                    projectName: before.projectName,
                    clientName: before.clientName,
                    description: before.description,
                  }
                : null,
            });
          }

          userGapMinutes += day.summary.gapMinutes;
          userGapCount += day.gaps.length;
          userUntimed += day.summary.untimedEntries;
          userDays.push({
            date: day.date,
            gapMinutes: day.summary.gapMinutes,
            gapCount: day.gaps.length,
            workedMinutes: day.summary.workedMinutes,
            spanMinutes: day.summary.spanMinutes,
            untimedEntries: day.summary.untimedEntries,
          });

          const dayTotal = dayTotals.get(day.date) ?? {
            gapMinutes: 0,
            gapCount: 0,
          };
          dayTotal.gapMinutes += day.summary.gapMinutes;
          dayTotal.gapCount += day.gaps.length;
          dayTotals.set(day.date, dayTotal);
        }

        byUser.push({
          userId: member.userId,
          userName: nameByUser.get(member.userId) ?? member.name,
          gapMinutes: userGapMinutes,
          gapCount: userGapCount,
          untimedEntries: userUntimed,
          days: userDays.sort((a, b) => a.date.localeCompare(b.date)),
        });
      }

      byUser.sort(
        (a, b) =>
          b.gapMinutes - a.gapMinutes ||
          a.userName.localeCompare(b.userName, "da"),
      );
      rows.sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.userName.localeCompare(b.userName, "da") ||
          b.gapMinutes - a.gapMinutes,
      );

      return {
        minGapMinutes: input.minGapMinutes,
        rows,
        byUser,
        byDay: [...dayTotals.entries()]
          .map(([date, t]) => ({ date, ...t }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        totals: {
          gapMinutes: byUser.reduce((sum, u) => sum + u.gapMinutes, 0),
          gapCount: byUser.reduce((sum, u) => sum + u.gapCount, 0),
          untimedEntries: byUser.reduce((sum, u) => sum + u.untimedEntries, 0),
        },
      };
    }),
});
