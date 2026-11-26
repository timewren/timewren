import { TRPCError } from "@trpc/server";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { getOpenAIForUser, isAIEnabledForUser } from "@/lib/ai/openai";
import { accountBrand } from "@/lib/auth/account-brand";
import { DEFAULT_BRAND_KEY } from "@/lib/brands/registry";
import { db } from "@/lib/db";
import {
  calendarConnections,
  calendarEvents,
  calendarMatchingRules,
  clients,
  projects,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { assertEntryEditable } from "@/lib/enterprise/edit-guard";
import { calendarProvidersForBrand } from "@/lib/integrations/calendar-oauth-clients";
import { createCalendarOAuthState } from "@/lib/integrations/calendar-oauth-state";
import {
  findSettingsConnections,
  getAnyCalendarStatus,
  syncAllCalendarProviders,
} from "@/lib/integrations/calendar-providers";
import {
  bulkExportTimeEntriesToCalendar,
  createTimeBlock,
  deleteTimeBlock,
  disconnectCalendar,
  exportTimeEntryToCalendar,
  getAuthorizationUrl,
  getAvailableSlots,
  getCalendarConnectionStatus,
  isGoogleCalendarAvailableForBrand,
  listCalendars,
  suggestTimeBlocks,
} from "@/lib/integrations/google-calendar";
import { syncDirectionRequiresWrite } from "@/lib/integrations/google-calendar-scopes";
import { assertGoogleCalendarWriteAccess } from "@/lib/integrations/google-calendar-write-guard";
import {
  connectICloud,
  disconnectICloud,
  getICloudStatus,
  ICloudConnectError,
  invalidateICloudSyncCache,
  listICloudCalendars,
  selectICloudCalendars,
  syncICloudCalendars,
} from "@/lib/integrations/icloud-calendar";
import {
  disconnectOutlook,
  getOutlookStatus,
} from "@/lib/integrations/outlook-calendar";
import {
  copenhagenDayEndExclusive,
  copenhagenDayStart,
  copenhagenToday,
} from "@/lib/time/copenhagen";
import { resolveDefaultBillable } from "@/lib/time/default-billable";
import { entryDateForStart } from "@/lib/timer/entry-date";
import { rateLimiter, userRateLimitKey } from "@/lib/utils/rate-limiter";
import { protectedProcedure, router } from "../trpc";

/** Oversæt iCloud-fejl til tydelige tRPC-fejl (dansk tekst til UI) */
function toICloudTrpcError(error: unknown): never {
  if (error instanceof ICloudConnectError) {
    throw new TRPCError({
      code:
        error.kind === "auth" || error.kind === "not_connected"
          ? "BAD_REQUEST"
          : "INTERNAL_SERVER_ERROR",
      message: error.message,
      cause: error,
    });
  }
  throw error;
}

export const calendarRouter = router({
  /**
   * Check if Google Calendar is configured
   */
  // comingSoon: TimeWren-konti uden TimeWrens egen Google-klient
  // (TIMEWREN_GOOGLE_*); UI'et viser "kommer snart" i stedet for "ikke sat op".
  isConfigured: protectedProcedure.query(async ({ ctx }) => {
    const brand = await accountBrand(ctx.db, ctx.session.user.id);
    const configured = isGoogleCalendarAvailableForBrand(brand);
    return {
      configured,
      comingSoon: brand !== DEFAULT_BRAND_KEY && !configured,
    };
  }),

  /**
   * Hvilke kalenderudbydere kontoen kan forbinde, ud fra kontoens brand og
   * hvilke OAuth-klienter der er sat (Outlook kun med brandets nøgler).
   */
  providers: protectedProcedure.query(async ({ ctx }) => {
    return calendarProvidersForBrand(
      await accountBrand(ctx.db, ctx.session.user.id),
    );
  }),

  /**
   * Get connection status
   */
  getConnectionStatus: protectedProcedure.query(async ({ ctx }) => {
    // Google hvis forbundet, ellers iCloud — kalendersiden er udbyder-neutral
    return getAnyCalendarStatus(ctx.session.user.id);
  }),

  /**
   * Get authorization URL to connect Google Calendar.
   * Read-only by default; `write: true` asks for calendar.events on top
   * (incremental authorization for an existing connection).
   */
  getAuthUrl: protectedProcedure
    .input(z.object({ write: z.boolean().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      // Kontoens brand vælger Google-klienten; aldrig TimeTracks klient for
      // en TimeWren-konto.
      const brand = await accountBrand(ctx.db, ctx.session.user.id);
      if (!isGoogleCalendarAvailableForBrand(brand)) {
        throw new Error(
          await tr("serverErrors", "calendar.googleNotConfigured"),
        );
      }
      // Signeret og bundet til kontoen og brandet; callbacken kræver den
      // samme værdi i google_oauth_state-cookien.
      const state = createCalendarOAuthState({
        userId: ctx.session.user.id,
        brand,
        provider: "google",
      });
      const status = input?.write
        ? await getCalendarConnectionStatus(ctx.session.user.id)
        : null;
      return {
        url: getAuthorizationUrl(state, {
          write: input?.write,
          loginHint: status?.accountEmail,
          brand,
        }),
        state,
      };
    }),

  /**
   * Disconnect Google Calendar
   */
  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await disconnectCalendar(ctx.session.user.id);
    return { success: true };
  }),

  /**
   * List available calendars
   */
  listCalendars: protectedProcedure.query(async ({ ctx }) => {
    return listCalendars(ctx.session.user.id);
  }),

  /**
   * Update calendar settings
   */
  updateSettings: protectedProcedure
    .input(
      z.object({
        calendarId: z.string().optional(),
        syncEnabled: z.boolean().optional(),
        syncDirection: z.enum(["inbound", "outbound", "both"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const connection = await db.query.calendarConnections.findFirst({
        where: and(
          eq(calendarConnections.userId, ctx.session.user.id),
          eq(calendarConnections.provider, "google"),
        ),
      });

      if (!connection) {
        throw new Error(await tr("serverErrors", "calendar.notConnected"));
      }

      if (syncDirectionRequiresWrite(input.syncDirection)) {
        await assertGoogleCalendarWriteAccess(ctx.session.user.id);
      }

      await db
        .update(calendarConnections)
        .set({
          ...(input.calendarId !== undefined && {
            calendarId: input.calendarId,
          }),
          ...(input.syncEnabled !== undefined && {
            syncEnabled: input.syncEnabled,
          }),
          ...(input.syncDirection !== undefined && {
            syncDirection: input.syncDirection,
          }),
          updatedAt: new Date(),
        })
        .where(eq(calendarConnections.id, connection.id));

      return { success: true };
    }),

  /**
   * Sync calendar events
   */
  sync: protectedProcedure.mutation(async ({ ctx }) => {
    return syncAllCalendarProviders(ctx.session.user.id);
  }),

  /**
   * Get events for a date range
   */
  getEvents: protectedProcedure
    .input(
      z.object({
        startDate: z.string().datetime({ offset: true }),
        endDate: z.string().datetime({ offset: true }),
      }),
    )
    .query(async ({ ctx, input }) => {
      const events = await db.query.calendarEvents.findMany({
        where: and(
          eq(calendarEvents.userId, ctx.session.user.id),
          gte(calendarEvents.startTime, new Date(input.startDate)),
          lte(calendarEvents.endTime, new Date(input.endDate)),
          eq(calendarEvents.isCancelled, false),
        ),
        orderBy: [desc(calendarEvents.startTime)],
        with: {
          linkedTask: true,
          linkedProject: true,
        },
      });

      return events;
    }),

  /**
   * Get events for today
   */
  getTodayEvents: protectedProcedure.query(async ({ ctx }) => {
    // Dansk dag uanset processens TZ (#649)
    const todayStr = copenhagenToday();
    const today = copenhagenDayStart(todayStr);
    const tomorrow = copenhagenDayEndExclusive(todayStr);

    const events = await db.query.calendarEvents.findMany({
      where: and(
        eq(calendarEvents.userId, ctx.session.user.id),
        gte(calendarEvents.startTime, today),
        lte(calendarEvents.startTime, tomorrow),
        eq(calendarEvents.isCancelled, false),
      ),
      orderBy: [desc(calendarEvents.startTime)],
      with: {
        linkedTask: true,
        linkedProject: true,
      },
    });

    return events;
  }),

  /**
   * Get available time slots for a day
   */
  getAvailableSlots: protectedProcedure
    .input(
      z.object({
        date: z.string().datetime({ offset: true }),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Get user's working hours
      const user = await db.query.users.findFirst({
        where: eq(users.id, ctx.session.user.id),
      });

      return getAvailableSlots(ctx.session.user.id, new Date(input.date), {
        workingHoursStart: user?.workingHoursStart || "09:00",
        workingHoursEnd: user?.workingHoursEnd || "17:00",
      });
    }),

  /**
   * Get time block suggestions for tasks
   */
  getTimeBlockSuggestions: protectedProcedure
    .input(
      z
        .object({
          daysToSchedule: z.number().min(1).max(30).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      // Get user's working settings
      const user = await db.query.users.findFirst({
        where: eq(users.id, ctx.session.user.id),
      });

      const workingDays = user?.workingDays
        ? user.workingDays.map(Number)
        : [1, 2, 3, 4, 5];

      const suggestions = await suggestTimeBlocks(ctx.session.user.id, {
        daysToSchedule: input?.daysToSchedule || 7,
        workingHoursStart: user?.workingHoursStart || "09:00",
        workingHoursEnd: user?.workingHoursEnd || "17:00",
        workingDays,
      });

      return suggestions.map((s) => {
        const project = Array.isArray(s.task.project)
          ? s.task.project[0]
          : s.task.project;
        return {
          taskId: s.task.id,
          taskTitle: s.task.title,
          projectName: project?.name,
          suggestedStart: s.suggestedSlot.start.toISOString(),
          suggestedEnd: s.suggestedSlot.end.toISOString(),
          reason: s.reason,
        };
      });
    }),

  /**
   * Create a time block for a task
   */
  createTimeBlock: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        startTime: z.string().datetime({ offset: true }),
        endTime: z.string().datetime({ offset: true }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGoogleCalendarWriteAccess(ctx.session.user.id);
      return createTimeBlock(
        ctx.session.user.id,
        input.taskId,
        new Date(input.startTime),
        new Date(input.endTime),
      );
    }),

  /**
   * Delete a time block
   */
  deleteTimeBlock: protectedProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertGoogleCalendarWriteAccess(ctx.session.user.id);
      return deleteTimeBlock(ctx.session.user.id, input.eventId);
    }),

  /**
   * Quick schedule: accept a suggestion and create time block
   */
  quickSchedule: protectedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        startTime: z.string().datetime({ offset: true }),
        endTime: z.string().datetime({ offset: true }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Check if Google Calendar is connected
      const status = await getCalendarConnectionStatus(ctx.session.user.id);

      if (!status.connected || !status.enabled) {
        // If not connected, just return success without creating calendar event
        // The UI should indicate this is a local time block only
        return {
          success: true,
          calendarEvent: false,
          message: await tr("serverErrors", "calendar.scheduledLocally"),
        };
      }

      await assertGoogleCalendarWriteAccess(ctx.session.user.id);

      const result = await createTimeBlock(
        ctx.session.user.id,
        input.taskId,
        new Date(input.startTime),
        new Date(input.endTime),
      );

      return {
        success: result.success,
        calendarEvent: true,
        eventId: result.eventId,
        error: result.error,
      };
    }),

  /**
   * Export a single time entry to Google Calendar
   */
  exportTimeEntry: protectedProcedure
    .input(
      z.object({
        timeEntryId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGoogleCalendarWriteAccess(ctx.session.user.id);
      // Get the time entry with related data
      const entry = await db.query.timeEntries.findFirst({
        where: and(
          eq(timeEntries.id, input.timeEntryId),
          // Calendar is a personal Google sync — only the caller's own time,
          // never colleagues' entries (even in an org).
          eq(timeEntries.userId, ctx.session.user.id),
        ),
        with: {
          project: {
            with: {
              client: true,
            },
          },
          client: true,
        },
      });

      if (!entry) {
        return {
          success: false,
          error: await tr("serverErrors", "calendar.timeEntryNotFound"),
        };
      }

      // Normalize Drizzle relation types
      const project = entry.project
        ? Array.isArray(entry.project)
          ? entry.project[0]
          : entry.project
        : null;
      const client = entry.client
        ? Array.isArray(entry.client)
          ? entry.client[0]
          : entry.client
        : null;
      const projectClient = project?.client
        ? Array.isArray(project.client)
          ? project.client[0]
          : project.client
        : null;

      return exportTimeEntryToCalendar(ctx.session.user.id, {
        id: entry.id,
        date: entry.date,
        hours: entry.hours,
        description: entry.description,
        startTime: entry.startTime,
        endTime: entry.endTime,
        projectId: entry.projectId,
        project: project ? { ...project, client: projectClient } : null,
        client,
      });
    }),

  /**
   * Bulk export time entries to Google Calendar
   */
  bulkExportTimeEntries: protectedProcedure
    .input(
      z.object({
        timeEntryIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGoogleCalendarWriteAccess(ctx.session.user.id);
      if (input.timeEntryIds.length === 0) {
        return {
          success: false,
          exported: 0,
          failed: 0,
          errors: ["Ingen tidsregistreringer fundet"],
        };
      }

      // Get the time entries with related data — filter in SQL, not JS
      const filteredEntries = await db.query.timeEntries.findMany({
        where: and(
          // Calendar is a personal Google sync — only the caller's own time,
          // never colleagues' entries (even in an org).
          eq(timeEntries.userId, ctx.session.user.id),
          inArray(timeEntries.id, input.timeEntryIds),
        ),
        with: {
          project: {
            with: {
              client: true,
            },
          },
          client: true,
        },
      });

      if (filteredEntries.length === 0) {
        return {
          success: false,
          exported: 0,
          failed: 0,
          errors: ["Ingen tidsregistreringer fundet"],
        };
      }

      return bulkExportTimeEntriesToCalendar(
        ctx.session.user.id,
        filteredEntries.map((entry) => {
          const project = entry.project
            ? Array.isArray(entry.project)
              ? entry.project[0]
              : entry.project
            : null;
          const client = entry.client
            ? Array.isArray(entry.client)
              ? entry.client[0]
              : entry.client
            : null;
          const projectClient = project?.client
            ? Array.isArray(project.client)
              ? project.client[0]
              : project.client
            : null;
          return {
            id: entry.id,
            date: entry.date,
            hours: entry.hours,
            description: entry.description,
            startTime: entry.startTime,
            endTime: entry.endTime,
            projectId: entry.projectId,
            project: project ? { ...project, client: projectClient } : null,
            client,
          };
        }),
      );
    }),

  /**
   * Export all time entries for a date range to Google Calendar
   */
  exportTimeEntriesForRange: protectedProcedure
    .input(
      z.object({
        startDate: z.string().datetime({ offset: true }),
        endDate: z.string().datetime({ offset: true }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertGoogleCalendarWriteAccess(ctx.session.user.id);
      // Get time entries for the range
      const entries = await db.query.timeEntries.findMany({
        where: and(
          // Calendar is a personal Google sync — only the caller's own time,
          // never colleagues' entries (even in an org).
          eq(timeEntries.userId, ctx.session.user.id),
          gte(timeEntries.date, new Date(input.startDate)),
          lte(timeEntries.date, new Date(input.endDate)),
        ),
        with: {
          project: {
            with: {
              client: true,
            },
          },
          client: true,
        },
      });

      if (entries.length === 0) {
        return {
          success: true,
          exported: 0,
          failed: 0,
          errors: [],
        };
      }

      return bulkExportTimeEntriesToCalendar(
        ctx.session.user.id,
        entries.map((entry) => {
          const project = entry.project
            ? Array.isArray(entry.project)
              ? entry.project[0]
              : entry.project
            : null;
          const client = entry.client
            ? Array.isArray(entry.client)
              ? entry.client[0]
              : entry.client
            : null;
          const projectClient = project?.client
            ? Array.isArray(project.client)
              ? project.client[0]
              : project.client
            : null;
          return {
            id: entry.id,
            date: entry.date,
            hours: entry.hours,
            description: entry.description,
            startTime: entry.startTime,
            endTime: entry.endTime,
            projectId: entry.projectId,
            project: project ? { ...project, client: projectClient } : null,
            client,
          };
        }),
      );
    }),

  /**
   * Match a calendar event to a client using multi-signal scoring
   */
  matchClient: protectedProcedure
    .input(
      z.object({
        eventTitle: z.string(),
        eventDescription: z.string().optional(),
        attendeeEmails: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { matchEventToClient } = await import("@/lib/calendar/matching");
      return matchEventToClient(
        ctx.session.user.id,
        input.eventTitle,
        input.eventDescription,
        input.attendeeEmails ?? [],
      );
    }),

  /**
   * Match a calendar event title to an existing project (fuzzy)
   */
  matchProject: protectedProcedure
    .input(
      z.object({
        eventTitle: z.string(),
        eventDescription: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const title = input.eventTitle.toLowerCase();
      const desc = (input.eventDescription || "").toLowerCase();
      const combined = `${title} ${desc}`;

      // Get all active projects with clients
      const userProjects = await db
        .select({
          id: projects.id,
          name: projects.name,
          clientId: projects.clientId,
          clientName: clients.name,
        })
        .from(projects)
        .leftJoin(clients, eq(projects.clientId, clients.id))
        .where(
          and(
            ctx.orgId
              ? eq(projects.organizationId, ctx.orgId)
              : eq(projects.userId, userId),
            eq(clients.isArchived, false),
            ne(projects.status, "archived"),
          ),
        );

      // Score each project
      const scored = userProjects
        .map((p) => {
          let score = 0;
          const pName = p.name.toLowerCase();
          const cName = (p.clientName || "").toLowerCase();

          // Exact project name in title → high score
          if (title.includes(pName)) score += 100;
          else if (combined.includes(pName)) score += 60;

          // Client name in title
          if (cName && title.includes(cName)) score += 80;
          else if (cName && combined.includes(cName)) score += 40;

          // Word-level partial matches
          const pWords = pName.split(/\s+/).filter((w) => w.length > 2);
          for (const w of pWords) {
            if (title.includes(w)) score += 20;
            else if (combined.includes(w)) score += 10;
          }

          return { ...p, score };
        })
        .filter((p) => p.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      // Also check last-used project for similar events
      const searchTerm = `${input.eventTitle}`.slice(0, 30);
      const orgFilter = ctx.orgId
        ? sql`AND organization_id = ${ctx.orgId}`
        : sql`AND user_id = ${userId}`;
      const recentMatch = await db.execute<{
        project_id: string | null;
        client_id: string | null;
      }>(
        sql`SELECT project_id, client_id FROM time_entries
            WHERE true ${orgFilter}
            AND description ILIKE ${`%${searchTerm}%`}
            ORDER BY date DESC LIMIT 1`,
      );

      // biome-ignore lint/suspicious/noExplicitAny: raw SQL result
      const lastUsedRow = (recentMatch as any)?.[0];
      return {
        suggestions: scored,
        lastUsed: lastUsedRow
          ? {
              projectId: lastUsedRow.project_id,
              clientId: lastUsedRow.client_id,
            }
          : null,
      };
    }),

  /**
   * Create a time entry from a calendar event
   */
  createTimeEntryFromEvent: protectedProcedure
    .input(
      z
        .object({
          eventId: z.string().uuid(),
          projectId: z.string().uuid().optional(),
          clientId: z.string().uuid().optional(),
          description: z.string().optional(),
          isBillable: z.boolean().optional(),
        })
        .refine(
          (data) => data.projectId || data.clientId || data.description?.trim(),
          {
            error: () => st("zod.selectProjectClientOrDescription"),
            path: ["projectId"],
          },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Get the calendar event
      const event = await db.query.calendarEvents.findFirst({
        where: and(
          eq(calendarEvents.id, input.eventId),
          eq(calendarEvents.userId, userId),
        ),
      });
      if (!event)
        throw new Error(await tr("serverErrors", "calendar.eventNotFound"));
      if (!event.startTime || !event.endTime)
        throw new Error(await tr("serverErrors", "calendar.eventMissingTimes"));

      // Verify project belongs to user (if provided)
      let resolvedClientId = input.clientId ?? null;
      if (input.projectId) {
        const project = await db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            ctx.orgId
              ? eq(projects.organizationId, ctx.orgId)
              : eq(projects.userId, userId),
          ),
        });
        if (!project)
          throw new Error(await tr("serverErrors", "common.projectNotFound"));
        // Fall back to the project's client if no clientId supplied
        if (!resolvedClientId) resolvedClientId = project.clientId;
      }

      // Verify clientId (if supplied) belongs to user
      if (input.clientId) {
        const client = await db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
          columns: { id: true },
        });
        if (!client)
          throw new Error(await tr("serverErrors", "common.clientNotFound"));
      }

      // Fælles redigeringsguard (#467): kalender-poster må ikke omgå
      // periodelås, indsendte uger eller rullende lås
      await assertEntryEditable(db, {
        orgId: ctx.orgId,
        userId,
        // Låsen tjekkes mod den dato posten gemmes på — ikke det rå
        // starttidspunkt, der i UTC kan ligge i forrige uge (#734)
        dates: [entryDateForStart(new Date(event.startTime))],
      });

      // Calculate hours
      const durationMs =
        new Date(event.endTime).getTime() - new Date(event.startTime).getTime();
      const hours = Math.round((durationMs / 3600000) * 100) / 100;

      // Create time entry
      const [entry] = await db
        .insert(timeEntries)
        .values({
          userId,
          organizationId: ctx.orgId,
          projectId: input.projectId ?? null,
          clientId: resolvedClientId,
          description: input.description || event.title,
          date: entryDateForStart(new Date(event.startTime)),
          hours: hours.toString(),
          startTime: new Date(event.startTime),
          endTime: new Date(event.endTime),
          isBillable: await resolveDefaultBillable(
            db,
            { projectId: input.projectId, clientId: resolvedClientId },
            input.isBillable,
          ),
          source: "calendar",
        })
        .returning();

      // Link the time entry to the calendar event
      await db
        .update(calendarEvents)
        .set({ linkedTimeEntryId: entry.id })
        .where(eq(calendarEvents.id, event.id));

      return { success: true, entryId: entry.id, hours };
    }),

  /**
   * Update sync filters for calendar connection
   */
  updateSyncFilters: protectedProcedure
    .input(
      z.object({
        ignoreWords: z.array(z.string()).optional(),
        minDurationMinutes: z.number().min(0).max(120).optional(),
        ignoreAllDay: z.boolean().optional(),
        onlyAccepted: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const connections = await findSettingsConnections(ctx.session.user.id);
      if (connections.length === 0)
        throw new Error(await tr("serverErrors", "calendar.noConnection"));

      await db
        .update(calendarConnections)
        .set({
          syncFilters: input,
          updatedAt: new Date(),
        })
        .where(
          inArray(
            calendarConnections.id,
            connections.map((c) => c.id),
          ),
        );
      // iCloud genanvender filtrene på alt ved næste synk
      await invalidateICloudSyncCache(ctx.session.user.id);

      return { success: true };
    }),

  /**
   * Get sync filters for calendar connection
   */
  getSyncFilters: protectedProcedure.query(async ({ ctx }) => {
    const [connection] = await findSettingsConnections(ctx.session.user.id);
    if (!connection) return null;
    return (
      (connection.syncFilters as {
        ignoreWords?: string[];
        minDurationMinutes?: number;
        ignoreAllDay?: boolean;
        onlyAccepted?: boolean;
      }) || {}
    );
  }),

  /**
   * Update auto-track mode
   */
  updateAutoTrackMode: protectedProcedure
    .input(
      z.object({
        mode: z.enum(["off", "suggest", "auto"]),
        defaultProjectId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const connections = await findSettingsConnections(ctx.session.user.id);
      if (connections.length === 0)
        throw new Error(await tr("serverErrors", "calendar.noConnection"));

      await db
        .update(calendarConnections)
        .set({
          autoTrackMode: input.mode,
          ...(input.defaultProjectId !== undefined && {
            defaultProjectId: input.defaultProjectId,
          }),
          updatedAt: new Date(),
        })
        .where(
          inArray(
            calendarConnections.id,
            connections.map((c) => c.id),
          ),
        );

      return { success: true };
    }),

  /**
   * Get auto-track settings
   */
  getAutoTrackSettings: protectedProcedure.query(async ({ ctx }) => {
    const [connection] = await findSettingsConnections(ctx.session.user.id);
    if (!connection) return null;
    return {
      mode: (connection.autoTrackMode || "off") as "off" | "suggest" | "auto",
      defaultProjectId: connection.defaultProjectId,
    };
  }),

  /**
   * Get pending auto-track suggestions (events that ended but have no linked time entry)
   */
  getAutoTrackSuggestions: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get connection settings (Google eller iCloud)
    const [connection] = await findSettingsConnections(userId);
    if (!connection || connection.autoTrackMode === "off") return [];

    // Find past events with no linked time entry, not all-day, not cancelled
    const suggestions = await db.query.calendarEvents.findMany({
      where: and(
        eq(calendarEvents.userId, userId),
        eq(calendarEvents.isCancelled, false),
        eq(calendarEvents.isAllDay, false),
        lte(calendarEvents.endTime, now),
        gte(calendarEvents.startTime, oneDayAgo),
        sql`${calendarEvents.linkedTimeEntryId} IS NULL`,
      ),
      orderBy: [desc(calendarEvents.startTime)],
      limit: 20,
    });

    // Filter out declined events
    return suggestions.filter(
      (e) => !e.responseStatus || e.responseStatus !== "declined",
    );
  }),

  /**
   * Auto-track: batch create time entries from past events
   */
  autoTrackEvents: protectedProcedure
    .input(
      z.object({
        eventIds: z.array(z.string().uuid()),
        projectId: z.string().uuid().optional(),
        clientId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      let created = 0;
      let skipped = 0;

      // Verify project (if provided)
      let resolvedClientId = input.clientId ?? null;
      if (input.projectId) {
        const project = await db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            ctx.orgId
              ? eq(projects.organizationId, ctx.orgId)
              : eq(projects.userId, userId),
          ),
        });
        if (!project)
          throw new Error(await tr("serverErrors", "common.projectNotFound"));
        if (!resolvedClientId) resolvedClientId = project.clientId;
      }

      // Verify clientId if supplied
      if (input.clientId) {
        const client = await db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
          columns: { id: true },
        });
        if (!client)
          throw new Error(await tr("serverErrors", "common.clientNotFound"));
      }

      for (const eventId of input.eventIds) {
        const event = await db.query.calendarEvents.findFirst({
          where: and(
            eq(calendarEvents.id, eventId),
            eq(calendarEvents.userId, userId),
            sql`${calendarEvents.linkedTimeEntryId} IS NULL`,
          ),
        });
        if (!event?.startTime || !event.endTime) {
          skipped++;
          continue;
        }

        const durationMs =
          new Date(event.endTime).getTime() -
          new Date(event.startTime).getTime();
        const hours = Math.round((durationMs / 3600000) * 100) / 100;
        if (hours < 0.01) {
          skipped++;
          continue;
        }

        // Fælles redigeringsguard (#467): låste dage springes over i stedet
        // for at vælte hele auto-track-kørslen
        try {
          await assertEntryEditable(db, {
            orgId: ctx.orgId,
            userId,
            dates: [entryDateForStart(new Date(event.startTime))],
          });
        } catch (err) {
          if (err instanceof TRPCError) {
            skipped++;
            continue;
          }
          throw err;
        }

        const [entry] = await db
          .insert(timeEntries)
          .values({
            userId,
            organizationId: ctx.orgId,
            projectId: input.projectId ?? null,
            clientId: resolvedClientId,
            description: event.title,
            date: entryDateForStart(new Date(event.startTime)),
            hours: hours.toString(),
            startTime: new Date(event.startTime),
            endTime: new Date(event.endTime),
            isBillable:
              input.projectId || resolvedClientId
                ? await resolveDefaultBillable(db, {
                    projectId: input.projectId,
                    clientId: resolvedClientId,
                  })
                : false,
            source: "calendar",
          })
          .returning();

        await db
          .update(calendarEvents)
          .set({ linkedTimeEntryId: entry.id })
          .where(eq(calendarEvents.id, eventId));

        created++;
      }

      return { created, skipped };
    }),

  /**
   * Detect overlapping time entries and calendar events for a date range
   */
  getConflicts: protectedProcedure
    .input(
      z.object({
        startDate: z.string().datetime({ offset: true }),
        endDate: z.string().datetime({ offset: true }),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const start = new Date(input.startDate);
      const end = new Date(input.endDate);

      // Get all time entries with start/end times
      const entries = await db.query.timeEntries.findMany({
        where: and(
          // Calendar is a personal Google sync — only the caller's own time.
          eq(timeEntries.userId, userId),
          gte(timeEntries.date, start),
          lte(timeEntries.date, end),
          sql`${timeEntries.startTime} IS NOT NULL`,
          sql`${timeEntries.endTime} IS NOT NULL`,
        ),
        with: { project: true },
      });

      // Get calendar events
      const events = await db.query.calendarEvents.findMany({
        where: and(
          eq(calendarEvents.userId, userId),
          gte(calendarEvents.startTime, start),
          lte(calendarEvents.endTime, end),
          eq(calendarEvents.isCancelled, false),
          eq(calendarEvents.isAllDay, false),
        ),
      });

      type Conflict = {
        type: "entry-entry" | "entry-event";
        item1: { id: string; title: string; start: string; end: string };
        item2: { id: string; title: string; start: string; end: string };
        overlapMinutes: number;
      };
      const conflicts: Conflict[] = [];

      // Check entry vs entry overlaps
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i];
          const b = entries[j];
          if (!a.startTime || !a.endTime || !b.startTime || !b.endTime)
            continue;
          const aStart = new Date(a.startTime).getTime();
          const aEnd = new Date(a.endTime).getTime();
          const bStart = new Date(b.startTime).getTime();
          const bEnd = new Date(b.endTime).getTime();

          if (aStart < bEnd && bStart < aEnd) {
            const overlapStart = Math.max(aStart, bStart);
            const overlapEnd = Math.min(aEnd, bEnd);
            conflicts.push({
              type: "entry-entry",
              item1: {
                id: a.id,
                title: a.description || "Tidsregistrering",
                start: a.startTime.toISOString(),
                end: a.endTime.toISOString(),
              },
              item2: {
                id: b.id,
                title: b.description || "Tidsregistrering",
                start: b.startTime.toISOString(),
                end: b.endTime.toISOString(),
              },
              overlapMinutes: Math.round((overlapEnd - overlapStart) / 60000),
            });
          }
        }
      }

      // Check entry vs event overlaps (only if event has no linked entry)
      for (const entry of entries) {
        if (!entry.startTime || !entry.endTime) continue;
        const eStart = new Date(entry.startTime).getTime();
        const eEnd = new Date(entry.endTime).getTime();

        for (const event of events) {
          if (event.linkedTimeEntryId === entry.id) continue; // skip linked pairs
          if (!event.startTime || !event.endTime) continue;
          const evStart = new Date(event.startTime).getTime();
          const evEnd = new Date(event.endTime).getTime();

          if (eStart < evEnd && evStart < eEnd) {
            const overlapStart = Math.max(eStart, evStart);
            const overlapEnd = Math.min(eEnd, evEnd);
            conflicts.push({
              type: "entry-event",
              item1: {
                id: entry.id,
                title: entry.description || "Tidsregistrering",
                start: entry.startTime.toISOString(),
                end: entry.endTime.toISOString(),
              },
              item2: {
                id: event.id,
                title: event.title,
                start: event.startTime.toISOString(),
                end: event.endTime.toISOString(),
              },
              overlapMinutes: Math.round((overlapEnd - overlapStart) / 60000),
            });
          }
        }
      }

      return conflicts;
    }),

  /**
   * Weekly summary: calendar time vs tracked time
   */
  getWeeklySummary: protectedProcedure
    .input(
      z.object({
        weekStart: z.string().datetime({ offset: true }),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const weekStart = new Date(input.weekStart);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      // Calendar time (non-cancelled, non-all-day, not declined)
      const events = await db.query.calendarEvents.findMany({
        where: and(
          eq(calendarEvents.userId, userId),
          gte(calendarEvents.startTime, weekStart),
          lte(calendarEvents.endTime, weekEnd),
          eq(calendarEvents.isCancelled, false),
          eq(calendarEvents.isAllDay, false),
        ),
      });

      let calendarMinutes = 0;
      let _trackedFromCalendar = 0;
      for (const ev of events) {
        if (ev.responseStatus === "declined") continue;
        if (!ev.startTime || !ev.endTime) continue;
        const dur =
          (new Date(ev.endTime).getTime() - new Date(ev.startTime).getTime()) /
          60000;
        calendarMinutes += dur;
        if (ev.linkedTimeEntryId) _trackedFromCalendar += dur;
      }

      // Tracked time
      const entries = await db.query.timeEntries.findMany({
        where: and(
          // Calendar is a personal Google sync — only the caller's own time.
          eq(timeEntries.userId, userId),
          gte(timeEntries.date, weekStart),
          // weekEnd er næste mandag — eksklusiv, ellers tæller dens poster med.
          lt(timeEntries.date, weekEnd),
        ),
        with: { project: true },
      });

      let trackedMinutes = 0;
      const byProject: Record<string, { name: string; minutes: number }> = {};
      for (const e of entries) {
        const mins = Number(e.hours) * 60;
        trackedMinutes += mins;
        const projName =
          (e.project
            ? Array.isArray(e.project)
              ? e.project[0]?.name
              : e.project.name
            : await tr("serverErrors", "calendar.noProject")) ||
          (await tr("serverErrors", "calendar.noProject"));
        if (!byProject[projName])
          byProject[projName] = { name: projName, minutes: 0 };
        byProject[projName].minutes += mins;
      }

      return {
        calendarHours: Math.round((calendarMinutes / 60) * 10) / 10,
        trackedHours: Math.round((trackedMinutes / 60) * 10) / 10,
        gapHours:
          Math.round(((calendarMinutes - trackedMinutes) / 60) * 10) / 10,
        captureRate:
          calendarMinutes > 0
            ? Math.round((trackedMinutes / calendarMinutes) * 100)
            : 100,
        eventsCount: events.filter((e) => e.responseStatus !== "declined")
          .length,
        trackedEventsCount: events.filter((e) => e.linkedTimeEntryId).length,
        byProject: Object.values(byProject).sort(
          (a, b) => b.minutes - a.minutes,
        ),
      };
    }),

  /**
   * CRUD for matching rules
   */
  listMatchingRules: protectedProcedure.query(async ({ ctx }) => {
    return db.query.calendarMatchingRules.findMany({
      where: ctx.orgId
        ? eq(calendarMatchingRules.organizationId, ctx.orgId)
        : eq(calendarMatchingRules.userId, ctx.session.user.id),
      with: { project: true, client: true },
      orderBy: [desc(calendarMatchingRules.matchCount)],
    });
  }),

  createMatchingRule: protectedProcedure
    .input(
      z.object({
        pattern: z.string().min(1).max(255),
        projectId: z.string().uuid().optional(),
        clientId: z.string().uuid().optional(),
        source: z.enum(["manual", "learned"]).optional().default("manual"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify referenced project/client belong to user — listMatchingRules
      // joins these, so a cross-tenant id would leak the other project/client.
      if (input.projectId) {
        const project = await db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            ctx.orgId
              ? eq(projects.organizationId, ctx.orgId)
              : eq(projects.userId, userId),
          ),
          columns: { id: true },
        });
        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.projectNotFound"),
          });
        }
      }
      if (input.clientId) {
        const client = await db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
          columns: { id: true },
        });
        if (!client) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.clientNotFound"),
          });
        }
      }

      const [rule] = await db
        .insert(calendarMatchingRules)
        .values({
          userId,
          organizationId: ctx.orgId ?? null,
          pattern: input.pattern,
          projectId: input.projectId || null,
          clientId: input.clientId || null,
          source: input.source,
        })
        .returning();
      return rule;
    }),

  deleteMatchingRule: protectedProcedure
    .input(z.object({ ruleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(calendarMatchingRules)
        .where(
          and(
            eq(calendarMatchingRules.id, input.ruleId),
            ctx.orgId
              ? eq(calendarMatchingRules.organizationId, ctx.orgId)
              : eq(calendarMatchingRules.userId, ctx.session.user.id),
          ),
        );
      return { success: true };
    }),

  /**
   * Update privacy mode for calendar connection
   */
  updatePrivacyMode: protectedProcedure
    .input(z.object({ mode: z.enum(["off", "mask_titles", "mask_all"]) }))
    .mutation(async ({ ctx, input }) => {
      const connections = await findSettingsConnections(ctx.session.user.id);
      if (connections.length === 0)
        throw new Error(await tr("serverErrors", "calendar.noConnection"));

      await db
        .update(calendarConnections)
        .set({ privacyMode: input.mode, updatedAt: new Date() })
        .where(
          inArray(
            calendarConnections.id,
            connections.map((c) => c.id),
          ),
        );
      // Titler maskeres/afmaskeres på alle iCloud-hændelser ved næste synk
      await invalidateICloudSyncCache(ctx.session.user.id);

      return { success: true };
    }),

  /**
   * Get privacy mode
   */
  getPrivacyMode: protectedProcedure.query(async ({ ctx }) => {
    const [connection] = await findSettingsConnections(ctx.session.user.id);
    return {
      mode: (connection?.privacyMode || "off") as
        | "off"
        | "mask_titles"
        | "mask_all",
    };
  }),

  /**
   * Select which Google calendars to sync (multi-calendar)
   */
  selectCalendars: protectedProcedure
    .input(
      z.object({
        calendars: z.array(
          z.object({
            calendarId: z.string(),
            calendarName: z.string(),
            calendarColor: z.string().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Get primary connection (the one without parentConnectionId — it holds OAuth tokens)
      const primary = await ctx.db.query.calendarConnections.findFirst({
        where: and(
          eq(calendarConnections.userId, userId),
          eq(calendarConnections.provider, "google"),
          isNull(calendarConnections.parentConnectionId),
        ),
      });
      if (!primary)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "calendar.noConnectionFound"),
        });

      // Get existing child connections
      const existing = await ctx.db.query.calendarConnections.findMany({
        where: and(
          eq(calendarConnections.userId, userId),
          eq(calendarConnections.parentConnectionId, primary.id),
        ),
      });

      const existingIds = new Set(
        existing.map((c) => c.calendarId).filter(Boolean),
      );
      const selectedIds = new Set(input.calendars.map((c) => c.calendarId));

      // Remove deselected calendars
      for (const conn of existing) {
        if (!conn.calendarId || !selectedIds.has(conn.calendarId)) {
          await ctx.db
            .delete(calendarConnections)
            .where(eq(calendarConnections.id, conn.id));
        }
      }

      // Add newly selected calendars
      for (const cal of input.calendars) {
        if (
          !existingIds.has(cal.calendarId) &&
          cal.calendarId !== primary.calendarId
        ) {
          // Children read tokens from the parent — never store own copies
          await ctx.db.insert(calendarConnections).values({
            userId,
            organizationId: ctx.orgId,
            provider: "google",
            accessToken: null,
            refreshToken: null,
            tokenExpiry: null,
            calendarId: cal.calendarId,
            calendarName: cal.calendarName,
            calendarColor: cal.calendarColor ?? null,
            parentConnectionId: primary.id,
            syncEnabled: true,
            syncDirection: "inbound",
            autoTrackMode: "suggest",
          });
        }
      }

      // Update primary calendar name/color if included in selection
      const primaryCal = input.calendars.find(
        (c) => c.calendarId === primary.calendarId,
      );
      if (primaryCal) {
        await ctx.db
          .update(calendarConnections)
          .set({
            calendarName: primaryCal.calendarName,
            calendarColor: primaryCal.calendarColor ?? null,
          })
          .where(eq(calendarConnections.id, primary.id));
      }

      return { success: true };
    }),

  /**
   * Get selected calendars for multi-calendar sync
   */
  getSelectedCalendars: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const connections = await ctx.db.query.calendarConnections.findMany({
      // Google-kalendervælgeren — iCloud har sin egen (icloudListCalendars)
      where: and(
        eq(calendarConnections.userId, userId),
        eq(calendarConnections.provider, "google"),
      ),
      orderBy: [calendarConnections.createdAt],
    });
    return connections.map((c) => ({
      id: c.id,
      calendarId: c.calendarId,
      calendarName: c.calendarName ?? c.calendarId,
      calendarColor: c.calendarColor,
      isPrimary: !c.parentConnectionId,
      syncEnabled: c.syncEnabled,
      autoTrackMode: c.autoTrackMode,
    }));
  }),

  // ------------------------------------------------------------------
  // iCloud / CalDAV (#676) — read-only
  // ------------------------------------------------------------------

  /** iCloud-status (viser aldrig password) */
  icloudStatus: protectedProcedure.query(async ({ ctx }) => {
    return getICloudStatus(ctx.session.user.id);
  }),

  /**
   * Forbind eller genforbind iCloud med Apple-ID + app-specifikt password.
   * Validerer mod Apple før noget gemmes; ingen kalendere vælges automatisk.
   */
  icloudConnect: protectedProcedure
    .input(
      z.object({
        appleId: z.string().trim().min(3).max(255),
        appPassword: z.string().trim().min(8).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Serveren må ikke kunne bruges til at gætte Apple-passwords
      await rateLimiter.checkOrThrow(
        userRateLimitKey(ctx.session.user.id, "icloud-connect"),
        "login",
      );
      try {
        return await connectICloud({
          userId: ctx.session.user.id,
          orgId: ctx.orgId ?? null,
          appleId: input.appleId,
          appPassword: input.appPassword,
        });
      } catch (error) {
        toICloudTrpcError(error);
      }
    }),

  /** Brugerens iCloud-kalendere med markering af de valgte */
  icloudListCalendars: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await listICloudCalendars(ctx.session.user.id);
    } catch (error) {
      toICloudTrpcError(error);
    }
  }),

  /** Vælg hvilke iCloud-kalendere der læses, og kør første synk */
  icloudSelectCalendars: protectedProcedure
    .input(
      z.object({
        calendarUrls: z.array(z.string().url().max(255)).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const selection = await selectICloudCalendars({
          userId: ctx.session.user.id,
          orgId: ctx.orgId ?? null,
          calendarUrls: input.calendarUrls,
        });
        const sync = await syncICloudCalendars(ctx.session.user.id, {
          force: true,
        });
        return { ...selection, sync };
      } catch (error) {
        toICloudTrpcError(error);
      }
    }),

  // ------------------------------------------------------------------
  // Outlook (Microsoft Graph) — read-only. Forbindelsen startes via
  // /api/integrations/outlook/start (PKCE-verifier i HttpOnly-cookie).
  // ------------------------------------------------------------------

  /** Outlook-status (viser aldrig tokens) */
  outlookStatus: protectedProcedure.query(async ({ ctx }) => {
    return getOutlookStatus(ctx.session.user.id);
  }),

  /** Afbryd Outlook — sletter forbindelsen, dens tokens og hændelser */
  outlookDisconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await disconnectOutlook(ctx.session.user.id);
    return { success: true };
  }),

  /** Afbryd iCloud — sletter kun iCloud-forbindelser og deres hændelser */
  icloudDisconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await disconnectICloud(ctx.session.user.id);
    return { success: true };
  }),

  /**
   * Register webhook for real-time push notifications
   */
  registerWebhook: protectedProcedure.mutation(async ({ ctx }) => {
    const { registerWebhookChannel } = await import(
      "@/lib/integrations/google-calendar"
    );
    return registerWebhookChannel(ctx.session.user.id);
  }),

  /**
   * List all connected calendars (multi-calendar support)
   */
  listConnectedCalendars: protectedProcedure.query(async ({ ctx }) => {
    const connections = await db.query.calendarConnections.findMany({
      where: eq(calendarConnections.userId, ctx.session.user.id),
    });
    return connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      accountEmail: c.providerAccountId,
      calendarId: c.calendarId,
      syncEnabled: c.syncEnabled,
      syncDirection: c.syncDirection,
      privacyMode: c.privacyMode,
      autoTrackMode: c.autoTrackMode,
      lastSyncedAt: c.lastSynced,
      error: c.syncError,
    }));
  }),

  /**
   * AI-powered time tracking suggestions from calendar events.
   * Analyzes recent calendar events and suggests which project to track them to.
   * Requires user to have their own AI API key configured (BYOK).
   */
  getAISuggestions: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Check AI availability
    const aiEnabled = await isAIEnabledForUser(userId);
    if (!aiEnabled) return { available: false, suggestions: [] };

    // Get untracked past events (last 24h)
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const untrackedEvents = await db.query.calendarEvents.findMany({
      where: and(
        eq(calendarEvents.userId, userId),
        eq(calendarEvents.isCancelled, false),
        eq(calendarEvents.isAllDay, false),
        lte(calendarEvents.endTime, now),
        gte(calendarEvents.startTime, oneDayAgo),
        sql`${calendarEvents.linkedTimeEntryId} IS NULL`,
      ),
      orderBy: [desc(calendarEvents.startTime)],
      limit: 10,
    });

    if (untrackedEvents.length === 0) {
      return { available: true, suggestions: [] };
    }

    // Get user's projects for context
    const userProjects = await db
      .select({
        id: projects.id,
        name: projects.name,
        clientName: clients.name,
      })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          ctx.orgId
            ? eq(projects.organizationId, ctx.orgId)
            : eq(projects.userId, userId),
          eq(clients.isArchived, false),
        ),
      );

    try {
      const { client, model } = await getOpenAIForUser(userId);

      const prompt = `Du er en assistent for en dansk freelancer. Baseret på disse kalenderevents, foreslå hvilket projekt de hører til.

Events:
${untrackedEvents.map((e) => `- "${e.title}" (${e.startTime ? new Date(e.startTime).toLocaleString("da-DK", { timeZone: "Europe/Copenhagen" }) : ""})`).join("\n")}

Tilgængelige projekter:
${userProjects.map((p) => `- ${p.name} (${p.clientName || "ingen kunde"})`).join("\n")}

Svar med JSON array: [{"eventTitle": "...", "projectName": "...", "confidence": 0.0-1.0, "reason": "kort forklaring"}]
Kun inkluder events du er rimelig sikre på (confidence > 0.5). Svar kun med JSON, ingen markdown.`;

      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      });

      const raw = completion.choices[0]?.message?.content || "[]";
      // Extract JSON from response
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return { available: true, suggestions: [] };

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        eventTitle: string;
        projectName: string;
        confidence: number;
        reason: string;
      }>;

      // Map project names to IDs
      const suggestions = parsed
        .filter((s) => s.confidence > 0.5)
        .map((s) => {
          const project = userProjects.find(
            (p) => p.name.toLowerCase() === s.projectName.toLowerCase(),
          );
          const event = untrackedEvents.find((e) => e.title === s.eventTitle);
          if (!project || !event) return null;
          return {
            eventId: event.id,
            eventTitle: s.eventTitle,
            projectId: project.id,
            projectName: project.name,
            clientName: project.clientName,
            confidence: s.confidence,
            reason: s.reason,
          };
        })
        .filter(Boolean);

      return { available: true, suggestions };
    } catch (err) {
      console.error("[AI Calendar] Error:", err);
      return {
        available: true,
        suggestions: [],
        error: await tr("serverErrors", "calendar.aiFailed"),
      };
    }
  }),
});
