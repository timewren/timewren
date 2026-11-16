import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  type AnyColumn,
  and,
  count,
  eq,
  gte,
  inArray,
  isNull,
  notInArray,
} from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { isSharedProdDb } from "@/lib/config";
import {
  clients,
  dataExportRequests,
  invoiceLines,
  invoices,
  prepaidPackages,
  prepaidUsage,
  projects,
  rateHistory,
  tasks,
  timeEntries,
} from "@/lib/db/schema";
import {
  ORG_EXPORT_DAILY_LIMIT,
  ORG_EXPORT_FORMAT,
  ORG_EXPORT_REQUEST_TYPE,
  ORG_EXPORT_TTL_MS,
  USER_EXPORT_REQUEST_TYPE,
  ZIP_EXPORT_TYPES,
} from "@/lib/export/org-export/access";
import { hashToken, revealToken } from "@/lib/security/token-hash";
import { dateUpperBound } from "@/lib/time/date-bounds";
import { encryptSecret } from "@/lib/utils/encryption";
import { getOrgRole } from "../middleware/org-role";
import {
  moduleWriteProcedure,
  orgAdminProcedure,
  protectedProcedure,
  router,
  subscribedProcedure,
} from "../trpc";

const dataTypeEnum = z.enum([
  "clients",
  "projects",
  "timeEntries",
  "tasks",
  "invoices",
  "invoiceLines",
  "prepaidPackages",
  "prepaidUsage",
  "rateHistory",
]);

export const dataExportRouter = router({
  /**
   * Export data for one type — client downloads directly
   */
  exportData: orgAdminProcedure
    .input(
      z.object({
        dataType: dataTypeEnum,
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const dateFrom = input.dateFrom ? new Date(input.dateFrom) : undefined;
      // Slutdatoen er inklusiv: en ren dato tager hele dagen med (eksklusiv
      // grænse på næste dags start), ellers tabes alt efter midnat.
      const dateToBound = (column: AnyColumn) =>
        input.dateTo ? dateUpperBound(column, input.dateTo) : undefined;

      const clientScope = ctx.orgId
        ? eq(clients.organizationId, ctx.orgId)
        : eq(clients.userId, userId);
      const projectScope = ctx.orgId
        ? eq(projects.organizationId, ctx.orgId)
        : eq(projects.userId, userId);
      const timeEntryScope = ctx.orgId
        ? eq(timeEntries.organizationId, ctx.orgId)
        : eq(timeEntries.userId, userId);
      const taskScope = ctx.orgId
        ? eq(tasks.organizationId, ctx.orgId)
        : eq(tasks.userId, userId);
      const invoiceScope = ctx.orgId
        ? eq(invoices.organizationId, ctx.orgId)
        : eq(invoices.userId, userId);
      const prepaidScope = ctx.orgId
        ? eq(prepaidPackages.organizationId, ctx.orgId)
        : eq(prepaidPackages.userId, userId);
      const rateScope = ctx.orgId
        ? eq(rateHistory.organizationId, ctx.orgId)
        : eq(rateHistory.userId, userId);

      switch (input.dataType) {
        case "clients": {
          const data = await ctx.db.query.clients.findMany({
            where: and(
              clientScope,
              dateFrom ? gte(clients.createdAt, dateFrom) : undefined,
              dateToBound(clients.createdAt),
            ),
          });
          return data.map((c) => ({
            name: c.name,
            email: c.email,
            phone: c.phone,
            company: c.company,
            address: c.address,
            city: c.city,
            postalCode: c.postalCode,
            country: c.country,
            cvrNumber: c.cvrNumber,
            notes: c.notes,
            defaultHourlyRate: c.defaultHourlyRate,
            isActive: c.isActive,
            isArchived: c.isArchived,
            createdAt: c.createdAt,
          }));
        }

        case "projects": {
          const data = await ctx.db.query.projects.findMany({
            where: and(
              projectScope,
              dateFrom ? gte(projects.createdAt, dateFrom) : undefined,
              dateToBound(projects.createdAt),
            ),
            with: { client: { columns: { name: true } } },
          });
          return data.map((p) => ({
            name: p.name,
            description: p.description,
            clientName: p.client?.name || "",
            hourlyRate: p.hourlyRate,
            fixedPrice: p.fixedPrice,
            status: p.status,
            startDate: p.startDate,
            endDate: p.endDate,
            createdAt: p.createdAt,
          }));
        }

        case "timeEntries": {
          const data = await ctx.db.query.timeEntries.findMany({
            where: and(
              timeEntryScope,
              dateFrom ? gte(timeEntries.date, dateFrom) : undefined,
              dateToBound(timeEntries.date),
            ),
            with: {
              project: { columns: { name: true } },
              client: { columns: { name: true } },
            },
          });
          return data.map((t) => ({
            date: t.date,
            description: t.description,
            notes: t.notes,
            hours: t.hours,
            startTime: t.startTime,
            endTime: t.endTime,
            billableRate: t.billableRate,
            isBillable: t.isBillable,
            isBilled: t.isBilled,
            isPrepaid: t.isPrepaid,
            source: t.source,
            projectName: t.project?.name || "",
            clientName: t.client?.name || "",
            createdAt: t.createdAt,
          }));
        }

        case "tasks": {
          const data = await ctx.db.query.tasks.findMany({
            where: and(
              taskScope,
              dateFrom ? gte(tasks.createdAt, dateFrom) : undefined,
              dateToBound(tasks.createdAt),
            ),
            with: {
              project: { columns: { name: true } },
              client: { columns: { name: true } },
            },
          });
          return data.map((t) => ({
            title: t.title,
            description: t.description,
            projectName: t.project?.name || "",
            clientName: t.client?.name || "",
            status: t.status,
            priority: t.priority,
            deadline: t.deadline,
            completedAt: t.completedAt,
            estimatedMinutes: t.estimatedMinutes,
            actualMinutes: t.actualMinutes,
            sourceType: t.sourceType,
            createdAt: t.createdAt,
          }));
        }

        case "invoices": {
          const data = await ctx.db.query.invoices.findMany({
            where: and(
              invoiceScope,
              dateFrom ? gte(invoices.issueDate, dateFrom) : undefined,
              dateToBound(invoices.issueDate),
            ),
            with: { client: { columns: { name: true } } },
          });
          return data.map((i) => ({
            invoiceNumber: i.invoiceNumber,
            clientName: i.client?.name || "",
            amount: i.amount,
            status: i.status,
            issueDate: i.issueDate,
            dueDate: i.dueDate,
            paidDate: i.paidDate,
            notes: i.notes,
            createdAt: i.createdAt,
          }));
        }

        case "invoiceLines": {
          // Get user's invoice IDs first, then filter lines at DB level
          const userInvoiceIds = await ctx.db
            .select({ id: invoices.id })
            .from(invoices)
            .where(invoiceScope);
          const invoiceIdList = userInvoiceIds.map((i) => i.id);

          if (invoiceIdList.length === 0) return [];

          const data = await ctx.db.query.invoiceLines.findMany({
            where: and(
              inArray(invoiceLines.invoiceId, invoiceIdList),
              dateFrom ? gte(invoiceLines.createdAt, dateFrom) : undefined,
              dateToBound(invoiceLines.createdAt),
            ),
            with: {
              invoice: {
                columns: { invoiceNumber: true },
              },
            },
          });
          return data.map((l) => ({
            invoiceNumber: l.invoice?.invoiceNumber || "",
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            amount: l.amount,
            sortOrder: l.sortOrder,
          }));
        }

        case "prepaidPackages": {
          const data = await ctx.db.query.prepaidPackages.findMany({
            where: and(
              prepaidScope,
              dateFrom ? gte(prepaidPackages.createdAt, dateFrom) : undefined,
              dateToBound(prepaidPackages.createdAt),
            ),
            with: { client: { columns: { name: true } } },
          });
          return data.map((p) => ({
            name: p.name,
            clientName: p.client?.name || "",
            totalHours: p.totalHours,
            usedHours: p.usedHours,
            remainingHours: p.remainingHours,
            hourlyRate: p.hourlyRate,
            totalValue: p.totalValue,
            purchaseDate: p.purchaseDate,
            expiryDate: p.expiryDate,
            isActive: p.isActive,
          }));
        }

        case "prepaidUsage": {
          // Get user's prepaid package IDs first, then filter usage at DB level
          const userPackageIds = await ctx.db
            .select({ id: prepaidPackages.id })
            .from(prepaidPackages)
            .where(prepaidScope);
          const packageIdList = userPackageIds.map((p) => p.id);

          if (packageIdList.length === 0) return [];

          const data = await ctx.db.query.prepaidUsage.findMany({
            where: and(
              inArray(prepaidUsage.prepaidPackageId, packageIdList),
              dateFrom ? gte(prepaidUsage.createdAt, dateFrom) : undefined,
              dateToBound(prepaidUsage.createdAt),
            ),
            with: {
              prepaidPackage: {
                columns: { name: true },
              },
            },
          });
          return data.map((u) => ({
            packageName: u.prepaidPackage?.name || "",
            hoursUsed: u.hoursUsed,
            valueUsed: u.valueUsed,
            description: u.description,
            createdAt: u.createdAt,
          }));
        }

        case "rateHistory": {
          const data = await ctx.db.query.rateHistory.findMany({
            where: and(
              rateScope,
              dateFrom ? gte(rateHistory.createdAt, dateFrom) : undefined,
              dateToBound(rateHistory.createdAt),
            ),
            with: {
              client: { columns: { name: true } },
              project: { columns: { name: true } },
            },
          });
          return data.map((r) => ({
            clientName: r.client?.name || "",
            projectName: r.project?.name || "",
            oldRate: r.oldRate,
            newRate: r.newRate,
            rateType: r.rateType,
            effectiveDate: r.effectiveDate,
            reason: r.reason,
          }));
        }
      }
    }),

  /**
   * Request a full GDPR data export (background job)
   */
  requestFullExport: orgAdminProcedure
    .input(
      z.object({
        format: z.enum(["json", "csv"]).default("json"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Rate limit: max 1 pending/processing per user
      const pendingCount = await ctx.db
        .select({ count: count() })
        .from(dataExportRequests)
        .where(
          and(
            eq(dataExportRequests.userId, userId),
            notInArray(dataExportRequests.requestType, [...ZIP_EXPORT_TYPES]),
            eq(dataExportRequests.status, "pending"),
          ),
        );

      if (pendingCount[0] && pendingCount[0].count > 0) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: await tr("serverErrors", "dataExport.pending"),
        });
      }

      // Rate limit: max 3 per 24 hours
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentCount = await ctx.db
        .select({ count: count() })
        .from(dataExportRequests)
        .where(
          and(
            eq(dataExportRequests.userId, userId),
            notInArray(dataExportRequests.requestType, [...ZIP_EXPORT_TYPES]),
            gte(dataExportRequests.createdAt, oneDayAgo),
          ),
        );

      if (recentCount[0] && recentCount[0].count >= 3) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: await tr("serverErrors", "dataExport.limit3"),
        });
      }

      const downloadToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const [request] = await ctx.db
        .insert(dataExportRequests)
        .values({
          userId,
          requestType: "gdpr_full",
          format: input.format,
          // Hash til opslag + enc:v1, så cron'en kan maile linket og
          // GDPR-siden vise det igen (#713). Klartekst gemmes ikke.
          downloadTokenHash: hashToken(downloadToken),
          downloadTokenEncrypted: encryptSecret(downloadToken),
          expiresAt,
        })
        .returning();

      return {
        id: request.id,
        status: request.status,
        expiresAt: request.expiresAt,
      };
    }),

  /**
   * Om de fulde ZIP-eksporter (org og bruger) er slået til. Slået fra når
   * SHARED_PROD_DB=1: en ældre prod-version deler database og ville
   * mishandle disse request-typer. UI'et skal skjule bestil-knapperne ud fra
   * dette, ikke kun stole på at mutationerne afviser.
   */
  getExportFlags: protectedProcedure.query(() => ({
    fullExportEnabled: !isSharedProdDb(),
  })),

  /**
   * Bestil en fuld eksport af hele organisationens data (ZIP med JSON, CSV
   * pr. tabel og filer). Kun ejer og administrator; solo-brugere uden
   * organisation får deres egne data. Ikke bag abonnement: eksporten skal
   * også virke på Gratis og efter opsigelse (DPA 10.2, /tillid).
   */
  requestOrgExport: orgAdminProcedure.mutation(async ({ ctx }) => {
    if (isSharedProdDb()) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: await tr("serverErrors", "dataExport.fullNotEnabled"),
      });
    }

    const userId = ctx.session.user.id;
    const orgId = ctx.orgId ?? null;
    const scope = and(
      eq(dataExportRequests.requestType, ORG_EXPORT_REQUEST_TYPE),
      orgId
        ? eq(dataExportRequests.organizationId, orgId)
        : and(
            eq(dataExportRequests.userId, userId),
            isNull(dataExportRequests.organizationId),
          ),
    );

    const [active] = await ctx.db
      .select({ count: count() })
      .from(dataExportRequests)
      .where(
        and(
          scope,
          inArray(dataExportRequests.status, ["pending", "processing"]),
        ),
      );
    if (active && active.count > 0) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: await tr("serverErrors", "dataExport.orgInProgress"),
      });
    }

    const [recent] = await ctx.db
      .select({ count: count() })
      .from(dataExportRequests)
      .where(
        and(
          scope,
          gte(
            dataExportRequests.createdAt,
            new Date(Date.now() - 24 * 60 * 60 * 1000),
          ),
        ),
      );
    if (recent && recent.count >= ORG_EXPORT_DAILY_LIMIT) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: await tr("serverErrors", "dataExport.orgDailyLimit", {
          limit: ORG_EXPORT_DAILY_LIMIT,
        }),
      });
    }

    const downloadToken = crypto.randomUUID();
    const [request] = await ctx.db
      .insert(dataExportRequests)
      .values({
        userId,
        organizationId: orgId,
        requestType: ORG_EXPORT_REQUEST_TYPE,
        format: ORG_EXPORT_FORMAT,
        downloadTokenHash: hashToken(downloadToken),
        downloadTokenEncrypted: encryptSecret(downloadToken),
        expiresAt: new Date(Date.now() + ORG_EXPORT_TTL_MS),
      })
      .returning();

    return {
      id: request.id,
      status: request.status,
      expiresAt: request.expiresAt,
    };
  }),

  /**
   * Brugerens egne organisations-eksporter i den aktive organisation.
   */
  listOrgExports: orgAdminProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const orgId = ctx.orgId ?? null;
    const requests = await ctx.db.query.dataExportRequests.findMany({
      where: and(
        eq(dataExportRequests.userId, userId),
        eq(dataExportRequests.requestType, ORG_EXPORT_REQUEST_TYPE),
        orgId
          ? eq(dataExportRequests.organizationId, orgId)
          : isNull(dataExportRequests.organizationId),
      ),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      limit: 10,
    });
    const now = Date.now();
    return requests.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      processedAt: r.processedAt,
      expiresAt: r.expiresAt,
      fileSizeBytes: r.fileSizeBytes,
      downloadToken:
        (r.status === "ready" || r.status === "downloaded") &&
        r.expiresAt.getTime() > now
          ? revealToken(r.downloadTokenEncrypted)
          : null,
    }));
  }),

  /**
   * Bestil en eksport af brugerens EGNE data (GDPR art. 15 og 20): ZIP med
   * de rækker, der hører til brugeren selv i den aktive organisation, og
   * brugerens profil. Åben for alle roller og uden abonnement
   * (protectedProcedure), så også medarbejdere og låste Gratis-medlemmer kan
   * hente det, der er gemt om dem. Organisationen kommer altid fra
   * sessionen, aldrig fra klienten. Hvad der er med, står i
   * src/lib/export/org-export/user-registry.ts.
   */
  requestUserExport: protectedProcedure.mutation(async ({ ctx }) => {
    if (isSharedProdDb()) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: await tr("serverErrors", "dataExport.fullNotEnabled"),
      });
    }

    const userId = ctx.session.user.id;
    const orgId = ctx.orgId ?? null;

    if (orgId) {
      const role = await getOrgRole(ctx.db, userId, orgId);
      if (!role) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "dataExport.notOrgMemberDot"),
        });
      }
    }

    // Bruger-eksporten tæller pr. bruger, ikke pr. organisation.
    const scope = and(
      eq(dataExportRequests.requestType, USER_EXPORT_REQUEST_TYPE),
      eq(dataExportRequests.userId, userId),
    );

    const [active] = await ctx.db
      .select({ count: count() })
      .from(dataExportRequests)
      .where(
        and(
          scope,
          inArray(dataExportRequests.status, ["pending", "processing"]),
        ),
      );
    if (active && active.count > 0) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: await tr("serverErrors", "dataExport.inProgress"),
      });
    }

    const [recent] = await ctx.db
      .select({ count: count() })
      .from(dataExportRequests)
      .where(
        and(
          scope,
          gte(
            dataExportRequests.createdAt,
            new Date(Date.now() - 24 * 60 * 60 * 1000),
          ),
        ),
      );
    if (recent && recent.count >= ORG_EXPORT_DAILY_LIMIT) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: await tr("serverErrors", "dataExport.dailyLimit", {
          limit: ORG_EXPORT_DAILY_LIMIT,
        }),
      });
    }

    const downloadToken = crypto.randomUUID();
    const [request] = await ctx.db
      .insert(dataExportRequests)
      .values({
        userId,
        organizationId: orgId,
        requestType: USER_EXPORT_REQUEST_TYPE,
        format: ORG_EXPORT_FORMAT,
        downloadTokenHash: hashToken(downloadToken),
        downloadTokenEncrypted: encryptSecret(downloadToken),
        expiresAt: new Date(Date.now() + ORG_EXPORT_TTL_MS),
      })
      .returning();

    return {
      id: request.id,
      status: request.status,
      expiresAt: request.expiresAt,
    };
  }),

  /**
   * Brugerens egne bruger-eksporter i den aktive organisation.
   */
  listUserExports: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const orgId = ctx.orgId ?? null;
    const requests = await ctx.db.query.dataExportRequests.findMany({
      where: and(
        eq(dataExportRequests.userId, userId),
        eq(dataExportRequests.requestType, USER_EXPORT_REQUEST_TYPE),
        orgId
          ? eq(dataExportRequests.organizationId, orgId)
          : isNull(dataExportRequests.organizationId),
      ),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      limit: 10,
    });
    const now = Date.now();
    return requests.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      processedAt: r.processedAt,
      expiresAt: r.expiresAt,
      fileSizeBytes: r.fileSizeBytes,
      downloadToken:
        (r.status === "ready" || r.status === "downloaded") &&
        r.expiresAt.getTime() > now
          ? revealToken(r.downloadTokenEncrypted)
          : null,
    }));
  }),

  /**
   * List user's export requests with status
   */
  listExportRequests: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const requests = await ctx.db.query.dataExportRequests.findMany({
      where: and(
        eq(dataExportRequests.userId, userId),
        notInArray(dataExportRequests.requestType, [...ZIP_EXPORT_TYPES]),
      ),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      limit: 20,
    });
    return requests.map(
      ({ downloadTokenHash: _hash, downloadTokenEncrypted, ...request }) => ({
        ...request,
        downloadToken: revealToken(downloadTokenEncrypted),
      }),
    );
  }),

  /**
   * Cancel a pending export request
   */
  cancelExportRequest: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const request = await ctx.db.query.dataExportRequests.findFirst({
        where: and(
          eq(dataExportRequests.id, input.id),
          eq(dataExportRequests.userId, userId),
        ),
      });

      if (!request) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "dataExport.requestNotFound"),
        });
      }

      if (request.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "dataExport.cancelPendingOnly"),
        });
      }

      await ctx.db
        .update(dataExportRequests)
        .set({ status: "expired" })
        .where(eq(dataExportRequests.id, input.id));

      return { success: true };
    }),

  /**
   * Get data counts per table (for GDPR overview)
   */
  getDataCounts: orgAdminProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [
      clientCount,
      projectCount,
      timeEntryCount,
      taskCount,
      invoiceCount,
      prepaidCount,
    ] = await Promise.all([
      ctx.db
        .select({ count: count() })
        .from(clients)
        .where(
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
        ),
      ctx.db
        .select({ count: count() })
        .from(projects)
        .where(
          ctx.orgId
            ? eq(projects.organizationId, ctx.orgId)
            : eq(projects.userId, userId),
        ),
      ctx.db
        .select({ count: count() })
        .from(timeEntries)
        .where(
          ctx.orgId
            ? eq(timeEntries.organizationId, ctx.orgId)
            : eq(timeEntries.userId, userId),
        ),
      ctx.db
        .select({ count: count() })
        .from(tasks)
        .where(
          ctx.orgId
            ? eq(tasks.organizationId, ctx.orgId)
            : eq(tasks.userId, userId),
        ),
      ctx.db
        .select({ count: count() })
        .from(invoices)
        .where(
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
        ),
      ctx.db
        .select({ count: count() })
        .from(prepaidPackages)
        .where(
          ctx.orgId
            ? eq(prepaidPackages.organizationId, ctx.orgId)
            : eq(prepaidPackages.userId, userId),
        ),
    ]);

    return {
      clients: clientCount[0]?.count || 0,
      projects: projectCount[0]?.count || 0,
      timeEntries: timeEntryCount[0]?.count || 0,
      tasks: taskCount[0]?.count || 0,
      invoices: invoiceCount[0]?.count || 0,
      prepaidPackages: prepaidCount[0]?.count || 0,
    };
  }),

  /**
   * Bulk import clients
   */
  bulkImportClients: subscribedProcedure
    .input(
      z.object({
        entries: z.array(
          z.object({
            name: z.string().min(1),
            email: z.string().optional(),
            phone: z.string().optional(),
            company: z.string().optional(),
            address: z.string().optional(),
            city: z.string().optional(),
            postalCode: z.string().optional(),
            country: z.string().optional(),
            cvrNumber: z.string().optional(),
            notes: z.string().optional(),
            defaultHourlyRate: z.string().optional(),
          }),
        ),
        skipDuplicates: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const existingClients = await ctx.db.query.clients.findMany({
        where: ctx.orgId
          ? eq(clients.organizationId, ctx.orgId)
          : eq(clients.userId, userId),
        columns: { name: true, email: true, cvrNumber: true },
      });

      const existingSet = new Set(
        existingClients.map((c) => c.name.toLowerCase()),
      );

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const entry of input.entries) {
        try {
          if (
            input.skipDuplicates &&
            existingSet.has(entry.name.toLowerCase())
          ) {
            skipped++;
            continue;
          }

          await ctx.db.insert(clients).values({
            userId,
            organizationId: ctx.orgId,
            name: entry.name,
            email: entry.email || null,
            phone: entry.phone || null,
            company: entry.company || null,
            address: entry.address || null,
            city: entry.city || null,
            postalCode: entry.postalCode || null,
            country: entry.country || "Danmark",
            cvrNumber: entry.cvrNumber || null,
            notes: entry.notes || null,
            defaultHourlyRate: entry.defaultHourlyRate || null,
          });
          imported++;
          existingSet.add(entry.name.toLowerCase());
        } catch (err) {
          errors.push(`${entry.name}: ${(err as Error).message}`);
        }
      }

      return { imported, skipped, errors };
    }),

  /**
   * Bulk import projects
   */
  bulkImportProjects: subscribedProcedure
    .input(
      z.object({
        entries: z.array(
          z.object({
            name: z.string().min(1),
            description: z.string().optional(),
            clientName: z.string().optional(),
            hourlyRate: z.string().optional(),
            fixedPrice: z.string().optional(),
            status: z.string().optional(),
          }),
        ),
        skipDuplicates: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const userClients = await ctx.db.query.clients.findMany({
        where: ctx.orgId
          ? eq(clients.organizationId, ctx.orgId)
          : eq(clients.userId, userId),
        columns: { id: true, name: true },
      });
      const clientMap = new Map(
        userClients.map((c) => [c.name.toLowerCase(), c.id]),
      );

      const existingProjects = await ctx.db.query.projects.findMany({
        where: ctx.orgId
          ? eq(projects.organizationId, ctx.orgId)
          : eq(projects.userId, userId),
        columns: { name: true },
        with: { client: { columns: { name: true } } },
      });
      const existingSet = new Set(
        existingProjects.map(
          (p) =>
            `${p.name.toLowerCase()}::${p.client?.name?.toLowerCase() || ""}`,
        ),
      );

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const entry of input.entries) {
        try {
          const clientId = entry.clientName
            ? clientMap.get(entry.clientName.toLowerCase())
            : undefined;

          if (entry.clientName && !clientId) {
            errors.push(
              await tr("serverErrors", "dataExport.importClientNotFound", {
                name: entry.name,
                client: entry.clientName,
              }),
            );
            continue;
          }

          const key = `${entry.name.toLowerCase()}::${entry.clientName?.toLowerCase() || ""}`;
          if (input.skipDuplicates && existingSet.has(key)) {
            skipped++;
            continue;
          }

          if (!clientId) {
            errors.push(
              await tr("serverErrors", "dataExport.importClientRequired", {
                name: entry.name,
              }),
            );
            continue;
          }

          await ctx.db.insert(projects).values({
            userId,
            organizationId: ctx.orgId,
            name: entry.name,
            description: entry.description || null,
            clientId,
            hourlyRate: entry.hourlyRate || null,
            fixedPrice: entry.fixedPrice || null,
            status: entry.status || "active",
          });
          imported++;
          existingSet.add(key);
        } catch (err) {
          errors.push(`${entry.name}: ${(err as Error).message}`);
        }
      }

      return { imported, skipped, errors };
    }),

  /**
   * Bulk import tasks
   */
  bulkImportTasks: moduleWriteProcedure("tasks")
    .input(
      z.object({
        entries: z.array(
          z.object({
            title: z.string().min(1),
            description: z.string().optional(),
            projectName: z.string().optional(),
            clientName: z.string().optional(),
            status: z.string().optional(),
            priority: z.string().optional(),
            deadline: z.string().optional(),
            estimatedMinutes: z.number().optional(),
          }),
        ),
        skipDuplicates: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const userProjects = await ctx.db.query.projects.findMany({
        where: ctx.orgId
          ? eq(projects.organizationId, ctx.orgId)
          : eq(projects.userId, userId),
        columns: { id: true, name: true, clientId: true },
      });
      const projectMap = new Map(
        userProjects.map((p) => [p.name.toLowerCase(), p]),
      );

      const userClients = await ctx.db.query.clients.findMany({
        where: ctx.orgId
          ? eq(clients.organizationId, ctx.orgId)
          : eq(clients.userId, userId),
        columns: { id: true, name: true },
      });
      const clientMap = new Map(
        userClients.map((c) => [c.name.toLowerCase(), c.id]),
      );

      let imported = 0;
      const skipped = 0;
      const errors: string[] = [];

      for (const entry of input.entries) {
        try {
          const project = entry.projectName
            ? projectMap.get(entry.projectName.toLowerCase())
            : undefined;
          const clientId = entry.clientName
            ? clientMap.get(entry.clientName.toLowerCase())
            : project?.clientId || undefined;

          await ctx.db.insert(tasks).values({
            userId,
            organizationId: ctx.orgId,
            title: entry.title,
            description: entry.description || null,
            projectId: project?.id || null,
            clientId: clientId || null,
            status: entry.status || "backlog",
            priority: entry.priority || "medium",
            deadline: entry.deadline ? new Date(entry.deadline) : null,
            estimatedMinutes: entry.estimatedMinutes || null,
          });
          imported++;
        } catch (err) {
          errors.push(`${entry.title}: ${(err as Error).message}`);
        }
      }

      return { imported, skipped, errors };
    }),

  /**
   * Bulk import invoices
   */
  // Bulk-creating invoices must respect the same gate as invoices.create —
  // otherwise import is a backdoor around the invoicing permission.
  bulkImportInvoices: moduleWriteProcedure("invoices")
    .input(
      z.object({
        entries: z.array(
          z.object({
            invoiceNumber: z.string().min(1),
            clientName: z.string(),
            amount: z.string(),
            status: z.string().optional(),
            issueDate: z.string(),
            dueDate: z.string().optional(),
            paidDate: z.string().optional(),
            notes: z.string().optional(),
          }),
        ),
        skipDuplicates: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const userClients = await ctx.db.query.clients.findMany({
        where: ctx.orgId
          ? eq(clients.organizationId, ctx.orgId)
          : eq(clients.userId, userId),
        columns: { id: true, name: true },
      });
      const clientMap = new Map(
        userClients.map((c) => [c.name.toLowerCase(), c.id]),
      );

      const existingInvoices = await ctx.db.query.invoices.findMany({
        where: ctx.orgId
          ? eq(invoices.organizationId, ctx.orgId)
          : eq(invoices.userId, userId),
        columns: { invoiceNumber: true },
      });
      const existingSet = new Set(existingInvoices.map((i) => i.invoiceNumber));

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const entry of input.entries) {
        try {
          if (input.skipDuplicates && existingSet.has(entry.invoiceNumber)) {
            skipped++;
            continue;
          }

          const clientId = clientMap.get(entry.clientName.toLowerCase());
          if (!clientId) {
            errors.push(
              await tr(
                "serverErrors",
                "dataExport.importInvoiceClientNotFound",
                { number: entry.invoiceNumber, client: entry.clientName },
              ),
            );
            continue;
          }

          await ctx.db.insert(invoices).values({
            userId,
            organizationId: ctx.orgId,
            invoiceNumber: entry.invoiceNumber,
            clientId,
            amount: entry.amount,
            status: entry.status || "draft",
            issueDate: new Date(entry.issueDate),
            dueDate: entry.dueDate ? new Date(entry.dueDate) : null,
            paidDate: entry.paidDate ? new Date(entry.paidDate) : null,
            notes: entry.notes || null,
          });
          imported++;
          existingSet.add(entry.invoiceNumber);
        } catch (err) {
          errors.push(
            await tr("serverErrors", "dataExport.importInvoiceError", {
              number: entry.invoiceNumber,
              message: (err as Error).message,
            }),
          );
        }
      }

      return { imported, skipped, errors };
    }),

  /**
   * Bulk import prepaid packages
   */
  bulkImportPrepaidPackages: moduleWriteProcedure("klippekort")
    .input(
      z.object({
        entries: z.array(
          z.object({
            name: z.string().min(1),
            clientName: z.string(),
            totalHours: z.string(),
            usedHours: z.string().optional(),
            hourlyRate: z.string(),
            purchaseDate: z.string(),
            expiryDate: z.string().optional(),
          }),
        ),
        skipDuplicates: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const userClients = await ctx.db.query.clients.findMany({
        where: ctx.orgId
          ? eq(clients.organizationId, ctx.orgId)
          : eq(clients.userId, userId),
        columns: { id: true, name: true },
      });
      const clientMap = new Map(
        userClients.map((c) => [c.name.toLowerCase(), c.id]),
      );

      let imported = 0;
      const skipped = 0;
      const errors: string[] = [];

      for (const entry of input.entries) {
        try {
          const clientId = clientMap.get(entry.clientName.toLowerCase());
          if (!clientId) {
            errors.push(
              await tr("serverErrors", "dataExport.importClientNotFound", {
                name: entry.name,
                client: entry.clientName,
              }),
            );
            continue;
          }

          const totalHours = parseFloat(entry.totalHours);
          const usedHours = parseFloat(entry.usedHours || "0");
          const hourlyRate = parseFloat(entry.hourlyRate);
          const remainingHours = totalHours - usedHours;

          await ctx.db.insert(prepaidPackages).values({
            userId,
            organizationId: ctx.orgId,
            name: entry.name,
            clientId,
            totalHours: entry.totalHours,
            usedHours: entry.usedHours || "0",
            remainingHours: remainingHours.toFixed(2),
            hourlyRate: entry.hourlyRate,
            totalValue: (totalHours * hourlyRate).toFixed(2),
            purchaseDate: new Date(entry.purchaseDate),
            expiryDate: entry.expiryDate ? new Date(entry.expiryDate) : null,
          });
          imported++;
        } catch (err) {
          errors.push(`${entry.name}: ${(err as Error).message}`);
        }
      }

      return { imported, skipped, errors };
    }),
});
