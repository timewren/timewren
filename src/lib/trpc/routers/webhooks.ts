import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import {
  clients,
  outgoingWebhooks,
  projects,
  type WebhookEventType,
  webhookDeliveries,
} from "@/lib/db/schema";
import { encryptSecret } from "@/lib/utils/encryption";
import { validateUrlForSSRF } from "@/lib/utils/ssrf-protection";
import { testWebhook } from "@/lib/webhooks/delivery";
import { maskWebhookSecret } from "@/lib/webhooks/signing";
import {
  protectedProcedure,
  router,
  subscribedOrgAdminProcedure,
} from "../trpc";

// All available webhook event types
const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  "client.created",
  "client.updated",
  "client.archived",
  "project.created",
  "project.updated",
  "project.status_changed",
  "project.budget_threshold",
  "time_entry.created",
  "time_entry.updated",
  "time_entry.deleted",
  "invoice.created",
  "invoice.sent",
  "invoice.paid",
  "invoice.overdue",
  "prepaid.created",
  "prepaid.updated",
  "prepaid.low_balance",
  "prepaid.expired",
  "task.created",
  "task.updated",
  "task.completed",
];

// Generate a secure webhook secret
function generateSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString("hex")}`;
}

export const webhooksRouter = router({
  // List all webhooks for the current user
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const webhooks = await ctx.db.query.outgoingWebhooks.findMany({
      where: ctx.orgId
        ? eq(outgoingWebhooks.organizationId, ctx.orgId)
        : eq(outgoingWebhooks.userId, userId),
      orderBy: [desc(outgoingWebhooks.createdAt)],
      with: {
        client: {
          columns: { id: true, name: true },
        },
        project: {
          columns: { id: true, name: true },
        },
      },
    });

    // Don't expose the full secret, just show first/last chars
    return webhooks.map((w) => ({
      ...w,
      secret: maskWebhookSecret(w.secret),
    }));
  }),

  // Get a single webhook by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const webhook = await ctx.db.query.outgoingWebhooks.findFirst({
        where: and(
          eq(outgoingWebhooks.id, input.id),
          ctx.orgId
            ? eq(outgoingWebhooks.organizationId, ctx.orgId)
            : eq(outgoingWebhooks.userId, userId),
        ),
        with: {
          client: {
            columns: { id: true, name: true },
          },
          project: {
            columns: { id: true, name: true },
          },
        },
      });

      if (!webhook) {
        throw new Error(await tr("serverErrors", "common.webhookNotFound"));
      }

      return {
        ...webhook,
        secret: maskWebhookSecret(webhook.secret),
      };
    }),

  // Get available event types
  getEventTypes: protectedProcedure.query(() => {
    return WEBHOOK_EVENT_TYPES.map((type) => {
      const [category, action] = type.split(".");
      return {
        type,
        category,
        action,
        label: formatEventLabel(type),
      };
    });
  }),

  // Create a new webhook
  create: subscribedOrgAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        url: z.string().url({ error: () => st("zod.invalidUrl") }),
        events: z
          .array(z.string())
          .min(1, { error: () => st("zod.webhookEventRequired") }),
        clientId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        retryCount: z.number().int().min(0).max(10).optional(),
        timeoutMs: z.number().int().min(1000).max(60000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Require HTTPS + SSRF validation (blocks internal / metadata hosts)
      const ssrfError = await validateUrlForSSRF(input.url);
      if (ssrfError) {
        throw new Error(ssrfError);
      }

      // Validate event types
      const validEvents = input.events.filter((e) =>
        WEBHOOK_EVENT_TYPES.includes(e as WebhookEventType),
      ) as WebhookEventType[];

      if (validEvents.length === 0) {
        throw new Error(await tr("serverErrors", "webhooks.noValidEvents"));
      }

      // Verify clientId/projectId belong to the user/org (prevent scoping a webhook
      // to another tenant's client/project, which would leak event existence)
      if (input.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
          columns: { id: true },
        });
        if (!client) {
          throw new Error(await tr("serverErrors", "common.clientNotFound"));
        }
      }
      if (input.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            ctx.orgId
              ? eq(projects.organizationId, ctx.orgId)
              : eq(projects.userId, userId),
          ),
          columns: { id: true },
        });
        if (!project) {
          throw new Error(await tr("serverErrors", "common.projectNotFound"));
        }
      }

      const secret = generateSecret();

      const [webhook] = await ctx.db
        .insert(outgoingWebhooks)
        .values({
          userId,
          organizationId: ctx.orgId,
          name: input.name,
          url: input.url,
          // Krypteret at rest (#712); klartekst vises kun i svaret her.
          secret: encryptSecret(secret),
          events: validEvents,
          clientId: input.clientId || null,
          projectId: input.projectId || null,
          retryCount: input.retryCount ?? 3,
          timeoutMs: input.timeoutMs ?? 30000,
        })
        .returning();

      // Return the full secret on creation - this is the only time it's shown
      return {
        ...webhook,
        secret,
        secretFull: secret,
      };
    }),

  // Update a webhook
  update: subscribedOrgAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        url: z
          .string()
          .url({ error: () => st("zod.invalidUrl") })
          .optional(),
        events: z.array(z.string()).min(1).optional(),
        clientId: z.string().uuid().nullable().optional(),
        projectId: z.string().uuid().nullable().optional(),
        isActive: z.boolean().optional(),
        retryCount: z.number().int().min(0).max(10).optional(),
        timeoutMs: z.number().int().min(1000).max(60000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify ownership
      const existing = await ctx.db.query.outgoingWebhooks.findFirst({
        where: and(
          eq(outgoingWebhooks.id, input.id),
          ctx.orgId
            ? eq(outgoingWebhooks.organizationId, ctx.orgId)
            : eq(outgoingWebhooks.userId, userId),
        ),
      });

      if (!existing) {
        throw new Error(await tr("serverErrors", "common.webhookNotFound"));
      }

      // Require HTTPS + SSRF validation for updated URL
      if (input.url) {
        const ssrfError = await validateUrlForSSRF(input.url);
        if (ssrfError) {
          throw new Error(ssrfError);
        }
      }

      // Verify clientId/projectId belong to the user/org when changed
      if (input.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
          columns: { id: true },
        });
        if (!client) {
          throw new Error(await tr("serverErrors", "common.clientNotFound"));
        }
      }
      if (input.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            ctx.orgId
              ? eq(projects.organizationId, ctx.orgId)
              : eq(projects.userId, userId),
          ),
          columns: { id: true },
        });
        if (!project) {
          throw new Error(await tr("serverErrors", "common.projectNotFound"));
        }
      }

      // Validate event types if provided
      let validEvents: WebhookEventType[] | undefined;
      if (input.events) {
        validEvents = input.events.filter((e) =>
          WEBHOOK_EVENT_TYPES.includes(e as WebhookEventType),
        ) as WebhookEventType[];

        if (validEvents.length === 0) {
          throw new Error(await tr("serverErrors", "webhooks.noValidEvents"));
        }
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) updateData.name = input.name;
      if (input.url !== undefined) updateData.url = input.url;
      if (validEvents !== undefined) updateData.events = validEvents;
      if (input.clientId !== undefined) updateData.clientId = input.clientId;
      if (input.projectId !== undefined) updateData.projectId = input.projectId;
      if (input.retryCount !== undefined)
        updateData.retryCount = input.retryCount;
      if (input.timeoutMs !== undefined) updateData.timeoutMs = input.timeoutMs;

      // If re-enabling, clear disabled state
      if (input.isActive === true && !existing.isActive) {
        updateData.isActive = true;
        updateData.disabledAt = null;
        updateData.disabledReason = null;
        updateData.consecutiveFailures = 0;
      } else if (input.isActive !== undefined) {
        updateData.isActive = input.isActive;
      }

      const [updated] = await ctx.db
        .update(outgoingWebhooks)
        .set(updateData)
        .where(eq(outgoingWebhooks.id, input.id))
        .returning();

      return { ...updated, secret: maskWebhookSecret(updated.secret) };
    }),

  // Regenerate webhook secret
  regenerateSecret: subscribedOrgAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify ownership
      const existing = await ctx.db.query.outgoingWebhooks.findFirst({
        where: and(
          eq(outgoingWebhooks.id, input.id),
          ctx.orgId
            ? eq(outgoingWebhooks.organizationId, ctx.orgId)
            : eq(outgoingWebhooks.userId, userId),
        ),
      });

      if (!existing) {
        throw new Error(await tr("serverErrors", "common.webhookNotFound"));
      }

      const newSecret = generateSecret();

      await ctx.db
        .update(outgoingWebhooks)
        .set({
          secret: encryptSecret(newSecret),
          updatedAt: new Date(),
        })
        .where(eq(outgoingWebhooks.id, input.id));

      // Return the full new secret - this is the only time it's shown
      return { secret: newSecret };
    }),

  // Delete a webhook
  delete: subscribedOrgAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify ownership
      const existing = await ctx.db.query.outgoingWebhooks.findFirst({
        where: and(
          eq(outgoingWebhooks.id, input.id),
          ctx.orgId
            ? eq(outgoingWebhooks.organizationId, ctx.orgId)
            : eq(outgoingWebhooks.userId, userId),
        ),
      });

      if (!existing) {
        throw new Error(await tr("serverErrors", "common.webhookNotFound"));
      }

      // Delete webhook (deliveries will cascade)
      await ctx.db
        .delete(outgoingWebhooks)
        .where(eq(outgoingWebhooks.id, input.id));

      return { success: true };
    }),

  // Test a webhook
  test: subscribedOrgAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const result = await testWebhook(input.id, userId, ctx.orgId);

      return result;
    }),

  // Get delivery history for a webhook
  getDeliveries: protectedProcedure
    .input(
      z.object({
        webhookId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify ownership
      const webhook = await ctx.db.query.outgoingWebhooks.findFirst({
        where: and(
          eq(outgoingWebhooks.id, input.webhookId),
          ctx.orgId
            ? eq(outgoingWebhooks.organizationId, ctx.orgId)
            : eq(outgoingWebhooks.userId, userId),
        ),
      });

      if (!webhook) {
        throw new Error(await tr("serverErrors", "common.webhookNotFound"));
      }

      const deliveries = await ctx.db.query.webhookDeliveries.findMany({
        where: eq(webhookDeliveries.webhookId, input.webhookId),
        orderBy: [desc(webhookDeliveries.createdAt)],
        limit: input.limit ?? 50,
      });

      return deliveries;
    }),

  // Get webhook stats
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const webhooks = await ctx.db.query.outgoingWebhooks.findMany({
      where: ctx.orgId
        ? eq(outgoingWebhooks.organizationId, ctx.orgId)
        : eq(outgoingWebhooks.userId, userId),
    });

    const totalWebhooks = webhooks.length;
    const activeWebhooks = webhooks.filter((w) => w.isActive).length;
    const totalDeliveries = webhooks.reduce(
      (sum, w) => sum + w.totalDeliveries,
      0,
    );
    const successfulDeliveries = webhooks.reduce(
      (sum, w) => sum + w.successfulDeliveries,
      0,
    );
    const failedDeliveries = webhooks.reduce(
      (sum, w) => sum + w.failedDeliveries,
      0,
    );

    return {
      totalWebhooks,
      activeWebhooks,
      disabledWebhooks: totalWebhooks - activeWebhooks,
      totalDeliveries,
      successfulDeliveries,
      failedDeliveries,
      successRate:
        totalDeliveries > 0
          ? Math.round((successfulDeliveries / totalDeliveries) * 100)
          : 100,
    };
  }),
});

// Helper to format event labels in Danish
function formatEventLabel(type: WebhookEventType): string {
  const labels: Record<WebhookEventType, string> = {
    "client.created": st("webhooks.event.clientCreated"),
    "client.updated": st("webhooks.event.clientUpdated"),
    "client.archived": st("webhooks.event.clientArchived"),
    "project.created": st("webhooks.event.projectCreated"),
    "project.updated": st("webhooks.event.projectUpdated"),
    "project.status_changed": st("webhooks.event.projectStatusChanged"),
    "project.budget_threshold": st("webhooks.event.projectBudgetThreshold"),
    "time_entry.created": st("webhooks.event.timeEntryCreated"),
    "time_entry.updated": st("webhooks.event.timeEntryUpdated"),
    "time_entry.deleted": st("webhooks.event.timeEntryDeleted"),
    "invoice.created": st("webhooks.event.invoiceCreated"),
    "invoice.sent": st("webhooks.event.invoiceSent"),
    "invoice.paid": st("webhooks.event.invoicePaid"),
    "invoice.overdue": st("webhooks.event.invoiceOverdue"),
    "prepaid.created": st("webhooks.event.prepaidCreated"),
    "prepaid.updated": st("webhooks.event.prepaidUpdated"),
    "prepaid.low_balance": st("webhooks.event.prepaidLowBalance"),
    "prepaid.expired": st("webhooks.event.prepaidExpired"),
    "task.created": st("webhooks.event.taskCreated"),
    "task.updated": st("webhooks.event.taskUpdated"),
    "task.completed": st("webhooks.event.taskCompleted"),
  };
  return labels[type] || type;
}
