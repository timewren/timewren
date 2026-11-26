// src/lib/trpc/routers/reports.ts
import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { LOCALES } from "@/i18n/config";
import { st, tr } from "@/i18n/server-text";
import { getAppUrl } from "@/lib/config";
import { todayInTimeZone } from "@/lib/coverage/coverage";
import { loadWorkTimeContexts } from "@/lib/coverage/load";
import {
  clients,
  members,
  projects,
  reportSchedules,
  reportShares,
  reportTemplates,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { toLocalDateStr } from "@/lib/format";
import { canViewAllOrgTime } from "@/lib/permissions/server";
import {
  reportTemplateConfigSchema,
  showsBudgetColumn,
} from "@/lib/reports/config-schema";
import { generateCSV } from "@/lib/reports/generators/csv";
import { generateJSON } from "@/lib/reports/generators/json";
import { generateXLSX } from "@/lib/reports/generators/xlsx";
import {
  aggregateReport,
  loadReportBudgetUsage,
  loadReportEntries,
  resolveDateRange,
} from "@/lib/reports/query";
import { memberUtilization, workHoursInRange } from "@/lib/reports/utilization";
import { hashToken, revealToken } from "@/lib/security/token-hash";
import { trackEvent } from "@/lib/telemetry/track";
import { copenhagenTodayAnchor } from "@/lib/time/copenhagen";
import { dateUpperBound } from "@/lib/time/date-bounds";
import { encryptSecret } from "@/lib/utils/encryption";
import { rateLimiter, userRateLimitKey } from "@/lib/utils/rate-limiter";
import {
  moduleReadProcedure,
  orgAdminProcedure,
  protectedProcedure,
  router,
  subscribedModuleReadProcedure,
} from "../trpc";
import { getAccessibleClientIds } from "./clientAccess";

/**
 * Whether a report should be limited to the caller's own entries. Owners/admins
 * (and members granted "viewTeamTime") may report across all members; everyone
 * else is scoped to their own — mirroring the time.list visibility rule so
 * reports can't become a backdoor to the whole team's time and revenue.
 */
async function shouldRestrictReportToOwn(ctx: {
  db: Parameters<typeof canViewAllOrgTime>[0];
  orgId: string | null;
  session: { user: { id: string } };
}): Promise<boolean> {
  if (!ctx.orgId) return false;
  return !(await canViewAllOrgTime(ctx.db, ctx.orgId, ctx.session.user.id));
}

export const reportsRouter = router({
  // Team-lønsomhed (#142): omsætning − intern kostpris pr. medarbejder/
  // projekt. Kun owner/admin (kostpriser er salary-like data). Kost pr.
  // post = snapshot'et costRate, fallback medlemmets aktuelle org-sats.
  getTeamProfitability: orgAdminProcedure
    .input(
      z
        .object({ months: z.number().int().min(1).max(24).default(6) })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.orgId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "reports.teamProfitabilityNeedsOrg",
          ),
        });
      }
      const orgId = ctx.orgId;
      const months = input?.months ?? 6;
      const now = copenhagenTodayAnchor(); // dansk dato uanset proces-TZ (#649)
      const from = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

      const effectiveCost = sql<string>`COALESCE(${timeEntries.costRate}, ${members.costRate}, 0)`;
      const revenueExpr = sql<string>`COALESCE(SUM(CASE WHEN ${timeEntries.isBillable} = true THEN ${timeEntries.hours} * COALESCE(${timeEntries.billableRate}, 0) ELSE 0 END), 0)`;
      const costExpr = sql<string>`COALESCE(SUM(${timeEntries.hours} * ${effectiveCost}), 0)`;
      const hoursExpr = sql<string>`COALESCE(SUM(${timeEntries.hours}), 0)`;

      const baseQuery = (groupCol: "user" | "project") =>
        ctx.db
          .select({
            key:
              groupCol === "user"
                ? sql<string>`${timeEntries.userId}`
                : sql<string | null>`${timeEntries.projectId}`,
            totalHours: hoursExpr,
            revenue: revenueExpr,
            cost: costExpr,
          })
          .from(timeEntries)
          .leftJoin(
            members,
            and(
              eq(members.userId, timeEntries.userId),
              eq(members.organizationId, orgId),
            ),
          )
          .where(
            and(
              eq(timeEntries.organizationId, orgId),
              gte(timeEntries.date, from),
              ne(timeEntries.approvalStatus, "rejected"),
            ),
          )
          .groupBy(
            groupCol === "user" ? timeEntries.userId : timeEntries.projectId,
          );

      const [memberRows, projectRows] = await Promise.all([
        baseQuery("user"),
        baseQuery("project"),
      ]);

      const userIds = memberRows
        .map((r) => r.key)
        .filter((id): id is string => !!id);
      const userRows = userIds.length
        ? await ctx.db.query.users.findMany({
            where: inArray(users.id, userIds),
            columns: { id: true, name: true },
          })
        : [];
      const userMap = new Map(userRows.map((u) => [u.id, u.name]));

      const projectIds = projectRows
        .map((r) => r.key)
        .filter((id): id is string => !!id);
      const projRows = projectIds.length
        ? await ctx.db.query.projects.findMany({
            where: inArray(projects.id, projectIds),
            columns: { id: true, name: true },
          })
        : [];
      const projMap = new Map(projRows.map((pr) => [pr.id, pr.name]));

      const toStat = (r: {
        key: string | null;
        totalHours: string;
        revenue: string;
        cost: string;
      }) => {
        const revenue = Number.parseFloat(r.revenue);
        const cost = Number.parseFloat(r.cost);
        return {
          hours: Number.parseFloat(r.totalHours),
          revenue,
          cost,
          margin: revenue - cost,
          marginPct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
        };
      };

      return {
        from: toLocalDateStr(from),
        months,
        byMember: memberRows
          .map((r) => ({
            id: r.key,
            name: userMap.get(r.key as string) ?? "Ukendt",
            ...toStat(r),
          }))
          .sort((a, b) => a.margin - b.margin),
        byProject: projectRows
          .map((r) => ({
            id: r.key,
            name: r.key
              ? (projMap.get(r.key) ?? "Ukendt")
              : st("common.noProject"),
            ...toStat(r),
          }))
          .sort((a, b) => a.margin - b.margin),
      };
    }),

  // Udnyttelsesgrad (#143) + belægningsgrad (#704): fakturerbar tid vs.
  // total tid vs. arbejdstid pr. medarbejder + månedlig team-trend.
  // Arbejdstiden er samme grundlag som dækningsgraden (#679): brugerens
  // ugeskema eller HR-normtiden (enterprise). Perioden tælles til og med i
  // dag, så månedens resterende arbejdsdage ikke trækker tallene ned.
  // Samme adgangsmodel som team-lønsomhed (owner/admin).
  getTeamUtilization: orgAdminProcedure
    .input(
      z
        .object({ months: z.number().int().min(1).max(24).default(6) })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.orgId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "reports.utilisationNeedsOrg"),
        });
      }
      const orgId = ctx.orgId;
      const months = input?.months ?? 6;
      const now = copenhagenTodayAnchor(); // dansk dato uanset proces-TZ (#649)
      const from = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
      const fromStr = toLocalDateStr(from);
      const today = todayInTimeZone("Europe/Copenhagen", now);

      const billableExpr = sql<string>`COALESCE(SUM(CASE WHEN ${timeEntries.isBillable} = true THEN ${timeEntries.hours} ELSE 0 END), 0)`;
      const hoursExpr = sql<string>`COALESCE(SUM(${timeEntries.hours}), 0)`;
      const periodWhere = and(
        eq(timeEntries.organizationId, orgId),
        gte(timeEntries.date, from),
        dateUpperBound(timeEntries.date, today),
        ne(timeEntries.approvalStatus, "rejected"),
      );

      const [memberRows, monthRows] = await Promise.all([
        ctx.db
          .select({
            userId: timeEntries.userId,
            totalHours: hoursExpr,
            billableHours: billableExpr,
          })
          .from(timeEntries)
          .where(periodWhere)
          .groupBy(timeEntries.userId),
        ctx.db
          .select({
            month: sql<string>`to_char(${timeEntries.date}, 'YYYY-MM')`,
            totalHours: hoursExpr,
            billableHours: billableExpr,
          })
          .from(timeEntries)
          .where(periodWhere)
          .groupBy(sql`to_char(${timeEntries.date}, 'YYYY-MM')`)
          .orderBy(sql`to_char(${timeEntries.date}, 'YYYY-MM')`),
      ]);

      const userIds = memberRows
        .map((r) => r.userId)
        .filter((id): id is string => !!id);
      const enterpriseEnabled = ctx.modules.isEnabled("enterprise");
      const [userRows, workContexts] = await Promise.all([
        userIds.length
          ? ctx.db.query.users.findMany({
              where: inArray(users.id, userIds),
              columns: { id: true, name: true },
            })
          : Promise.resolve([]),
        loadWorkTimeContexts(ctx.db, userIds, orgId, { enterpriseEnabled }),
      ]);
      const userMap = new Map(userRows.map((u) => [u.id, u.name]));
      const workMap = new Map(
        [...workContexts].map(([userId, wt]) => [
          userId,
          {
            hours: workHoursInRange(fromStr, today, wt.hoursFor),
            source: wt.source,
          },
        ]),
      );

      return {
        from: fromStr,
        to: today,
        months,
        byMember: memberRows
          .map((r) => {
            const total = Number.parseFloat(r.totalHours);
            const billable = Number.parseFloat(r.billableHours);
            const work = workMap.get(r.userId);
            const workHours = work?.hours ?? 0;
            const { utilizationPct, coveragePct } = memberUtilization({
              loggedHours: total,
              billableHours: billable,
              workHours,
            });
            return {
              id: r.userId,
              name: userMap.get(r.userId) ?? "Ukendt",
              totalHours: total,
              billableHours: billable,
              billablePct: total > 0 ? (billable / total) * 100 : null,
              workHours: workHours > 0 ? workHours : null,
              workTimeSource: work?.source ?? null,
              utilizationPct,
              coveragePct,
            };
          })
          .sort((a, b) => (a.billablePct ?? 0) - (b.billablePct ?? 0)),
        trend: monthRows.map((r) => {
          const total = Number.parseFloat(r.totalHours);
          const billable = Number.parseFloat(r.billableHours);
          return {
            month: r.month,
            totalHours: total,
            billableHours: billable,
            billablePct: total > 0 ? (billable / total) * 100 : null,
          };
        }),
      };
    }),

  // Reel timepris (#97): optjente kroner (fakturerede + klippekort-træk)
  // divideret med ALLE brugte timer pr. kunde — inkl. intern/ufakturerbar
  // tid på kunden. Deterministisk SQL-aggregering, ingen AI.
  getRealRates: moduleReadProcedure("reports")
    .input(
      z
        .object({ months: z.number().int().min(1).max(36).default(12) })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const months = input?.months ?? 12;
      const now = copenhagenTodayAnchor(); // dansk dato uanset proces-TZ (#649)
      const from = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
      // Samme værn som getReportData/shares (review-fund): et medlem uden
      // viewTeamTime må kun se sin egen tid — ikke hele org'ens indtjening.
      const restrictToOwn = await shouldRestrictReportToOwn(ctx);

      const effectiveClientId = sql<
        string | null
      >`COALESCE(${projects.clientId}, ${timeEntries.clientId})`;

      // Optjent = timer x sats for poster der ER afregnet (faktureret
      // eller trukket på klippekort). Invoice-belob bruges bevidst ikke —
      // en faktura kan indeholde materialer m.m.; det her er kroner tjent
      // på arbejdstimerne.
      const rows = await ctx.db
        .select({
          clientId: effectiveClientId,
          totalHours: sql<string>`COALESCE(SUM(${timeEntries.hours}), 0)`,
          earned: sql<string>`COALESCE(SUM(CASE WHEN ${timeEntries.isBilled} = true OR ${timeEntries.isPrepaid} = true THEN ${timeEntries.hours} * COALESCE(${timeEntries.billableRate}, 0) ELSE 0 END), 0)`,
          settledHours: sql<string>`COALESCE(SUM(CASE WHEN ${timeEntries.isBilled} = true OR ${timeEntries.isPrepaid} = true THEN ${timeEntries.hours} ELSE 0 END), 0)`,
          unbilledBillableHours: sql<string>`COALESCE(SUM(CASE WHEN ${timeEntries.isBillable} = true AND ${timeEntries.isBilled} = false AND ${timeEntries.isPrepaid} = false THEN ${timeEntries.hours} ELSE 0 END), 0)`,
          nonBillableHours: sql<string>`COALESCE(SUM(CASE WHEN ${timeEntries.isBillable} = false THEN ${timeEntries.hours} ELSE 0 END), 0)`,
        })
        .from(timeEntries)
        .leftJoin(projects, eq(timeEntries.projectId, projects.id))
        .where(
          and(
            ctx.orgId
              ? eq(timeEntries.organizationId, ctx.orgId)
              : eq(timeEntries.userId, userId),
            restrictToOwn ? eq(timeEntries.userId, userId) : undefined,
            // Afvist tid er hverken arbejde eller omkostning her — den
            // ville kunstigt trække den reelle timepris ned (review-fund)
            ne(timeEntries.approvalStatus, "rejected"),
            gte(timeEntries.date, from),
          ),
        )
        .groupBy(effectiveClientId);

      // Per-medlem klientadgang + navne/satser
      const accessibleIds = ctx.orgId
        ? await getAccessibleClientIds(ctx.db, userId, ctx.orgId)
        : null;

      const clientIds = rows
        .map((r) => r.clientId)
        .filter((id): id is string => !!id)
        .filter((id) => accessibleIds === null || accessibleIds.includes(id));

      const clientRows = clientIds.length
        ? await ctx.db.query.clients.findMany({
            where: inArray(clients.id, clientIds),
            columns: { id: true, name: true, defaultHourlyRate: true },
          })
        : [];
      const clientMap = new Map(clientRows.map((c) => [c.id, c]));

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { defaultHourlyRate: true },
      });
      const defaultRate = user?.defaultHourlyRate
        ? Number.parseFloat(user.defaultHourlyRate)
        : null;

      const clientStats = rows
        .filter((r) => r.clientId && clientMap.has(r.clientId))
        .map((r) => {
          const client = clientMap.get(r.clientId as string);
          if (!client) return null;
          const totalHours = Number.parseFloat(r.totalHours);
          const earned = Number.parseFloat(r.earned);
          const nominalRate = client.defaultHourlyRate
            ? Number.parseFloat(client.defaultHourlyRate)
            : defaultRate;
          const realRate = totalHours > 0 ? earned / totalHours : 0;
          return {
            clientId: client.id,
            clientName: client.name,
            totalHours,
            earned,
            settledHours: Number.parseFloat(r.settledHours),
            unbilledBillableHours: Number.parseFloat(r.unbilledBillableHours),
            nonBillableHours: Number.parseFloat(r.nonBillableHours),
            realRate,
            nominalRate,
            rateRatio:
              nominalRate && nominalRate > 0 ? realRate / nominalRate : null,
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .sort((a, b) => a.realRate - b.realRate);

      // Poster helt uden kunde/projekt = intern tid
      const internalRow = rows.find((r) => !r.clientId);
      const internalHours = internalRow
        ? Number.parseFloat(internalRow.totalHours)
        : 0;

      return {
        from: toLocalDateStr(from),
        months,
        defaultRate,
        clients: clientStats,
        internal: {
          hours: internalHours,
          // "Tabt" omsaetning hvis timerne var solgt til standardsats —
          // en illustration, ikke bogholderi
          lostValue: defaultRate ? internalHours * defaultRate : null,
        },
      };
    }),

  // Planlagte email-rapporter (#189). Gated bag aktivt abonnement
  // (subscribedModuleReadProcedure) — premium-klassens feature hos konkurrenterne.
  // Mailen indeholder rapportdata, så rollen skal kunne læse rapporter (#1116).
  createSchedule: subscribedModuleReadProcedure("reports")
    .input(
      z.object({
        reportTemplateId: z.string().uuid(),
        frequency: z.enum(["weekly", "monthly"]),
        sendDay: z.number().int().min(1).max(28),
        recipients: z
          .array(z.string().email())
          .min(1, { error: () => st("zod.atLeastOneRecipient") })
          .max(10),
        format: z.enum(["pdf", "xlsx", "csv"]).default("pdf"),
        subject: z.string().max(200).optional(),
        message: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (input.frequency === "weekly" && input.sendDay > 7) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "reports.weekdayRange"),
        });
      }

      // Skabelonen skal tilhøre scope
      const template = await ctx.db.query.reportTemplates.findFirst({
        where: (t, { and: andT, eq: eqT }) =>
          andT(
            eqT(t.id, input.reportTemplateId),
            ctx.orgId
              ? eqT(t.organizationId, ctx.orgId)
              : eqT(t.userId, userId),
          ),
        columns: { id: true, reportType: true },
      });
      if (!template) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.templateNotFound"),
        });
      }

      const [schedule] = await ctx.db
        .insert(reportSchedules)
        .values({
          userId,
          organizationId: ctx.orgId,
          reportTemplateId: input.reportTemplateId,
          // Enterprise-skabeloner (E4, #462) routes i cron'en på reportType
          reportType: template.reportType,
          frequency: input.frequency,
          sendDay: input.sendDay,
          recipients: input.recipients,
          format: input.format,
          subject: input.subject || null,
          message: input.message || null,
          restrictToOwnEntries: await shouldRestrictReportToOwn(ctx),
        })
        .returning();

      trackEvent({
        userId,
        orgId: ctx.orgId,
        event: "report.schedule_created",
      });

      return schedule;
    }),

  listSchedules: moduleReadProcedure("reports").query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: reportSchedules.id,
        frequency: reportSchedules.frequency,
        sendDay: reportSchedules.sendDay,
        recipients: reportSchedules.recipients,
        format: reportSchedules.format,
        isActive: reportSchedules.isActive,
        lastSentAt: reportSchedules.lastSentAt,
        templateName: reportTemplates.name,
      })
      .from(reportSchedules)
      .innerJoin(
        reportTemplates,
        eq(reportSchedules.reportTemplateId, reportTemplates.id),
      )
      .where(eq(reportSchedules.userId, ctx.session.user.id))
      .orderBy(desc(reportSchedules.createdAt));
    return rows;
  }),

  toggleSchedule: protectedProcedure
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(reportSchedules)
        .set({ isActive: input.isActive })
        .where(
          and(
            eq(reportSchedules.id, input.id),
            eq(reportSchedules.userId, ctx.session.user.id),
          ),
        )
        .returning({ id: reportSchedules.id });
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.notFound"),
        });
      }
      return { success: true };
    }),

  deleteSchedule: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(reportSchedules)
        .where(
          and(
            eq(reportSchedules.id, input.id),
            eq(reportSchedules.userId, ctx.session.user.id),
          ),
        );
      return { success: true };
    }),

  // Offentligt delbart rapport-link (#190): anonymt read-only URL.
  // Config'en snapshotters; ved lockDates bages de konkrete datoer ind
  // (ellers ruller perioden, fx "denne maaned"). Revokerbart. Linket viser
  // rapportdata, så rollen skal kunne læse rapporter (#1116).
  createShareLink: moduleReadProcedure("reports")
    .input(
      z.object({
        config: reportTemplateConfigSchema,
        name: z.string().min(1).max(120),
        lockDates: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      let config = input.config;
      if (input.lockDates) {
        const { start, end } = resolveDateRange(config.filters);
        config = {
          ...config,
          filters: {
            ...config.filters,
            dateRange: "custom",
            customStart: toLocalDateStr(start),
            customEnd: toLocalDateStr(end),
          },
        };
      }

      const token = crypto.randomBytes(32).toString("base64url");

      const [share] = await ctx.db
        .insert(reportShares)
        .values({
          // Hash til opslag + enc:v1 så linket kan kopieres igen (#713).
          tokenHash: hashToken(token),
          tokenEncrypted: encryptSecret(token),
          userId,
          organizationId: ctx.orgId,
          name: input.name,
          config,
          restrictToOwnEntries: await shouldRestrictReportToOwn(ctx),
          lockedDates: input.lockDates,
        })
        .returning();

      trackEvent({
        userId: ctx.session.user.id,
        orgId: ctx.orgId,
        event: "report.share_created",
      });

      return {
        id: share.id,
        token,
        url: `${getAppUrl()}/r/${token}`,
        name: share.name,
        lockedDates: share.lockedDates,
      };
    }),

  listShareLinks: moduleReadProcedure("reports").query(async ({ ctx }) => {
    const shares = await ctx.db.query.reportShares.findMany({
      where: and(
        eq(reportShares.userId, ctx.session.user.id),
        isNull(reportShares.revokedAt),
      ),
      orderBy: [desc(reportShares.createdAt)],
      columns: {
        id: true,
        tokenEncrypted: true,
        name: true,
        lockedDates: true,
        viewCount: true,
        lastViewedAt: true,
        createdAt: true,
      },
    });
    const base = getAppUrl();
    return shares.map(({ tokenEncrypted, ...sh }) => {
      const token = revealToken(tokenEncrypted);
      return { ...sh, token, url: token ? `${base}/r/${token}` : null };
    });
  }),

  revokeShareLink: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(reportShares)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(reportShares.id, input.id),
            eq(reportShares.userId, ctx.session.user.id),
            isNull(reportShares.revokedAt),
          ),
        )
        .returning({ id: reportShares.id });
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "reports.linkNotFound"),
        });
      }
      return { success: true };
    }),

  getReportData: moduleReadProcedure("reports")
    .input(
      z.object({
        config: reportTemplateConfigSchema,
        locale: z.enum(LOCALES).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const entries = await loadReportEntries(ctx.db, {
        userId: ctx.session.user.id,
        organizationId: ctx.orgId,
        config: input.config,
        restrictToOwnEntries: await shouldRestrictReportToOwn(ctx),
      });
      const { start, end } = resolveDateRange(input.config.filters);
      const budget = showsBudgetColumn(input.config)
        ? await loadReportBudgetUsage(ctx.db, {
            entries,
            userId: ctx.session.user.id,
            organizationId: ctx.orgId,
            start,
            end,
          })
        : null;
      const aggregates = aggregateReport(entries, input.config.grouping, {
        locale: input.locale,
        budgetUsageByProject: budget?.usageByProject,
        budgetMonth: budget?.month,
        includePauses: input.config.branding.showPauses,
      });
      return {
        entries,
        aggregates,
        period: { start: toLocalDateStr(start), end: toLocalDateStr(end) },
      };
    }),

  exportReport: moduleReadProcedure("reports")
    .input(
      z.object({
        config: reportTemplateConfigSchema,
        format: z.enum(["csv", "xlsx", "json", "pdf"]),
        locale: z.enum(LOCALES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rateLimitResult = await rateLimiter.check(
        userRateLimitKey(ctx.session.user.id, "reportExport"),
        "reportExport",
      );
      if (!rateLimitResult.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: await tr("serverErrors", "common.rateLimited", {
            seconds: Math.ceil(rateLimitResult.resetIn / 1000),
          }),
        });
      }

      const entries = await loadReportEntries(ctx.db, {
        userId: ctx.session.user.id,
        organizationId: ctx.orgId,
        config: input.config,
        restrictToOwnEntries: await shouldRestrictReportToOwn(ctx),
      });

      if (entries.length > 10_000) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "reports.tooManyRows"),
        });
      }

      // Efter guards (review-fund): en afvist eksport må ikke give event.
      // Generator-fejl senere er sjældne og accepteres som edge.
      trackEvent({
        userId: ctx.session.user.id,
        orgId: ctx.orgId,
        event: "report.exported",
        metadata: { format: input.format },
      });

      const range = resolveDateRange(input.config.filters);
      const exportBudget = showsBudgetColumn(input.config)
        ? await loadReportBudgetUsage(ctx.db, {
            entries,
            userId: ctx.session.user.id,
            organizationId: ctx.orgId,
            start: range.start,
            end: range.end,
          })
        : null;
      const aggregates = aggregateReport(entries, input.config.grouping, {
        locale: input.locale,
        budgetUsageByProject: exportBudget?.usageByProject,
        budgetMonth: exportBudget?.month,
        includePauses: input.config.branding.showPauses,
      });
      // Gruppe-tabellen kommer kun med i eksporten når budget-kolonnen er
      // valgt OG grupperingen er et projekt — samme prædikat som preview og
      // PDF. Ellers ser eksporten ud som hidtil (#593).
      const exportGroups = showsBudgetColumn(input.config)
        ? aggregates.groups
        : undefined;

      if (input.format === "csv") {
        return {
          format: "csv" as const,
          data: generateCSV(entries, {
            columns: input.config.columns,
            groups: exportGroups,
            groupingNote: aggregates.groupingNote,
            pauses: aggregates.pauses,
          }),
        };
      }
      if (input.format === "json") {
        return {
          format: "json" as const,
          data: generateJSON(entries, {
            columns: input.config.columns,
            groups: exportGroups,
            groupingNote: aggregates.groupingNote,
          }),
        };
      }
      if (input.format === "xlsx") {
        const buf = await generateXLSX(entries, {
          columns: input.config.columns,
          groups: exportGroups,
          groupingNote: aggregates.groupingNote,
        });
        return {
          format: "xlsx" as const,
          data: Buffer.from(buf).toString("base64"),
        };
      }
      // PDF returns the data payload; the client renders the PDF via @react-pdf/renderer
      const { start, end } = range;
      const company = await ctx.db.query.companyProfiles.findFirst({
        where: (c, { eq: eqC }) =>
          ctx.orgId
            ? eqC(c.organizationId, ctx.orgId)
            : eqC(c.userId, ctx.session.user.id),
        columns: { name: true, logoUrl: true },
      });
      return {
        format: "pdf-data" as const,
        entries,
        aggregates,
        period: {
          start: toLocalDateStr(start),
          end: toLocalDateStr(end),
        },
        companyName: company?.name ?? "",
        logoUrl: company?.logoUrl ?? null,
      };
    }),
});
