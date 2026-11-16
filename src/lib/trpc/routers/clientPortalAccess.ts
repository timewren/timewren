import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
// Portal links always use the MARKETING host (timetrack.dk) — after the
// app.* subdomain split, portal pages live on the marketing host, and links
// in customer emails must not point at the app host.
import { getMarketingUrl } from "@/lib/config";
import {
  clientPortalAccess,
  clientPortalSessions,
  clients,
  companyProfiles,
  portalActivityLogs,
  users,
} from "@/lib/db/schema";
import { sendPortalInvitationEmail } from "@/lib/email/portal";
import {
  clearedPortalAccessTokenFields,
  portalAccessTokenFields,
  readPortalAccessToken,
} from "@/lib/portal/access-token";
import { hashToken } from "@/lib/security/token-hash";
import { trackEvent } from "@/lib/telemetry/track";
import { protectedProcedure, router } from "../trpc";
import { assertClientAccess, getAccessibleClientIds } from "./clientAccess";

// Generate secure token
function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

// Generate session token
function _generateSessionToken(): string {
  return crypto.randomBytes(48).toString("base64url");
}

// Send the portal invitation email. A mail failure must never roll back the
// created access, so errors are logged and swallowed. Returns whether the
// invitation was actually sent.
async function sendInvitation(
  db: typeof import("@/lib/db").db,
  params: {
    userId: string;
    orgId: string | null;
    to: string | null | undefined;
    clientName: string;
    clientId: string;
    portalUrl: string;
    accessType: "account" | "token";
    loginEmail?: string;
  },
): Promise<boolean> {
  if (!params.to) return false;
  try {
    // Sender identity prefers the org's company profile (consistent with
    // invoice emails) and falls back to the creating user.
    const [user, companyProfile] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.id, params.userId),
        columns: { name: true, email: true },
      }),
      db.query.companyProfiles.findFirst({
        where: params.orgId
          ? eq(companyProfiles.organizationId, params.orgId)
          : eq(companyProfiles.userId, params.userId),
        columns: { name: true, email: true },
      }),
    ]);

    await sendPortalInvitationEmail({
      to: params.to,
      clientName: params.clientName,
      senderName: companyProfile?.name || user?.name || "TimeTrack",
      senderEmail: companyProfile?.email || user?.email || "",
      portalUrl: params.portalUrl,
      accessType: params.accessType,
      loginEmail: params.loginEmail,
      userId: params.userId,
      clientId: params.clientId,
    });
    return true;
  } catch (err) {
    console.error("[Portal] Kunne ikke sende invitationsmail:", err);
    return false;
  }
}

// Token-hashes og krypterede tokens sendes ikke ud i lister (#713) — linket
// hentes via getPortalUrl.
const SECRET_COLUMNS_HIDDEN = {
  accessTokenHash: false,
  accessTokenEncrypted: false,
  emailVerificationTokenHash: false,
} as const;

export const clientPortalAccessRouter = router({
  // List all portal access entries for freelancer's clients
  list: protectedProcedure
    .input(
      z.object({
        includeInactive: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Et scoped medlem må kun se portaladgange for sine egne klienter —
      // ellers kan hele org'ens kundeliste opregnes herfra. Solo-brugere har
      // ingen org og dermed ingen begrænsning; null = ubegrænset medlem.
      // Filtreres i DB'en, ikke bagefter, så en fremtidig limit/paginering
      // ikke kommer til at tælle rækker brugeren alligevel ikke må se.
      let clientScope: ReturnType<typeof inArray> | undefined;
      if (ctx.orgId) {
        const accessibleIds = await getAccessibleClientIds(
          ctx.db,
          userId,
          ctx.orgId,
        );
        if (accessibleIds !== null) {
          // Ingen tildelte klienter → intet at vise. inArray med tom liste er
          // ikke veldefineret i Drizzle, så det korte svar gives her.
          if (accessibleIds.length === 0) return [];
          clientScope = inArray(clientPortalAccess.clientId, accessibleIds);
        }
      }

      const accesses = await ctx.db.query.clientPortalAccess.findMany({
        where: and(
          ctx.orgId
            ? eq(clientPortalAccess.organizationId, ctx.orgId)
            : eq(clientPortalAccess.freelancerId, userId),
          input.includeInactive
            ? undefined
            : eq(clientPortalAccess.isActive, true),
          clientScope,
        ),
        columns: SECRET_COLUMNS_HIDDEN,
        with: {
          client: true,
        },
        orderBy: [desc(clientPortalAccess.createdAt)],
      });

      return accesses;
    }),

  // Get portal access for a specific client
  getByClientId: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Org-filteret nedenfor stopper kun fremmede organisationer. Et medlem
      // med begrænset klientadgang skal også afvises her, ellers kan det læse
      // eller udstede portaladgang for en klient det ikke har fået tildelt.
      await assertClientAccess(ctx.db, userId, ctx.orgId, input.clientId);

      // Verify client belongs to user
      const client = await ctx.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.clientId),
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
        ),
      });

      if (!client) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.clientNotFound"),
        });
      }

      const access = await ctx.db.query.clientPortalAccess.findFirst({
        where: and(
          eq(clientPortalAccess.clientId, input.clientId),
          ctx.orgId
            ? eq(clientPortalAccess.organizationId, ctx.orgId)
            : eq(clientPortalAccess.freelancerId, userId),
        ),
        columns: SECRET_COLUMNS_HIDDEN,
        with: {
          client: true,
          sessions: {
            columns: { sessionTokenHash: false },
          },
        },
      });

      return access;
    }),

  // Create token-based access for a client
  createTokenAccess: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        expiresInDays: z.number().min(1).max(365).optional(),
        permissions: z
          .object({
            canViewInvoices: z.boolean().default(true),
            canViewProjects: z.boolean().default(true),
            canViewTimeEntries: z.boolean().default(true),
            canViewPrepaid: z.boolean().default(true),
            canApproveTime: z.boolean().default(false),
            canDownloadInvoices: z.boolean().default(true),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Org-filteret nedenfor stopper kun fremmede organisationer. Et medlem
      // med begrænset klientadgang skal også afvises her, ellers kan det læse
      // eller udstede portaladgang for en klient det ikke har fået tildelt.
      await assertClientAccess(ctx.db, userId, ctx.orgId, input.clientId);

      // Verify client belongs to user
      const client = await ctx.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.clientId),
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
        ),
      });

      if (!client) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.clientNotFound"),
        });
      }

      // Check if access already exists
      const existing = await ctx.db.query.clientPortalAccess.findFirst({
        where: and(
          eq(clientPortalAccess.clientId, input.clientId),
          ctx.orgId
            ? eq(clientPortalAccess.organizationId, ctx.orgId)
            : eq(clientPortalAccess.freelancerId, userId),
        ),
      });

      const accessToken = generateToken();
      const tokenExpiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      const portalUrl = `${getMarketingUrl()}/portal/t/${accessToken}`;

      if (existing) {
        // Update existing access
        const [updated] = await ctx.db
          .update(clientPortalAccess)
          .set({
            accessType: "token",
            ...portalAccessTokenFields(accessToken),
            tokenExpiresAt,
            isActive: true,
            ...input.permissions,
            updatedAt: new Date(),
          })
          .where(eq(clientPortalAccess.id, existing.id))
          .returning();
        trackEvent({
          userId: ctx.session.user.id,
          orgId: ctx.orgId,
          event: "portal.access_created",
          metadata: { accessType: "token" },
        });

        const emailSent = await sendInvitation(ctx.db, {
          userId,
          orgId: ctx.orgId ?? null,
          to: client.email,
          clientName: client.name,
          clientId: client.id,
          portalUrl,
          accessType: "token",
        });

        return { access: updated, isNew: false, emailSent };
      }

      // Create new access
      const [created] = await ctx.db
        .insert(clientPortalAccess)
        .values({
          clientId: input.clientId,
          freelancerId: userId,
          organizationId: ctx.orgId ?? null,
          accessType: "token",
          ...portalAccessTokenFields(accessToken),
          tokenExpiresAt,
          ...input.permissions,
        })
        .returning();
      trackEvent({
        userId: ctx.session.user.id,
        orgId: ctx.orgId,
        event: "portal.access_created",
        metadata: { accessType: "token" },
      });

      const emailSent = await sendInvitation(ctx.db, {
        userId,
        orgId: ctx.orgId ?? null,
        to: client.email,
        clientName: client.name,
        clientId: client.id,
        portalUrl,
        accessType: "token",
      });

      return { access: created, isNew: true, emailSent };
    }),

  // Create account-based access for a client
  createAccountAccess: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        email: z.string().email(),
        password: z.string().min(8),
        permissions: z
          .object({
            canViewInvoices: z.boolean().default(true),
            canViewProjects: z.boolean().default(true),
            canViewTimeEntries: z.boolean().default(true),
            canViewPrepaid: z.boolean().default(true),
            canApproveTime: z.boolean().default(false),
            canDownloadInvoices: z.boolean().default(true),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Org-filteret nedenfor stopper kun fremmede organisationer. Et medlem
      // med begrænset klientadgang skal også afvises her, ellers kan det læse
      // eller udstede portaladgang for en klient det ikke har fået tildelt.
      await assertClientAccess(ctx.db, userId, ctx.orgId, input.clientId);

      // Verify client belongs to user
      const client = await ctx.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.clientId),
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
        ),
      });

      if (!client) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.clientNotFound"),
        });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(input.password, 10);
      const emailVerificationToken = generateToken();

      // Check if access already exists
      const existing = await ctx.db.query.clientPortalAccess.findFirst({
        where: and(
          eq(clientPortalAccess.clientId, input.clientId),
          ctx.orgId
            ? eq(clientPortalAccess.organizationId, ctx.orgId)
            : eq(clientPortalAccess.freelancerId, userId),
        ),
      });

      if (existing) {
        // Update existing access
        const [updated] = await ctx.db
          .update(clientPortalAccess)
          .set({
            accessType: "account",
            email: input.email,
            passwordHash,
            emailVerified: false,
            emailVerificationTokenHash: hashToken(emailVerificationToken),
            ...clearedPortalAccessTokenFields,
            tokenExpiresAt: null,
            isActive: true,
            ...input.permissions,
            updatedAt: new Date(),
          })
          .where(eq(clientPortalAccess.id, existing.id))
          .returning();

        const emailSent = await sendInvitation(ctx.db, {
          userId,
          orgId: ctx.orgId ?? null,
          to: input.email,
          clientName: client.name,
          clientId: client.id,
          portalUrl: `${getMarketingUrl()}/portal/login`,
          accessType: "account",
          loginEmail: input.email,
        });

        return {
          access: updated,
          isNew: false,
          emailVerificationToken,
          emailSent,
        };
      }

      // Create new access
      const [created] = await ctx.db
        .insert(clientPortalAccess)
        .values({
          clientId: input.clientId,
          freelancerId: userId,
          organizationId: ctx.orgId ?? null,
          accessType: "account",
          email: input.email,
          passwordHash,
          emailVerificationTokenHash: hashToken(emailVerificationToken),
          ...input.permissions,
        })
        .returning();

      const emailSent = await sendInvitation(ctx.db, {
        userId,
        orgId: ctx.orgId ?? null,
        to: input.email,
        clientName: client.name,
        clientId: client.id,
        portalUrl: `${getMarketingUrl()}/portal/login`,
        accessType: "account",
        loginEmail: input.email,
      });

      return {
        access: created,
        isNew: true,
        emailVerificationToken,
        emailSent,
      };
    }),

  // Regenerate access token
  regenerateToken: protectedProcedure
    .input(
      z.object({
        accessId: z.string().uuid(),
        expiresInDays: z.number().min(1).max(365).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify access belongs to user
      const access = await ctx.db.query.clientPortalAccess.findFirst({
        where: and(
          eq(clientPortalAccess.id, input.accessId),
          ctx.orgId
            ? eq(clientPortalAccess.organizationId, ctx.orgId)
            : eq(clientPortalAccess.freelancerId, userId),
        ),
      });

      if (!access) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "clientPortal.accessNotFound"),
        });
      }
      // Per-medlem klientadgang: org-filteret ovenfor er ikke nok — et scoped
      // medlem må ikke kunne røre portaladgang for en klient det ikke er
      // tildelt, blot ved at kende accessId'et.
      await assertClientAccess(ctx.db, userId, ctx.orgId, access.clientId);

      const newToken = generateToken();
      const tokenExpiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      const [updated] = await ctx.db
        .update(clientPortalAccess)
        .set({
          ...portalAccessTokenFields(newToken),
          tokenExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(clientPortalAccess.id, input.accessId))
        .returning();

      return updated;
    }),

  // Update permissions
  updatePermissions: protectedProcedure
    .input(
      z.object({
        accessId: z.string().uuid(),
        canViewInvoices: z.boolean().optional(),
        canViewProjects: z.boolean().optional(),
        canViewTimeEntries: z.boolean().optional(),
        canViewPrepaid: z.boolean().optional(),
        canApproveTime: z.boolean().optional(),
        canDownloadInvoices: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { accessId, ...permissions } = input;

      // Verify access belongs to user
      const access = await ctx.db.query.clientPortalAccess.findFirst({
        where: and(
          eq(clientPortalAccess.id, accessId),
          ctx.orgId
            ? eq(clientPortalAccess.organizationId, ctx.orgId)
            : eq(clientPortalAccess.freelancerId, userId),
        ),
      });

      if (!access) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "clientPortal.accessNotFound"),
        });
      }
      // Per-medlem klientadgang: org-filteret ovenfor er ikke nok — et scoped
      // medlem må ikke kunne røre portaladgang for en klient det ikke er
      // tildelt, blot ved at kende accessId'et.
      await assertClientAccess(ctx.db, userId, ctx.orgId, access.clientId);

      const [updated] = await ctx.db
        .update(clientPortalAccess)
        .set({
          ...permissions,
          updatedAt: new Date(),
        })
        .where(eq(clientPortalAccess.id, accessId))
        .returning();

      return updated;
    }),

  // Deactivate access
  deactivate: protectedProcedure
    .input(z.object({ accessId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify access belongs to user
      const access = await ctx.db.query.clientPortalAccess.findFirst({
        where: and(
          eq(clientPortalAccess.id, input.accessId),
          ctx.orgId
            ? eq(clientPortalAccess.organizationId, ctx.orgId)
            : eq(clientPortalAccess.freelancerId, userId),
        ),
      });

      if (!access) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "clientPortal.accessNotFound"),
        });
      }
      // Per-medlem klientadgang: org-filteret ovenfor er ikke nok — et scoped
      // medlem må ikke kunne røre portaladgang for en klient det ikke er
      // tildelt, blot ved at kende accessId'et.
      await assertClientAccess(ctx.db, userId, ctx.orgId, access.clientId);

      // Delete all sessions
      await ctx.db
        .delete(clientPortalSessions)
        .where(eq(clientPortalSessions.portalAccessId, input.accessId));

      const [updated] = await ctx.db
        .update(clientPortalAccess)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(clientPortalAccess.id, input.accessId))
        .returning();

      return updated;
    }),

  // Reactivate access
  reactivate: protectedProcedure
    .input(z.object({ accessId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Adgangen skal slås op FØR opdateringen: klient-tjekket kan ikke laves
      // på resultatet, for så var rækken allerede genaktiveret.
      const existing = await ctx.db.query.clientPortalAccess.findFirst({
        where: and(
          eq(clientPortalAccess.id, input.accessId),
          ctx.orgId
            ? eq(clientPortalAccess.organizationId, ctx.orgId)
            : eq(clientPortalAccess.freelancerId, userId),
        ),
        columns: { clientId: true },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "clientPortal.accessNotFound"),
        });
      }
      await assertClientAccess(ctx.db, userId, ctx.orgId, existing.clientId);

      const [updated] = await ctx.db
        .update(clientPortalAccess)
        .set({
          isActive: true,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(clientPortalAccess.id, input.accessId),
            ctx.orgId
              ? eq(clientPortalAccess.organizationId, ctx.orgId)
              : eq(clientPortalAccess.freelancerId, userId),
          ),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "clientPortal.accessNotFound"),
        });
      }

      return updated;
    }),

  // Delete access completely
  delete: protectedProcedure
    .input(z.object({ accessId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify access belongs to user
      const access = await ctx.db.query.clientPortalAccess.findFirst({
        where: and(
          eq(clientPortalAccess.id, input.accessId),
          ctx.orgId
            ? eq(clientPortalAccess.organizationId, ctx.orgId)
            : eq(clientPortalAccess.freelancerId, userId),
        ),
      });

      if (!access) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "clientPortal.accessNotFound"),
        });
      }
      // Per-medlem klientadgang: org-filteret ovenfor er ikke nok — et scoped
      // medlem må ikke kunne røre portaladgang for en klient det ikke er
      // tildelt, blot ved at kende accessId'et.
      await assertClientAccess(ctx.db, userId, ctx.orgId, access.clientId);

      // Delete sessions first (cascade should handle this, but be explicit)
      await ctx.db
        .delete(clientPortalSessions)
        .where(eq(clientPortalSessions.portalAccessId, input.accessId));

      // Delete activity logs
      await ctx.db
        .delete(portalActivityLogs)
        .where(eq(portalActivityLogs.portalAccessId, input.accessId));

      // Delete access
      await ctx.db
        .delete(clientPortalAccess)
        .where(eq(clientPortalAccess.id, input.accessId));

      return { success: true };
    }),

  // Get activity log for a client's portal access
  getActivityLog: protectedProcedure
    .input(
      z.object({
        accessId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify access belongs to user
      const access = await ctx.db.query.clientPortalAccess.findFirst({
        where: and(
          eq(clientPortalAccess.id, input.accessId),
          ctx.orgId
            ? eq(clientPortalAccess.organizationId, ctx.orgId)
            : eq(clientPortalAccess.freelancerId, userId),
        ),
      });

      if (!access) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "clientPortal.accessNotFound"),
        });
      }
      // Per-medlem klientadgang: org-filteret ovenfor er ikke nok — et scoped
      // medlem må ikke kunne røre portaladgang for en klient det ikke er
      // tildelt, blot ved at kende accessId'et.
      await assertClientAccess(ctx.db, userId, ctx.orgId, access.clientId);

      const logs = await ctx.db.query.portalActivityLogs.findMany({
        where: eq(portalActivityLogs.portalAccessId, input.accessId),
        orderBy: [desc(portalActivityLogs.createdAt)],
        limit: input.limit,
      });

      return logs;
    }),

  // Get all portal activity for freelancer
  getAllActivity: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // In an org, show activity for ALL the org's portal accesses (whole team),
      // not just those created by the caller. portalActivityLogs has no org
      // column, so resolve the org's access ids and filter by them.
      let activityFilter = eq(portalActivityLogs.freelancerId, userId);
      if (ctx.orgId) {
        const orgAccesses = await ctx.db.query.clientPortalAccess.findMany({
          where: eq(clientPortalAccess.organizationId, ctx.orgId),
          columns: { id: true, clientId: true },
        });
        // Scoped medlem: kun aktivitet for egne klienter. null = ubegrænset.
        const accessibleIds = await getAccessibleClientIds(
          ctx.db,
          userId,
          ctx.orgId,
        );
        const visible =
          accessibleIds === null
            ? orgAccesses
            : orgAccesses.filter((a) => accessibleIds.includes(a.clientId));
        if (visible.length === 0) return [];
        activityFilter = inArray(
          portalActivityLogs.portalAccessId,
          visible.map((a) => a.id),
        );
      }

      const logs = await ctx.db.query.portalActivityLogs.findMany({
        where: activityFilter,
        orderBy: [desc(portalActivityLogs.createdAt)],
        limit: input.limit,
        with: {
          portalAccess: {
            with: {
              client: true,
            },
          },
        },
      });

      return logs;
    }),

  // Get portal URL for a client
  getPortalUrl: protectedProcedure
    .input(z.object({ accessId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const access = await ctx.db.query.clientPortalAccess.findFirst({
        where: and(
          eq(clientPortalAccess.id, input.accessId),
          ctx.orgId
            ? eq(clientPortalAccess.organizationId, ctx.orgId)
            : eq(clientPortalAccess.freelancerId, userId),
        ),
      });

      if (!access) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "clientPortal.accessNotFound"),
        });
      }
      // Per-medlem klientadgang: org-filteret ovenfor er ikke nok — et scoped
      // medlem må ikke kunne røre portaladgang for en klient det ikke er
      // tildelt, blot ved at kende accessId'et.
      await assertClientAccess(ctx.db, userId, ctx.orgId, access.clientId);

      // Portal-links skal pege på marketing-hosten — /portal bor der efter
      // subdomæne-splittet (app.* redirecter bare tilbage).
      const baseUrl = getMarketingUrl();

      const accessToken = readPortalAccessToken(access);
      if (access.accessType === "token" && accessToken) {
        return {
          url: `${baseUrl}/portal/t/${accessToken}`,
          type: "token" as const,
        };
      }

      return {
        url: `${baseUrl}/portal/login`,
        type: "account" as const,
      };
    }),
});
