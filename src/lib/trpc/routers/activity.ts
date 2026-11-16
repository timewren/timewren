import { and, desc, eq, gte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import type * as schema from "@/lib/db/schema";
import { activityLogs } from "@/lib/db/schema";
import { toLocalDateStr } from "@/lib/format";
import { dateUpperBound } from "@/lib/time/date-bounds";
import { protectedProcedure, router } from "../trpc";

// Type for change tracking
export interface FieldChange {
  field: string;
  fieldLabel: string;
  before: unknown;
  after: unknown;
}

export interface ActivityLogEntry {
  entityType: string;
  entityId: string;
  action: string;
  entityName?: string;
  changes?: FieldChange[];
  metadata?: Record<string, unknown>;
}

/**
 * Helper function to log activity
 * Call this from other routers when making changes
 */
export async function logActivity(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
  entry: ActivityLogEntry,
  organizationId?: string | null,
) {
  try {
    await db.insert(activityLogs).values({
      userId,
      organizationId: organizationId ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      entityName: entry.entityName,
      changes: entry.changes as unknown as Record<string, unknown>,
      metadata: entry.metadata,
    });
  } catch (error) {
    // Don't fail the main operation if logging fails
    console.error("Failed to log activity:", error);
  }
}

/**
 * Helper to detect changes between two objects
 */
export function detectChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fieldLabels: Record<string, string>,
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const [field, label] of Object.entries(fieldLabels)) {
    const beforeValue = before[field];
    const afterValue = after[field];

    // Compare values (handle null/undefined equivalence)
    const beforeNormalized = beforeValue ?? null;
    const afterNormalized = afterValue ?? null;

    if (JSON.stringify(beforeNormalized) !== JSON.stringify(afterNormalized)) {
      changes.push({
        field,
        fieldLabel: label,
        before: beforeNormalized,
        after: afterNormalized,
      });
    }
  }

  return changes;
}

export const activityRouter = router({
  // Get recent activity
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).default(50),
          offset: z.number().min(0).default(0),
          entityType: z.string().optional(),
          entityId: z.string().uuid().optional(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const conditions = [
        ctx.orgId
          ? eq(activityLogs.organizationId, ctx.orgId)
          : eq(activityLogs.userId, userId),
      ];

      if (input?.entityType) {
        conditions.push(eq(activityLogs.entityType, input.entityType));
      }

      if (input?.entityId) {
        conditions.push(eq(activityLogs.entityId, input.entityId));
      }

      if (input?.startDate) {
        conditions.push(gte(activityLogs.createdAt, new Date(input.startDate)));
      }

      if (input?.endDate) {
        // Dato uden klokkeslæt = hele dagen med (samme regel som #648)
        conditions.push(dateUpperBound(activityLogs.createdAt, input.endDate));
      }

      const logs = await ctx.db.query.activityLogs.findMany({
        where: and(...conditions),
        orderBy: [desc(activityLogs.createdAt)],
        limit: input?.limit || 50,
        offset: input?.offset || 0,
        // Surface the actor (who performed the action) for team activity views.
        with: { user: { columns: { id: true, name: true, image: true } } },
      });

      return logs;
    }),

  // Get activity for a specific entity
  getByEntity: protectedProcedure
    .input(
      z.object({
        entityType: z.string(),
        entityId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const logs = await ctx.db.query.activityLogs.findMany({
        where: and(
          ctx.orgId
            ? eq(activityLogs.organizationId, ctx.orgId)
            : eq(activityLogs.userId, userId),
          eq(activityLogs.entityType, input.entityType),
          eq(activityLogs.entityId, input.entityId),
        ),
        orderBy: [desc(activityLogs.createdAt)],
        with: { user: { columns: { id: true, name: true, image: true } } },
      });

      return logs;
    }),

  // Get activity summary (grouped by day)
  getSummary: protectedProcedure
    .input(
      z
        .object({
          days: z.number().min(1).max(90).default(30),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const days = input?.days || 30;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const logs = await ctx.db.query.activityLogs.findMany({
        where: and(
          ctx.orgId
            ? eq(activityLogs.organizationId, ctx.orgId)
            : eq(activityLogs.userId, userId),
          gte(activityLogs.createdAt, startDate),
        ),
        orderBy: [desc(activityLogs.createdAt)],
      });

      // Group by date
      const byDate = new Map<string, typeof logs>();
      for (const log of logs) {
        const dateKey = toLocalDateStr(log.createdAt);
        if (!byDate.has(dateKey)) {
          byDate.set(dateKey, []);
        }
        byDate.get(dateKey)?.push(log);
      }

      // Group by entity type
      const byEntityType = new Map<string, number>();
      for (const log of logs) {
        const count = byEntityType.get(log.entityType) || 0;
        byEntityType.set(log.entityType, count + 1);
      }

      // Group by action
      const byAction = new Map<string, number>();
      for (const log of logs) {
        const count = byAction.get(log.action) || 0;
        byAction.set(log.action, count + 1);
      }

      return {
        total: logs.length,
        byDate: Object.fromEntries(
          Array.from(byDate.entries()).map(([date, items]) => [
            date,
            items.length,
          ]),
        ),
        byEntityType: Object.fromEntries(byEntityType),
        byAction: Object.fromEntries(byAction),
      };
    }),
});
