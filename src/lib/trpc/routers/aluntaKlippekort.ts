import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { getCallbackBaseUrl } from "@/lib/config";
import {
  aluntaKlippekortTokens,
  aluntaPlanMappings,
  clients,
  webhookEvents,
} from "@/lib/db/schema";
import { hashToken, revealToken } from "@/lib/security/token-hash";
import { encryptSecret } from "@/lib/utils/encryption";
import { protectedProcedure, router } from "../trpc";

/** Build the full webhook URL for a given token */
function webhookUrl(token: string): string {
  return `${getCallbackBaseUrl()}/api/alunta/klippekort/${token}`;
}

/**
 * Nyt webhook-token (#713): hash til opslag i webhook-ruten, enc:v1 så URL'en
 * kan vises igen i indstillinger. Klartekst gemmes ikke.
 */
function newTokenFields() {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    fields: {
      tokenHash: hashToken(token),
      tokenEncrypted: encryptSecret(token),
    },
  };
}

/** Webhook-tokenet til visning — kaster hvis det ikke kan dekrypteres. */
function displayToken(row: { tokenEncrypted: string | null }): string {
  const token = revealToken(row.tokenEncrypted);
  if (!token) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: st("alunta.webhookUrlUnavailable"),
    });
  }
  return token;
}

/** Ownership condition — org-scoped when available, else user-scoped */
function ownerCondition(
  table: typeof aluntaKlippekortTokens | typeof aluntaPlanMappings,
  userId: string,
  orgId: string | null,
) {
  return orgId ? eq(table.organizationId, orgId) : eq(table.userId, userId);
}

export const aluntaKlippekortRouter = router({
  // ──────────────────────────────────────────────
  // Token management
  // ──────────────────────────────────────────────

  /** Get (or lazily create) the active webhook token */
  getToken: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const orgId = ctx.orgId;

    // Try to find an existing active token
    const existing = await ctx.db.query.aluntaKlippekortTokens.findFirst({
      where: and(
        ownerCondition(aluntaKlippekortTokens, userId, orgId),
        eq(aluntaKlippekortTokens.isActive, true),
      ),
    });

    if (existing) {
      const token = displayToken(existing);
      return {
        token,
        webhookUrl: webhookUrl(token),
        isActive: existing.isActive,
      };
    }

    // None found — create one
    const { token, fields } = newTokenFields();
    const [created] = await ctx.db
      .insert(aluntaKlippekortTokens)
      .values({
        userId,
        organizationId: orgId,
        ...fields,
      })
      .returning();

    return {
      token,
      webhookUrl: webhookUrl(token),
      isActive: created.isActive,
    };
  }),

  /** Regenerate the webhook token (deactivates all previous) */
  regenerateToken: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const orgId = ctx.orgId;

    // Deactivate all existing tokens
    await ctx.db
      .update(aluntaKlippekortTokens)
      .set({ isActive: false })
      .where(
        and(
          ownerCondition(aluntaKlippekortTokens, userId, orgId),
          eq(aluntaKlippekortTokens.isActive, true),
        ),
      );

    // Create a new token
    const { token, fields } = newTokenFields();
    await ctx.db.insert(aluntaKlippekortTokens).values({
      userId,
      organizationId: orgId,
      ...fields,
    });

    return {
      token,
      webhookUrl: webhookUrl(token),
    };
  }),

  // ──────────────────────────────────────────────
  // Mapping CRUD
  // ──────────────────────────────────────────────

  /** List all active plan mappings (with client relation) */
  listMappings: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const orgId = ctx.orgId;

    return ctx.db.query.aluntaPlanMappings.findMany({
      where: and(
        ownerCondition(aluntaPlanMappings, userId, orgId),
        eq(aluntaPlanMappings.isActive, true),
      ),
      with: { client: true },
      orderBy: [desc(aluntaPlanMappings.createdAt)],
    });
  }),

  /** Get the active mapping for a specific client */
  getMappingForClient: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const orgId = ctx.orgId;

      return (
        (await ctx.db.query.aluntaPlanMappings.findFirst({
          where: and(
            ownerCondition(aluntaPlanMappings, userId, orgId),
            eq(aluntaPlanMappings.clientId, input.clientId),
            eq(aluntaPlanMappings.isActive, true),
          ),
          with: { client: true },
        })) ?? null
      );
    }),

  /** Create a new plan → client mapping */
  createMapping: protectedProcedure
    .input(
      z.object({
        aluntaPlanUuid: z.string().min(1),
        aluntaPlanName: z.string().min(1),
        clientId: z.string().uuid(),
        hoursPerPeriod: z.number().positive(),
        hourlyRate: z.number().nonnegative(),
        renewalBehavior: z
          .enum(["parallel", "transfer", "archive"])
          .default("parallel"),
        clipSizeMinutes: z.number().int().positive().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const orgId = ctx.orgId;

      // Verify client belongs to user/org
      const client = await ctx.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.clientId),
          orgId
            ? eq(clients.organizationId, orgId)
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

      const existingMapping = await ctx.db.query.aluntaPlanMappings.findFirst({
        where: and(
          ownerCondition(aluntaPlanMappings, userId, orgId),
          eq(aluntaPlanMappings.clientId, input.clientId),
          eq(aluntaPlanMappings.isActive, true),
        ),
      });
      if (existingMapping) {
        throw new TRPCError({
          code: "CONFLICT",
          message: await tr("serverErrors", "alunta.clientAlreadyMapped"),
        });
      }

      // Get or create active token
      let activeToken = await ctx.db.query.aluntaKlippekortTokens.findFirst({
        where: and(
          ownerCondition(aluntaKlippekortTokens, userId, orgId),
          eq(aluntaKlippekortTokens.isActive, true),
        ),
      });

      if (!activeToken) {
        const { fields } = newTokenFields();
        const [created] = await ctx.db
          .insert(aluntaKlippekortTokens)
          .values({ userId, organizationId: orgId, ...fields })
          .returning();
        activeToken = created;
      }

      const [mapping] = await ctx.db
        .insert(aluntaPlanMappings)
        .values({
          userId,
          organizationId: orgId,
          tokenId: activeToken.id,
          aluntaPlanUuid: input.aluntaPlanUuid,
          aluntaPlanName: input.aluntaPlanName,
          clientId: input.clientId,
          hoursPerPeriod: input.hoursPerPeriod.toString(),
          hourlyRate: input.hourlyRate.toString(),
          renewalBehavior: input.renewalBehavior,
          clipSizeMinutes: input.clipSizeMinutes ?? null,
        })
        .returning();

      return mapping;
    }),

  /** Update an existing mapping */
  updateMapping: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        aluntaPlanUuid: z.string().min(1).optional(),
        aluntaPlanName: z.string().min(1).optional(),
        hoursPerPeriod: z.number().positive().optional(),
        hourlyRate: z.number().nonnegative().optional(),
        renewalBehavior: z.enum(["parallel", "transfer", "archive"]).optional(),
        clipSizeMinutes: z.number().int().positive().nullable().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const orgId = ctx.orgId;

      // Verify ownership
      const existing = await ctx.db.query.aluntaPlanMappings.findFirst({
        where: and(
          eq(aluntaPlanMappings.id, input.id),
          ownerCondition(aluntaPlanMappings, userId, orgId),
        ),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "alunta.mappingNotFound"),
        });
      }

      // Build update object — only include defined fields
      const { id: _id, ...updates } = input;
      const setObj: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (updates.aluntaPlanUuid !== undefined) {
        setObj.aluntaPlanUuid = updates.aluntaPlanUuid;
      }
      if (updates.aluntaPlanName !== undefined) {
        setObj.aluntaPlanName = updates.aluntaPlanName;
      }
      if (updates.hoursPerPeriod !== undefined) {
        setObj.hoursPerPeriod = updates.hoursPerPeriod.toString();
      }
      if (updates.hourlyRate !== undefined) {
        setObj.hourlyRate = updates.hourlyRate.toString();
      }
      if (updates.renewalBehavior !== undefined) {
        setObj.renewalBehavior = updates.renewalBehavior;
      }
      if (updates.clipSizeMinutes !== undefined) {
        setObj.clipSizeMinutes = updates.clipSizeMinutes;
      }
      if (updates.isActive !== undefined) {
        setObj.isActive = updates.isActive;
      }

      const [updated] = await ctx.db
        .update(aluntaPlanMappings)
        .set(setObj)
        .where(eq(aluntaPlanMappings.id, input.id))
        .returning();

      return updated;
    }),

  /** Delete a mapping */
  deleteMapping: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const orgId = ctx.orgId;

      // Verify ownership
      const existing = await ctx.db.query.aluntaPlanMappings.findFirst({
        where: and(
          eq(aluntaPlanMappings.id, input.id),
          ownerCondition(aluntaPlanMappings, userId, orgId),
        ),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "alunta.mappingNotFound"),
        });
      }

      await ctx.db
        .update(aluntaPlanMappings)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(aluntaPlanMappings.id, input.id));

      return { success: true };
    }),

  // ──────────────────────────────────────────────
  // Webhook event log
  // ──────────────────────────────────────────────

  /** Get last 20 webhook events scoped to this user's token */
  getRecentWebhooks: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const orgId = ctx.orgId;

    const token = await ctx.db.query.aluntaKlippekortTokens.findFirst({
      where: and(
        ownerCondition(aluntaKlippekortTokens, userId, orgId),
        eq(aluntaKlippekortTokens.isActive, true),
      ),
      columns: { id: true },
    });

    if (!token) return [];

    return ctx.db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.source, `alunta-klippekort:${token.id}`))
      .orderBy(desc(webhookEvents.createdAt))
      .limit(20);
  }),
});
