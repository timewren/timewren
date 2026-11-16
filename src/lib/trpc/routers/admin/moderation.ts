import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import {
  bannedEmailDomains,
  clients,
  invoices,
  prepaidPackages,
  projects,
  tasks,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { notifyAdmin } from "@/lib/notifications/admin";
import { adminProcedure, router, supporterProcedure } from "../../trpc";
import { deleteAllUserData, logAdminAction } from "./shared";

/** Rå DB-fejl (SQL/schema) må aldrig nå klienten — heller ikke i admin. */
async function deleteAllUserDataSafely(
  db: Parameters<typeof deleteAllUserData>[0],
  userId: string,
) {
  try {
    return await deleteAllUserData(db, userId);
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    console.error("[Admin] Sletning af bruger fejlede:", userId, err);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Sletningen kunne ikke gennemføres. Se serverloggen.",
    });
  }
}

export const adminModerationRouter = router({
  // ============================================
  // Flag System
  // Supporters can flag/unflag
  // ============================================

  flagUser: supporterProcedure
    .input(
      z.object({
        userId: z.string(),
        reason: z.string().min(1, "Angiv en årsag for flagning"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "flag_user",
        input.userId,
        { reason: input.reason },
        ctx.headers,
      );

      await ctx.db
        .update(users)
        .set({
          isFlagged: true,
          flaggedReason: input.reason,
          flaggedAt: new Date(),
          flaggedBy: ctx.session.user.id,
        })
        .where(eq(users.id, input.userId));

      notifyAdmin("user_flagged", {
        userId: input.userId,
        userName: input.userId,
        reason: input.reason,
      });

      return {
        success: true,
        message: "Bruger er nu flagget som mistænkelig",
      };
    }),

  unflagUser: supporterProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "unflag_user",
        input.userId,
        null,
        ctx.headers,
      );

      await ctx.db
        .update(users)
        .set({
          isFlagged: false,
          flaggedReason: null,
          flaggedAt: null,
          flaggedBy: null,
        })
        .where(eq(users.id, input.userId));

      return {
        success: true,
        message: "Bruger er ikke længere flagget",
      };
    }),

  // ============================================
  // Bulk User Operations
  // ============================================

  bulkFlagUsers: adminProcedure
    .input(
      z.object({
        userIds: z.array(z.string()).min(1).max(100),
        reason: z.string().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "bulk_flag_users",
        null,
        { userIds: input.userIds, reason: input.reason },
        ctx.headers,
      );

      await ctx.db
        .update(users)
        .set({
          isFlagged: true,
          flaggedReason: input.reason,
          flaggedAt: new Date(),
          flaggedBy: ctx.session.user.id,
        })
        .where(inArray(users.id, input.userIds));

      return { flagged: input.userIds.length };
    }),

  // ============================================
  // Delete User (Admin only)
  // ============================================

  deleteUser: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        reason: z.string().min(1, "Angiv en årsag for sletning"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "delete_user",
        input.userId,
        { reason: input.reason },
        ctx.headers,
      );

      // Get user info before deletion for the log
      const userToDelete = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.userId),
        columns: { id: true, name: true, email: true, role: true },
      });

      if (!userToDelete) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bruger ikke fundet",
        });
      }

      // Don't allow deleting admin users
      if (userToDelete.role === "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Kan ikke slette admin brugere",
        });
      }

      // Don't allow deleting yourself
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Kan ikke slette din egen konto",
        });
      }

      // Slet brugeren (solo-data) / anonymisér i teams (#918)
      const { outcome } = await deleteAllUserDataSafely(ctx.db, input.userId);

      return {
        success: true,
        message:
          outcome === "anonymized"
            ? `Bruger "${userToDelete.name || userToDelete.email}" er slettet og anonymiseret i sine teams`
            : `Bruger "${userToDelete.name || userToDelete.email}" er slettet`,
        deletedUser: {
          id: userToDelete.id,
          name: userToDelete.name,
        },
      };
    }),

  // ============================================
  // Bulk Delete Users (Admin only)
  // ============================================

  bulkDeleteUsers: adminProcedure
    .input(
      z.object({
        userIds: z.array(z.string()).min(1).max(50),
        reason: z.string().min(1, "Angiv en årsag for sletning"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "bulk_delete_users",
        null,
        { userIds: input.userIds, reason: input.reason },
        ctx.headers,
      );

      // Filter out admins and self
      const usersToDelete = await ctx.db.query.users.findMany({
        where: and(
          inArray(users.id, input.userIds),
          ne(users.role, "admin"),
          ne(users.id, ctx.session.user.id),
        ),
        columns: { id: true, name: true },
      });

      const idsToDelete = usersToDelete.map((u) => u.id);

      if (idsToDelete.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ingen gyldige brugere at slette",
        });
      }

      // Slet hver bruger; eneste ejere af et team springes over (#918)
      let deletedCount = 0;
      const blocked: string[] = [];
      for (const id of idsToDelete) {
        try {
          await deleteAllUserDataSafely(ctx.db, id);
          deletedCount++;
        } catch (err) {
          if (err instanceof TRPCError && err.code === "PRECONDITION_FAILED") {
            blocked.push(id);
            continue;
          }
          throw err;
        }
      }

      return {
        success: true,
        deletedCount,
        skippedCount: input.userIds.length - deletedCount,
        blockedUserIds: blocked,
        message:
          blocked.length > 0
            ? `${deletedCount} brugere slettet. ${blocked.length} er eneste ejer af et team og skal overdrage ejerskabet først`
            : `${deletedCount} brugere slettet`,
      };
    }),

  // ============================================
  // Ban/Unban Email Domain (Admin only)
  // ============================================

  banEmailDomain: adminProcedure
    .input(
      z.object({
        domain: z
          .string()
          .min(3, "Domæne skal være mindst 3 tegn")
          .refine(
            (d) => !d.includes("@"),
            "Indtast kun domæne, ikke fuld email",
          ),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const normalizedDomain = input.domain.toLowerCase().trim();

      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "ban_email_domain",
        null,
        { domain: normalizedDomain, reason: input.reason },
        ctx.headers,
      );

      // Check if already banned
      const existing = await ctx.db.query.bannedEmailDomains.findFirst({
        where: eq(bannedEmailDomains.domain, normalizedDomain),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Dette domæne er allerede blokeret",
        });
      }

      // Insert banned domain
      await ctx.db.insert(bannedEmailDomains).values({
        domain: normalizedDomain,
        reason: input.reason,
        bannedBy: ctx.session.user.id,
      });

      return {
        success: true,
        message: `Domæne "${normalizedDomain}" er nu blokeret`,
        domain: normalizedDomain,
      };
    }),

  unbanEmailDomain: adminProcedure
    .input(z.object({ domain: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const normalizedDomain = input.domain.toLowerCase().trim();

      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "unban_email_domain",
        null,
        { domain: normalizedDomain },
        ctx.headers,
      );

      await ctx.db
        .delete(bannedEmailDomains)
        .where(eq(bannedEmailDomains.domain, normalizedDomain));

      return {
        success: true,
        message: `Domæne "${normalizedDomain}" er nu fjernet fra blokering`,
        domain: normalizedDomain,
      };
    }),

  listBannedDomains: supporterProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "list_banned_domains",
        null,
        { limit: input.limit, offset: input.offset },
        ctx.headers,
      );

      const domains = await ctx.db
        .select({
          id: bannedEmailDomains.id,
          domain: bannedEmailDomains.domain,
          reason: bannedEmailDomains.reason,
          createdAt: bannedEmailDomains.createdAt,
          adminId: users.id,
          adminName: users.name,
        })
        .from(bannedEmailDomains)
        .leftJoin(users, eq(bannedEmailDomains.bannedBy, users.id))
        .orderBy(desc(bannedEmailDomains.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const totalCount = await ctx.db
        .select({ count: count() })
        .from(bannedEmailDomains);

      return {
        domains: domains.map((d) => ({
          ...d,
          admin: d.adminId ? { id: d.adminId, name: d.adminName } : null,
        })),
        total: totalCount[0]?.count ?? 0,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  // ============================================
  // GDPR Data Export
  // Supporters can trigger
  // ============================================

  exportUserData: supporterProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "export_user_data",
        input.userId,
        null,
        ctx.headers,
      );

      // Gather all user data
      const [
        userData,
        clientsData,
        projectsData,
        timeEntriesData,
        invoicesData,
        prepaidData,
        tasksData,
      ] = await Promise.all([
        ctx.db.query.users.findFirst({
          where: eq(users.id, input.userId),
        }),
        ctx.db.query.clients.findMany({
          where: eq(clients.userId, input.userId),
        }),
        ctx.db.query.projects.findMany({
          where: eq(projects.userId, input.userId),
        }),
        ctx.db.query.timeEntries.findMany({
          where: eq(timeEntries.userId, input.userId),
        }),
        ctx.db.query.invoices.findMany({
          where: eq(invoices.userId, input.userId),
        }),
        ctx.db.query.prepaidPackages.findMany({
          where: eq(prepaidPackages.userId, input.userId),
        }),
        ctx.db.query.tasks.findMany({
          where: eq(tasks.userId, input.userId),
        }),
      ]);

      if (!userData) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bruger ikke fundet",
        });
      }

      return {
        exportedAt: new Date().toISOString(),
        user: userData,
        clients: clientsData,
        projects: projectsData,
        timeEntries: timeEntriesData,
        invoices: invoicesData,
        prepaidPackages: prepaidData,
        tasks: tasksData,
      };
    }),
});
