import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { emailIntegrations, emailSyncQueue } from "@/lib/db/schema";
import { ImapClientService } from "@/lib/services/imap-client";
import {
  decrypt,
  encrypt,
  isEncrypted,
  maskApiKey,
} from "@/lib/utils/encryption";
import { validateHostnameForSSRF } from "@/lib/utils/ssrf-protection";
import { enqueueEmailSyncJob } from "@/lib/workers/email-sync-worker";
import { adminProcedure, protectedProcedure, router } from "../trpc";

const integrationInputSchema = z.object({
  imapHost: z.string().min(1),
  imapPort: z.number().min(1).max(65535),
  imapUsername: z.string().min(1),
  imapPassword: z.string().optional(),
  imapUseSSL: z.boolean(),
  syncFrequencyMinutes: z.number().min(5).max(60),
  syncEnabled: z.boolean(),
  targetMailbox: z.string().min(1),
  clientDomainsOnly: z.boolean().optional(),
  senderWhitelist: z.array(z.string()).optional(),
  senderBlacklist: z.array(z.string()).optional(),
  subjectFilters: z.array(z.string()).optional(),
});

const testConnectionSchema = integrationInputSchema.extend({
  imapPassword: z.string().optional(),
});

// Email integrations are per-user (IMAP credentials are personal)
export const emailIntegrationRouter = router({
  getIntegration: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const integration = await ctx.db.query.emailIntegrations.findFirst({
      where: eq(emailIntegrations.userId, userId),
    });

    if (!integration) return null;

    return {
      id: integration.id,
      imapHost: integration.imapHost,
      imapPort: integration.imapPort,
      imapUsername: integration.imapUsername,
      imapUseSSL: integration.imapUseSSL,
      syncEnabled: integration.syncEnabled,
      syncFrequencyMinutes: integration.syncFrequencyMinutes,
      targetMailbox: integration.targetMailbox,
      lastSyncedAt: integration.lastSyncedAt,
      lastSyncStatus: integration.lastSyncStatus,
      lastSyncError: integration.lastSyncError,
      consecutiveSyncFailures: integration.consecutiveSyncFailures,
      syncDisabledUntil: integration.syncDisabledUntil,
      processedEmailsCount: integration.processedEmailsCount,
      hasPassword: !!integration.imapPassword,
      clientDomainsOnly: integration.clientDomainsOnly,
      senderWhitelist: integration.senderWhitelist || [],
      senderBlacklist: integration.senderBlacklist || [],
      subjectFilters: integration.subjectFilters || [],
      maskedPassword: integration.imapPassword
        ? maskApiKey(
            isEncrypted(integration.imapPassword)
              ? decrypt(integration.imapPassword)
              : integration.imapPassword,
          )
        : null,
    };
  }),

  upsertIntegration: protectedProcedure
    .input(integrationInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Validate IMAP host to prevent SSRF
      const ssrfError = await validateHostnameForSSRF(input.imapHost);
      if (ssrfError) {
        throw new Error(ssrfError);
      }

      const userId = ctx.session.user.id;

      const existing = await ctx.db.query.emailIntegrations.findFirst({
        where: eq(emailIntegrations.userId, userId),
        columns: { id: true, imapPassword: true },
      });

      const passwordToStore = input.imapPassword
        ? encrypt(input.imapPassword)
        : existing?.imapPassword || null;

      if (!passwordToStore) {
        throw new Error(
          await tr("serverErrors", "emailIntegration.imapPasswordRequired"),
        );
      }

      const now = new Date();

      if (existing) {
        await ctx.db
          .update(emailIntegrations)
          .set({
            imapHost: input.imapHost,
            imapPort: input.imapPort,
            imapUsername: input.imapUsername,
            imapPassword: passwordToStore,
            imapUseSSL: input.imapUseSSL,
            syncFrequencyMinutes: input.syncFrequencyMinutes,
            syncEnabled: input.syncEnabled,
            targetMailbox: input.targetMailbox,
            clientDomainsOnly: input.clientDomainsOnly ?? false,
            senderWhitelist: input.senderWhitelist || [],
            senderBlacklist: input.senderBlacklist || [],
            subjectFilters: input.subjectFilters || [],
            updatedAt: now,
          })
          .where(eq(emailIntegrations.id, existing.id));
      } else {
        await ctx.db.insert(emailIntegrations).values({
          userId,
          imapHost: input.imapHost,
          imapPort: input.imapPort,
          imapUsername: input.imapUsername,
          imapPassword: passwordToStore,
          imapUseSSL: input.imapUseSSL,
          syncFrequencyMinutes: input.syncFrequencyMinutes,
          syncEnabled: input.syncEnabled,
          targetMailbox: input.targetMailbox,
          clientDomainsOnly: input.clientDomainsOnly ?? false,
          senderWhitelist: input.senderWhitelist || [],
          senderBlacklist: input.senderBlacklist || [],
          subjectFilters: input.subjectFilters || [],
          createdAt: now,
          updatedAt: now,
        });
      }

      await enqueueEmailSyncJob(userId, "incremental_sync");

      return { success: true };
    }),

  testConnection: protectedProcedure
    .input(testConnectionSchema)
    .mutation(async ({ ctx, input }) => {
      // Validate IMAP host to prevent SSRF
      const ssrfError = await validateHostnameForSSRF(input.imapHost);
      if (ssrfError) {
        throw new Error(ssrfError);
      }

      let password = input.imapPassword;
      if (!password) {
        const existing = await ctx.db.query.emailIntegrations.findFirst({
          where: eq(emailIntegrations.userId, ctx.session.user.id),
          columns: { imapPassword: true },
        });
        if (existing?.imapPassword) {
          const decrypted = decrypt(existing.imapPassword);
          // If decrypt returned the encrypted value as-is, decryption failed
          // (likely ENCRYPTION_KEY changed between sessions)
          if (isEncrypted(decrypted)) {
            throw new Error(
              await tr("serverErrors", "emailIntegration.cannotDecrypt"),
            );
          }
          password = decrypted;
        }
      }

      if (!password) {
        throw new Error(
          await tr("serverErrors", "emailIntegration.imapPasswordRequired"),
        );
      }

      const client = new ImapClientService({
        host: input.imapHost,
        port: input.imapPort,
        user: input.imapUsername,
        password,
        tls: input.imapUseSSL,
        mailbox: input.targetMailbox,
      });

      try {
        await client.testConnection();
      } catch (err: unknown) {
        let message = "Unknown IMAP error";
        if (err instanceof Error) {
          // ImapFlow sometimes puts details in code/responseStatus instead of message
          const parts: string[] = [];
          if (err.message) parts.push(err.message);
          const code = (err as { code?: string }).code;
          if (code) parts.push(`code: ${code}`);
          const responseStatus = (err as { responseStatus?: string })
            .responseStatus;
          if (responseStatus) parts.push(`status: ${responseStatus}`);
          message = parts.join(" — ") || "Connection error (no details)";
        }
        throw new Error(
          await tr("serverErrors", "emailIntegration.connectionFailed", {
            message,
          }),
        );
      }

      return { success: true };
    }),

  triggerSync: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    await enqueueEmailSyncJob(userId, "incremental_sync");
    return { success: true };
  }),

  triggerBackfill: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        days: z.number().min(1).max(90).default(30),
      }),
    )
    .mutation(async ({ input }) => {
      await enqueueEmailSyncJob(input.userId, "incremental_sync", {
        sinceDays: input.days,
      });
      return { success: true };
    }),

  getSyncHistory: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const history = await ctx.db.query.emailSyncQueue.findMany({
        where: eq(emailSyncQueue.userId, userId),
        orderBy: desc(emailSyncQueue.createdAt),
        limit: input.limit,
      });

      return history;
    }),

  getSyncHealth: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const integration = await ctx.db.query.emailIntegrations.findFirst({
      where: eq(emailIntegrations.userId, userId),
    });

    if (!integration) return null;

    // Count recent failures
    const recentFailures = await ctx.db.query.emailSyncQueue.findMany({
      where: and(
        eq(emailSyncQueue.userId, userId),
        eq(emailSyncQueue.status, "failed"),
      ),
      orderBy: desc(emailSyncQueue.createdAt),
      limit: 5,
      columns: { id: true, errorMessage: true, createdAt: true },
    });

    return {
      uidValidity: integration.uidValidity,
      highestProcessedUid: integration.highestProcessedUid,
      lastHeartbeat: integration.lastHeartbeat,
      lastSyncedAt: integration.lastSyncedAt,
      lastSyncStatus: integration.lastSyncStatus,
      lastSyncError: integration.lastSyncError,
      consecutiveSyncFailures: integration.consecutiveSyncFailures,
      syncEnabled: integration.syncEnabled,
      processedEmailsCount: integration.processedEmailsCount,
      recentFailures,
    };
  }),
});
