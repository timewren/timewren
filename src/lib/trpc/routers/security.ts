// Security settings are per-user
import { and, desc, eq, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { accountBrand } from "@/lib/auth/account-brand";
import { linkableProviders } from "@/lib/auth/social-providers";
import {
  accounts,
  passkeys,
  sessions,
  trustedDevices,
  twoFactors,
  users,
} from "@/lib/db/schema";
import { protectedProcedure, router } from "../trpc";

export const securityRouter = router({
  // ============================================
  // Connected Accounts
  // ============================================

  // Get all connected accounts for the current user
  getConnectedAccounts: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const userAccounts = await ctx.db.query.accounts.findMany({
      where: eq(accounts.userId, userId),
    });

    // Udbydere fra kontoens brand: en TimeWren-konto kan kun forbinde
    // udbydere med en TimeWren-klient (auth/social-providers.ts).
    // Entra ID linkes via linkSocial — aldrig via trustedProviders (auto-link
    // på e-mail ville åbne for nOAuth, #470).
    const availableProviders = linkableProviders(
      await accountBrand(ctx.db, userId),
    );

    return {
      accounts: userAccounts.map((account) => ({
        id: account.id,
        providerId: account.providerId,
        accountId: account.accountId,
        createdAt: account.createdAt,
      })),
      availableProviders,
    };
  }),

  // Disconnect an OAuth account
  disconnectAccount: protectedProcedure
    .input(
      z.object({
        accountId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Check that the account belongs to the user
      const account = await ctx.db.query.accounts.findFirst({
        where: and(
          eq(accounts.id, input.accountId),
          eq(accounts.userId, userId),
        ),
      });

      if (!account) {
        throw new Error(await tr("serverErrors", "security.accountNotFound"));
      }

      // Check if user has other login methods before disconnecting
      const allAccounts = await ctx.db.query.accounts.findMany({
        where: eq(accounts.userId, userId),
      });

      // Check if user has a password (credential provider)
      const hasPassword = allAccounts.some(
        (a) => a.providerId === "credential",
      );

      // Check if user has passkeys
      const userPasskeys = await ctx.db.query.passkeys.findMany({
        where: eq(passkeys.userId, userId),
      });

      const hasPasskey = userPasskeys.length > 0;
      const otherOAuthAccounts = allAccounts.filter(
        (a) => a.id !== input.accountId && a.providerId !== "credential",
      );

      // Must have at least one login method remaining
      if (!hasPassword && !hasPasskey && otherOAuthAccounts.length === 0) {
        throw new Error(
          await tr("serverErrors", "security.lastLoginMethodRemove"),
        );
      }

      // Delete the account
      await ctx.db.delete(accounts).where(eq(accounts.id, input.accountId));

      return { success: true };
    }),

  // ============================================
  // Passkeys
  // ============================================

  // Get all passkeys for the current user
  getPasskeys: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const userPasskeys = await ctx.db.query.passkeys.findMany({
      where: eq(passkeys.userId, userId),
      orderBy: [desc(passkeys.createdAt)],
    });

    return userPasskeys.map((pk) => ({
      id: pk.id,
      name: pk.name || "Unavngivet passkey",
      deviceType: pk.deviceType,
      backedUp: pk.backedUp,
      createdAt: pk.createdAt,
    }));
  }),

  // Rename a passkey
  renamePasskey: protectedProcedure
    .input(
      z.object({
        passkeyId: z.string(),
        name: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Check that the passkey belongs to the user
      const passkey = await ctx.db.query.passkeys.findFirst({
        where: and(
          eq(passkeys.id, input.passkeyId),
          eq(passkeys.userId, userId),
        ),
      });

      if (!passkey) {
        throw new Error(await tr("serverErrors", "security.passkeyNotFound"));
      }

      await ctx.db
        .update(passkeys)
        .set({ name: input.name })
        .where(eq(passkeys.id, input.passkeyId));

      return { success: true };
    }),

  // Delete a passkey
  deletePasskey: protectedProcedure
    .input(
      z.object({
        passkeyId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Check that the passkey belongs to the user
      const passkey = await ctx.db.query.passkeys.findFirst({
        where: and(
          eq(passkeys.id, input.passkeyId),
          eq(passkeys.userId, userId),
        ),
      });

      if (!passkey) {
        throw new Error(await tr("serverErrors", "security.passkeyNotFound"));
      }

      // Check if user has other login methods
      const allAccounts = await ctx.db.query.accounts.findMany({
        where: eq(accounts.userId, userId),
      });

      const hasPassword = allAccounts.some(
        (a) => a.providerId === "credential",
      );
      const hasOAuth = allAccounts.some((a) => a.providerId !== "credential");

      const userPasskeys = await ctx.db.query.passkeys.findMany({
        where: eq(passkeys.userId, userId),
      });

      const otherPasskeys = userPasskeys.filter(
        (pk) => pk.id !== input.passkeyId,
      );

      if (!hasPassword && !hasOAuth && otherPasskeys.length === 0) {
        throw new Error(
          await tr("serverErrors", "security.lastLoginMethodDelete"),
        );
      }

      await ctx.db.delete(passkeys).where(eq(passkeys.id, input.passkeyId));

      return { success: true };
    }),

  // ============================================
  // Sessions
  // ============================================

  // Get all active (non-expired) sessions for the current user
  getSessions: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const currentToken = ctx.session.session.token;
    const now = new Date();

    const userSessions = await ctx.db.query.sessions.findMany({
      where: eq(sessions.userId, userId),
      orderBy: [desc(sessions.createdAt)],
    });

    // Only return non-expired sessions
    return userSessions
      .filter((session) => new Date(session.expiresAt) > now)
      .map((session) => ({
        id: session.id,
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        isCurrent: session.token === currentToken,
      }));
  }),

  // Revoke a specific session
  revokeSession: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Check that the session belongs to the user and is not the current session
      const session = await ctx.db.query.sessions.findFirst({
        where: and(
          eq(sessions.id, input.sessionId),
          eq(sessions.userId, userId),
        ),
      });

      if (!session) {
        throw new Error(await tr("serverErrors", "security.sessionNotFound"));
      }

      if (session.token === ctx.session.session.token) {
        throw new Error(await tr("serverErrors", "security.cannotEndCurrent"));
      }

      await ctx.db.delete(sessions).where(eq(sessions.id, input.sessionId));

      return { success: true };
    }),

  // Revoke all other sessions (keep current)
  revokeAllOtherSessions: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const currentToken = ctx.session.session.token;

    // Get the current session ID
    const currentSession = await ctx.db.query.sessions.findFirst({
      where: and(eq(sessions.userId, userId), eq(sessions.token, currentToken)),
    });

    if (!currentSession) {
      throw new Error(
        await tr("serverErrors", "security.currentSessionNotFound"),
      );
    }

    // Delete all other sessions
    await ctx.db
      .delete(sessions)
      .where(
        and(eq(sessions.userId, userId), ne(sessions.id, currentSession.id)),
      );

    return { success: true };
  }),

  // ============================================
  // Phone Number
  // ============================================

  // Get phone number status
  getPhoneStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    return {
      hasPhone: !!user?.phoneNumber,
      phoneNumber: user?.phoneNumber ? maskPhoneNumber(user.phoneNumber) : null,
      phoneVerified: user?.phoneNumberVerified ?? false,
      providerAvailable: Boolean(process.env.MESSAGEBIRD_API_KEY),
    };
  }),

  // Remove phone number
  removePhoneNumber: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Check if user has other login methods
    const allAccounts = await ctx.db.query.accounts.findMany({
      where: eq(accounts.userId, userId),
    });

    const hasPassword = allAccounts.some((a) => a.providerId === "credential");
    const hasOAuth = allAccounts.some((a) => a.providerId !== "credential");

    const userPasskeys = await ctx.db.query.passkeys.findMany({
      where: eq(passkeys.userId, userId),
    });

    if (!hasPassword && !hasOAuth && userPasskeys.length === 0) {
      throw new Error(await tr("serverErrors", "security.phoneIsOnlyMethod"));
    }

    await ctx.db
      .update(users)
      .set({
        phoneNumber: null,
        phoneNumberVerified: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return { success: true };
  }),

  // ============================================
  // Two-Factor Authentication
  // ============================================

  // Get 2FA status for the current user
  getTwoFactorStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    const twoFactor = await ctx.db.query.twoFactors.findFirst({
      where: eq(twoFactors.userId, userId),
    });

    return {
      enabled: user?.twoFactorEnabled ?? false,
      hasSecret: !!twoFactor,
      createdAt: twoFactor?.createdAt,
    };
  }),

  // Disable 2FA (called from Better-Auth, this just cleans up our DB)
  disable2FA: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Update user
    await ctx.db
      .update(users)
      .set({
        twoFactorEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    // Delete 2FA record
    await ctx.db.delete(twoFactors).where(eq(twoFactors.userId, userId));

    // Delete all trusted devices
    await ctx.db
      .delete(trustedDevices)
      .where(eq(trustedDevices.userId, userId));

    return { success: true };
  }),

  // ============================================
  // Trusted Devices
  // ============================================

  // Get all trusted devices for the current user
  getTrustedDevices: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Clean up expired devices first
    await ctx.db
      .delete(trustedDevices)
      .where(
        and(
          eq(trustedDevices.userId, userId),
          lt(trustedDevices.expiresAt, new Date()),
        ),
      );

    const devices = await ctx.db.query.trustedDevices.findMany({
      where: eq(trustedDevices.userId, userId),
      orderBy: [desc(trustedDevices.lastUsed)],
    });

    return devices.map((device) => ({
      id: device.id,
      userAgent: device.userAgent,
      ipAddress: device.ipAddress,
      lastUsed: device.lastUsed,
      expiresAt: device.expiresAt,
      createdAt: device.createdAt,
    }));
  }),

  // Remove a trusted device
  removeTrustedDevice: protectedProcedure
    .input(
      z.object({
        deviceId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Check that the device belongs to the user
      const device = await ctx.db.query.trustedDevices.findFirst({
        where: and(
          eq(trustedDevices.id, input.deviceId),
          eq(trustedDevices.userId, userId),
        ),
      });

      if (!device) {
        throw new Error(await tr("serverErrors", "security.deviceNotFound"));
      }

      await ctx.db
        .delete(trustedDevices)
        .where(eq(trustedDevices.id, input.deviceId));

      return { success: true };
    }),

  // Remove all trusted devices
  removeAllTrustedDevices: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    await ctx.db
      .delete(trustedDevices)
      .where(eq(trustedDevices.userId, userId));

    return { success: true };
  }),

  // ============================================
  // Password Management
  // ============================================

  // Check if user has a password set
  hasPassword: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const credentialAccount = await ctx.db.query.accounts.findFirst({
      where: and(
        eq(accounts.userId, userId),
        eq(accounts.providerId, "credential"),
      ),
    });

    return {
      hasPassword: !!credentialAccount?.password,
    };
  }),

  // ============================================
  // Login History / Audit Log
  // ============================================

  // Get login history (from sessions)
  getLoginHistory: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(5).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Get all sessions including expired ones (for history)
      const allSessions = await ctx.db.query.sessions.findMany({
        where: eq(sessions.userId, userId),
        orderBy: [desc(sessions.createdAt)],
        limit: input.limit,
      });

      return allSessions.map((session) => ({
        id: session.id,
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        isActive: new Date(session.expiresAt) > new Date(),
        isCurrent: session.token === ctx.session.session.token,
      }));
    }),

  // ============================================
  // Security Summary
  // ============================================

  // Get overall security status
  getSecuritySummary: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [
      user,
      userAccounts,
      userPasskeys,
      twoFactor,
      devices,
      activeSessions,
    ] = await Promise.all([
      ctx.db.query.users.findFirst({ where: eq(users.id, userId) }),
      ctx.db.query.accounts.findMany({ where: eq(accounts.userId, userId) }),
      ctx.db.query.passkeys.findMany({ where: eq(passkeys.userId, userId) }),
      ctx.db.query.twoFactors.findFirst({
        where: eq(twoFactors.userId, userId),
      }),
      ctx.db.query.trustedDevices.findMany({
        where: and(
          eq(trustedDevices.userId, userId),
          // Only count non-expired devices
        ),
      }),
      ctx.db.query.sessions.findMany({ where: eq(sessions.userId, userId) }),
    ]);

    const hasPassword = userAccounts.some((a) => a.providerId === "credential");
    const oauthProviders = userAccounts
      .filter((a) => a.providerId !== "credential")
      .map((a) => a.providerId);

    // Calculate security score (0-100)
    let securityScore = 0;
    const recommendations: string[] = [];

    // Password or OAuth (20 points)
    if (hasPassword || oauthProviders.length > 0) {
      securityScore += 20;
    } else {
      recommendations.push(
        await tr("serverErrors", "security.rec.addLoginMethod"),
      );
    }

    // Email verified (15 points)
    if (user?.emailVerified) {
      securityScore += 15;
    } else {
      recommendations.push(
        await tr("serverErrors", "security.rec.verifyEmail"),
      );
    }

    // 2FA enabled (30 points)
    if (user?.twoFactorEnabled && twoFactor) {
      securityScore += 30;
    } else {
      recommendations.push(await tr("serverErrors", "security.rec.enable2fa"));
    }

    // Passkey (20 points)
    if (userPasskeys.length > 0) {
      securityScore += 20;
    } else {
      recommendations.push(await tr("serverErrors", "security.rec.addPasskey"));
    }

    // Multiple login methods (15 points)
    const loginMethodCount =
      (hasPassword ? 1 : 0) +
      oauthProviders.length +
      userPasskeys.length +
      (user?.phoneNumber ? 1 : 0);

    if (loginMethodCount >= 2) {
      securityScore += 15;
    } else {
      recommendations.push(await tr("serverErrors", "security.rec.addMore"));
    }

    return {
      securityScore,
      recommendations,
      stats: {
        hasPassword,
        oauthProviders,
        passkeyCount: userPasskeys.length,
        twoFactorEnabled: user?.twoFactorEnabled ?? false,
        trustedDeviceCount: devices.filter(
          (d) => new Date(d.expiresAt) > new Date(),
        ).length,
        activeSessionCount: activeSessions.filter(
          (s) => new Date(s.expiresAt) > new Date(),
        ).length,
        phoneVerified: user?.phoneNumberVerified ?? false,
        emailVerified: user?.emailVerified ?? false,
      },
    };
  }),
});

// Helper function to mask phone number
function maskPhoneNumber(phone: string): string {
  if (phone.length < 6) return phone;
  const visibleEnd = phone.slice(-4);
  const masked = "*".repeat(phone.length - 4);
  return masked + visibleEnd;
}
