import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  max,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { containsPattern } from "@/lib/api/list-query";
import { assertCanAddActiveClient } from "@/lib/billing/plan-limits";
import { normalizeClientDomains } from "@/lib/clients/domains";
import {
  clientPortalAccess,
  clients,
  emailPreferences,
  generatedTimeEntries,
  invoices,
  prepaidPackages,
  prepaidUsage,
  projects,
  rateHistory,
  recurringTimeTemplates,
  timeEntries,
  users,
} from "@/lib/db/schema";
import {
  recordDeletionTombstones,
  type TombstoneRow,
} from "@/lib/desktop-sync-tombstones";
import { sendFirstClientEmail } from "@/lib/email/engagement";
import { unbilledTimeEntryFilter } from "@/lib/invoicing/unbilled";
import { logOrgAudit } from "@/lib/org-audit";
import { trackEvent } from "@/lib/telemetry/track";
import { emitWebhookEvent } from "@/lib/webhooks/events";
import { Errors } from "../errors";
import {
  moduleReadProcedure,
  moduleWriteProcedure,
  protectedProcedure,
  router,
  subscribedProcedure,
} from "../trpc";
import { detectChanges, logActivity } from "./activity";
import { getAccessibleClientIds } from "./clientAccess";

// Field labels for activity log
const clientFieldLabels: Record<string, string> = {
  name: "Navn",
  email: "Email",
  phone: "Telefon",
  company: "Virksomhed",
  address: "Adresse",
  city: "By",
  postalCode: "Postnummer",
  country: "Land",
  cvrNumber: "CVR-nummer",
  notes: "Noter",
  defaultHourlyRate: "Timesats",
  defaultBillable: "Fakturerbar som standard",
  isActive: "Aktiv",
  isArchived: "Arkiveret",
};

const clientInput = z
  .object({
    name: z
      .string()
      .min(2, { error: () => st("zod.nameMin2") })
      .max(255),
    email: z
      .string()
      .max(255)
      .email({ error: () => st("zod.invalidEmailShort") })
      .optional()
      .or(z.literal("")),
    phone: z.string().max(50).optional(),
    company: z.string().max(255).optional(),
    address: z.string().max(500).optional(),
    city: z.string().max(255).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().max(100).optional(),
    cvrNumber: z.string().max(20).optional(),
    // Kobling til Billy-kontakt; kun update bruger den, undefined = uændret
    billyId: z.string().max(100).nullable().optional(),
    notes: z.string().max(5000).optional(),
    defaultHourlyRate: z.string().max(20).optional(),
    // Betalingsbetingelser (#201): dage til forfald, null = brug default
    paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
    // Månedlig kunde-statusrapport (#96)
    monthlyStatusReportEnabled: z.boolean().optional(),
    autoReminderEnabled: z.boolean().optional(),
    monthlyStatusNote: z.string().max(1000).nullable().optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
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
    roundingMethod: z.enum(["up", "nearest", "down"]).nullable().optional(),
    hidePrepaidValue: z.boolean().nullable().optional(),
    // Intern klient (#541): false = nye tidsposter er ikke-fakturerbare som default
    defaultBillable: z.boolean().optional(),
    approvalWorkflow: z
      .enum(["off", "per_entry", "per_period", "per_invoice_draft"])
      .nullable()
      .optional(),
    // Kundens egne domæner (desktop-detektionen); undefined = uændret
    domains: z.array(z.string().max(253)).max(50).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.domains) {
      const { invalid } = normalizeClientDomains(data.domains);
      if (invalid.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: st("clients.invalidDomain", { domain: invalid[0] }),
          path: ["domains"],
        });
      }
    }
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
  });

export const clientsRouter = router({
  // Get all clients for the current user
  list: protectedProcedure
    .input(
      z
        .object({
          includeArchived: z.boolean().optional().default(false),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const includeArchived = input?.includeArchived ?? false;

      const scopeFilter = ctx.orgId
        ? eq(clients.organizationId, ctx.orgId)
        : eq(clients.userId, userId);
      const whereConditions = includeArchived
        ? [scopeFilter]
        : [scopeFilter, eq(clients.isArchived, false)];

      // Filter by per-member client access rules in SQL
      const accessibleIds = ctx.orgId
        ? await getAccessibleClientIds(ctx.db, ctx.session.user.id, ctx.orgId)
        : null;
      if (accessibleIds !== null) {
        whereConditions.push(inArray(clients.id, accessibleIds));
      }

      const allClients = await ctx.db.query.clients.findMany({
        where: and(...whereConditions),
        orderBy: [asc(sql`lower(${clients.name})`)],
        limit: 500,
      });

      // Get time entry counts per client for sorting by usage
      const timeScopeFilter = ctx.orgId
        ? eq(timeEntries.organizationId, ctx.orgId)
        : eq(timeEntries.userId, userId);
      const usageCounts = await ctx.db
        .select({
          clientId: timeEntries.clientId,
          count: sql<number>`count(*)::int`.as("count"),
        })
        .from(timeEntries)
        .where(timeScopeFilter)
        .groupBy(timeEntries.clientId);

      const countMap = new Map(
        usageCounts
          .filter((u) => u.clientId !== null)
          .map((u) => [u.clientId as string, u.count]),
      );

      return allClients
        .map((c) => ({
          ...c,
          timeEntryCount: countMap.get(c.id) ?? 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "da"));
    }),

  // Side-baseret liste til REST-API'et og MCP (#573). `list` har et fast loft
  // på 500 kunder, så GET /api/v1/clients og MCP's list_clients stoppede tavst
  // ved kunde nummer 500. Her pagineres, søges og sorteres i databasen, og
  // totalen tælles med de samme betingelser.
  listPage: moduleReadProcedure("clients")
    .input(
      z.object({
        includeArchived: z.boolean().default(false),
        // Fritekst på navn, e-mail, firma og CVR — samme felter som REST-
        // ruten tidligere søgte i, i hukommelsen.
        q: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(500).default(25),
        offset: z.number().int().min(0).default(0),
        sortBy: z
          .enum(["name", "createdAt", "company", "email"])
          .default("name"),
        sortOrder: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const conditions = [
        ctx.orgId
          ? eq(clients.organizationId, ctx.orgId)
          : eq(clients.userId, userId),
      ];
      if (!input.includeArchived) {
        conditions.push(eq(clients.isArchived, false));
      }
      const accessibleIds = ctx.orgId
        ? await getAccessibleClientIds(ctx.db, userId, ctx.orgId)
        : null;
      if (accessibleIds !== null) {
        if (accessibleIds.length === 0) return { clients: [], total: 0 };
        conditions.push(inArray(clients.id, accessibleIds));
      }
      if (input.q) {
        const pattern = containsPattern(input.q);
        const match = or(
          ilike(clients.name, pattern),
          ilike(clients.email, pattern),
          ilike(clients.company, pattern),
          ilike(clients.cvrNumber, pattern),
        );
        if (match) conditions.push(match);
      }
      const where = and(...conditions);

      const direction = input.sortOrder === "asc" ? asc : desc;
      const sortColumn =
        input.sortBy === "createdAt"
          ? clients.createdAt
          : input.sortBy === "company"
            ? sql`lower(${clients.company})`
            : input.sortBy === "email"
              ? sql`lower(${clients.email})`
              : sql`lower(${clients.name})`;

      const [totalRow] = await ctx.db
        .select({ value: count() })
        .from(clients)
        .where(where);

      const page = await ctx.db.query.clients.findMany({
        where,
        // id som sidste nøgle, så rækker med samme sorteringsværdi ikke
        // skifter side mellem to kald.
        orderBy: [direction(sortColumn), asc(clients.id)],
        limit: input.limit,
        offset: input.offset,
      });

      // timeEntryCount var med i svaret fra `list`; beregnes nu kun for siden.
      const ids = page.map((c) => c.id);
      const usageCounts = ids.length
        ? await ctx.db
            .select({
              clientId: timeEntries.clientId,
              count: sql<number>`count(*)::int`.as("count"),
            })
            .from(timeEntries)
            .where(
              and(
                ctx.orgId
                  ? eq(timeEntries.organizationId, ctx.orgId)
                  : eq(timeEntries.userId, userId),
                inArray(timeEntries.clientId, ids),
              ),
            )
            .groupBy(timeEntries.clientId)
        : [];
      const countMap = new Map(
        usageCounts.map((u) => [u.clientId as string, u.count]),
      );

      return {
        clients: page.map((c) => ({
          ...c,
          timeEntryCount: countMap.get(c.id) ?? 0,
        })),
        total: totalRow?.value ?? 0,
      };
    }),

  // Get all clients with stats (unbilled hours, overdue invoices, project count)
  listWithStats: moduleReadProcedure("clients")
    .input(
      z
        .object({
          includeArchived: z.boolean().optional().default(false),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const includeArchived = input?.includeArchived ?? false;

      const scopeFilter = ctx.orgId
        ? eq(clients.organizationId, ctx.orgId)
        : eq(clients.userId, userId);
      const whereConditions = includeArchived
        ? [scopeFilter]
        : [scopeFilter, eq(clients.isArchived, false)];

      // Filter by per-member client access rules in SQL
      const accessibleIds = ctx.orgId
        ? await getAccessibleClientIds(ctx.db, ctx.session.user.id, ctx.orgId)
        : null;
      if (accessibleIds !== null) {
        whereConditions.push(inArray(clients.id, accessibleIds));
      }

      const allClients = await ctx.db.query.clients.findMany({
        where: and(...whereConditions),
        orderBy: [asc(sql`lower(${clients.name})`)],
      });
      allClients.sort((a, b) => a.name.localeCompare(b.name, "da"));

      // Get all client IDs
      const clientIds = allClients.map((c) => c.id);
      if (clientIds.length === 0) {
        return [];
      }

      const timeScopeFilter = ctx.orgId
        ? eq(timeEntries.organizationId, ctx.orgId)
        : eq(timeEntries.userId, userId);

      // Get unbilled time entries per client — ÉN fælles definition, delt med
      // dashboard, påmindelsescron, rapporter og API (#626). Kundelisten
      // brugte før `isBillable = true` strengt, så gamle rækker med
      // `isBillable NULL` faldt ud, og klippekort-timer talte med.
      const unbilledEntries = await ctx.db
        .select({
          clientId: timeEntries.clientId,
          totalHours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
          totalAmount: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL) * CAST(COALESCE(${timeEntries.billableRate}, '0') AS DECIMAL)), 0)`,
        })
        .from(timeEntries)
        .where(
          and(
            timeScopeFilter,
            inArray(timeEntries.clientId, clientIds),
            isNull(timeEntries.invoiceId),
            unbilledTimeEntryFilter({
              userId,
              orgId: ctx.orgId,
              withoutScope: true,
            }),
          ),
        )
        .groupBy(timeEntries.clientId);

      // Get total hours per client (all time entries)
      const totalHoursEntries = await ctx.db
        .select({
          clientId: timeEntries.clientId,
          totalHours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
          lastActivity: max(timeEntries.date),
        })
        .from(timeEntries)
        .where(and(timeScopeFilter, inArray(timeEntries.clientId, clientIds)))
        .groupBy(timeEntries.clientId);

      // Get active prepaid packages (klippekort) per client
      const prepaidScopeFilter = ctx.orgId
        ? eq(prepaidPackages.organizationId, ctx.orgId)
        : eq(prepaidPackages.userId, userId);
      const activePrepaidCounts = await ctx.db
        .select({
          clientId: prepaidPackages.clientId,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(prepaidPackages)
        .where(
          and(
            prepaidScopeFilter,
            inArray(prepaidPackages.clientId, clientIds),
            eq(prepaidPackages.isActive, true),
            eq(prepaidPackages.isArchived, false),
          ),
        )
        .groupBy(prepaidPackages.clientId);

      // Get overdue invoices per client
      const invoiceScopeFilter = ctx.orgId
        ? eq(invoices.organizationId, ctx.orgId)
        : eq(invoices.userId, userId);
      const overdueInvoices = await ctx.db
        .select({
          clientId: invoices.clientId,
          count: sql<number>`COUNT(*)::int`,
          totalAmount: sql<string>`COALESCE(SUM(CAST(${invoices.amount} AS DECIMAL)), 0)`,
        })
        .from(invoices)
        .where(
          and(
            invoiceScopeFilter,
            inArray(invoices.clientId, clientIds),
            eq(invoices.status, "overdue"),
          ),
        )
        .groupBy(invoices.clientId);

      // Get project count per client
      const projectScopeFilter = ctx.orgId
        ? eq(projects.organizationId, ctx.orgId)
        : eq(projects.userId, userId);
      const projectCounts = await ctx.db
        .select({
          clientId: projects.clientId,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(projects)
        .where(and(projectScopeFilter, inArray(projects.clientId, clientIds)))
        .groupBy(projects.clientId);

      // Build stats map
      const unbilledMap = new Map(
        unbilledEntries.map((e) => [
          e.clientId,
          {
            hours: parseFloat(e.totalHours),
            amount: parseFloat(e.totalAmount),
          },
        ]),
      );
      const totalHoursMap = new Map(
        totalHoursEntries.map((e) => [
          e.clientId,
          {
            totalHours: parseFloat(e.totalHours),
            lastActivity: e.lastActivity ? e.lastActivity.toISOString() : null,
          },
        ]),
      );
      const prepaidMap = new Map(
        activePrepaidCounts.map((e) => [e.clientId, e.count]),
      );
      const overdueMap = new Map(
        overdueInvoices.map((e) => [
          e.clientId,
          { count: e.count, amount: parseFloat(e.totalAmount) },
        ]),
      );
      const projectMap = new Map(
        projectCounts.map((e) => [e.clientId, e.count]),
      );

      // Portal-status (#95): har kunden adgang, og har de brugt den?
      const portalAccesses = await ctx.db.query.clientPortalAccess.findMany({
        where: and(
          inArray(clientPortalAccess.clientId, clientIds),
          eq(clientPortalAccess.isActive, true),
        ),
        columns: { clientId: true, accessCount: true, lastAccessedAt: true },
      });
      const portalMap = new Map<
        string,
        { status: "active" | "invited"; lastAccessedAt: string | null }
      >();
      for (const access of portalAccesses) {
        const existing = portalMap.get(access.clientId);
        const isUsed = (access.accessCount ?? 0) > 0;
        if (!existing || (isUsed && existing.status === "invited")) {
          portalMap.set(access.clientId, {
            status: isUsed ? "active" : "invited",
            lastAccessedAt: access.lastAccessedAt
              ? access.lastAccessedAt.toISOString()
              : null,
          });
        }
      }

      // Combine clients with stats
      return allClients.map((client) => ({
        ...client,
        stats: {
          unbilledHours: unbilledMap.get(client.id)?.hours ?? 0,
          unbilledAmount: unbilledMap.get(client.id)?.amount ?? 0,
          overdueCount: overdueMap.get(client.id)?.count ?? 0,
          overdueAmount: overdueMap.get(client.id)?.amount ?? 0,
          projectCount: projectMap.get(client.id) ?? 0,
          totalHours: totalHoursMap.get(client.id)?.totalHours ?? 0,
          activePrepaidCount: prepaidMap.get(client.id) ?? 0,
          lastActivityDate: totalHoursMap.get(client.id)?.lastActivity ?? null,
          portalStatus: portalMap.get(client.id)?.status ?? null,
        },
      }));
    }),

  // Get a single client by ID
  getById: moduleReadProcedure("clients")
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const client = await ctx.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.id),
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
        ),
        with: {
          tags: {
            with: { tag: true },
          },
        },
      });

      if (!client) {
        throw Errors.clientNotFound();
      }

      // Verify client access for org members with restricted access
      if (ctx.orgId) {
        const accessibleIds = await getAccessibleClientIds(
          ctx.db,
          userId,
          ctx.orgId,
        );
        if (accessibleIds !== null && !accessibleIds.includes(client.id)) {
          throw Errors.clientNotFound();
        }
      }

      return {
        ...client,
        tags: (client.tags ?? []).map((ct) => ({
          id: ct.tag.id,
          name: ct.tag.name,
          color: ct.tag.color,
        })),
      };
    }),

  // Create a new client
  create: subscribedProcedure
    .input(clientInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Gratis-tier: max 3 aktive kunder.
      await assertCanAddActiveClient(ctx.db, {
        planTier: ctx.planTier,
        orgId: ctx.orgId,
        userId,
      });

      // Check if this is the user's first client (before creating)
      const existingClients = await ctx.db.query.clients.findMany({
        where: ctx.orgId
          ? eq(clients.organizationId, ctx.orgId)
          : eq(clients.userId, userId),
        limit: 1,
      });
      const isFirstClient = existingClients.length === 0;

      const [newClient] = await ctx.db
        .insert(clients)
        .values({
          userId,
          organizationId: ctx.orgId,
          name: input.name,
          email: input.email || null,
          phone: input.phone || null,
          company: input.company || null,
          address: input.address || null,
          city: input.city || null,
          postalCode: input.postalCode || null,
          country: input.country || "Danmark",
          cvrNumber: input.cvrNumber || null,
          notes: input.notes || null,
          defaultHourlyRate: input.defaultHourlyRate || null,
          paymentTermsDays: input.paymentTermsDays ?? null,
          color: input.color ?? null,
          roundingEnabled: input.roundingEnabled,
          roundingMinutes: input.roundingMinutes,
          roundingMethod: input.roundingMethod,
          hidePrepaidValue: input.hidePrepaidValue ?? null,
          defaultBillable: input.defaultBillable ?? true,
          approvalWorkflow: input.approvalWorkflow ?? null,
          domains: normalizeClientDomains(input.domains ?? []).domains,
          isActive: true,
          isArchived: false,
        })
        .returning();

      // Log activity
      await logActivity(
        ctx.db,
        userId,
        {
          entityType: "client",
          entityId: newClient.id,
          action: "create",
          entityName: newClient.name,
        },
        ctx.orgId,
      );

      // Send first client milestone email
      if (isFirstClient) {
        try {
          const user = await ctx.db.query.users.findFirst({
            where: eq(users.id, userId),
          });
          const prefs = await ctx.db.query.emailPreferences.findFirst({
            where: eq(emailPreferences.userId, userId),
          });

          // Only send if user has onboarding milestones enabled (default: true)
          if (user && prefs?.onboardingMilestones !== false) {
            await sendFirstClientEmail({
              to: user.email,
              userName: user.name || "der",
              clientName: newClient.name,
              userId,
            });
          }
        } catch (error) {
          // Don't fail the create operation if email fails
          console.error("Failed to send first client email:", error);
        }
      }

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType: "client.created",
        eventId: newClient.id,
        data: { client: newClient },
        clientId: newClient.id,
      });

      trackEvent({
        userId: ctx.session.user.id,
        orgId: ctx.orgId,
        event: "client.created",
      });

      return newClient;
    }),

  // Update a client
  update: subscribedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: clientInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify client belongs to user/org
      const existingClient = await ctx.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.id),
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
        ),
      });

      if (!existingClient) {
        throw Errors.clientNotFound();
      }

      // Check if hourly rate changed
      if (
        input.data.defaultHourlyRate &&
        input.data.defaultHourlyRate !== existingClient.defaultHourlyRate
      ) {
        // Log rate change to history
        await ctx.db.insert(rateHistory).values({
          userId,
          organizationId: ctx.orgId,
          clientId: input.id,
          projectId: null,
          oldRate: existingClient.defaultHourlyRate,
          newRate: input.data.defaultHourlyRate,
          rateType: "client",
          effectiveDate: new Date(),
        });
      }

      const [updatedClient] = await ctx.db
        .update(clients)
        .set({
          name: input.data.name,
          email: input.data.email || null,
          phone: input.data.phone || null,
          company: input.data.company || null,
          address: input.data.address || null,
          city: input.data.city || null,
          postalCode: input.data.postalCode || null,
          country: input.data.country || "Danmark",
          cvrNumber: input.data.cvrNumber || null,
          notes: input.data.notes || null,
          defaultHourlyRate: input.data.defaultHourlyRate || null,
          ...(input.data.autoReminderEnabled !== undefined
            ? { autoReminderEnabled: input.data.autoReminderEnabled }
            : {}),
          ...(input.data.monthlyStatusReportEnabled !== undefined
            ? {
                monthlyStatusReportEnabled:
                  input.data.monthlyStatusReportEnabled,
              }
            : {}),
          ...(input.data.monthlyStatusNote !== undefined
            ? { monthlyStatusNote: input.data.monthlyStatusNote }
            : {}),
          ...(input.data.paymentTermsDays !== undefined
            ? { paymentTermsDays: input.data.paymentTermsDays }
            : {}),
          color: input.data.color ?? undefined,
          roundingEnabled: input.data.roundingEnabled,
          roundingMinutes: input.data.roundingMinutes,
          roundingMethod: input.data.roundingMethod,
          ...(input.data.hidePrepaidValue !== undefined
            ? { hidePrepaidValue: input.data.hidePrepaidValue }
            : {}),
          ...(input.data.defaultBillable !== undefined
            ? { defaultBillable: input.data.defaultBillable }
            : {}),
          ...(input.data.approvalWorkflow !== undefined
            ? { approvalWorkflow: input.data.approvalWorkflow }
            : {}),
          ...(input.data.billyId !== undefined
            ? { billyId: input.data.billyId }
            : {}),
          ...(input.data.domains !== undefined
            ? { domains: normalizeClientDomains(input.data.domains).domains }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(clients.id, input.id),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
        )
        .returning();

      // Log activity with changes
      const changes = detectChanges(
        {
          name: existingClient.name,
          email: existingClient.email,
          phone: existingClient.phone,
          company: existingClient.company,
          address: existingClient.address,
          city: existingClient.city,
          postalCode: existingClient.postalCode,
          country: existingClient.country,
          cvrNumber: existingClient.cvrNumber,
          notes: existingClient.notes,
          defaultHourlyRate: existingClient.defaultHourlyRate,
          defaultBillable: existingClient.defaultBillable,
        },
        {
          name: input.data.name,
          email: input.data.email || null,
          phone: input.data.phone || null,
          company: input.data.company || null,
          address: input.data.address || null,
          city: input.data.city || null,
          postalCode: input.data.postalCode || null,
          country: input.data.country || "Danmark",
          cvrNumber: input.data.cvrNumber || null,
          notes: input.data.notes || null,
          defaultHourlyRate: input.data.defaultHourlyRate || null,
          defaultBillable:
            input.data.defaultBillable ?? existingClient.defaultBillable,
        },
        clientFieldLabels,
      );

      if (changes.length > 0) {
        await logActivity(
          ctx.db,
          userId,
          {
            entityType: "client",
            entityId: updatedClient.id,
            action: "update",
            entityName: updatedClient.name,
            changes,
          },
          ctx.orgId,
        );
      }

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType: "client.updated",
        eventId: updatedClient.id,
        data: { client: updatedClient, changes },
        clientId: updatedClient.id,
      });

      return updatedClient;
    }),

  // Archive a client (soft delete)
  archive: moduleWriteProcedure("clients")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify client belongs to user/org
      const ownershipFilter = ctx.orgId
        ? eq(clients.organizationId, ctx.orgId)
        : eq(clients.userId, userId);
      const existingClient = await ctx.db.query.clients.findFirst({
        where: and(eq(clients.id, input.id), ownershipFilter),
      });

      if (!existingClient) {
        throw Errors.clientNotFound();
      }

      await ctx.db
        .update(clients)
        .set({
          isArchived: true,
          isActive: false,
          updatedAt: new Date(),
        })
        .where(and(eq(clients.id, input.id), ownershipFilter));

      // Log activity
      await logActivity(
        ctx.db,
        userId,
        {
          entityType: "client",
          entityId: input.id,
          action: "archive",
          entityName: existingClient.name,
        },
        ctx.orgId,
      );

      if (ctx.orgId) {
        logOrgAudit(ctx.db, ctx.orgId, userId, "client_archived", {
          metadata: { clientId: input.id, clientName: existingClient.name },
        });
      }

      emitWebhookEvent({
        userId,
        orgId: ctx.orgId,
        eventType: "client.archived",
        eventId: existingClient.id,
        data: {
          client: { ...existingClient, isArchived: true, isActive: false },
        },
        clientId: existingClient.id,
      });

      return { success: true };
    }),

  // Bulk archive clients (soft delete)
  bulkArchive: moduleWriteProcedure("clients")
    .input(z.object({ ids: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const ownershipFilter = ctx.orgId
        ? eq(clients.organizationId, ctx.orgId)
        : eq(clients.userId, userId);
      const existing = await ctx.db.query.clients.findMany({
        where: and(inArray(clients.id, input.ids), ownershipFilter),
        columns: { id: true, name: true },
      });

      if (existing.length !== input.ids.length) {
        throw Errors.clientNotFound();
      }

      await ctx.db
        .update(clients)
        .set({ isArchived: true, isActive: false, updatedAt: new Date() })
        .where(and(inArray(clients.id, input.ids), ownershipFilter));

      if (ctx.orgId) {
        logOrgAudit(ctx.db, ctx.orgId, ctx.session.user.id, "client_archived", {
          metadata: { clientIds: input.ids },
        });
      }

      for (const c of existing) {
        await logActivity(
          ctx.db,
          userId,
          {
            entityType: "client",
            entityId: c.id,
            action: "archive",
            entityName: c.name,
          },
          ctx.orgId,
        );
      }

      return { success: true, count: existing.length };
    }),

  // Hard delete clients (destructive — only allowed when no invoices exist).
  // Used for fixing mistaken imports / wrong data entry.
  bulkDelete: moduleWriteProcedure("clients")
    .input(z.object({ ids: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const ownershipFilter = ctx.orgId
        ? eq(clients.organizationId, ctx.orgId)
        : eq(clients.userId, userId);
      const existing = await ctx.db.query.clients.findMany({
        where: and(inArray(clients.id, input.ids), ownershipFilter),
        columns: { id: true, name: true },
      });

      if (existing.length !== input.ids.length) {
        throw Errors.clientNotFound();
      }

      // Safety gate: refuse if any client has invoices (accounting records).
      const invoiceScopeFilter = ctx.orgId
        ? eq(invoices.organizationId, ctx.orgId)
        : eq(invoices.userId, userId);
      const invoiceCheck = await ctx.db
        .select({ clientId: invoices.clientId })
        .from(invoices)
        .where(and(inArray(invoices.clientId, input.ids), invoiceScopeFilter))
        .limit(1);

      if (invoiceCheck.length > 0) {
        throw new Error(await tr("serverErrors", "clients.hasInvoices"));
      }

      // Cascade-delete in the order dictated by the FK graph. Tables with
      // ON DELETE CASCADE / SET NULL clean themselves up when the parent
      // (projects / clients) is removed, so we only need to manually
      // handle the restricted ones: time_entries, rate_history,
      // recurring_time_templates, prepaid_packages, and projects.
      const teScopeFilter = ctx.orgId
        ? eq(timeEntries.organizationId, ctx.orgId)
        : eq(timeEntries.userId, userId);
      const rhScopeFilter = ctx.orgId
        ? eq(rateHistory.organizationId, ctx.orgId)
        : eq(rateHistory.userId, userId);
      const ppScopeFilter = ctx.orgId
        ? eq(prepaidPackages.organizationId, ctx.orgId)
        : eq(prepaidPackages.userId, userId);
      const prScopeFilter = ctx.orgId
        ? eq(projects.organizationId, ctx.orgId)
        : eq(projects.userId, userId);

      // Rækkerne der bliver slettet, skal have en tombstone, så en
      // skrivebordsenhed rydder dem lokalt (se desktop-sync-tombstones).
      // RETURNING giver præcis de rækker DELETE ramte — en forud hentet liste
      // kunne afvige, hvis en sletning var delvist betinget.
      const deleted: Record<string, TombstoneRow[]> = {
        time_entry: [],
        project: [],
        klippekort: [],
        client: [],
      };

      await ctx.db.transaction(async (tx) => {
        // Resolve the clients' projects up front. Child rows (time entries,
        // rate history, recurring templates) may link to a project WITHOUT a
        // direct clientId — those must be deleted by projectId too, or the
        // later projects delete hits a NO ACTION FK and the whole tx rolls back.
        const clientProjects = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(inArray(projects.clientId, input.ids), prScopeFilter));
        const projectIds = clientProjects.map((p) => p.id);
        const hasProjects = projectIds.length > 0;

        const clientTimeScope = and(
          hasProjects
            ? or(
                inArray(timeEntries.clientId, input.ids),
                inArray(timeEntries.projectId, projectIds),
              )
            : inArray(timeEntries.clientId, input.ids),
          teScopeFilter,
        );

        // Fakturerede tidsposter er låst (#702) — også manuelt markerede,
        // som fakturatjekket ovenfor ikke fanger
        const [billedEntry] = await tx
          .select({ id: timeEntries.id })
          .from(timeEntries)
          .where(
            and(
              clientTimeScope,
              or(
                eq(timeEntries.isBilled, true),
                isNotNull(timeEntries.invoiceId),
              ),
            ),
          )
          .limit(1);
        if (billedEntry) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr("serverErrors", "clients.hasBilledEntries"),
          });
        }

        // prepaid_usage og generated_time_entries peger på tidsposterne uden
        // ON DELETE (#1112) — børnene først, ellers vælter hele kaskaden.
        const clientEntryIds = tx
          .select({ id: timeEntries.id })
          .from(timeEntries)
          .where(clientTimeScope);
        await tx
          .delete(prepaidUsage)
          .where(inArray(prepaidUsage.timeEntryId, clientEntryIds));
        await tx
          .delete(generatedTimeEntries)
          .where(inArray(generatedTimeEntries.timeEntryId, clientEntryIds));

        deleted.time_entry = await tx
          .delete(timeEntries)
          .where(clientTimeScope)
          .returning({
            id: timeEntries.id,
            userId: timeEntries.userId,
            organizationId: timeEntries.organizationId,
          });

        await tx
          .delete(rateHistory)
          .where(
            and(
              hasProjects
                ? or(
                    inArray(rateHistory.clientId, input.ids),
                    inArray(rateHistory.projectId, projectIds),
                  )
                : inArray(rateHistory.clientId, input.ids),
              rhScopeFilter,
            ),
          );

        const rtScopeFilter = ctx.orgId
          ? eq(recurringTimeTemplates.organizationId, ctx.orgId)
          : eq(recurringTimeTemplates.userId, userId);
        const templateScope = and(
          hasProjects
            ? or(
                inArray(recurringTimeTemplates.clientId, input.ids),
                inArray(recurringTimeTemplates.projectId, projectIds),
              )
            : inArray(recurringTimeTemplates.clientId, input.ids),
          rtScopeFilter,
        );
        await tx
          .delete(generatedTimeEntries)
          .where(
            inArray(
              generatedTimeEntries.recurringTemplateId,
              tx
                .select({ id: recurringTimeTemplates.id })
                .from(recurringTimeTemplates)
                .where(templateScope),
            ),
          );
        await tx.delete(recurringTimeTemplates).where(templateScope);

        // Usage-rækker uden tidspost (manuelle træk) peger stadig på kortet
        await tx.delete(prepaidUsage).where(
          inArray(
            prepaidUsage.prepaidPackageId,
            tx
              .select({ id: prepaidPackages.id })
              .from(prepaidPackages)
              .where(
                and(
                  inArray(prepaidPackages.clientId, input.ids),
                  ppScopeFilter,
                ),
              ),
          ),
        );

        deleted.klippekort = await tx
          .delete(prepaidPackages)
          .where(
            and(inArray(prepaidPackages.clientId, input.ids), ppScopeFilter),
          )
          .returning({
            id: prepaidPackages.id,
            userId: prepaidPackages.userId,
            organizationId: prepaidPackages.organizationId,
          });

        deleted.project = await tx
          .delete(projects)
          .where(and(inArray(projects.clientId, input.ids), prScopeFilter))
          .returning({
            id: projects.id,
            userId: projects.userId,
            organizationId: projects.organizationId,
          });

        deleted.client = await tx
          .delete(clients)
          .where(and(inArray(clients.id, input.ids), ownershipFilter))
          .returning({
            id: clients.id,
            userId: clients.userId,
            organizationId: clients.organizationId,
          });
      });

      // Uden for transaktionen: en tombstone-insert der fejler (migrationen 0128
      // er endnu ikke kørt) må ikke kunne rulle sletningen tilbage, mens
      // mutationen svarer success — målt mod Postgres 17, se
      // sync-tombstones.integration.test.ts. Nøglen skrives på *rækkens* ejer,
      // så det er ejeren af posten der rydder sin enhed.
      for (const [entityType, rows] of Object.entries(deleted)) {
        await recordDeletionTombstones(ctx.db, { entityType, rows });
      }

      for (const c of existing) {
        await logActivity(
          ctx.db,
          userId,
          {
            entityType: "client",
            entityId: c.id,
            action: "delete",
            entityName: c.name,
          },
          ctx.orgId,
        );
      }

      return { success: true, count: existing.length };
    }),

  // Unarchive a client (restore)
  unarchive: moduleWriteProcedure("clients")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify client belongs to user/org
      const ownershipFilter = ctx.orgId
        ? eq(clients.organizationId, ctx.orgId)
        : eq(clients.userId, userId);
      const existingClient = await ctx.db.query.clients.findFirst({
        where: and(eq(clients.id, input.id), ownershipFilter),
      });

      if (!existingClient) {
        throw Errors.clientNotFound();
      }

      // Gratis-tier: en genoprettet kunde tæller som aktiv igen.
      if (existingClient.isArchived) {
        await assertCanAddActiveClient(ctx.db, {
          planTier: ctx.planTier,
          orgId: ctx.orgId,
          userId,
        });
      }

      await ctx.db
        .update(clients)
        .set({
          isArchived: false,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(and(eq(clients.id, input.id), ownershipFilter));

      // Log activity
      await logActivity(
        ctx.db,
        userId,
        {
          entityType: "client",
          entityId: input.id,
          action: "restore",
          entityName: existingClient.name,
        },
        ctx.orgId,
      );

      return { success: true };
    }),

  // Get client count
  count: moduleReadProcedure("clients").query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [result] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(clients)
      .where(
        and(
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
          eq(clients.isArchived, false),
          eq(clients.isActive, true),
        ),
      );

    return result?.count ?? 0;
  }),

  // Detect at-risk (silent) clients: had past activity but no time entry in last N days
  getAtRiskClients: moduleReadProcedure("clients")
    .input(z.object({ daysSilent: z.number().min(1).max(365).default(60) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - input.daysSilent);

      // Find clients that have AT LEAST ONE time entry ever (not brand-new)
      // but their MOST RECENT time entry is older than cutoffDate
      const timeScopeFilter = ctx.orgId
        ? eq(timeEntries.organizationId, ctx.orgId)
        : eq(timeEntries.userId, userId);
      const lastActivityRows = await ctx.db
        .select({
          clientId: timeEntries.clientId,
          lastDate: max(timeEntries.date),
        })
        .from(timeEntries)
        .where(and(timeScopeFilter, isNotNull(timeEntries.clientId)))
        .groupBy(timeEntries.clientId);

      // Filter to clients that are silent (last entry older than cutoffDate)
      const silentRows = lastActivityRows.filter(
        (r) =>
          r.clientId !== null && r.lastDate !== null && r.lastDate < cutoffDate,
      );

      if (silentRows.length === 0) return [];

      const silentClientIds = silentRows.map((r) => r.clientId as string);

      // Fetch client info, excluding archived clients
      const clientScopeFilter = ctx.orgId
        ? eq(clients.organizationId, ctx.orgId)
        : eq(clients.userId, userId);
      const clientRows = await ctx.db
        .select({
          id: clients.id,
          name: clients.name,
          email: clients.email,
          isArchived: clients.isArchived,
        })
        .from(clients)
        .where(
          and(
            clientScopeFilter,
            inArray(clients.id, silentClientIds),
            eq(clients.isArchived, false),
          ),
        );

      if (clientRows.length === 0) return [];

      const activeClientIds = clientRows.map((c) => c.id);

      // Build lastActivityDate map
      const lastActivityMap = new Map(
        silentRows
          .filter((r) => r.clientId !== null)
          .map((r) => [r.clientId as string, r.lastDate as Date]),
      );

      // For each at-risk client: revenue in the 6 months BEFORE their last activity date
      const invoiceScopeFilter = ctx.orgId
        ? eq(invoices.organizationId, ctx.orgId)
        : eq(invoices.userId, userId);

      // Per-client 6-month revenue window calculation
      // We already fetched all invoices per client above; now refine with date range in JS
      // For efficiency we re-query with per-client cutoff using a simpler approach:
      // get all invoices for these clients and filter per-client by date in JS
      const sixMonthInvoices = await ctx.db
        .select({
          clientId: invoices.clientId,
          issueDate: invoices.issueDate,
          amount: invoices.amount,
        })
        .from(invoices)
        .where(
          and(invoiceScopeFilter, inArray(invoices.clientId, activeClientIds)),
        );

      const revenueWindow = new Map<string, number>();
      for (const clientId of activeClientIds) {
        const lastActivity = lastActivityMap.get(clientId);
        if (!lastActivity) continue;
        const windowStart = new Date(lastActivity);
        windowStart.setMonth(windowStart.getMonth() - 6);
        const total = sixMonthInvoices
          .filter(
            (inv) =>
              inv.clientId === clientId &&
              inv.issueDate >= windowStart &&
              inv.issueDate <= lastActivity,
          )
          .reduce((sum, inv) => sum + parseFloat(inv.amount), 0);
        revenueWindow.set(clientId, total);
      }

      // Sum of remaining prepaid hours per at-risk client (active packages only)
      const prepaidScopeFilter = ctx.orgId
        ? eq(prepaidPackages.organizationId, ctx.orgId)
        : eq(prepaidPackages.userId, userId);
      const prepaidRows = await ctx.db
        .select({
          clientId: prepaidPackages.clientId,
          totalRemaining: sql<string>`COALESCE(SUM(CAST(${prepaidPackages.remainingHours} AS DECIMAL)), 0)`,
        })
        .from(prepaidPackages)
        .where(
          and(
            prepaidScopeFilter,
            inArray(prepaidPackages.clientId, activeClientIds),
            eq(prepaidPackages.isActive, true),
            eq(prepaidPackages.isArchived, false),
            gt(sql`CAST(${prepaidPackages.remainingHours} AS DECIMAL)`, 0),
          ),
        )
        .groupBy(prepaidPackages.clientId);

      const prepaidMap = new Map(
        prepaidRows.map((r) => [r.clientId, parseFloat(r.totalRemaining)]),
      );

      const now = new Date();
      const result = clientRows.map((client) => {
        const lastActivityDate = lastActivityMap.get(client.id) ?? null;
        const daysSinceLastActivity = lastActivityDate
          ? Math.floor(
              (now.getTime() - lastActivityDate.getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : 0;
        return {
          clientId: client.id,
          clientName: client.name,
          clientEmail: client.email,
          lastActivityDate,
          daysSinceLastActivity,
          recentRevenue: revenueWindow.get(client.id) ?? 0,
          activePrepaidHours: prepaidMap.get(client.id) ?? 0,
        };
      });

      // Sort by recent revenue desc (most valuable silent clients first)
      result.sort((a, b) => b.recentRevenue - a.recentRevenue);

      return result;
    }),

  // Get top clients by hours or revenue
  getTopClients: moduleReadProcedure("clients")
    .input(
      z.object({
        limit: z.number().min(1).max(10).default(5),
        sortBy: z.enum(["hours", "revenue"]).default("hours"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // PERF: Aggregate in SQL. Previously loaded every time entry + nested
      // client + project + project.client relation into memory just to
      // compute top N clients by hours/revenue.
      // COALESCE the direct clientId with the project's clientId so that
      // entries attached only via project still aggregate to the client.
      const timeScopeFilter = ctx.orgId
        ? eq(timeEntries.organizationId, ctx.orgId)
        : eq(timeEntries.userId, userId);
      const rows = await ctx.db
        .select({
          clientId: sql<string>`COALESCE(${timeEntries.clientId}, ${projects.clientId})`,
          totalHours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
          totalRevenue: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL) * CAST(COALESCE(${timeEntries.billableRate}, '0') AS DECIMAL)), 0)`,
        })
        .from(timeEntries)
        .leftJoin(projects, eq(timeEntries.projectId, projects.id))
        .where(timeScopeFilter)
        .groupBy(sql`COALESCE(${timeEntries.clientId}, ${projects.clientId})`);

      const filtered = rows.filter((r) => r.clientId !== null);
      if (filtered.length === 0) return [];

      const clientIds = filtered.map((r) => r.clientId as string);
      const clientScopeFilter = ctx.orgId
        ? eq(clients.organizationId, ctx.orgId)
        : eq(clients.userId, userId);
      const clientRows = await ctx.db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(and(clientScopeFilter, inArray(clients.id, clientIds)));
      const nameById = new Map(clientRows.map((c) => [c.id, c.name]));

      const stats = filtered
        .map((r) => ({
          id: r.clientId as string,
          name: nameById.get(r.clientId as string) ?? "",
          totalHours: parseFloat(r.totalHours as unknown as string),
          totalRevenue: parseFloat(r.totalRevenue as unknown as string),
        }))
        .filter((s) => s.name !== "");

      stats.sort((a, b) =>
        input.sortBy === "hours"
          ? b.totalHours - a.totalHours
          : b.totalRevenue - a.totalRevenue,
      );

      return stats.slice(0, input.limit);
    }),
});
