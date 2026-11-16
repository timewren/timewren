import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { dataExportRequests, users } from "@/lib/db/schema";
import { adminProcedure, router } from "../../trpc";
import { logAdminAction } from "./shared";

/**
 * Admin-side GDPR workflow: overview of data export / deletion requests
 * with SLA (30 days per GDPR Art. 12) tracking so nothing falls through
 * the cracks.
 */
export const adminGdprRouter = router({
  listRequests: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
        status: z
          .enum([
            "pending",
            "processing",
            "ready",
            "downloaded",
            "expired",
            "failed",
          ])
          .optional(),
        slaRisk: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_gdpr_requests",
        null,
        { filters: input },
        ctx.headers,
      );

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const twentyFiveDaysAgo = new Date();
      twentyFiveDaysAgo.setDate(twentyFiveDaysAgo.getDate() - 25);

      const whereConditions = [] as ReturnType<typeof eq>[];
      if (input.status) {
        whereConditions.push(eq(dataExportRequests.status, input.status));
      }
      if (input.slaRisk) {
        // Requests created >25 days ago and not yet handled
        whereConditions.push(
          lte(dataExportRequests.createdAt, twentyFiveDaysAgo),
        );
      }

      const [rows, totalCount, slaRiskCount, slaBreachedCount] =
        await Promise.all([
          ctx.db
            .select({
              id: dataExportRequests.id,
              userId: dataExportRequests.userId,
              requestType: dataExportRequests.requestType,
              status: dataExportRequests.status,
              format: dataExportRequests.format,
              processedAt: dataExportRequests.processedAt,
              downloadedAt: dataExportRequests.downloadedAt,
              expiresAt: dataExportRequests.expiresAt,
              errorMessage: dataExportRequests.errorMessage,
              requestIp: dataExportRequests.requestIp,
              createdAt: dataExportRequests.createdAt,
              fileSizeBytes: dataExportRequests.fileSizeBytes,
              userName: users.name,
              userEmail: users.email,
            })
            .from(dataExportRequests)
            .leftJoin(users, eq(dataExportRequests.userId, users.id))
            .where(
              whereConditions.length > 0 ? and(...whereConditions) : undefined,
            )
            .orderBy(desc(dataExportRequests.createdAt))
            .limit(input.limit)
            .offset(input.offset),
          ctx.db
            .select({ count: count() })
            .from(dataExportRequests)
            .where(
              whereConditions.length > 0 ? and(...whereConditions) : undefined,
            ),
          // SLA risk: pending/processing requests >25 days old
          ctx.db
            .select({ count: count() })
            .from(dataExportRequests)
            .where(
              and(
                eq(dataExportRequests.status, "pending"),
                lte(dataExportRequests.createdAt, twentyFiveDaysAgo),
                gte(dataExportRequests.createdAt, thirtyDaysAgo),
              ),
            ),
          // SLA breached: pending requests >30 days old
          ctx.db
            .select({ count: count() })
            .from(dataExportRequests)
            .where(
              and(
                eq(dataExportRequests.status, "pending"),
                lte(dataExportRequests.createdAt, thirtyDaysAgo),
              ),
            ),
        ]);

      // Annotate each row with sla status
      const now = Date.now();
      const annotated = rows.map((r) => {
        const ageMs = now - r.createdAt.getTime();
        const ageDays = Math.floor(ageMs / (86400 * 1000));
        const slaStatus: "ok" | "approaching" | "breached" =
          r.status === "downloaded" || r.status === "ready"
            ? "ok"
            : ageDays >= 30
              ? "breached"
              : ageDays >= 25
                ? "approaching"
                : "ok";
        return { ...r, ageDays, slaStatus };
      });

      return {
        requests: annotated,
        total: totalCount[0]?.count ?? 0,
        slaRisk: slaRiskCount[0]?.count ?? 0,
        slaBreached: slaBreachedCount[0]?.count ?? 0,
      };
    }),

  markHandled: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "mark_gdpr_request_handled",
        null,
        { requestId: input.id, note: input.note ?? null },
        ctx.headers,
      );

      await ctx.db
        .update(dataExportRequests)
        .set({ status: "ready", processedAt: new Date() })
        .where(eq(dataExportRequests.id, input.id));

      return { success: true };
    }),
});
