import { TRPCError } from "@trpc/server";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { isAvailableLocale, LOCALES } from "@/i18n/config";
import { st, tr } from "@/i18n/server-text";
import {
  deleteUserAccountCompletely,
  findActiveStoreSubscription,
  planAccountDeletion,
} from "@/lib/account-deletion";
import { clearUserAICache } from "@/lib/ai";
import {
  clients,
  companyProfiles,
  emailPreferences,
  featureFlags,
  invoices,
  members,
  projects,
  rateHistory,
  timeEntries,
  users,
} from "@/lib/db/schema";
import type { CompanyType, VatPeriod } from "@/lib/deadlines/dk-deadlines";
import { getUpcomingDeadlines } from "@/lib/deadlines/dk-deadlines";
import {
  ensureUserHasInboundEmailId,
  getInboundEmailAddress,
} from "@/lib/email/inbound";
import { canViewAllOrgTime } from "@/lib/permissions/server";
import { START_PAGE_HREFS, type StartPageHref } from "@/lib/start-page";
import { isStartPageAccessible } from "@/lib/start-page.server";
import { encryptSecretOrNull } from "@/lib/utils/encryption";
import { validateUrlForSSRF } from "@/lib/utils/ssrf-protection";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";

/** Kendte skjulbare bannere/hints (server-side dismissals). Tilføj nye nøgler
 * her — håndhæves som allowlist i dismissBanner. */
const DISMISSIBLE_BANNER_KEYS = [
  "desktop-download",
  "onboarding-checklist",
  // Guided tour "seen" flag. Server-side so it survives an origin change
  // (localStorage doesn't cross timetrack.dk ↔ app.timetrack.dk).
  "guided-tour",
  // Velkomstkortet på Hjem efter signup (#91)
  "welcome-first-timer",
] as const;

export const userRouter = router({
  // Get current user profile (excludes sensitive API keys)
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) return null;

    // Strip sensitive API keys AND admin-internal flag fields from the
    // response. The flag fields are only visible to admins via the admin
    // router — returning them to the user themselves would telegraph the
    // investigation and help an abusive user tune their behavior.
    const {
      billyApiKey: _b,
      dineroApiKey: _d,
      dineroRefreshToken: _dr,
      economicAppSecretToken: _e,
      economicAgreementGrantToken: _ea,
      aiApiKey: _a,
      isFlagged: _if,
      flaggedReason: _fr,
      flaggedAt: _fa,
      ...safeUser
    } = user;

    return safeUser;
  }),

  // Get user theme preference
  getTheme: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    return {
      theme: user?.theme || "light",
    };
  }),

  // Update user theme preference
  updateTheme: protectedProcedure
    .input(
      z.object({
        theme: z.enum(["light", "dark", "system"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await ctx.db
        .update(users)
        .set({
          theme: input.theme,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return { success: true };
    }),

  // Server-side dismissals af UI-bannere/hints (per-konto, på tværs af enheder)
  getDismissedBanners: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, ctx.session.user.id),
      columns: { dismissedBanners: true },
    });
    return user?.dismissedBanners ?? [];
  }),

  dismissBanner: protectedProcedure
    // Allowlist: forhindrer at en klient pumper vilkårlige nøgler ind og lader
    // arrayet vokse ubegrænset. Nye skjulbare bannere tilføjes her.
    .input(z.object({ key: z.enum(DISMISSIBLE_BANNER_KEYS) }))
    .mutation(async ({ ctx, input }) => {
      // Atomisk array-opdatering (array_remove+append = idempotent dedup) i ÉN
      // UPDATE — undgår lost-update hvis to bannere skjules samtidig på siden.
      await ctx.db
        .update(users)
        .set({
          dismissedBanners: sql`array_append(array_remove(${users.dismissedBanners}, ${input.key}), ${input.key})`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.session.user.id));
      return { success: true };
    }),

  // Update user profile
  updateProfile: protectedProcedure
    .input(
      z
        .object({
          // Valgfrit: autogem sender kun det felt, der er ændret, så et
          // kort ikke overskriver et navn, der gemmes samtidig.
          name: z
            .string()
            .min(2, { error: () => st("zod.nameMin2") })
            .max(255)
            .optional(),
          image: z.string().nullable().optional(),
          defaultHourlyRate: z.string().max(20).optional(),
          weeklyHourGoal: z.string().max(10).optional(),
          hidePrepaidValue: z.boolean().optional(),
          roundingEnabled: z.boolean().nullable().optional(),
          roundingMinutes: z
            .union([
              z.literal(5),
              z.literal(10),
              z.literal(15),
              z.literal(30),
              z.literal(60),
            ])
            .nullable()
            .optional(),
          roundingMethod: z
            .enum(["up", "nearest", "down"])
            .nullable()
            .optional(),
          locale: z
            .enum(LOCALES)
            .refine((l) => isAvailableLocale(l))
            .optional(),
          approvalWorkflow: z
            .enum(["off", "per_entry", "per_period", "per_invoice_draft"])
            .optional(),
          startPage: z
            .enum(START_PAGE_HREFS as [StartPageHref, ...StartPageHref[]])
            .nullable()
            .optional(),
        })
        .superRefine((data, ctx) => {
          if (
            data.roundingEnabled === true &&
            (data.roundingMinutes == null || data.roundingMethod == null)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: st("clients.roundingRequired"),
              path: ["roundingEnabled"],
            });
          }
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Get current user to check if rate changed
      const currentUser = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (
        input.startPage !== undefined &&
        input.startPage !== null &&
        !(await isStartPageAccessible(
          ctx.db,
          userId,
          ctx.orgId,
          input.startPage,
        ))
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "user.pageUnavailable"),
        });
      }

      // Check if hourly rate changed
      if (
        input.defaultHourlyRate &&
        currentUser &&
        input.defaultHourlyRate !== currentUser.defaultHourlyRate
      ) {
        // Log rate change to history
        await ctx.db.insert(rateHistory).values({
          userId,
          organizationId: ctx.orgId,
          clientId: null,
          projectId: null,
          oldRate: currentUser.defaultHourlyRate,
          newRate: input.defaultHourlyRate,
          rateType: "global",
          effectiveDate: new Date(),
        });
      }

      await ctx.db
        .update(users)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.image !== undefined ? { image: input.image } : {}),
          ...(input.defaultHourlyRate !== undefined
            ? { defaultHourlyRate: input.defaultHourlyRate || null }
            : {}),
          ...(input.weeklyHourGoal !== undefined
            ? { weeklyHourGoal: input.weeklyHourGoal || null }
            : {}),
          roundingEnabled: input.roundingEnabled,
          roundingMinutes: input.roundingMinutes,
          roundingMethod: input.roundingMethod,
          ...(input.hidePrepaidValue !== undefined
            ? { hidePrepaidValue: input.hidePrepaidValue }
            : {}),
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
          ...(input.approvalWorkflow !== undefined
            ? { approvalWorkflow: input.approvalWorkflow }
            : {}),
          ...(input.startPage !== undefined
            ? { startPage: input.startPage }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return { success: true };
    }),

  // "Gør til startside" i kommandopaletten (#startside) — rammer kun
  // startPage, så kaldet ikke afhænger af resten af updateProfiles input
  // (fx navn) og ikke kan påvirke andre felter.
  setStartPage: protectedProcedure
    .input(
      z.object({
        startPage: z
          .enum(START_PAGE_HREFS as [StartPageHref, ...StartPageHref[]])
          .nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (
        input.startPage !== null &&
        !(await isStartPageAccessible(
          ctx.db,
          userId,
          ctx.orgId,
          input.startPage,
        ))
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "user.pageUnavailable"),
        });
      }

      await ctx.db
        .update(users)
        .set({ startPage: input.startPage, updatedAt: new Date() })
        .where(eq(users.id, userId));

      return { success: true };
    }),

  // Update prepaid alert recipient setting
  updatePrepaidAlertRecipient: protectedProcedure
    .input(
      z.object({
        prepaidAlertRecipient: z.enum(["owner", "client", "both"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await ctx.db
        .update(users)
        .set({
          prepaidAlertRecipient: input.prepaidAlertRecipient,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return { success: true };
    }),

  // Update integration API keys
  updateIntegrations: protectedProcedure
    .input(
      z.object({
        billyApiKey: z.string().optional(),
        dineroApiKey: z.string().optional(),
        dineroOrganizationId: z.string().optional(),
        economicAppSecretToken: z.string().optional(),
        economicAgreementGrantToken: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Build update object with only provided fields
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      // Only update fields that were provided. Nøgler/tokens krypteres at rest
      // (#690); mangler ENCRYPTION_KEY, kaster encryptSecretOrNull og intet gemmes.
      if (input.billyApiKey !== undefined) {
        updateData.billyApiKey = encryptSecretOrNull(input.billyApiKey);
      }
      if (input.dineroApiKey !== undefined) {
        updateData.dineroApiKey = encryptSecretOrNull(input.dineroApiKey);
      }
      if (input.dineroOrganizationId !== undefined) {
        updateData.dineroOrganizationId = input.dineroOrganizationId || null;
      }
      if (input.economicAppSecretToken !== undefined) {
        updateData.economicAppSecretToken = encryptSecretOrNull(
          input.economicAppSecretToken,
        );
      }
      if (input.economicAgreementGrantToken !== undefined) {
        updateData.economicAgreementGrantToken = encryptSecretOrNull(
          input.economicAgreementGrantToken,
        );
      }

      await ctx.db.update(users).set(updateData).where(eq(users.id, userId));

      return { success: true };
    }),

  // Get integration status (without exposing full API keys)
  getIntegrationStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    return {
      hasBillyApiKey: !!user?.billyApiKey,
      hasDineroApiKey: !!user?.dineroApiKey,
      hasDineroOrganizationId: !!user?.dineroOrganizationId,
      hasEconomicAppSecretToken: !!user?.economicAppSecretToken,
      hasEconomicAgreementGrantToken: !!user?.economicAgreementGrantToken,
      billyConnected: !!user?.billyApiKey,
      dineroConnected:
        !!user?.dineroRefreshToken ||
        (!!user?.dineroApiKey && !!user?.dineroOrganizationId),
      dineroIsOAuth: !!user?.dineroRefreshToken,
      dineroOrgName: user?.dineroOrgName || null,
      dineroTokenExpired:
        !!user?.dineroRefreshToken &&
        !!user?.dineroTokenExpiry &&
        user.dineroTokenExpiry < new Date(),
      economicConnected:
        !!user?.economicAppSecretToken && !!user?.economicAgreementGrantToken,
    };
  }),

  // Get system/environment status
  getSystemStatus: protectedProcedure.query(async () => {
    return {
      environment: process.env.NODE_ENV,
    };
  }),

  // Sletteflowet viser en bekræftelse, hvis et butiksabonnement løber videre,
  // og forklarer hvorfor/hvordan, hvis sletningen er blokeret (#918)
  getAccountDeletionInfo: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [plan, storeSubscription] = await Promise.all([
      planAccountDeletion(ctx.db, userId),
      findActiveStoreSubscription(ctx.db, userId),
    ]);
    return {
      storeSubscription,
      canDelete: !plan.blocked,
      blockReason: plan.blocked?.reason ?? null,
      blockingOrgs: plan.blocked?.orgs ?? [],
      // Teams brugeren forlader; deres data bevares anonymiseret
      teamCount: plan.sharedOrgIds.length,
    };
  }),

  // Delete user account and all associated data
  deleteAccount: protectedProcedure
    .input(
      z.object({
        confirmEmail: z.string().email(),
        // Kræves, når kontoen har et aktivt App Store/Google Play-abonnement
        storeSubscriptionAcknowledged: z.boolean().optional(),
        // iOS-appen sender en frisk Apple authorization code (gyldig 5 min,
        // engangs), så Apple-login kan tilbagekaldes (5.1.1(v)). Valgfri:
        // ældre klienter og web udelader den.
        appleAuthorizationCode: z.string().min(1).max(4096).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify email matches current user
      const currentUser = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      const confirmEmail = input.confirmEmail.trim().toLowerCase();
      if (!currentUser || currentUser.email.toLowerCase() !== confirmEmail) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "user.emailMismatch"),
        });
      }

      try {
        await deleteUserAccountCompletely(ctx.db, userId, {
          storeSubscriptionAcknowledged: input.storeSubscriptionAcknowledged,
          appleAuthorizationCode: input.appleAuthorizationCode,
        });
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        // Aldrig lække rå DB-fejl (SQL/schema-detaljer) til klienten
        console.error("[Account Deletion] Sletning fejlede:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: await tr("serverErrors", "user.deleteFailed"),
        });
      }

      return { success: true };
    }),

  // Complete onboarding
  completeOnboarding: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    await ctx.db
      .update(users)
      .set({
        onboardingCompleted: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return { success: true };
  }),

  // Get recent activity feed
  getRecentActivity: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(5).max(100).default(10),
        type: z
          .enum(["all", "time", "invoices", "clients", "projects"])
          .default("all"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const activities: Array<{
        id: string;
        type: "time" | "invoice" | "client" | "project";
        title: string;
        description: string;
        timestamp: Date;
        actorName?: string | null;
        actorImage?: string | null;
        metadata?: Record<string, unknown>;
      }> = [];

      // For teams, resolve who performed each activity (the entity's creator
      // userId -> member name/image). Solo orgs (<=1 member) get no actor
      // labels, so personal dashboards stay uncluttered.
      const memberRows = ctx.orgId
        ? await ctx.db.query.members.findMany({
            where: eq(members.organizationId, ctx.orgId),
            with: { user: { columns: { id: true, name: true, image: true } } },
          })
        : [];
      const isTeam = memberRows.length > 1;
      const actorById = new Map(
        memberRows.map((m) => [
          m.userId,
          { name: m.user.name, image: m.user.image },
        ]),
      );
      const actorFor = (creatorId: string | null | undefined) => {
        if (!isTeam || !creatorId) return { actorName: null, actorImage: null };
        const a = actorById.get(creatorId);
        return { actorName: a?.name ?? null, actorImage: a?.image ?? null };
      };

      // Fetch time entries — a regular member only sees their OWN activity;
      // owner/admin see the whole team's (with actor labels). Matches the
      // "members see only own time" model (search/calendar/reports).
      if (input.type === "all" || input.type === "time") {
        const canSeeAllTime = await canViewAllOrgTime(
          ctx.db,
          ctx.orgId,
          userId,
        );
        const recentTimeEntries = await ctx.db.query.timeEntries.findMany({
          where:
            ctx.orgId && canSeeAllTime
              ? eq(timeEntries.organizationId, ctx.orgId)
              : eq(timeEntries.userId, userId),
          orderBy: [desc(timeEntries.createdAt)],
          limit: input.limit,
          with: {
            project: {
              with: {
                client: true,
              },
            },
            client: true,
          },
        });

        activities.push(
          ...recentTimeEntries.map((entry) => ({
            id: entry.id,
            type: "time" as const,
            title: entry.description || st("activity.timeEntryFallback"),
            description: entry.project
              ? st("activity.timeOnProject", {
                  hours: entry.hours,
                  name: entry.project.name,
                })
              : entry.client
                ? st("activity.timeForClient", {
                    hours: entry.hours,
                    name: entry.client.name,
                  })
                : st("activity.timeOnly", { hours: entry.hours }),
            timestamp: entry.createdAt,
            ...actorFor(entry.userId),
            metadata: {
              hours: entry.hours,
              projectId: entry.projectId,
              clientId: entry.clientId || entry.project?.clientId,
              projectName: entry.project?.name,
              clientName: entry.client?.name || entry.project?.client?.name,
              date: entry.date,
              entryDescription: entry.description,
            },
          })),
        );
      }

      // Fetch invoices
      if (input.type === "all" || input.type === "invoices") {
        const recentInvoices = await ctx.db.query.invoices.findMany({
          where: ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
          orderBy: [desc(invoices.createdAt)],
          limit: input.limit,
          with: {
            client: true,
          },
        });

        activities.push(
          ...recentInvoices.map((invoice) => ({
            id: invoice.id,
            type: "invoice" as const,
            title: st("activity.invoiceTitle", {
              number: invoice.invoiceNumber,
            }),
            description: st("activity.invoiceDescription", {
              amount: invoice.amount,
              client: invoice.client.name,
            }),
            timestamp: invoice.createdAt,
            ...actorFor(invoice.userId),
            metadata: {
              invoiceNumber: invoice.invoiceNumber,
              amount: invoice.amount,
              clientName: invoice.client.name,
              status: invoice.status,
            },
          })),
        );
      }

      // Fetch clients
      if (input.type === "all" || input.type === "clients") {
        const recentClients = await ctx.db.query.clients.findMany({
          where: ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
          orderBy: [desc(clients.createdAt)],
          limit: input.limit,
        });

        activities.push(
          ...recentClients.map((client) => ({
            id: client.id,
            type: "client" as const,
            title: st("activity.newClient", { name: client.name }),
            description: client.company
              ? `${client.company}`
              : client.email || st("activity.noContact"),
            timestamp: client.createdAt,
            ...actorFor(client.userId),
            metadata: {
              name: client.name,
              company: client.company,
              email: client.email,
            },
          })),
        );
      }

      // Fetch projects
      if (input.type === "all" || input.type === "projects") {
        const recentProjects = await ctx.db.query.projects.findMany({
          where: ctx.orgId
            ? eq(projects.organizationId, ctx.orgId)
            : eq(projects.userId, userId),
          orderBy: [desc(projects.createdAt)],
          limit: input.limit,
          with: {
            client: true,
          },
        });

        activities.push(
          ...recentProjects.map((project) => ({
            id: project.id,
            type: "project" as const,
            title: st("activity.newProject", { name: project.name }),
            description: st("activity.projectFor", {
              client: project.client?.name ?? st("activity.internal"),
            }),
            timestamp: project.createdAt,
            ...actorFor(project.userId),
            metadata: {
              name: project.name,
              clientName: project.client?.name ?? st("activity.internal"),
              status: project.status,
            },
          })),
        );
      }

      // Sort all activities by timestamp and limit
      const sortedActivities = activities
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, input.limit);

      return sortedActivities;
    }),

  // Get email preferences
  getEmailPreferences: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    let prefs = await ctx.db.query.emailPreferences.findFirst({
      where: eq(emailPreferences.userId, userId),
    });

    // If no preferences exist, create default ones
    if (!prefs) {
      const [newPrefs] = await ctx.db
        .insert(emailPreferences)
        .values({
          userId,
        })
        .returning();
      prefs = newPrefs;
    }

    return prefs;
  }),

  // Update email preferences
  updateEmailPreferences: protectedProcedure
    .input(
      z.object({
        // Report toggles
        weeklyReport: z.boolean().optional(),
        monthlyReport: z.boolean().optional(),
        unbilledReminder: z.boolean().optional(),
        // Security toggles
        passwordChanged: z.boolean().optional(),
        newLoginAlert: z.boolean().optional(),
        emailChanged: z.boolean().optional(),
        // Engagement toggles
        onboardingMilestones: z.boolean().optional(),
        inactivityReminder: z.boolean().optional(),
        tipsAndTricks: z.boolean().optional(),
        // Client email toggles
        clientInvoices: z.boolean().optional(),
        clientPrepaidAlerts: z.boolean().optional(),
        clientProjectUpdates: z.boolean().optional(),
        // Timing preferences
        weeklyReportDay: z.string().optional(),
        weeklyReportTime: z.string().optional(),
        monthlyReportDay: z.number().min(1).max(28).optional(),
        // Reminder frequency
        unbilledReminderFrequency: z
          .enum(["daily", "weekly", "monthly"])
          .optional(),
        inactivityReminderDays: z.number().min(1).max(90).optional(),
        // End-of-day notification
        endOfDayEnabled: z.boolean().optional(),
        endOfDayTime: z.string().optional(),
        // Drip campaign
        dripEmails: z.boolean().optional(),
        // Quiet hours
        quietHoursEnabled: z.boolean().optional(),
        quietHoursStart: z.string().optional(),
        quietHoursEnd: z.string().optional(),
        // Digest mode
        digestMode: z.boolean().optional(),
        digestFrequency: z.enum(["daily", "weekly"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Check if preferences exist
      const existing = await ctx.db.query.emailPreferences.findFirst({
        where: eq(emailPreferences.userId, userId),
      });

      if (existing) {
        // Update existing preferences
        const [updated] = await ctx.db
          .update(emailPreferences)
          .set({
            ...input,
            updatedAt: new Date(),
          })
          .where(eq(emailPreferences.userId, userId))
          .returning();
        return updated;
      } else {
        // Create new preferences
        const [created] = await ctx.db
          .insert(emailPreferences)
          .values({
            userId,
            ...input,
          })
          .returning();
        return created;
      }
    }),

  // ============================================
  // Email-to-Task Settings
  // ============================================

  // Get email-to-task settings
  getEmailToTaskSettings: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new Error("Bruger ikke fundet");
    }

    // Generate inbound email address if user has an ID
    const inboundEmail = user.inboundEmailId
      ? getInboundEmailAddress(user.inboundEmailId)
      : null;

    return {
      enabled: !!user.inboundEmailId,
      inboundEmail,
      inboundEmailId: user.inboundEmailId,
      aiAutonomyLevel: user.aiAutonomyLevel || "suggest",
      workingHoursStart: user.workingHoursStart,
      workingHoursEnd: user.workingHoursEnd,
      timezone: user.timezone || "Europe/Copenhagen",
    };
  }),

  // Enable email-to-task (generates inbound email ID)
  enableEmailToTask: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Generate and assign inbound email ID
    const inboundEmailId = await ensureUserHasInboundEmailId(userId);
    const inboundEmail = getInboundEmailAddress(inboundEmailId);

    return {
      success: true,
      inboundEmail,
      inboundEmailId,
    };
  }),

  // Disable email-to-task (removes inbound email ID)
  disableEmailToTask: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    await ctx.db
      .update(users)
      .set({
        inboundEmailId: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return { success: true };
  }),

  // Regenerate inbound email ID (for security/spam reasons)
  regenerateInboundEmail: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // First clear the existing ID
    await ctx.db
      .update(users)
      .set({
        inboundEmailId: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    // Generate a new one
    const inboundEmailId = await ensureUserHasInboundEmailId(userId);
    const inboundEmail = getInboundEmailAddress(inboundEmailId);

    return {
      success: true,
      inboundEmail,
      inboundEmailId,
    };
  }),

  // ============================================
  // AI Settings
  // ============================================

  // Get AI settings
  getAISettings: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new Error("Bruger ikke fundet");
    }

    // Check if AI is enabled (system-level or user's own key)
    const systemAiEnabled = !!process.env.OPENAI_API_KEY;
    const userHasOwnKey = !!user.aiApiKey;
    const aiEnabled = systemAiEnabled || userHasOwnKey;

    return {
      aiEnabled,
      systemAiAvailable: systemAiEnabled,
      aiAutonomyLevel: user.aiAutonomyLevel || "suggest",
      // BYOK settings
      aiProvider: user.aiProvider || "system",
      hasCustomApiKey: !!user.aiApiKey, // Don't expose the actual key
      aiApiKeyConfigured: !!user.aiApiKey, // Alias for compatibility
      aiApiUrl: user.aiApiUrl || null,
      aiModel: user.aiModel || null,
      // Working hours
      workingHoursStart: user.workingHoursStart,
      workingHoursEnd: user.workingHoursEnd,
      timezone: user.timezone || "Europe/Copenhagen",
    };
  }),

  // Update AI settings
  updateAISettings: protectedProcedure
    .input(
      z.object({
        aiAutonomyLevel: z
          .enum(["manual", "suggest", "auto_lowrisk", "auto_all"])
          .optional(),
        // BYOK settings
        aiProvider: z.enum(["system", "openai", "custom"]).optional(),
        aiApiKey: z.string().optional().nullable(), // null to clear
        aiApiUrl: z.string().url().optional().nullable(),
        aiModel: z.string().max(100).optional().nullable(),
        // Working hours
        workingHoursStart: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional()
          .nullable(),
        workingHoursEnd: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional()
          .nullable(),
        timezone: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (input.aiAutonomyLevel !== undefined) {
        updateData.aiAutonomyLevel = input.aiAutonomyLevel;
      }
      if (input.aiProvider !== undefined) {
        updateData.aiProvider = input.aiProvider;
      }
      if (input.aiApiKey !== undefined) {
        // Allow null to clear the key. Krypteres at rest (#690).
        updateData.aiApiKey = encryptSecretOrNull(input.aiApiKey);
      }
      if (input.aiApiUrl !== undefined) {
        // Validate URL against SSRF before persisting
        if (input.aiApiUrl) {
          const ssrfError = await validateUrlForSSRF(input.aiApiUrl);
          if (ssrfError) {
            throw new Error(ssrfError);
          }
        }
        updateData.aiApiUrl = input.aiApiUrl;
      }
      if (input.aiModel !== undefined) {
        updateData.aiModel = input.aiModel;
      }
      if (input.workingHoursStart !== undefined) {
        updateData.workingHoursStart = input.workingHoursStart;
      }
      if (input.workingHoursEnd !== undefined) {
        updateData.workingHoursEnd = input.workingHoursEnd;
      }
      if (input.timezone !== undefined) {
        updateData.timezone = input.timezone;
      }

      const [updatedUser] = await ctx.db
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning();

      // Clear the AI settings cache so changes take effect immediately
      clearUserAICache(userId);

      return {
        aiAutonomyLevel: updatedUser.aiAutonomyLevel,
        aiProvider: updatedUser.aiProvider,
        aiApiKeyConfigured: !!updatedUser.aiApiKey,
        aiApiUrl: updatedUser.aiApiUrl,
        aiModel: updatedUser.aiModel,
        workingHoursStart: updatedUser.workingHoursStart,
        workingHoursEnd: updatedUser.workingHoursEnd,
        timezone: updatedUser.timezone,
      };
    }),

  // Test custom AI configuration
  testAIConnection: protectedProcedure
    .input(
      z.object({
        provider: z.enum(["openai", "custom"]),
        apiKey: z.string().min(1),
        apiUrl: z.string().url().optional(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Validate custom API URL to prevent SSRF
      if (input.apiUrl) {
        const ssrfError = await validateUrlForSSRF(input.apiUrl);
        if (ssrfError) {
          throw new Error(ssrfError);
        }
      }

      const OpenAI = (await import("openai")).default;

      try {
        const client = new OpenAI({
          apiKey: input.apiKey,
          baseURL: input.apiUrl || undefined,
        });

        // Simple test: list models or do a minimal completion
        const response = await client.chat.completions.create({
          model: input.model || "gpt-4o-mini",
          messages: [
            { role: "user", content: "Say 'OK' if you can read this." },
          ],
          max_tokens: 10,
        });

        const reply = response.choices[0]?.message?.content?.trim() || "";

        return {
          success: true,
          message: await tr("serverErrors", "user.aiConnectionOk", { reply }),
          model: response.model,
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : await tr("serverErrors", "common.unknownError");
        return {
          success: false,
          message: await tr("serverErrors", "user.aiConnectionFailed", {
            message,
          }),
          model: null,
        };
      }
    }),

  getFeatureFlags: protectedProcedure.query(async ({ ctx }) => {
    const flags = await ctx.db
      .select({
        key: featureFlags.key,
        enabled: featureFlags.enabled,
      })
      .from(featureFlags);

    const result: Record<string, boolean> = {};
    for (const flag of flags) {
      result[flag.key] = flag.enabled;
    }
    return result;
  }),

  // ============================================
  // Company Info / Deadline Personalization
  // ============================================

  getUpcomingDeadlines: protectedProcedure
    .input(z.object({ lookAheadDays: z.number().default(180) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user?.companyType) {
        return { deadlines: [], needsSetup: true };
      }

      const deadlines = getUpcomingDeadlines({
        companyType: user.companyType as CompanyType,
        vatPeriod: (user.vatPeriod ?? "none") as VatPeriod,
        fiscalYearEnd: user.fiscalYearEnd ?? "12-31",
        hasEmployees: user.hasEmployees ?? false,
        refDate: new Date(),
        lookAheadDays: input.lookAheadDays,
        locale: user.locale,
      });

      return { deadlines, needsSetup: false };
    }),

  // Org company/tax profile (companyType, vatPeriod, fiscalYearEnd) is org-level
  // config — gate to admin/owner, matching onboarding.updateCompanyProfile.
  // Solo users (no org) pass through (requireOrgAdmin only checks within an org).
  updateCompanyInfo: orgAdminProcedure
    .input(
      z.object({
        companyType: z
          .enum(["sole_prop", "i_s", "aps", "as", "freelance"])
          .nullable(),
        vatPeriod: z
          .enum(["monthly", "quarterly", "semi_annual", "none"])
          .nullable(),
        fiscalYearEnd: z
          .string()
          .regex(/^\d{2}-\d{2}$/, { error: () => st("zod.formatMmDd") })
          .nullable()
          .optional(),
        hasEmployees: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (ctx.orgId) {
        const profileFilter = eq(companyProfiles.organizationId, ctx.orgId);
        const existing = await ctx.db.query.companyProfiles.findFirst({
          where: profileFilter,
        });
        if (existing) {
          await ctx.db
            .update(companyProfiles)
            .set({
              companyType: input.companyType,
              vatPeriod: input.vatPeriod,
              ...(input.fiscalYearEnd !== undefined
                ? { fiscalYearEnd: input.fiscalYearEnd }
                : {}),
              ...(input.hasEmployees !== undefined
                ? { hasEmployees: input.hasEmployees }
                : {}),
              updatedAt: new Date(),
            })
            .where(profileFilter);
          return { success: true };
        }
      }

      // Fallback: write to user row (legacy / no org)
      await ctx.db
        .update(users)
        .set({
          companyType: input.companyType,
          vatPeriod: input.vatPeriod,
          ...(input.fiscalYearEnd !== undefined
            ? { fiscalYearEnd: input.fiscalYearEnd }
            : {}),
          ...(input.hasEmployees !== undefined
            ? { hasEmployees: input.hasEmployees }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return { success: true };
    }),
});
