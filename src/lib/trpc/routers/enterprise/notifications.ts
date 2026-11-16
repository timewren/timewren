import { tr } from "@/i18n/server-text";
/**
 * Notifikationsbus (E10, #468): org-indstillinger (defaults, Teams-webhook,
 * leder-digest, eskalering), bruger-præferencer, in-app-indbakke og
 * leverance-log. Alt scopet på ctx.orgId.
 */

import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  notificationDeliveries,
  notificationInbox,
  orgNotificationSettings,
  userNotificationPreferences,
} from "@/lib/db/schema";
import {
  BUILT_IN_DEFAULTS,
  buildTeamsCard,
  effectiveUserMatrix,
  maskWebhookUrl,
  mergeMatrix,
  postTeamsCard,
  sanitizeMatrix,
  USER_CHANNELS,
  validateTeamsWebhookUrl,
} from "@/lib/notifications/bus";
import {
  encryptWebhookSecret,
  getTeamsWebhookUrl,
} from "@/lib/notifications/webhook-secrets";
import { router } from "../../trpc";
import { orgAdminProcedure, organizationProcedure } from "./middleware";

// Løs record (zod 4 kræver ellers alle enum-nøgler); sanitizeMatrix
// smider ukendte grupper/kanaler væk server-side.
const matrixSchema = z.record(z.string(), z.record(z.string(), z.boolean()));

const digestSchema = z.enum(["off", "daily", "weekly"]);

async function loadOrgSettings(
  db: typeof import("@/lib/db").db,
  orgId: string,
) {
  return db.query.orgNotificationSettings.findFirst({
    where: eq(orgNotificationSettings.organizationId, orgId),
  });
}

function toPublicSettings(
  row: typeof orgNotificationSettings.$inferSelect | undefined,
) {
  return {
    channelDefaults: row?.channelDefaults ?? {},
    effectiveDefaults: mergeMatrix(row?.channelDefaults),
    builtInDefaults: BUILT_IN_DEFAULTS,
    teams: {
      configured: Boolean(row?.teamsWebhookUrl),
      enabled: Boolean(row?.teamsEnabled && row?.teamsWebhookUrl),
      maskedUrl: maskWebhookUrl(getTeamsWebhookUrl(row)),
    },
    managerDigest: (row?.managerDigest ?? "off") as "off" | "daily" | "weekly",
    escalationDays: row?.escalationDays ?? null,
  };
}

export const enterpriseNotificationsRouter = router({
  /** Org-indstillinger (admin). Webhook-URL'en returneres kun maskeret. */
  getNotificationSettings: orgAdminProcedure.query(async ({ ctx }) => {
    const row = await loadOrgSettings(ctx.db, ctx.orgId);
    return toPublicSettings(row);
  }),

  updateNotificationSettings: orgAdminProcedure
    .input(
      z.object({
        channelDefaults: matrixSchema.optional(),
        managerDigest: digestSchema.optional(),
        escalationDays: z.number().int().min(1).max(60).nullable().optional(),
        teamsEnabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await loadOrgSettings(ctx.db, ctx.orgId);
      const values = {
        ...(input.channelDefaults !== undefined && {
          channelDefaults: sanitizeMatrix(input.channelDefaults),
        }),
        ...(input.managerDigest !== undefined && {
          managerDigest: input.managerDigest,
        }),
        ...(input.escalationDays !== undefined && {
          escalationDays: input.escalationDays,
        }),
        ...(input.teamsEnabled !== undefined && {
          teamsEnabled: input.teamsEnabled,
        }),
        updatedAt: new Date(),
      };
      if (input.teamsEnabled && !existing?.teamsWebhookUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.notifications.addTeamsFirst",
          ),
        });
      }
      const [row] = await ctx.db
        .insert(orgNotificationSettings)
        .values({ organizationId: ctx.orgId, ...values })
        .onConflictDoUpdate({
          target: orgNotificationSettings.organizationId,
          set: values,
        })
        .returning();
      return toPublicSettings(row);
    }),

  /** Gem Teams-webhook. URL'en valideres og gemmes kun server-side. */
  setTeamsWebhook: orgAdminProcedure
    .input(z.object({ url: z.string().min(1).max(2048) }))
    .mutation(async ({ ctx, input }) => {
      const validated = validateTeamsWebhookUrl(input.url);
      if (!validated.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: validated.error });
      }
      const values = {
        teamsWebhookUrl: encryptWebhookSecret(validated.url),
        teamsEnabled: true,
        updatedAt: new Date(),
      };
      const [row] = await ctx.db
        .insert(orgNotificationSettings)
        .values({ organizationId: ctx.orgId, ...values })
        .onConflictDoUpdate({
          target: orgNotificationSettings.organizationId,
          set: values,
        })
        .returning();
      return toPublicSettings(row);
    }),

  removeTeamsWebhook: orgAdminProcedure.mutation(async ({ ctx }) => {
    const [row] = await ctx.db
      .update(orgNotificationSettings)
      .set({
        teamsWebhookUrl: null,
        teamsEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(orgNotificationSettings.organizationId, ctx.orgId))
      .returning();
    return toPublicSettings(row);
  }),

  /** "Send testbesked" — poster et kort direkte (uden om præferencer). */
  testTeamsWebhook: orgAdminProcedure.mutation(async ({ ctx }) => {
    const row = await loadOrgSettings(ctx.db, ctx.orgId);
    const teamsWebhookUrl = getTeamsWebhookUrl(row);
    if (!teamsWebhookUrl) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: await tr(
          "serverErrors",
          "enterprise.notifications.noTeamsWebhook",
        ),
      });
    }
    const org = await ctx.db.query.organizations.findFirst({
      where: (o, { eq: eqOp }) => eqOp(o.id, ctx.orgId),
      columns: { name: true },
    });
    const card = buildTeamsCard(
      {
        title: "Testbesked fra TimeTrack",
        body: await tr("serverErrors", "enterprise.notifications.testBody", {
          org:
            org?.name ??
            (await tr(
              "serverErrors",
              "enterprise.notifications.theOrganisation",
            )),
        }),
        url: "/dashboard/enterprise/settings",
        facts: [{ name: "Sendt af", value: ctx.session.user.name ?? "" }],
      },
      { orgName: org?.name },
    );
    try {
      await postTeamsCard(teamsWebhookUrl, card);
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : await tr("serverErrors", "common.unknownError");
      await ctx.db.insert(notificationDeliveries).values({
        organizationId: ctx.orgId,
        userId: ctx.session.user.id,
        event: "teams.test",
        channel: "teams",
        status: "failed",
        attempts: 1,
        error: message.slice(0, 1000),
      });
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: await tr(
          "serverErrors",
          "enterprise.notifications.teamsRejected",
          { message },
        ),
      });
    }
    await ctx.db.insert(notificationDeliveries).values({
      organizationId: ctx.orgId,
      userId: ctx.session.user.id,
      event: "teams.test",
      channel: "teams",
      status: "sent",
      attempts: 1,
      sentAt: new Date(),
    });
    return { ok: true as const };
  }),

  /** Seneste leverancer (admin) — fejlsøgning. */
  listNotificationDeliveries: orgAdminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.query.notificationDeliveries.findMany({
        where: eq(notificationDeliveries.organizationId, ctx.orgId),
        orderBy: [desc(notificationDeliveries.createdAt)],
        limit: input.limit,
        with: { user: { columns: { name: true, email: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        event: r.event,
        channel: r.channel,
        status: r.status,
        attempts: r.attempts,
        error: r.error,
        recipient: r.user?.name || r.user?.email || null,
        createdAt: r.createdAt,
        sentAt: r.sentAt,
      }));
    }),

  /** Egne præferencer: overrides + effektiv matrix + org-defaults. */
  getMyNotificationPreferences: organizationProcedure.query(async ({ ctx }) => {
    const [orgRow, userRow] = await Promise.all([
      loadOrgSettings(ctx.db, ctx.orgId),
      ctx.db.query.userNotificationPreferences.findFirst({
        where: and(
          eq(userNotificationPreferences.organizationId, ctx.orgId),
          eq(userNotificationPreferences.userId, ctx.session.user.id),
        ),
      }),
    ]);
    return {
      overrides: userRow?.preferences ?? {},
      effective: effectiveUserMatrix(
        orgRow?.channelDefaults,
        userRow?.preferences,
      ),
      orgDefaults: mergeMatrix(orgRow?.channelDefaults),
      userChannels: USER_CHANNELS,
    };
  }),

  updateMyNotificationPreferences: organizationProcedure
    .input(z.object({ preferences: matrixSchema }))
    .mutation(async ({ ctx, input }) => {
      const values = {
        preferences: sanitizeMatrix(input.preferences, USER_CHANNELS),
        updatedAt: new Date(),
      };
      const [row] = await ctx.db
        .insert(userNotificationPreferences)
        .values({
          organizationId: ctx.orgId,
          userId: ctx.session.user.id,
          ...values,
        })
        .onConflictDoUpdate({
          target: [
            userNotificationPreferences.organizationId,
            userNotificationPreferences.userId,
          ],
          set: values,
        })
        .returning();
      return row.preferences;
    }),

  /** In-app-indbakke. */
  listInbox: organizationProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          unreadOnly: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.query.notificationInbox.findMany({
        where: and(
          eq(notificationInbox.organizationId, ctx.orgId),
          eq(notificationInbox.userId, ctx.session.user.id),
          input?.unreadOnly ? isNull(notificationInbox.readAt) : undefined,
        ),
        orderBy: [desc(notificationInbox.createdAt)],
        limit: input?.limit ?? 30,
      });
      return rows;
    }),

  inboxUnreadCount: organizationProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationInbox)
      .where(
        and(
          eq(notificationInbox.organizationId, ctx.orgId),
          eq(notificationInbox.userId, ctx.session.user.id),
          isNull(notificationInbox.readAt),
        ),
      );
    return row?.count ?? 0;
  }),

  markInboxRead: organizationProcedure
    .input(z.object({ id: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(notificationInbox)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notificationInbox.organizationId, ctx.orgId),
            eq(notificationInbox.userId, ctx.session.user.id),
            isNull(notificationInbox.readAt),
            input.id ? eq(notificationInbox.id, input.id) : undefined,
          ),
        );
      return { ok: true as const };
    }),
});
