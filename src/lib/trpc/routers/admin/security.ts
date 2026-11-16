import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { adminActivityLogs, members, sessions, users } from "@/lib/db/schema";
import { logOrgAudit } from "@/lib/org-audit";
import { adminProcedure, router } from "../../trpc";
import { logAdminAction } from "./shared";

/**
 * Security dashboard: looks at session patterns, banned / flagged users,
 * and impersonation activity to surface signals that deserve admin
 * attention.
 *
 * We don't track failed login attempts directly (Better-Auth doesn't
 * persist them by default), but we can still provide meaningful signal
 * from what we have.
 */
export const adminSecurityRouter = router({
  getOverview: adminProcedure
    .input(
      z.object({
        daysBack: z.number().min(1).max(90).default(14),
      }),
    )
    .query(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_security_overview",
        null,
        { daysBack: input.daysBack },
        ctx.headers,
      );

      const since = new Date();
      since.setDate(since.getDate() - input.daysBack);
      const now = new Date();

      const [
        totalSessions,
        activeSessions,
        uniqueLoginUsers,
        bannedUsers,
        flaggedUsers,
        impersonationSessions,
        recentLogins,
        topIps,
      ] = await Promise.all([
        ctx.db
          .select({ count: count() })
          .from(sessions)
          .where(gte(sessions.createdAt, since)),
        ctx.db
          .select({ count: count() })
          .from(sessions)
          .where(and(gte(sessions.expiresAt, now))),
        ctx.db
          .select({
            count: sql<number>`count(distinct ${sessions.userId})`,
          })
          .from(sessions)
          .where(gte(sessions.createdAt, since)),
        ctx.db
          .select({ count: count() })
          .from(users)
          .where(eq(users.banned, true)),
        ctx.db
          .select({ count: count() })
          .from(users)
          .where(eq(users.isFlagged, true)),
        ctx.db
          .select({
            id: sessions.id,
            userId: sessions.userId,
            impersonatedBy: sessions.impersonatedBy,
            ipAddress: sessions.ipAddress,
            userAgent: sessions.userAgent,
            createdAt: sessions.createdAt,
          })
          .from(sessions)
          .where(
            and(
              isNotNull(sessions.impersonatedBy),
              gte(sessions.createdAt, since),
            ),
          )
          .orderBy(desc(sessions.createdAt))
          .limit(20),
        ctx.db
          .select({
            id: sessions.id,
            userId: sessions.userId,
            ipAddress: sessions.ipAddress,
            userAgent: sessions.userAgent,
            createdAt: sessions.createdAt,
            userName: users.name,
            userEmail: users.email,
            userRole: users.role,
          })
          .from(sessions)
          .leftJoin(users, eq(sessions.userId, users.id))
          .where(gte(sessions.createdAt, since))
          .orderBy(desc(sessions.createdAt))
          .limit(50),
        ctx.db
          .select({
            ipAddress: sessions.ipAddress,
            loginCount: count(),
            uniqueUsers: sql<number>`count(distinct ${sessions.userId})`,
          })
          .from(sessions)
          .where(
            and(gte(sessions.createdAt, since), isNotNull(sessions.ipAddress)),
          )
          .groupBy(sessions.ipAddress)
          .orderBy(desc(count()))
          .limit(10),
      ]);

      // Identify "shared IPs": single IP with multiple distinct users.
      // Could be a shared office, or could be a flag.
      const sharedIps = topIps.filter((row) => Number(row.uniqueUsers) > 1);

      return {
        summary: {
          totalSessions: Number(totalSessions[0]?.count ?? 0),
          activeSessions: Number(activeSessions[0]?.count ?? 0),
          uniqueLoginUsers: Number(uniqueLoginUsers[0]?.count ?? 0),
          bannedUsers: Number(bannedUsers[0]?.count ?? 0),
          flaggedUsers: Number(flaggedUsers[0]?.count ?? 0),
          impersonationCount: impersonationSessions.length,
          sharedIpCount: sharedIps.length,
        },
        impersonationSessions,
        recentLogins,
        topIps,
        sharedIps,
      };
    }),

  /**
   * Recent admin actions that modify security state (ban, flag, verify,
   * impersonate, delete user, change role, etc.)
   */
  getSecurityAuditTrail: adminProcedure
    .input(
      z.object({
        daysBack: z.number().min(1).max(90).default(14),
        limit: z.number().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const since = new Date();
      since.setDate(since.getDate() - input.daysBack);

      const securityActions = [
        "flag_user",
        "unflag_user",
        "ban_user",
        "unban_user",
        "manual_verify_email",
        "delete_user",
        "bulk_delete_users",
        "bulk_flag_users",
        "change_user_role",
        "impersonate_user",
        "ban_email_domain",
        "unban_email_domain",
      ];

      return ctx.db
        .select({
          id: adminActivityLogs.id,
          action: adminActivityLogs.action,
          adminUserId: adminActivityLogs.adminUserId,
          targetUserId: adminActivityLogs.targetUserId,
          details: adminActivityLogs.details,
          ipAddress: adminActivityLogs.ipAddress,
          userAgent: adminActivityLogs.userAgent,
          createdAt: adminActivityLogs.createdAt,
          adminName: users.name,
          adminEmail: users.email,
        })
        .from(adminActivityLogs)
        .leftJoin(users, eq(adminActivityLogs.adminUserId, users.id))
        .where(
          and(
            gte(adminActivityLogs.createdAt, since),
            sql`${adminActivityLogs.action} IN (${sql.join(
              securityActions.map((a) => sql`${a}`),
              sql`, `,
            )})`,
          ),
        )
        .orderBy(desc(adminActivityLogs.createdAt))
        .limit(input.limit);
    }),

  /**
   * Log the intent to impersonate a user. Called by the admin UI before
   * invoking Better Auth's impersonateUser. The reason is stored in the
   * admin audit log alongside who impersonated whom and from where.
   */
  logImpersonation: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        reason: z.string().min(3, "Angiv en årsag for impersonation").max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify target exists and isn't self
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Kan ikke impersonere dig selv",
        });
      }
      const target = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.userId),
        columns: { id: true, email: true, name: true, role: true },
      });
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bruger ikke fundet",
        });
      }
      if (target.role === "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Kan ikke impersonere admin-brugere",
        });
      }

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "impersonate_user",
        input.userId,
        {
          reason: input.reason,
          targetEmail: target.email,
          targetName: target.name,
        },
        ctx.headers,
      );

      // Synligt for org-admin (#466): en post i hver af målbrugerens
      // organisationers hændelseslog, så en offentlig arbejdsgiver kan se
      // at support har haft adgang som deres medarbejder. Aldrig årsagen —
      // den kan indeholde support-interne detaljer.
      const memberships = await ctx.db.query.members.findMany({
        where: eq(members.userId, input.userId),
        columns: { organizationId: true },
      });
      for (const m of memberships) {
        await logOrgAudit(
          ctx.db,
          m.organizationId,
          ctx.session.user.id,
          "admin_impersonation_started",
          {
            targetUserId: input.userId,
            targetEmail: target.email,
            metadata: { targetName: target.name },
          },
        );
      }

      return { ok: true };
    }),
});
