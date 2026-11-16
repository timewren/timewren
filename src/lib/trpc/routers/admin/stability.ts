import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  clientVersionEnforced,
  minClientVersionsFromEnv,
} from "@/lib/client-version";
import { summarizeClientVersions } from "@/lib/client-version/distribution";
import {
  clients,
  organizations,
  stabilityFindings,
  timerEvents,
  users,
} from "@/lib/db/schema";
import { parseDbTimestamp } from "@/lib/time/db-timestamp";
import { adminProcedure, router } from "../../trpc";
import { logAdminAction } from "./shared";

/**
 * Stabilitetsvagtens fund (/admin/stabilitet). Kun admin. Sporet viser
 * hvornår og fra hvilken enhed en bruger har arbejdet — visningen
 * auditlogges som Timerlog-fanen.
 */
export const adminStabilityRouter = router({
  list: adminProcedure
    .input(
      z.object({
        status: z.enum(["open", "resolved", "ignored"]),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(stabilityFindings)
        .where(eq(stabilityFindings.status, input.status))
        .orderBy(
          input.status === "resolved"
            ? desc(stabilityFindings.resolvedAt)
            : desc(stabilityFindings.lastSeen),
        )
        .limit(input.limit);

      const userIds = [
        ...new Set(rows.map((r) => r.userId).filter(Boolean)),
      ] as string[];
      const orgIds = [
        ...new Set(rows.map((r) => r.organizationId).filter(Boolean)),
      ] as string[];
      const [userRows, orgRows] = await Promise.all([
        userIds.length
          ? ctx.db
              .select({ id: users.id, name: users.name, email: users.email })
              .from(users)
              .where(inArray(users.id, userIds))
          : Promise.resolve([]),
        orgIds.length
          ? ctx.db
              .select({ id: organizations.id, name: organizations.name })
              .from(organizations)
              .where(inArray(organizations.id, orgIds))
          : Promise.resolve([]),
      ]);
      const userById = new Map(userRows.map((u) => [u.id, u]));
      const orgById = new Map(orgRows.map((o) => [o.id, o.name]));

      return rows.map((r) => ({
        ...r,
        userName: r.userId ? (userById.get(r.userId)?.name ?? null) : null,
        userEmail: r.userId ? (userById.get(r.userId)?.email ?? null) : null,
        organizationName: r.organizationId
          ? (orgById.get(r.organizationId) ?? null)
          : null,
      }));
    }),

  /** Antal fund pr. detektor, første gang set inden for 24 t / 7 dage. */
  counters: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        detector: stabilityFindings.detector,
        last24h:
          sql<number>`count(*) filter (where ${stabilityFindings.firstSeen} >= (now() AT TIME ZONE 'UTC') - interval '24 hours')`.mapWith(
            Number,
          ),
        last7d: sql<number>`count(*)`.mapWith(Number),
        open: sql<number>`count(*) filter (where ${stabilityFindings.resolvedAt} IS NULL AND ${stabilityFindings.status} = 'open')`.mapWith(
          Number,
        ),
      })
      .from(stabilityFindings)
      .where(
        sql`${stabilityFindings.firstSeen} >= (now() AT TIME ZONE 'UTC') - interval '7 days' OR ${stabilityFindings.resolvedAt} IS NULL`,
      )
      .groupBy(stabilityFindings.detector);
    return rows;
  }),

  /**
   * Klienttyper og -versioner der har skrevet timer-hændelser de seneste
   * 7 dage (timer_events.client_hint) — vurderet mod MIN_CLIENT_VERSIONS.
   */
  clientVersions: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        clientHint: timerEvents.clientHint,
        source: timerEvents.source,
        writes: sql<number>`count(*)`.mapWith(Number),
        rejected:
          sql<number>`count(*) filter (where ${timerEvents.event} = 'client_too_old')`.mapWith(
            Number,
          ),
        users: sql<number>`count(distinct ${timerEvents.userId})`.mapWith(
          Number,
        ),
        lastAt: sql<Date | null>`max(${timerEvents.createdAt})`.mapWith(
          (v: Date | string | null) => parseDbTimestamp(v),
        ),
      })
      .from(timerEvents)
      .where(
        and(
          sql`${timerEvents.createdAt} >= (now() AT TIME ZONE 'UTC') - interval '7 days'`,
          sql`${timerEvents.source} NOT IN ('cron', 'api')`,
        ),
      )
      .groupBy(timerEvents.clientHint, timerEvents.source)
      .limit(1000);
    const minimums = minClientVersionsFromEnv();
    return {
      minimums,
      enforced: clientVersionEnforced(),
      rows: summarizeClientVersions(rows, minimums),
    };
  }),

  /** Timer-sporet omkring et fund (brugerens timer_events i fundets periode). */
  trail: adminProcedure
    .input(z.object({ findingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const finding = await ctx.db.query.stabilityFindings.findFirst({
        where: eq(stabilityFindings.id, input.findingId),
      });
      if (!finding) throw new TRPCError({ code: "NOT_FOUND" });
      if (!finding.userId) return [];

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_timer_events",
        finding.userId,
        { via: "stability", findingId: finding.id },
        ctx.headers,
      );

      const from = new Date(finding.firstSeen.getTime() - 2 * 60 * 60_000);
      const to = new Date(finding.lastSeen.getTime() + 60 * 60_000);
      const rows = await ctx.db
        .select()
        .from(timerEvents)
        .where(
          and(
            eq(timerEvents.userId, finding.userId),
            gte(timerEvents.createdAt, from),
            lte(timerEvents.createdAt, to),
          ),
        )
        .orderBy(desc(timerEvents.createdAt))
        .limit(100);

      const clientIds = [
        ...new Set(rows.map((r) => r.clientId).filter(Boolean)),
      ] as string[];
      const clientRows = clientIds.length
        ? await ctx.db
            .select({ id: clients.id, name: clients.name })
            .from(clients)
            .where(inArray(clients.id, clientIds))
        : [];
      const clientNames = new Map(clientRows.map((c) => [c.id, c.name]));
      return rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        event: r.event,
        source: r.source,
        clientHint: r.clientHint,
        versionBefore: r.versionBefore,
        versionAfter: r.versionAfter,
        startTime: r.startTime,
        clientName: r.clientId ? (clientNames.get(r.clientId) ?? null) : null,
        detail: r.detail,
      }));
    }),

  resolve: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(stabilityFindings)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
          resolvedBy: ctx.session.user.id,
          resolutionNote: input.note ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stabilityFindings.id, input.id),
            isNull(stabilityFindings.resolvedAt),
          ),
        )
        .returning({ id: stabilityFindings.id });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "stability_resolve",
        null,
        { findingId: input.id, note: input.note ?? null },
        ctx.headers,
      );
      return { success: true };
    }),

  /** Kendt/forklaret fund: opdateres stille, alarmerer og løses ikke. */
  ignore: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(stabilityFindings)
        .set({
          status: "ignored",
          resolutionNote: input.note ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stabilityFindings.id, input.id),
            isNull(stabilityFindings.resolvedAt),
          ),
        )
        .returning({ id: stabilityFindings.id });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "stability_ignore",
        null,
        { findingId: input.id, note: input.note ?? null },
        ctx.headers,
      );
      return { success: true };
    }),
});
