import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { calculateChurnRisk } from "@/lib/admin/churn-risk";
import { authForBrand } from "@/lib/auth";
import {
  accounts,
  adminActivityLogs,
  adminUserNotes,
  bannedDomains,
  calendarConnections,
  clients,
  companyProfiles,
  emailIntegrations,
  emailPreferences,
  invoices,
  onboardingProgress,
  passkeys,
  projects,
  sessions,
  subscriptions,
  timeEntries,
  trustedDevices,
  twoFactors,
  users,
} from "@/lib/db/schema";
import { recipientMailBrand } from "@/lib/email/mail-brand";
import { getFoundingAvailability } from "@/lib/founding-tier";
import { PERSONAL_FROM_EMAIL, resend } from "@/lib/resend";
import { parseDbTimestamp } from "@/lib/time/db-timestamp";
import { rateLimiter } from "@/lib/utils/rate-limiter";
import { escapeCsv } from "@/lib/utils/spreadsheet";
import { adminProcedure, router, supporterProcedure } from "../../trpc";
import { logAdminAction } from "./shared";

export const adminUsersRouter = router({
  // ============================================
  // User List (Without GDPR Data)
  // Supporters can view
  // ============================================

  listUsers: supporterProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
        onlyFlagged: z.boolean().optional(),
        role: z.enum(["user", "supporter", "admin"]).optional(),
        segment: z
          .enum([
            "new_7d",
            "inactive_30d",
            "power",
            "klippekort",
            "unverified",
            "churn_high",
            "churn_medium",
          ])
          .optional(),
        sortBy: z.enum(["created", "name", "lastActive"]).default("created"),
        sortDir: z.enum(["asc", "desc"]).default("desc"),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "list_users",
        null,
        { limit: input.limit, offset: input.offset, hasSearch: !!input.search },
        ctx.headers,
      );

      // Build where conditions
      const conditions = [];
      if (input.onlyFlagged) {
        conditions.push(eq(users.isFlagged, true));
      }
      if (input.role) {
        conditions.push(eq(users.role, input.role));
      }
      if (input.search) {
        conditions.push(ilike(users.name, `%${input.search}%`));
      }

      // Segment filters
      if (input.segment === "new_7d") {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        conditions.push(gte(users.createdAt, sevenDaysAgo));
      } else if (input.segment === "unverified") {
        conditions.push(eq(users.emailVerified, false));
      } else if (input.segment === "klippekort") {
        conditions.push(
          sql`${users.id} IN (SELECT DISTINCT user_id FROM prepaid_packages)`,
        );
      } else if (input.segment === "inactive_30d") {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        conditions.push(
          sql`${users.id} NOT IN (SELECT DISTINCT "userId" FROM session WHERE "createdAt" >= ${thirtyDaysAgo.toISOString()})`,
        );
      } else if (input.segment === "power") {
        // Power users: >10 sessions in last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        conditions.push(
          sql`${users.id} IN (SELECT "userId" FROM session WHERE "createdAt" >= ${thirtyDaysAgo.toISOString()} GROUP BY "userId" HAVING COUNT(*) > 10)`,
        );
      } else if (input.segment === "churn_high") {
        const churnUsers = await calculateChurnRisk(ctx.db, {
          limit: 200,
          minLevel: "high",
        });
        const ids = churnUsers.map((u) => u.userId);
        if (ids.length > 0) {
          conditions.push(
            sql`${users.id} IN (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          );
        } else {
          conditions.push(sql`false`);
        }
      } else if (input.segment === "churn_medium") {
        const churnUsers = await calculateChurnRisk(ctx.db, {
          limit: 200,
          minLevel: "medium",
        });
        const ids = churnUsers.map((u) => u.userId);
        if (ids.length > 0) {
          conditions.push(
            sql`${users.id} IN (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          );
        } else {
          conditions.push(sql`false`);
        }
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      // Determine sort direction
      const orderDirection = input.sortDir === "asc" ? sql`ASC` : sql`DESC`;

      // Optimized single query with subqueries for counts
      const result = await ctx.db.execute(sql`
        SELECT
          "user".id, "user".name, "user"."createdAt", "user"."onboarding_completed" as onboarding_completed,
          "user".role, "user".is_flagged, "user".flagged_reason, "user"."flagged_at", "user".is_demo,
          COALESCE(c.cnt, 0) as client_count,
          COALESCE(p.cnt, 0) as project_count,
          COALESCE(te.cnt, 0) as time_entry_count,
          s.last_active,
          sub.founding_tier
        FROM "user"
        LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM clients GROUP BY user_id) c ON c.user_id = "user".id
        LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM projects GROUP BY user_id) p ON p.user_id = "user".id
        LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM time_entries GROUP BY user_id) te ON te.user_id = "user".id
        LEFT JOIN (SELECT "userId", MAX("createdAt") as last_active FROM session GROUP BY "userId") s ON s."userId" = "user".id
        LEFT JOIN subscriptions sub ON sub.user_id = "user".id
        ${whereClause ? sql`WHERE ${whereClause}` : sql``}
        ORDER BY ${input.sortBy === "lastActive" ? sql`s.last_active` : input.sortBy === "name" ? sql`"user".name` : sql`"user"."createdAt"`} ${orderDirection} NULLS LAST
        LIMIT ${input.limit}
        OFFSET ${input.offset}
      `);

      // Get total count for pagination
      const totalQuery = ctx.db.select({ count: count() }).from(users);
      const totalCount = whereClause
        ? await totalQuery.where(whereClause)
        : await totalQuery;

      const userStats = (
        result as unknown as Array<{
          id: string;
          name: string;
          createdAt: Date | string;
          onboarding_completed: boolean;
          role: string;
          is_flagged: boolean;
          flagged_reason: string | null;
          flagged_at: Date | string | null;
          is_demo: boolean;
          client_count: number;
          project_count: number;
          time_entry_count: number;
          last_active: Date | string | null;
          founding_tier: string | null;
        }>
      ).map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: parseDbTimestamp(r.createdAt) as Date,
        onboardingCompleted: r.onboarding_completed,
        role: r.role,
        isFlagged: r.is_flagged,
        flaggedReason: r.flagged_reason,
        flaggedAt: parseDbTimestamp(r.flagged_at),
        isDemo: r.is_demo,
        clientCount: Number(r.client_count),
        projectCount: Number(r.project_count),
        timeEntryCount: Number(r.time_entry_count),
        lastActive: parseDbTimestamp(r.last_active),
        foundingTier: r.founding_tier,
      }));

      return {
        users: userStats,
        total: totalCount[0]?.count ?? 0,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  // ============================================
  // Support Mode - View User Data (GDPR-safe)
  // Supporters can view (without email)
  // ============================================

  getUserForSupport: supporterProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_user_for_support",
        input.userId,
        null,
        ctx.headers,
      );

      // Get basic user info (WITHOUT email, phone, API keys for supporters)
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.userId),
        columns: {
          id: true,
          name: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          onboardingCompleted: true,
          role: true,
          theme: true,
          weeklyHourGoal: true,
          aiAutonomyLevel: true,
          aiProvider: true,
          isFlagged: true,
          flaggedReason: true,
          flaggedAt: true,
        },
      });

      if (!user) {
        return null;
      }

      // Get aggregated stats
      const [
        clientCount,
        projectCount,
        timeEntryCount,
        invoiceCount,
        notesCount,
      ] = await Promise.all([
        ctx.db
          .select({ count: count() })
          .from(clients)
          .where(eq(clients.userId, input.userId)),
        ctx.db
          .select({ count: count() })
          .from(projects)
          .where(eq(projects.userId, input.userId)),
        ctx.db
          .select({ count: count() })
          .from(timeEntries)
          .where(eq(timeEntries.userId, input.userId)),
        ctx.db
          .select({ count: count() })
          .from(invoices)
          .where(eq(invoices.userId, input.userId)),
        ctx.db
          .select({ count: count() })
          .from(adminUserNotes)
          .where(eq(adminUserNotes.userId, input.userId)),
      ]);

      return {
        ...user,
        stats: {
          clients: clientCount[0]?.count ?? 0,
          projects: projectCount[0]?.count ?? 0,
          timeEntries: timeEntryCount[0]?.count ?? 0,
          invoices: invoiceCount[0]?.count ?? 0,
          notes: notesCount[0]?.count ?? 0,
        },
      };
    }),

  // ============================================
  // View User Email (Admin only - GDPR sensitive)
  // ============================================

  getUserEmail: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_user_email",
        input.userId,
        null,
        ctx.headers,
      );

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.userId),
        columns: { email: true },
      });

      if (!user) {
        return null;
      }

      // Return full email and domain for ban suggestion
      const domain = user.email.split("@")[1];
      return { email: user.email, domain };
    }),

  // ============================================
  // Admin-only: Rich user profile (all non-GDPR metadata)
  // ============================================

  getUserAdminProfile: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_user_admin_profile",
        input.userId,
        null,
        ctx.headers,
      );

      const [user, companyProfile, onboarding, emailPrefs, subscription] =
        await Promise.all([
          ctx.db.query.users.findFirst({
            where: eq(users.id, input.userId),
            columns: {
              id: true,
              email: true,
              emailVerified: true,
              name: true,
              image: true,
              phoneNumber: true,
              phoneNumberVerified: true,
              role: true,
              locale: true,
              theme: true,
              timezone: true,
              weeklyHourGoal: true,
              workingHoursStart: true,
              workingHoursEnd: true,
              workingDays: true,
              onboardingCompleted: true,
              twoFactorEnabled: true,
              aiAutonomyLevel: true,
              aiEmailProcessing: true,
              aiProvider: true,
              aiModel: true,
              approvalWorkflow: true,
              defaultAccountingIntegration: true,
              autoSyncInvoices: true,
              prepaidAlertRecipient: true,
              lastSeenChangelogId: true,
              isFlagged: true,
              flaggedReason: true,
              flaggedAt: true,
              attrSource: true,
              attrMedium: true,
              attrCampaign: true,
              attrReferrer: true,
              attrLandingPage: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
          ctx.db.query.companyProfiles.findFirst({
            where: eq(companyProfiles.userId, input.userId),
          }),
          ctx.db.query.onboardingProgress.findFirst({
            where: eq(onboardingProgress.userId, input.userId),
          }),
          ctx.db.query.emailPreferences.findFirst({
            where: eq(emailPreferences.userId, input.userId),
          }),
          ctx.db.query.subscriptions.findFirst({
            where: eq(subscriptions.userId, input.userId),
          }),
        ]);

      if (!user) return null;

      return {
        user,
        companyProfile: companyProfile ?? null,
        onboarding: onboarding ?? null,
        emailPreferences: emailPrefs ?? null,
        subscription: subscription ?? null,
      };
    }),

  // ============================================
  // Admin-only: Sessions & security info
  // ============================================

  getUserSecurityInfo: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_user_security",
        input.userId,
        null,
        ctx.headers,
      );

      const now = new Date();
      const [
        activeSessions,
        recentSessions,
        userPasskeys,
        userTrustedDevices,
        twoFactorRow,
        oauthAccounts,
      ] = await Promise.all([
        ctx.db
          .select({ count: count() })
          .from(sessions)
          .where(
            and(eq(sessions.userId, input.userId), gt(sessions.expiresAt, now)),
          ),
        ctx.db
          .select({
            id: sessions.id,
            ipAddress: sessions.ipAddress,
            userAgent: sessions.userAgent,
            createdAt: sessions.createdAt,
            expiresAt: sessions.expiresAt,
          })
          .from(sessions)
          .where(eq(sessions.userId, input.userId))
          .orderBy(desc(sessions.createdAt))
          .limit(25),
        ctx.db
          .select({
            id: passkeys.id,
            name: passkeys.name,
            deviceType: passkeys.deviceType,
            backedUp: passkeys.backedUp,
            createdAt: passkeys.createdAt,
          })
          .from(passkeys)
          .where(eq(passkeys.userId, input.userId)),
        ctx.db
          .select({
            id: trustedDevices.id,
            userAgent: trustedDevices.userAgent,
            ipAddress: trustedDevices.ipAddress,
            lastUsed: trustedDevices.lastUsed,
            expiresAt: trustedDevices.expiresAt,
            createdAt: trustedDevices.createdAt,
          })
          .from(trustedDevices)
          .where(eq(trustedDevices.userId, input.userId))
          .orderBy(desc(trustedDevices.lastUsed)),
        ctx.db.query.twoFactors.findFirst({
          where: eq(twoFactors.userId, input.userId),
          columns: { id: true, createdAt: true, updatedAt: true },
        }),
        ctx.db
          .select({
            id: accounts.id,
            providerId: accounts.providerId,
            createdAt: accounts.createdAt,
          })
          .from(accounts)
          .where(eq(accounts.userId, input.userId)),
      ]);

      return {
        activeSessionCount: activeSessions[0]?.count ?? 0,
        recentSessions,
        passkeys: userPasskeys,
        trustedDevices: userTrustedDevices,
        twoFactor: twoFactorRow
          ? {
              enrolledAt: twoFactorRow.createdAt,
              updatedAt: twoFactorRow.updatedAt,
            }
          : null,
        oauthAccounts,
      };
    }),

  // ============================================
  // Admin-only: Integration setup status (no secrets)
  // ============================================

  getUserIntegrations: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_user_integrations",
        input.userId,
        null,
        ctx.headers,
      );

      const [user, calendarList, emailInts] = await Promise.all([
        ctx.db.query.users.findFirst({
          where: eq(users.id, input.userId),
          columns: {
            billyApiKey: true,
            billyOrganizationId: true,
            dineroApiKey: true,
            dineroOrganizationId: true,
            dineroOrgName: true,
            dineroTokenExpiry: true,
            economicAppSecretToken: true,
            economicAgreementGrantToken: true,
            timeopsApiKey: true,
            aiProvider: true,
            aiApiKey: true,
            aiApiUrl: true,
            aiModel: true,
            defaultAccountingIntegration: true,
            autoSyncInvoices: true,
            inboundEmailId: true,
            resendContactId: true,
          },
        }),
        ctx.db
          .select({
            id: calendarConnections.id,
            provider: calendarConnections.provider,
            providerAccountId: calendarConnections.providerAccountId,
            calendarName: calendarConnections.calendarName,
            syncEnabled: calendarConnections.syncEnabled,
            lastSynced: calendarConnections.lastSynced,
            tokenExpiry: calendarConnections.tokenExpiry,
            createdAt: calendarConnections.createdAt,
          })
          .from(calendarConnections)
          .where(eq(calendarConnections.userId, input.userId)),
        ctx.db
          .select({
            id: emailIntegrations.id,
            imapHost: emailIntegrations.imapHost,
            imapUsername: emailIntegrations.imapUsername,
            syncEnabled: emailIntegrations.syncEnabled,
            lastSyncedAt: emailIntegrations.lastSyncedAt,
            lastSyncStatus: emailIntegrations.lastSyncStatus,
            createdAt: emailIntegrations.createdAt,
          })
          .from(emailIntegrations)
          .where(eq(emailIntegrations.userId, input.userId)),
      ]);

      if (!user) return null;

      // Convert API keys to boolean "configured" flags so we don't leak secrets
      return {
        accounting: {
          billy: {
            configured: Boolean(user.billyApiKey),
            organizationId: user.billyOrganizationId ?? null,
          },
          dinero: {
            configured: Boolean(user.dineroApiKey || user.dineroOrganizationId),
            organizationId: user.dineroOrganizationId ?? null,
            orgName: user.dineroOrgName ?? null,
            tokenExpiresAt: user.dineroTokenExpiry ?? null,
          },
          economic: {
            configured: Boolean(
              user.economicAppSecretToken && user.economicAgreementGrantToken,
            ),
          },
          defaultIntegration: user.defaultAccountingIntegration ?? null,
          autoSyncInvoices: user.autoSyncInvoices ?? false,
        },
        ai: {
          provider: user.aiProvider ?? "system",
          model: user.aiModel ?? null,
          customUrl: user.aiApiUrl ?? null,
          hasCustomKey: Boolean(user.aiApiKey),
        },
        timeops: { configured: Boolean(user.timeopsApiKey) },
        calendars: calendarList,
        emailIntegrations: emailInts,
        inbound: {
          inboundEmailId: user.inboundEmailId ?? null,
          resendContactId: user.resendContactId ?? null,
        },
      };
    }),

  getUserClients: supporterProcedure
    .input(
      z.object({
        userId: z.string(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_user_clients",
        input.userId,
        { limit: input.limit },
        ctx.headers,
      );

      // Get clients WITHOUT contact info (no email, phone, address, CVR)
      const clientList = await ctx.db
        .select({
          id: clients.id,
          name: clients.name,
          company: clients.company,
          isActive: clients.isActive,
          isArchived: clients.isArchived,
          createdAt: clients.createdAt,
        })
        .from(clients)
        .where(eq(clients.userId, input.userId))
        .orderBy(desc(clients.createdAt))
        .limit(input.limit);

      return clientList;
    }),

  getUserProjects: supporterProcedure
    .input(
      z.object({
        userId: z.string(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_user_projects",
        input.userId,
        { limit: input.limit },
        ctx.headers,
      );

      const projectList = await ctx.db.query.projects.findMany({
        where: eq(projects.userId, input.userId),
        orderBy: [desc(projects.createdAt)],
        limit: input.limit,
        columns: {
          id: true,
          name: true,
          description: true,
          status: true,
          startDate: true,
          endDate: true,
          createdAt: true,
        },
        with: {
          client: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      return projectList;
    }),

  getUserTimeEntries: supporterProcedure
    .input(
      z.object({
        userId: z.string(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_user_time_entries",
        input.userId,
        { limit: input.limit },
        ctx.headers,
      );

      const entries = await ctx.db.query.timeEntries.findMany({
        where: eq(timeEntries.userId, input.userId),
        orderBy: [desc(timeEntries.date)],
        limit: input.limit,
        columns: {
          id: true,
          description: true,
          hours: true,
          date: true,
          isBillable: true,
          isBilled: true,
          createdAt: true,
        },
        with: {
          project: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      return entries;
    }),

  getUserInvoices: supporterProcedure
    .input(
      z.object({
        userId: z.string(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_user_invoices",
        input.userId,
        { limit: input.limit },
        ctx.headers,
      );

      const invoiceList = await ctx.db.query.invoices.findMany({
        where: eq(invoices.userId, input.userId),
        orderBy: [desc(invoices.createdAt)],
        limit: input.limit,
        columns: {
          id: true,
          invoiceNumber: true,
          amount: true,
          status: true,
          issueDate: true,
          dueDate: true,
          paidDate: true,
          createdAt: true,
        },
        with: {
          client: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      return invoiceList;
    }),

  // ============================================
  // User Notes System
  // Supporters can add/view notes
  // ============================================

  addUserNote: supporterProcedure
    .input(
      z.object({
        userId: z.string(),
        content: z.string().min(1, "Note må ikke være tom"),
        isImportant: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "add_user_note",
        input.userId,
        { isImportant: input.isImportant },
        ctx.headers,
      );

      const [note] = await ctx.db
        .insert(adminUserNotes)
        .values({
          userId: input.userId,
          authorId: ctx.session.user.id,
          content: input.content,
          isImportant: input.isImportant,
        })
        .returning();

      return {
        success: true,
        note,
      };
    }),

  getUserNotes: supporterProcedure
    .input(
      z.object({
        userId: z.string(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_user_notes",
        input.userId,
        null,
        ctx.headers,
      );

      const notes = await ctx.db
        .select({
          id: adminUserNotes.id,
          content: adminUserNotes.content,
          isImportant: adminUserNotes.isImportant,
          createdAt: adminUserNotes.createdAt,
          updatedAt: adminUserNotes.updatedAt,
          authorId: users.id,
          authorName: users.name,
        })
        .from(adminUserNotes)
        .leftJoin(users, eq(adminUserNotes.authorId, users.id))
        .where(eq(adminUserNotes.userId, input.userId))
        .orderBy(desc(adminUserNotes.createdAt))
        .limit(input.limit);

      return notes.map((note) => ({
        ...note,
        author: note.authorId
          ? { id: note.authorId, name: note.authorName }
          : null,
      }));
    }),

  deleteUserNote: supporterProcedure
    .input(z.object({ noteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Get note to check ownership and for logging
      const note = await ctx.db.query.adminUserNotes.findFirst({
        where: eq(adminUserNotes.id, input.noteId),
      });

      if (!note) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Note ikke fundet",
        });
      }

      // Only the author or an admin can delete the note
      if (note.authorId !== ctx.session.user.id && ctx.userRole !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Du kan kun slette dine egne noter",
        });
      }

      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "delete_user_note",
        note.userId,
        { noteId: input.noteId },
        ctx.headers,
      );

      await ctx.db
        .delete(adminUserNotes)
        .where(eq(adminUserNotes.id, input.noteId));

      return { success: true };
    }),

  // ============================================
  // Support Features - Resend Verification Email
  // Supporters can trigger
  // ============================================

  resendVerificationEmail: supporterProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "resend_verification_email",
        input.userId,
        null,
        ctx.headers,
      );

      // Get user email
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.userId),
        columns: { email: true, emailVerified: true, name: true, brand: true },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bruger ikke fundet",
        });
      }

      if (user.emailVerified) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Brugerens email er allerede verificeret",
        });
      }

      // Linket bygges af kontoens brand-instans (timewren.com / timetrack.dk).
      await authForBrand(user.brand).api.sendVerificationEmail({
        body: {
          email: user.email,
          callbackURL: "/dashboard",
        },
      });

      return {
        success: true,
        message: `Verifikationsemail sendt til ${user.email}`,
      };
    }),

  // ============================================
  // Support Features - Send Password Reset
  // Supporters can trigger
  // ============================================

  sendPasswordResetForUser: supporterProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const supporterId = ctx.session.user.id;

      // Rate limit per (supporter, target) pair — the documented support
      // workflow still, but prevents a compromised or abusive supporter
      // account from spamming reset emails at a single user.
      const rateLimitKey = `supporterPasswordReset:${supporterId}:${input.userId}`;
      const limit = await rateLimiter.check(
        rateLimitKey,
        "supporterPasswordReset",
      );
      if (!limit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `For mange password reset forsøg. Prøv igen om ${Math.ceil(limit.resetIn / 60_000)} minutter.`,
        });
      }

      // Log this action (audit trail — supporter id + target id are both
      // captured so we can spot spray patterns later).
      await logAdminAction(
        ctx.db,
        supporterId,
        "send_password_reset",
        input.userId,
        null,
        ctx.headers,
      );

      // Get user email
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, input.userId),
        columns: { email: true, name: true, brand: true },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bruger ikke fundet",
        });
      }

      await authForBrand(user.brand).api.requestPasswordReset({
        body: {
          email: user.email,
          redirectTo: "/auth/reset-password",
        },
      });

      return {
        success: true,
        message: `Password reset email sendt til ${user.email}`,
      };
    }),

  // ============================================
  // Admin Only - Manual Email Verification
  // ============================================

  manuallyVerifyEmail: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        reason: z.string().min(1, "Angiv en årsag for manuel verificering"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "manually_verify_email",
        input.userId,
        { reason: input.reason },
        ctx.headers,
      );

      // Update user to verified
      await ctx.db
        .update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, input.userId));

      return {
        success: true,
        message: "Brugerens email er nu manuelt verificeret",
      };
    }),

  // ============================================
  // Role Management (Admin only)
  // ============================================

  updateUserRole: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        role: z.enum(["user", "supporter", "admin"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Can't change own role
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Du kan ikke ændre din egen rolle",
        });
      }

      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "update_user_role",
        input.userId,
        { newRole: input.role },
        ctx.headers,
      );

      await ctx.db
        .update(users)
        .set({ role: input.role })
        .where(eq(users.id, input.userId));

      return {
        success: true,
        message: `Brugerens rolle er nu ændret til ${input.role}`,
      };
    }),

  // ============================================
  // Founding Member Tier Status
  // ============================================

  getFoundingTierStatus: supporterProcedure.query(async ({ ctx }) => {
    const availability = await getFoundingAvailability(ctx.db);
    return { founding: availability };
  }),

  getChurnRisk: supporterProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_churn_risk",
        null,
        null,
        ctx.headers,
      );
      return calculateChurnRisk(ctx.db, { limit: input.limit });
    }),

  // ============================================
  // User Timeline (Combined activity view)
  // Supporters can view
  // ============================================

  /**
   * Compute a 0-100 health score for a user based on:
   *  - Recency: last login <7d = full points, decays to 0 at 60d
   *  - Activation: has completed onboarding + has ≥1 client/project/time entry
   *  - Monetization: subscription status + payment health
   *  - Engagement: logins in last 30d, feature adoption (integrations)
   *  - Retention risk: flagged, banned, past_due
   */
  getUserHealthScore: supporterProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const [
        userRow,
        lastSession,
        sessionsLast30,
        subscriptionRow,
        clientCount,
        projectCount,
        timeEntryCount,
        invoiceCount,
        calendarConnectionsCount,
      ] = await Promise.all([
        ctx.db.query.users.findFirst({
          where: eq(users.id, input.userId),
          columns: {
            id: true,
            createdAt: true,
            onboardingCompleted: true,
            emailVerified: true,
            isFlagged: true,
            banned: true,
            billyApiKey: true,
            dineroApiKey: true,
            economicAppSecretToken: true,
          },
        }),
        ctx.db
          .select({ createdAt: sessions.createdAt })
          .from(sessions)
          .where(eq(sessions.userId, input.userId))
          .orderBy(desc(sessions.createdAt))
          .limit(1),
        ctx.db
          .select({ count: count() })
          .from(sessions)
          .where(
            and(
              eq(sessions.userId, input.userId),
              gte(sessions.createdAt, thirtyDaysAgo),
            ),
          ),
        ctx.db.query.subscriptions.findFirst({
          where: eq(subscriptions.userId, input.userId),
          columns: { status: true, trialEndsAt: true, pastDueSince: true },
        }),
        ctx.db
          .select({ count: count() })
          .from(clients)
          .where(eq(clients.userId, input.userId)),
        ctx.db
          .select({ count: count() })
          .from(projects)
          .where(eq(projects.userId, input.userId)),
        ctx.db
          .select({ count: count() })
          .from(timeEntries)
          .where(eq(timeEntries.userId, input.userId)),
        ctx.db
          .select({ count: count() })
          .from(invoices)
          .where(eq(invoices.userId, input.userId)),
        ctx.db
          .select({ count: count() })
          .from(calendarConnections)
          .where(eq(calendarConnections.userId, input.userId)),
      ]);

      if (!userRow) return null;

      // ----- Recency (max 25) -----
      const lastLoginAt = lastSession[0]?.createdAt ?? null;
      const daysSinceLogin = lastLoginAt
        ? Math.floor((now.getTime() - lastLoginAt.getTime()) / (86400 * 1000))
        : Number.POSITIVE_INFINITY;
      let recency = 0;
      if (daysSinceLogin <= 7) recency = 25;
      else if (daysSinceLogin <= 14) recency = 20;
      else if (daysSinceLogin <= 30) recency = 12;
      else if (daysSinceLogin <= 60) recency = 5;
      else recency = 0;

      // ----- Activation (max 25) -----
      let activation = 0;
      if (userRow.emailVerified) activation += 5;
      if (userRow.onboardingCompleted) activation += 10;
      if ((clientCount[0]?.count ?? 0) > 0) activation += 3;
      if ((projectCount[0]?.count ?? 0) > 0) activation += 3;
      if ((timeEntryCount[0]?.count ?? 0) > 0) activation += 4;

      // ----- Monetization (max 25) -----
      let monetization = 0;
      const sub = subscriptionRow;
      if (sub?.status === "active") monetization = 25;
      else if (sub?.status === "trialing") monetization = 15;
      else if (sub?.status === "past_due") monetization = 5;
      else if (sub?.status === "canceled") monetization = 0;
      else monetization = 0;

      // ----- Engagement (max 15) -----
      const loginCount = Number(sessionsLast30[0]?.count ?? 0);
      let engagement = 0;
      if (loginCount >= 15) engagement += 8;
      else if (loginCount >= 5) engagement += 5;
      else if (loginCount >= 1) engagement += 2;
      const hasAccounting =
        Boolean(userRow.billyApiKey) ||
        Boolean(userRow.dineroApiKey) ||
        Boolean(userRow.economicAppSecretToken);
      if (hasAccounting) engagement += 4;
      if ((calendarConnectionsCount[0]?.count ?? 0) > 0) engagement += 3;
      engagement = Math.min(engagement, 15);

      // ----- Value (max 10) -----
      let value = 0;
      if ((invoiceCount[0]?.count ?? 0) > 0) value += 6;
      if ((timeEntryCount[0]?.count ?? 0) > 20) value += 4;
      value = Math.min(value, 10);

      const rawScore = recency + activation + monetization + engagement + value;

      // Penalties
      let penalty = 0;
      if (userRow.isFlagged) penalty += 20;
      if (userRow.banned) penalty += 40;
      if (sub?.pastDueSince) penalty += 10;

      const score = Math.max(0, Math.min(100, rawScore - penalty));

      const label =
        score >= 80
          ? "Fantastisk"
          : score >= 60
            ? "Sund"
            : score >= 40
              ? "I risiko"
              : score >= 20
                ? "Svag"
                : "Kritisk";

      return {
        score,
        label,
        breakdown: {
          recency: { score: recency, max: 25, daysSinceLogin, lastLoginAt },
          activation: {
            score: activation,
            max: 25,
            emailVerified: userRow.emailVerified,
            onboardingCompleted: userRow.onboardingCompleted,
            clients: Number(clientCount[0]?.count ?? 0),
            projects: Number(projectCount[0]?.count ?? 0),
            timeEntries: Number(timeEntryCount[0]?.count ?? 0),
          },
          monetization: {
            score: monetization,
            max: 25,
            subscriptionStatus: sub?.status ?? null,
            trialEndsAt: sub?.trialEndsAt ?? null,
          },
          engagement: {
            score: engagement,
            max: 15,
            loginsLast30Days: loginCount,
            hasAccountingIntegration: hasAccounting,
            calendarConnections: Number(
              calendarConnectionsCount[0]?.count ?? 0,
            ),
          },
          value: {
            score: value,
            max: 10,
            invoices: Number(invoiceCount[0]?.count ?? 0),
            timeEntries: Number(timeEntryCount[0]?.count ?? 0),
          },
        },
        penalties: {
          flagged: userRow.isFlagged ? 20 : 0,
          banned: userRow.banned ? 40 : 0,
          pastDue: sub?.pastDueSince ? 10 : 0,
        },
      };
    }),

  getUserTimeline: supporterProcedure
    .input(
      z.object({
        userId: z.string(),
        limit: z.number().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_user_timeline",
        input.userId,
        null,
        ctx.headers,
      );

      // Fetch lifecycle/milestone events in parallel from many tables
      const [
        userRow,
        activityLogs,
        notes,
        recentSessions,
        subscriptionRow,
        onboarding,
        firstClient,
        firstProject,
        firstTimeEntry,
        firstInvoice,
        twoFactorRow,
        userPasskeys,
        userCalendars,
      ] = await Promise.all([
        ctx.db.query.users.findFirst({
          where: eq(users.id, input.userId),
          columns: {
            id: true,
            name: true,
            createdAt: true,
            emailVerified: true,
            updatedAt: true,
            isFlagged: true,
            flaggedAt: true,
            flaggedReason: true,
            onboardingCompleted: true,
          },
        }),
        ctx.db
          .select({
            id: adminActivityLogs.id,
            action: adminActivityLogs.action,
            details: adminActivityLogs.details,
            createdAt: adminActivityLogs.createdAt,
            actorId: adminActivityLogs.adminUserId,
          })
          .from(adminActivityLogs)
          .where(eq(adminActivityLogs.targetUserId, input.userId))
          .orderBy(desc(adminActivityLogs.createdAt))
          .limit(input.limit),
        ctx.db
          .select({
            id: adminUserNotes.id,
            content: adminUserNotes.content,
            isImportant: adminUserNotes.isImportant,
            createdAt: adminUserNotes.createdAt,
            actorId: adminUserNotes.authorId,
          })
          .from(adminUserNotes)
          .where(eq(adminUserNotes.userId, input.userId))
          .orderBy(desc(adminUserNotes.createdAt))
          .limit(input.limit),
        ctx.db
          .select({
            id: sessions.id,
            createdAt: sessions.createdAt,
            ipAddress: sessions.ipAddress,
            userAgent: sessions.userAgent,
          })
          .from(sessions)
          .where(eq(sessions.userId, input.userId))
          .orderBy(desc(sessions.createdAt))
          .limit(20),
        ctx.db.query.subscriptions.findFirst({
          where: eq(subscriptions.userId, input.userId),
          columns: {
            id: true,
            createdAt: true,
            status: true,
            trialEndsAt: true,
            foundingTier: true,
          },
        }),
        ctx.db.query.onboardingProgress.findFirst({
          where: eq(onboardingProgress.userId, input.userId),
          columns: {
            id: true,
            isCompleted: true,
            completedAt: true,
            createdAt: true,
            currentStep: true,
            importSource: true,
            importCompletedAt: true,
          },
        }),
        ctx.db
          .select({
            id: clients.id,
            name: clients.name,
            createdAt: clients.createdAt,
          })
          .from(clients)
          .where(eq(clients.userId, input.userId))
          .orderBy(asc(clients.createdAt))
          .limit(1),
        ctx.db
          .select({
            id: projects.id,
            name: projects.name,
            createdAt: projects.createdAt,
          })
          .from(projects)
          .where(eq(projects.userId, input.userId))
          .orderBy(asc(projects.createdAt))
          .limit(1),
        ctx.db
          .select({ id: timeEntries.id, createdAt: timeEntries.createdAt })
          .from(timeEntries)
          .where(eq(timeEntries.userId, input.userId))
          .orderBy(asc(timeEntries.createdAt))
          .limit(1),
        ctx.db
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            createdAt: invoices.createdAt,
          })
          .from(invoices)
          .where(eq(invoices.userId, input.userId))
          .orderBy(asc(invoices.createdAt))
          .limit(1),
        ctx.db.query.twoFactors.findFirst({
          where: eq(twoFactors.userId, input.userId),
          columns: { id: true, createdAt: true },
        }),
        ctx.db
          .select({
            id: passkeys.id,
            name: passkeys.name,
            createdAt: passkeys.createdAt,
          })
          .from(passkeys)
          .where(eq(passkeys.userId, input.userId))
          .orderBy(asc(passkeys.createdAt)),
        ctx.db
          .select({
            id: calendarConnections.id,
            provider: calendarConnections.provider,
            createdAt: calendarConnections.createdAt,
          })
          .from(calendarConnections)
          .where(eq(calendarConnections.userId, input.userId))
          .orderBy(asc(calendarConnections.createdAt)),
      ]);

      type TimelineEvent =
        | {
            id: string;
            type: "signup";
            createdAt: Date;
            label: string;
          }
        | {
            id: string;
            type: "email_verified";
            createdAt: Date;
            label: string;
          }
        | {
            id: string;
            type: "subscription_started";
            createdAt: Date;
            label: string;
            details: Record<string, unknown> | null;
          }
        | {
            id: string;
            type: "trial_ends";
            createdAt: Date;
            label: string;
          }
        | {
            id: string;
            type: "onboarding_started";
            createdAt: Date;
            label: string;
          }
        | {
            id: string;
            type: "onboarding_completed";
            createdAt: Date;
            label: string;
          }
        | {
            id: string;
            type: "import_completed";
            createdAt: Date;
            label: string;
            source: string | null;
          }
        | {
            id: string;
            type:
              | "first_client"
              | "first_project"
              | "first_time_entry"
              | "first_invoice";
            createdAt: Date;
            label: string;
            ref: string | null;
          }
        | {
            id: string;
            type: "two_factor_enabled";
            createdAt: Date;
            label: string;
          }
        | {
            id: string;
            type: "passkey_added";
            createdAt: Date;
            label: string;
            passkeyName: string | null;
          }
        | {
            id: string;
            type: "calendar_connected";
            createdAt: Date;
            label: string;
            provider: string;
          }
        | {
            id: string;
            type: "flagged";
            createdAt: Date;
            label: string;
            reason: string | null;
          }
        | {
            id: string;
            type: "login";
            createdAt: Date;
            ipAddress: string | null;
            userAgent: string | null;
          }
        | {
            id: string;
            type: "note";
            createdAt: Date;
            content: string;
            isImportant: boolean | null;
            actorId: string | null;
          }
        | {
            id: string;
            type: "admin_action";
            createdAt: Date;
            action: string;
            details: unknown;
            actorId: string | null;
          };

      const events: TimelineEvent[] = [];

      // Lifecycle milestones
      if (userRow) {
        events.push({
          id: `signup-${userRow.id}`,
          type: "signup",
          createdAt: userRow.createdAt,
          label: "Bruger oprettet",
        });
        if (userRow.isFlagged && userRow.flaggedAt) {
          events.push({
            id: `flag-${userRow.id}`,
            type: "flagged",
            createdAt: userRow.flaggedAt,
            label: "Bruger flagget",
            reason: userRow.flaggedReason,
          });
        }
      }

      if (subscriptionRow) {
        events.push({
          id: `sub-${subscriptionRow.id}`,
          type: "subscription_started",
          createdAt: subscriptionRow.createdAt,
          label: subscriptionRow.foundingTier
            ? `Founding-medlem (${subscriptionRow.foundingTier}) - ${subscriptionRow.status}`
            : `Abonnement startet - ${subscriptionRow.status}`,
          details: {
            status: subscriptionRow.status,
            foundingTier: subscriptionRow.foundingTier,
          },
        });
        if (subscriptionRow.trialEndsAt) {
          events.push({
            id: `trial-${subscriptionRow.id}`,
            type: "trial_ends",
            createdAt: subscriptionRow.trialEndsAt,
            label: "Prøveperiode slutter",
          });
        }
      }

      if (onboarding) {
        events.push({
          id: `onb-start-${onboarding.id}`,
          type: "onboarding_started",
          createdAt: onboarding.createdAt,
          label: "Onboarding påbegyndt",
        });
        if (onboarding.isCompleted && onboarding.completedAt) {
          events.push({
            id: `onb-done-${onboarding.id}`,
            type: "onboarding_completed",
            createdAt: onboarding.completedAt,
            label: "Onboarding fuldført",
          });
        }
        if (onboarding.importCompletedAt && onboarding.importSource) {
          events.push({
            id: `import-${onboarding.id}`,
            type: "import_completed",
            createdAt: onboarding.importCompletedAt,
            label: `Data importeret fra ${onboarding.importSource}`,
            source: onboarding.importSource,
          });
        }
      }

      if (firstClient[0]) {
        events.push({
          id: `first-client-${firstClient[0].id}`,
          type: "first_client",
          createdAt: firstClient[0].createdAt,
          label: `Første kunde oprettet: ${firstClient[0].name}`,
          ref: firstClient[0].name,
        });
      }
      if (firstProject[0]) {
        events.push({
          id: `first-project-${firstProject[0].id}`,
          type: "first_project",
          createdAt: firstProject[0].createdAt,
          label: `Første projekt oprettet: ${firstProject[0].name}`,
          ref: firstProject[0].name,
        });
      }
      if (firstTimeEntry[0]) {
        events.push({
          id: `first-time-${firstTimeEntry[0].id}`,
          type: "first_time_entry",
          createdAt: firstTimeEntry[0].createdAt,
          label: "Første tidsregistrering",
          ref: null,
        });
      }
      if (firstInvoice[0]) {
        events.push({
          id: `first-invoice-${firstInvoice[0].id}`,
          type: "first_invoice",
          createdAt: firstInvoice[0].createdAt,
          label: `Første faktura oprettet: ${firstInvoice[0].invoiceNumber ?? "uden nummer"}`,
          ref: firstInvoice[0].invoiceNumber,
        });
      }

      if (twoFactorRow) {
        events.push({
          id: `2fa-${twoFactorRow.id}`,
          type: "two_factor_enabled",
          createdAt: twoFactorRow.createdAt,
          label: "2FA aktiveret",
        });
      }

      for (const pk of userPasskeys) {
        events.push({
          id: `passkey-${pk.id}`,
          type: "passkey_added",
          createdAt: pk.createdAt,
          label: pk.name ? `Passkey tilføjet: ${pk.name}` : "Passkey tilføjet",
          passkeyName: pk.name,
        });
      }

      for (const cal of userCalendars) {
        events.push({
          id: `cal-${cal.id}`,
          type: "calendar_connected",
          createdAt: cal.createdAt,
          label: `Kalender forbundet (${cal.provider})`,
          provider: cal.provider,
        });
      }

      // Admin actions, notes and logins
      for (const log of activityLogs) {
        events.push({
          id: log.id,
          type: "admin_action",
          createdAt: log.createdAt,
          action: log.action,
          details: log.details,
          actorId: log.actorId,
        });
      }
      for (const note of notes) {
        events.push({
          id: note.id,
          type: "note",
          createdAt: note.createdAt,
          content: note.content,
          isImportant: note.isImportant,
          actorId: note.actorId,
        });
      }
      for (const session of recentSessions) {
        events.push({
          id: session.id,
          type: "login",
          createdAt: session.createdAt,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
        });
      }

      // Sort newest first, cap to limit
      events.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return events.slice(0, input.limit);
    }),

  // ============================================
  // Bulk Actions (Admin only)
  // ============================================

  bulkEmail: adminProcedure
    .input(
      z.object({
        userIds: z.array(z.string()).min(1).max(200),
        subject: z.string().min(1).max(200),
        body: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch users by IDs
      const targetUsers = await ctx.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          brand: users.brand,
        })
        .from(users)
        .where(inArray(users.id, input.userIds));

      let sent = 0;
      let failed = 0;

      for (const user of targetUsers) {
        try {
          await resend.emails.send({
            // Multibrand: TimeWren-konti får TimeWren-afsenderen.
            from: recipientMailBrand(user.brand)?.from ?? PERSONAL_FROM_EMAIL,
            to: user.email,
            subject: input.subject,
            html: input.body.replace(/\n/g, "<br>"),
          });
          sent++;
          // 100ms delay between sends
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Failed to send bulk email to ${user.email}:`, error);
          failed++;
        }
      }

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "bulk_email",
        null,
        { subject: input.subject, sent, failed, total: targetUsers.length },
        ctx.headers,
      );

      return { sent, failed, total: targetUsers.length };
    }),

  bulkRoleChange: adminProcedure
    .input(
      z.object({
        userIds: z.array(z.string()).min(1).max(200),
        role: z.enum(["user", "supporter", "admin"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Prevent changing own role
      const filteredIds = input.userIds.filter(
        (id) => id !== ctx.session.user.id,
      );

      if (filteredIds.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Kan ikke ændre din egen rolle via bulk-handling",
        });
      }

      await ctx.db
        .update(users)
        .set({ role: input.role })
        .where(inArray(users.id, filteredIds));

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "bulk_role_change",
        null,
        { role: input.role, userCount: filteredIds.length },
        ctx.headers,
      );

      return { updated: filteredIds.length };
    }),

  bulkExportCsv: adminProcedure
    .input(
      z.object({
        userIds: z.array(z.string()).min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await ctx.db.execute(sql`
        SELECT
          u.id,
          u.name,
          u.email,
          u.role,
          u."createdAt",
          sub.status as subscription_status,
          s.last_active,
          COALESCE(te.total_hours, 0) as total_hours,
          COALESCE(c.cnt, 0) as client_count,
          COALESCE(p.cnt, 0) as project_count
        FROM "user" u
        LEFT JOIN subscriptions sub ON sub.user_id = u.id
        LEFT JOIN (SELECT "userId", MAX("createdAt") as last_active FROM session GROUP BY "userId") s ON s."userId" = u.id
        LEFT JOIN (SELECT user_id, SUM(hours) as total_hours FROM time_entries GROUP BY user_id) te ON te.user_id = u.id
        LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM clients GROUP BY user_id) c ON c.user_id = u.id
        LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM projects GROUP BY user_id) p ON p.user_id = u.id
        WHERE u.id IN (${sql.join(
          input.userIds.map((id) => sql`${id}`),
          sql`, `,
        )})
      `);

      const rows = result as unknown as Array<{
        id: string;
        name: string;
        email: string;
        role: string;
        createdAt: Date | string | null;
        subscription_status: string | null;
        last_active: Date | string | null;
        total_hours: number;
        client_count: number;
        project_count: number;
      }>;

      const csvHeaders =
        "id,name,email,role,createdAt,subscriptionStatus,lastActive,totalHours,clientCount,projectCount";
      const csvRows = rows.map((r) => {
        const createdAt = parseDbTimestamp(r.createdAt)?.toISOString() ?? "";
        const lastActive = parseDbTimestamp(r.last_active)?.toISOString() ?? "";
        const escapeCell = (val: string) =>
          escapeCsv(val, { delimiter: ",", alwaysQuote: true });
        return [
          escapeCell(r.id),
          escapeCell(r.name ?? ""),
          escapeCell(r.email ?? ""),
          escapeCell(r.role ?? "user"),
          escapeCell(createdAt),
          escapeCell(r.subscription_status ?? ""),
          escapeCell(lastActive),
          Number(r.total_hours).toFixed(2),
          Number(r.client_count),
          Number(r.project_count),
        ].join(",");
      });

      const csv = [csvHeaders, ...csvRows].join("\n");
      const filename = `users-export-${new Date().toISOString().slice(0, 10)}.csv`;

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "bulk_export_csv",
        null,
        { userCount: input.userIds.length },
        ctx.headers,
      );

      return { csv, filename };
    }),

  bulkBanDomain: adminProcedure
    .input(
      z.object({
        domains: z.array(z.string()).min(1).max(50),
        banExistingUsers: z.boolean(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let domainsAdded = 0;
      let usersBanned = 0;

      // Insert domains (skip duplicates)
      for (const domain of input.domains) {
        try {
          await ctx.db.insert(bannedDomains).values({
            domain: domain.toLowerCase(),
            reason: input.reason ?? null,
            bannedBy: ctx.session.user.id,
          });
          domainsAdded++;
        } catch {
          // Duplicate domain — skip
        }
      }

      // Ban existing users from those domains
      if (input.banExistingUsers) {
        for (const domain of input.domains) {
          const result = await ctx.db.execute(
            sql`UPDATE "user" SET banned = true WHERE LOWER(email) LIKE ${`%@${domain.toLowerCase()}`}`,
          );
          usersBanned += Number(
            (result as unknown as { rowCount?: number }).rowCount ?? 0,
          );
        }
      }

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "bulk_ban_domain",
        null,
        {
          domains: input.domains,
          domainsAdded,
          usersBanned,
          banExistingUsers: input.banExistingUsers,
        },
        ctx.headers,
      );

      return { domainsAdded, usersBanned };
    }),
});
