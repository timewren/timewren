import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { clients, imports, projects, users } from "@/lib/db/schema";
import {
  ACTIVE_IMPORT_STATUSES,
  CANCELLABLE_IMPORT_STATUSES,
} from "@/lib/imports/status";
import {
  classifyTimeOpsError,
  createTimeOpsClient,
  type TimeOpsCustomer,
  type TimeOpsProject,
  type TimeOpsTag,
} from "@/lib/integrations/timeops";
import { appUrlEnv } from "@/lib/runtime-env";
import { encrypt } from "@/lib/utils/encryption";
import { protectedProcedure, router } from "../trpc";

// ============================================
// Types stored in JSONB columns
// ============================================

export interface PreviewData {
  organization: { name: string | null; vatNumber: string | null };
  clients: PreviewClient[];
  projects: PreviewProject[];
  tags: PreviewTag[];
  entryCount: number;
  dateRange: { from: string; to: string } | null;
}

export interface PreviewClient {
  sourceId: string;
  name: string | null;
  vatNumber: string | null;
  defaultRate: number | null;
  conflict: { existingClientId: string; existingName: string } | null;
}

export interface PreviewProject {
  sourceId: string;
  name: string | null;
  sourceCustomerId: string;
  rate: number | null;
  finishedAt: string | null;
  conflict: { existingProjectId: string; existingName: string } | null;
}

export interface PreviewTag {
  sourceId: string;
  text: string | null;
}

// ============================================
// Router
// ============================================

export const importsRouter = router({
  testConnection: protectedProcedure
    .input(z.object({ apiKey: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const client = createTimeOpsClient(input.apiKey);
      try {
        const connectionResult = await client.testConnectionDetailed();
        if (!connectionResult.ok) {
          if (connectionResult.reason === "network_error") {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: await tr("serverErrors", "imports.timeopsConnect", {
                detail:
                  connectionResult.detail ??
                  (await tr("serverErrors", "imports.networkError")),
              }),
            });
          }
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: await tr("serverErrors", "imports.apiKeyInvalid"),
          });
        }
        const organization = await client.getOrganization();
        return {
          ok: true,
          organization: {
            name: organization.name,
            vatNumber: organization.vatNumber,
          },
        };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        const classified = classifyTimeOpsError(err);
        throw new TRPCError({
          code:
            classified.code === "invalid_key"
              ? "UNAUTHORIZED"
              : classified.code === "not_premium"
                ? "FORBIDDEN"
                : "INTERNAL_SERVER_ERROR",
          message: classified.message,
        });
      }
    }),

  createPreview: protectedProcedure
    .input(z.object({ apiKey: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // 1. Reject if an active import exists
      const active = await ctx.db.query.imports.findFirst({
        where: and(
          ctx.orgId
            ? eq(imports.organizationId, ctx.orgId)
            : eq(imports.userId, userId),
          inArray(imports.status, [...ACTIVE_IMPORT_STATUSES]),
        ),
      });
      if (active) {
        throw new TRPCError({
          code: "CONFLICT",
          message: await tr("serverErrors", "imports.alreadyRunning"),
        });
      }

      // 2. Create import row
      const [importRow] = await ctx.db
        .insert(imports)
        .values({
          userId,
          organizationId: ctx.orgId,
          source: "timeops",
          status: "previewing",
          credentials: encrypt(JSON.stringify({ apiKey: input.apiKey })),
        })
        .returning();

      // 3. Fetch from TimeOps (parallel)
      const client = createTimeOpsClient(input.apiKey);
      let organization: { name: string | null; vatNumber: string | null };
      let customers: TimeOpsCustomer[];
      let tmProjects: TimeOpsProject[];
      let tags: TimeOpsTag[];
      let totalCount: number;
      let dateRange: { from: string; to: string } | null = null;

      try {
        const [
          orgResult,
          customersResult,
          projectsResult,
          tagsResult,
          countResult,
        ] = await Promise.all([
          client.getOrganization(),
          client.listCustomers(),
          client.listProjects(),
          client.listTags(),
          client.listRegistrations({ page: 0, pageSize: 1 }),
        ]);
        organization = {
          name: orgResult.name,
          vatNumber: orgResult.vatNumber,
        };
        customers = customersResult;
        tmProjects = projectsResult;
        tags = tagsResult;
        totalCount = countResult.totalCount;

        // Fetch first + last entry for date range (if any entries exist)
        if (totalCount > 0) {
          // Assume /Registrations returns newest first by default (page 0 = newest)
          const latest = countResult;
          const lastPageIdx = Math.max(0, totalCount - 1);
          const oldest = await client.listRegistrations({
            page: lastPageIdx,
            pageSize: 1,
          });
          if (latest.items[0] && oldest.items[0]) {
            dateRange = {
              from: oldest.items[0].startedAt,
              to: latest.items[0].startedAt,
            };
          }
        }
      } catch (err) {
        // Clean up the import row
        await ctx.db.delete(imports).where(eq(imports.id, importRow.id));
        const classified = classifyTimeOpsError(err);
        throw new TRPCError({
          code:
            classified.code === "invalid_key"
              ? "UNAUTHORIZED"
              : classified.code === "not_premium"
                ? "FORBIDDEN"
                : "INTERNAL_SERVER_ERROR",
          message: classified.message,
        });
      }

      // 4. Fetch existing TimeTrack data for conflict detection
      const existingClients = await ctx.db.query.clients.findMany({
        where: ctx.orgId
          ? eq(clients.organizationId, ctx.orgId)
          : eq(clients.userId, userId),
        columns: { id: true, name: true, cvrNumber: true },
      });
      const existingProjects = await ctx.db.query.projects.findMany({
        where: ctx.orgId
          ? eq(projects.organizationId, ctx.orgId)
          : eq(projects.userId, userId),
        columns: { id: true, name: true, clientId: true },
      });

      // 5. Build preview data with conflicts
      const previewClients: PreviewClient[] = customers.map((c) => {
        const nameLower = c.name?.toLowerCase() ?? "";
        const match = existingClients.find(
          (ec) =>
            (nameLower && ec.name?.toLowerCase() === nameLower) ||
            (c.vatNumber && ec.cvrNumber === c.vatNumber),
        );
        return {
          sourceId: String(c.id),
          name: c.name,
          vatNumber: c.vatNumber,
          defaultRate: c.defaultRate,
          conflict: match
            ? { existingClientId: match.id, existingName: match.name ?? "" }
            : null,
        };
      });

      // Project conflict: match name within the same matched client
      const previewProjects: PreviewProject[] = tmProjects.map((p) => {
        const sourceCustomerId = String(p.customerId);
        const clientMatch = previewClients.find(
          (c) => c.sourceId === sourceCustomerId,
        );
        const mappedClientId = clientMatch?.conflict?.existingClientId;
        let match: { id: string; name: string | null } | undefined;
        if (mappedClientId && p.name) {
          const pNameLower = p.name.toLowerCase();
          match = existingProjects.find(
            (ep) =>
              ep.clientId === mappedClientId &&
              ep.name?.toLowerCase() === pNameLower,
          );
        }
        return {
          sourceId: String(p.id),
          name: p.name,
          sourceCustomerId,
          rate: p.rate,
          finishedAt: p.finishedAt,
          conflict: match
            ? { existingProjectId: match.id, existingName: match.name ?? "" }
            : null,
        };
      });

      const previewTags: PreviewTag[] = tags.map((t) => ({
        sourceId: String(t.id),
        text: t.text,
      }));

      const previewData: PreviewData = {
        organization,
        clients: previewClients,
        projects: previewProjects,
        tags: previewTags,
        entryCount: totalCount,
        dateRange,
      };

      // 6. Save preview
      await ctx.db
        .update(imports)
        .set({
          status: "preview_ready",
          previewData,
          totalEntries: totalCount,
          updatedAt: new Date(),
        })
        .where(eq(imports.id, importRow.id));

      // Save API key to user profile for later runs (encrypted)
      await ctx.db
        .update(users)
        .set({ timeopsApiKey: encrypt(input.apiKey) })
        .where(eq(users.id, userId));

      return { importId: importRow.id };
    }),

  getPreview: protectedProcedure
    .input(z.object({ importId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const importRow = await ctx.db.query.imports.findFirst({
        where: and(
          eq(imports.id, input.importId),
          ctx.orgId
            ? eq(imports.organizationId, ctx.orgId)
            : eq(imports.userId, ctx.session.user.id),
        ),
      });
      if (!importRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "imports.notFound"),
        });
      }
      return {
        id: importRow.id,
        status: importRow.status,
        previewData: importRow.previewData as PreviewData | null,
        conflictResolutions: importRow.conflictResolutions,
        totalEntries: importRow.totalEntries,
        createdAt: importRow.createdAt,
      };
    }),

  startImport: protectedProcedure
    .input(
      z.object({
        importId: z.string().uuid(),
        conflictResolutions: z.object({
          clients: z.record(
            z.string(),
            z.enum(["skip", "create_new", "merge"]),
          ),
          projects: z.record(
            z.string(),
            z.enum(["skip", "create_new", "merge"]),
          ),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const importRow = await ctx.db.query.imports.findFirst({
        where: and(
          eq(imports.id, input.importId),
          ctx.orgId
            ? eq(imports.organizationId, ctx.orgId)
            : eq(imports.userId, ctx.session.user.id),
        ),
      });
      if (!importRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "imports.notFound"),
        });
      }
      if (importRow.status !== "preview_ready") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "imports.cannotStart", {
            status: importRow.status,
          }),
        });
      }

      await ctx.db
        .update(imports)
        .set({
          status: "running",
          conflictResolutions: input.conflictResolutions,
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(imports.id, input.importId));

      // For small imports, process inline instead of waiting for cron.
      // This avoids the user having to wait for the next cron tick.
      if (importRow.totalEntries != null && importRow.totalEntries <= 50) {
        try {
          const cronSecret = process.env.CRON_SECRET;
          if (cronSecret) {
            // Springes over (200 skipped) hvis cron-kørslen allerede er i gang;
            // importen tages så af næste tick. Timeouten afbryder kun klienten.
            const baseUrl = appUrlEnv() ?? "http://localhost:3000";
            fetch(`${baseUrl}/api/cron/import`, {
              method: "GET",
              headers: { Authorization: `Bearer ${cronSecret}` },
              signal: AbortSignal.timeout(10_000),
            }).catch(() => {});
          }
        } catch {}
      }

      return { success: true };
    }),

  getStatus: protectedProcedure
    .input(z.object({ importId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const importRow = await ctx.db.query.imports.findFirst({
        where: and(
          eq(imports.id, input.importId),
          ctx.orgId
            ? eq(imports.organizationId, ctx.orgId)
            : eq(imports.userId, ctx.session.user.id),
        ),
        columns: {
          id: true,
          status: true,
          totalEntries: true,
          processedEntries: true,
          importedEntries: true,
          skippedEntries: true,
          failedEntries: true,
          results: true,
          errors: true,
          startedAt: true,
          completedAt: true,
        },
      });
      if (!importRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "imports.notFound"),
        });
      }
      return importRow;
    }),

  cancelImport: protectedProcedure
    .input(z.object({ importId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const importRow = await ctx.db.query.imports.findFirst({
        where: and(
          eq(imports.id, input.importId),
          ctx.orgId
            ? eq(imports.organizationId, ctx.orgId)
            : eq(imports.userId, ctx.session.user.id),
        ),
      });
      if (!importRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "imports.notFound"),
        });
      }
      const status =
        importRow.status as (typeof CANCELLABLE_IMPORT_STATUSES)[number];
      if (!CANCELLABLE_IMPORT_STATUSES.includes(status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "imports.cannotCancel"),
        });
      }

      if (status === "running" || status === "processing") {
        // Mark as cancelled — the cron job checks this per-page and stops.
        await ctx.db
          .update(imports)
          .set({
            status: "cancelled",
            completedAt: new Date(),
            credentials: null,
            updatedAt: new Date(),
          })
          .where(eq(imports.id, input.importId));
      } else {
        await ctx.db.delete(imports).where(eq(imports.id, input.importId));
      }
      return { success: true };
    }),

  listImports: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.imports.findMany({
      where: ctx.orgId
        ? eq(imports.organizationId, ctx.orgId)
        : eq(imports.userId, ctx.session.user.id),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: 10,
      columns: {
        id: true,
        source: true,
        status: true,
        totalEntries: true,
        importedEntries: true,
        skippedEntries: true,
        failedEntries: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
      },
    });
    return rows;
  }),
});
