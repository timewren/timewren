import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { getAppUrl } from "@/lib/config";
import {
  clientPortalAccess,
  clientPortalSessions,
  clients,
  companyProfiles,
  invoices,
  portalActivityLogs,
  portalBranding,
  prepaidPackages,
  prepaidRenewalRequests,
  prepaidUsage,
  projects,
  timeApprovalRequests,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { toLocalDateStr } from "@/lib/format";
import { isUnbilledEntry } from "@/lib/invoicing/unbilled";
import { hashToken, tokenLookup } from "@/lib/security/token-hash";
import { trackEvent } from "@/lib/telemetry/track";
import { dateUpperBound } from "@/lib/time/date-bounds";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";
import { badRequest, forbidden, notFound } from "../errors";
import { publicProcedure, router } from "../trpc";

async function notifyFreelancerOfRenewalRequest(
  db: Parameters<typeof validateAccess>[0],
  freelancerId: string,
  packageName: string,
) {
  const { users: usersTable } = await import("@/lib/db/schema");
  const { eq: eqOp } = await import("drizzle-orm");
  const { DEFAULT_FROM_EMAIL, resend } = await import("@/lib/resend");
  const freelancer = await db.query.users.findFirst({
    where: eqOp(usersTable.id, freelancerId),
    columns: { email: true, name: true, locale: true },
  });
  if (!freelancer?.email) return;
  const { mailT } = await import("@/lib/email/locale");
  const { resolveMailBrand } = await import("@/lib/email/mail-brand");
  const mb = await resolveMailBrand({ userId: freelancerId });
  const t = mailT("emailsBilling", freelancer.locale, mb?.key);
  const response = await resend.emails.send({
    from: mb?.from ?? DEFAULT_FROM_EMAIL,
    to: freelancer.email,
    subject: t("renewalRequest.subject", { name: packageName }),
    text: t("renewalRequest.body", {
      name: freelancer.name,
      package: packageName,
      url: `${mb?.appUrl ?? getAppUrl()}/dashboard/klippekort`,
    }),
  });
  if (response.error) {
    console.error("[Portal] renewal-besked afvist:", response.error);
  }
}

// Generate session token
function generateSessionToken(): string {
  return crypto.randomBytes(48).toString("base64url");
}

// Session duration: 30 days
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

// Whitelist of portalBranding fields safe to expose to unauthenticated
// portal clients. Excludes secrets like `domainVerificationToken`.
type BrandingRow = typeof portalBranding.$inferSelect;
function pickPublicBranding(b: BrandingRow | null | undefined) {
  if (!b) return null;
  return {
    userId: b.userId,
    brandName: b.brandName,
    logoUrl: b.logoUrl,
    faviconUrl: b.faviconUrl,
    primaryColor: b.primaryColor,
    secondaryColor: b.secondaryColor,
    accentColor: b.accentColor,
    backgroundColor: b.backgroundColor,
    textColor: b.textColor,
    headingFont: b.headingFont,
    bodyFont: b.bodyFont,
    customDomain: b.customDomain,
    customDomainVerified: b.customDomainVerified,
    footerText: b.footerText,
    supportEmail: b.supportEmail,
    supportPhone: b.supportPhone,
    showInvoices: b.showInvoices,
    showProjects: b.showProjects,
    showTimeEntries: b.showTimeEntries,
    showPrepaid: b.showPrepaid,
  };
}

export const publicPortalRouter = router({
  // Validate token and create session (for token-based access)
  validateToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Rate limiting to prevent token brute-forcing
      const clientIp = ctx.headers ? getClientIp(ctx.headers) : "unknown";
      const rateLimitKey = ipRateLimitKey(clientIp, "portal.validateToken");
      await rateLimiter.checkOrThrow(rateLimitKey, "portalLogin");

      const access = await ctx.db.query.clientPortalAccess.findFirst({
        where: and(
          tokenLookup(clientPortalAccess.accessTokenHash, input.token),
          eq(clientPortalAccess.isActive, true),
          eq(clientPortalAccess.accessType, "token"),
          or(
            isNull(clientPortalAccess.tokenExpiresAt),
            gte(clientPortalAccess.tokenExpiresAt, new Date()),
          ),
        ),
        with: {
          client: true,
          freelancer: true,
        },
      });

      if (!access) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "portal.invalidLink"),
        });
      }

      // Create session
      const sessionToken = generateSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

      // Kun hashen gemmes (#713); klienten får tokenet i svaret.
      await ctx.db.insert(clientPortalSessions).values({
        portalAccessId: access.id,
        sessionTokenHash: hashToken(sessionToken),
        expiresAt,
      });

      // Get branding — prefer the org's branding for an org client, so the
      // portal looks the same regardless of which member set up the access.
      const branding = await ctx.db.query.portalBranding.findFirst({
        where: access.client.organizationId
          ? eq(portalBranding.organizationId, access.client.organizationId)
          : eq(portalBranding.userId, access.freelancerId),
      });

      // Update last accessed
      await ctx.db
        .update(clientPortalAccess)
        .set({
          lastAccessedAt: new Date(),
          accessCount: (access.accessCount || 0) + 1,
        })
        .where(eq(clientPortalAccess.id, access.id));

      // Log activity
      await ctx.db.insert(portalActivityLogs).values({
        portalAccessId: access.id,
        freelancerId: access.freelancerId,
        action: "login",
        metadata: { method: "token" },
      });

      return {
        sessionToken,
        expiresAt,
        access: {
          id: access.id,
          clientId: access.clientId,
          clientName: access.client.name,
          freelancerName: access.freelancer.name,
          permissions: {
            canViewInvoices: access.canViewInvoices,
            canViewProjects: access.canViewProjects,
            canViewTimeEntries: access.canViewTimeEntries,
            canViewPrepaid: access.canViewPrepaid,
            canApproveTime: access.canApproveTime,
            canDownloadInvoices: access.canDownloadInvoices,
          },
        },
        branding: pickPublicBranding(branding),
      };
    }),

  // Login with email/password (for account-based access)
  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
        freelancerUserId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Rate limiting - check both IP and email to prevent brute-force
      const clientIp = ctx.headers ? getClientIp(ctx.headers) : "unknown";
      const ipRateKey = ipRateLimitKey(clientIp, "portal.login");
      const emailRateKey = `email:${input.email.toLowerCase()}:portal.login`;
      await rateLimiter.checkOrThrow(ipRateKey, "portalLogin");
      await rateLimiter.checkOrThrow(emailRateKey, "portalLogin");

      // Build query conditions — scope to specific freelancer on custom domains
      const conditions = [
        eq(clientPortalAccess.email, input.email.toLowerCase()),
        eq(clientPortalAccess.isActive, true),
        eq(clientPortalAccess.accessType, "account"),
      ];
      if (input.freelancerUserId) {
        conditions.push(
          eq(clientPortalAccess.freelancerId, input.freelancerUserId),
        );
      }

      const access = await ctx.db.query.clientPortalAccess.findFirst({
        where: and(...conditions),
        with: {
          client: true,
          freelancer: true,
        },
      });

      if (!access?.passwordHash) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "portal.invalidLogin"),
        });
      }

      // Verify password
      const isValid = await bcrypt.compare(input.password, access.passwordHash);
      if (!isValid) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "portal.invalidLogin"),
        });
      }

      // Create session
      const sessionToken = generateSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

      // Kun hashen gemmes (#713); klienten får tokenet i svaret.
      await ctx.db.insert(clientPortalSessions).values({
        portalAccessId: access.id,
        sessionTokenHash: hashToken(sessionToken),
        expiresAt,
      });

      // Update last accessed
      await ctx.db
        .update(clientPortalAccess)
        .set({
          lastAccessedAt: new Date(),
          accessCount: (access.accessCount || 0) + 1,
        })
        .where(eq(clientPortalAccess.id, access.id));

      // Log activity
      await ctx.db.insert(portalActivityLogs).values({
        portalAccessId: access.id,
        freelancerId: access.freelancerId,
        action: "login",
        metadata: { method: "account" },
      });

      // Get branding — prefer the org's branding for an org client, so the
      // portal looks the same regardless of which member set up the access.
      const branding = await ctx.db.query.portalBranding.findFirst({
        where: access.client.organizationId
          ? eq(portalBranding.organizationId, access.client.organizationId)
          : eq(portalBranding.userId, access.freelancerId),
      });

      return {
        sessionToken,
        expiresAt,
        access: {
          id: access.id,
          clientId: access.clientId,
          clientName: access.client.name,
          freelancerName: access.freelancer.name,
          permissions: {
            canViewInvoices: access.canViewInvoices,
            canViewProjects: access.canViewProjects,
            canViewTimeEntries: access.canViewTimeEntries,
            canViewPrepaid: access.canViewPrepaid,
            canApproveTime: access.canApproveTime,
            canDownloadInvoices: access.canDownloadInvoices,
          },
        },
        branding: pickPublicBranding(branding),
      };
    }),

  // Validate session token
  validateSession: publicProcedure
    .input(z.object({ sessionToken: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.query.clientPortalSessions.findFirst({
        where: and(
          tokenLookup(
            clientPortalSessions.sessionTokenHash,
            input.sessionToken,
          ),
          gte(clientPortalSessions.expiresAt, new Date()),
        ),
        with: {
          portalAccess: {
            with: {
              client: true,
              freelancer: true,
            },
          },
        },
      });

      if (!session?.portalAccess.isActive) {
        return { valid: false };
      }

      // Get branding — org branding for an org client (see validateToken).
      const branding = await ctx.db.query.portalBranding.findFirst({
        where: session.portalAccess.client.organizationId
          ? eq(
              portalBranding.organizationId,
              session.portalAccess.client.organizationId,
            )
          : eq(portalBranding.userId, session.portalAccess.freelancerId),
      });

      return {
        valid: true,
        access: {
          id: session.portalAccess.id,
          clientId: session.portalAccess.clientId,
          clientName: session.portalAccess.client.name,
          freelancerName: session.portalAccess.freelancer.name,
          permissions: {
            canViewInvoices: session.portalAccess.canViewInvoices,
            canViewProjects: session.portalAccess.canViewProjects,
            canViewTimeEntries: session.portalAccess.canViewTimeEntries,
            canViewPrepaid: session.portalAccess.canViewPrepaid,
            canApproveTime: session.portalAccess.canApproveTime,
            canDownloadInvoices: session.portalAccess.canDownloadInvoices,
          },
        },
        branding: pickPublicBranding(branding),
      };
    }),

  // Logout
  logout: publicProcedure
    .input(z.object({ sessionToken: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(clientPortalSessions)
        .where(
          tokenLookup(
            clientPortalSessions.sessionTokenHash,
            input.sessionToken,
          ),
        );

      return { success: true };
    }),

  // Get invoices for client
  getInvoices: publicProcedure
    .input(
      z.object({
        accessToken: z.string().optional(),
        sessionToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await validateAccess(ctx.db, input);
      if (!access?.canViewInvoices) {
        throw forbidden(await tr("serverErrors", "portal.noInvoiceAccess"));
      }

      // SECURITY: Verify both clientId AND userId to prevent IDOR attacks
      const clientInvoices = await ctx.db.query.invoices.findMany({
        where: and(
          eq(invoices.clientId, access.clientId),
          access.organizationId
            ? eq(invoices.organizationId, access.organizationId)
            : eq(invoices.userId, access.freelancerId),
        ),
        orderBy: [desc(invoices.issueDate)],
      });

      // Log activity
      await ctx.db.insert(portalActivityLogs).values({
        portalAccessId: access.id,
        freelancerId: access.freelancerId,
        action: "view_invoices",
      });

      return clientInvoices;
    }),

  // Get single invoice
  getInvoice: publicProcedure
    .input(
      z.object({
        invoiceId: z.string().uuid(),
        accessToken: z.string().optional(),
        sessionToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await validateAccess(ctx.db, input);
      if (!access?.canViewInvoices) {
        throw forbidden(await tr("serverErrors", "portal.noInvoiceAccess"));
      }

      // SECURITY: Verify both clientId AND userId to prevent IDOR attacks
      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(
          eq(invoices.id, input.invoiceId),
          eq(invoices.clientId, access.clientId),
          access.organizationId
            ? eq(invoices.organizationId, access.organizationId)
            : eq(invoices.userId, access.freelancerId), // Prevent cross-freelancer access
        ),
      });

      if (!invoice) {
        throw notFound(await tr("serverErrors", "common.invoiceNotFound"));
      }

      // Log activity
      await ctx.db.insert(portalActivityLogs).values({
        portalAccessId: access.id,
        freelancerId: access.freelancerId,
        action: "view_invoice",
        entityType: "invoice",
        entityId: invoice.id,
        entityName: invoice.invoiceNumber,
      });

      return invoice;
    }),

  // Get projects for client
  getProjects: publicProcedure
    .input(
      z.object({
        accessToken: z.string().optional(),
        sessionToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await validateAccess(ctx.db, input);
      if (!access?.canViewProjects) {
        throw forbidden(await tr("serverErrors", "portal.noProjectAccess"));
      }

      // SECURITY: Include userId check to prevent IDOR
      const clientProjects = await ctx.db.query.projects.findMany({
        where: and(
          eq(projects.clientId, access.clientId),
          access.organizationId
            ? eq(projects.organizationId, access.organizationId)
            : eq(projects.userId, access.freelancerId),
        ),
        orderBy: [desc(projects.updatedAt)],
      });

      // Log activity
      await ctx.db.insert(portalActivityLogs).values({
        portalAccessId: access.id,
        freelancerId: access.freelancerId,
        action: "view_projects",
      });

      return clientProjects;
    }),

  // Get single project
  getProject: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        accessToken: z.string().optional(),
        sessionToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await validateAccess(ctx.db, input);
      if (!access?.canViewProjects) {
        throw forbidden(await tr("serverErrors", "portal.noProjectAccess"));
      }

      // SECURITY: Include userId check to prevent IDOR
      const project = await ctx.db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.clientId, access.clientId),
          access.organizationId
            ? eq(projects.organizationId, access.organizationId)
            : eq(projects.userId, access.freelancerId),
        ),
      });

      if (!project) {
        throw notFound(await tr("serverErrors", "common.projectNotFound"));
      }

      // Log activity
      await ctx.db.insert(portalActivityLogs).values({
        portalAccessId: access.id,
        freelancerId: access.freelancerId,
        action: "view_project",
        entityType: "project",
        entityId: project.id,
        entityName: project.name,
      });

      return project;
    }),

  // Get time entries for client
  getTimeEntries: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid().optional(),
        accessToken: z.string().optional(),
        sessionToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await validateAccess(ctx.db, input);
      if (!access?.canViewTimeEntries) {
        throw forbidden(await tr("serverErrors", "portal.noTimeAccess"));
      }

      // SECURITY: Include userId check to prevent IDOR
      const entries = await ctx.db.query.timeEntries.findMany({
        where: input.projectId
          ? and(
              eq(timeEntries.clientId, access.clientId),
              access.organizationId
                ? eq(timeEntries.organizationId, access.organizationId)
                : eq(timeEntries.userId, access.freelancerId),
              eq(timeEntries.projectId, input.projectId),
            )
          : and(
              eq(timeEntries.clientId, access.clientId),
              access.organizationId
                ? eq(timeEntries.organizationId, access.organizationId)
                : eq(timeEntries.userId, access.freelancerId),
            ),
        orderBy: [desc(timeEntries.date)],
        with: {
          project: true,
        },
      });

      // Log activity
      await ctx.db.insert(portalActivityLogs).values({
        portalAccessId: access.id,
        freelancerId: access.freelancerId,
        action: "view_time_entries",
        metadata: input.projectId ? { projectId: input.projectId } : undefined,
      });

      // Return entries without sensitive rate information
      return entries.map((entry) => ({
        id: entry.id,
        description: entry.description,
        hours: entry.hours,
        date: entry.date,
        projectName: entry.project?.name,
        isBilled: entry.isBilled,
        isPrepaid: entry.isPrepaid,
      }));
    }),

  // Get prepaid packages for client
  getPrepaidPackages: publicProcedure
    .input(
      z.object({
        accessToken: z.string().optional(),
        sessionToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await validateAccess(ctx.db, input);
      if (!access?.canViewPrepaid) {
        throw forbidden(await tr("serverErrors", "portal.noPrepaidAccess"));
      }

      // SECURITY: Include userId check to prevent IDOR.
      // Arkiverede kort er væk for kunden; deaktiverede kort returneres
      // stadig (isActive=false), så portalen kan vise dem som "tidligere"
      // med historik — men aldrig som aktive med forny-knap.
      const packages = await ctx.db.query.prepaidPackages.findMany({
        where: and(
          eq(prepaidPackages.clientId, access.clientId),
          access.organizationId
            ? eq(prepaidPackages.organizationId, access.organizationId)
            : eq(prepaidPackages.userId, access.freelancerId),
          // is_archived er nullable — NULL skal tælle som "ikke arkiveret"
          or(
            isNull(prepaidPackages.isArchived),
            eq(prepaidPackages.isArchived, false),
          ),
          // Eksplicit skjult for kunden (også under "Tidligere")
          eq(prepaidPackages.hiddenFromPortal, false),
        ),
        orderBy: [
          desc(prepaidPackages.isActive),
          desc(prepaidPackages.createdAt),
        ],
      });

      // Log activity
      await ctx.db.insert(portalActivityLogs).values({
        portalAccessId: access.id,
        freelancerId: access.freelancerId,
        action: "view_prepaid",
      });

      // Kontakt-email til genkøbs-CTA'en (#177) — companyProfile
      // foretrækkes, ellers freelancerens egen email
      const [contactProfile, freelancer] = await Promise.all([
        ctx.db.query.companyProfiles.findFirst({
          where: access.organizationId
            ? eq(companyProfiles.organizationId, access.organizationId)
            : eq(companyProfiles.userId, access.freelancerId),
          columns: { email: true },
        }),
        ctx.db.query.users.findFirst({
          where: eq(users.id, access.freelancerId),
          columns: { email: true },
        }),
      ]);

      // Return packages without sensitive rate information
      return {
        contactEmail: contactProfile?.email ?? freelancer?.email ?? null,
        packages: packages.map((pkg) => ({
          id: pkg.id,
          name: pkg.name,
          totalHours: pkg.totalHours,
          usedHours: pkg.usedHours,
          remainingHours: pkg.remainingHours,
          overdraftHours: pkg.overdraftHours,
          purchaseDate: pkg.purchaseDate,
          expiryDate: pkg.expiryDate,
          isActive: pkg.isActive,
          description: pkg.description,
        })),
      };
    }),

  // Genkøbs-anmodning (#80): kunden beder om fornyelse af en pakke —
  // freelanceren godkender med ét klik i dashboardet.
  requestRenewal: publicProcedure
    .input(
      z.object({
        accessToken: z.string().optional(),
        sessionToken: z.string().optional(),
        packageId: z.string().uuid(),
        message: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await validateAccess(ctx.db, input);
      if (!access?.canViewPrepaid) {
        throw forbidden(await tr("serverErrors", "portal.noPrepaidAccess"));
      }

      // Rate-limit pr. portal-adgang (misbrugsværn på offentlig flade)
      const rl = await rateLimiter.check(
        ipRateLimitKey(access.id, "portal-renewal"),
        "reportExport",
      );
      if (!rl.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: await tr("serverErrors", "portal.tooManyRequests"),
        });
      }

      // Pakken skal tilhøre portalens klient (IDOR-guard, samme som #177)
      // og være AKTIV (review-fund): en anmodning på en allerede fornyet/
      // arkiveret pakke ville no-op'e silent ved godkendelse.
      const pkg = await ctx.db.query.prepaidPackages.findFirst({
        where: and(
          eq(prepaidPackages.id, input.packageId),
          eq(prepaidPackages.clientId, access.clientId),
          eq(prepaidPackages.isActive, true),
          eq(prepaidPackages.hiddenFromPortal, false),
          access.organizationId
            ? eq(prepaidPackages.organizationId, access.organizationId)
            : eq(prepaidPackages.userId, access.freelancerId),
        ),
        columns: { id: true, name: true },
      });
      if (!pkg) {
        throw badRequest(await tr("serverErrors", "portal.prepaidInactive"));
      }

      // Dedup: én åben anmodning pr. pakke
      const existing = await ctx.db.query.prepaidRenewalRequests.findFirst({
        where: and(
          eq(prepaidRenewalRequests.prepaidPackageId, input.packageId),
          eq(prepaidRenewalRequests.status, "pending"),
        ),
        columns: { id: true },
      });
      if (existing) {
        return { alreadyRequested: true };
      }

      await ctx.db.insert(prepaidRenewalRequests).values({
        prepaidPackageId: input.packageId,
        clientId: access.clientId,
        freelancerId: access.freelancerId,
        organizationId: access.organizationId,
        portalAccessId: access.id,
        message: input.message?.trim() || null,
      });

      await ctx.db.insert(portalActivityLogs).values({
        portalAccessId: access.id,
        freelancerId: access.freelancerId,
        action: "request_renewal",
        entityType: "prepaid_package",
        entityId: pkg.id,
      });

      trackEvent({
        userId: access.freelancerId,
        orgId: access.organizationId,
        event: "prepaid.renewal_requested",
        source: "web",
      });

      // Besked til freelanceren — fire-and-forget (Resend kan mangle
      // på beta; anmodningen er allerede gemt)
      notifyFreelancerOfRenewalRequest(
        ctx.db,
        access.freelancerId,
        pkg.name,
      ).catch((err) => console.error("[Portal] renewal-besked fejlede:", err));

      return { alreadyRequested: false };
    }),

  // Forbrugshistorik pr. klippekort (#177): hvilke tidsposter trak klip.
  // Uden raten — kunden ser dato, beskrivelse og timer, ikke priser.
  getPrepaidUsage: publicProcedure
    .input(
      z.object({
        accessToken: z.string().optional(),
        sessionToken: z.string().optional(),
        packageId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await validateAccess(ctx.db, input);
      if (!access?.canViewPrepaid) {
        throw forbidden(await tr("serverErrors", "portal.noPrepaidAccess"));
      }

      // Pakken skal tilhøre portalens klient (IDOR-guard)
      const pkg = await ctx.db.query.prepaidPackages.findFirst({
        where: and(
          eq(prepaidPackages.id, input.packageId),
          eq(prepaidPackages.clientId, access.clientId),
          access.organizationId
            ? eq(prepaidPackages.organizationId, access.organizationId)
            : eq(prepaidPackages.userId, access.freelancerId),
        ),
        columns: { id: true },
      });
      if (!pkg) {
        throw notFound(await tr("serverErrors", "common.prepaidNotFound"));
      }

      // Audit-trail: freelanceren kan se at kunden kiggede paa forbruget
      await ctx.db.insert(portalActivityLogs).values({
        portalAccessId: access.id,
        freelancerId: access.freelancerId,
        action: "view_prepaid_usage",
        entityType: "prepaid_package",
        entityId: pkg.id,
      });

      const usage = await ctx.db.query.prepaidUsage.findMany({
        where: eq(prepaidUsage.prepaidPackageId, input.packageId),
        orderBy: [desc(prepaidUsage.createdAt)],
        with: {
          timeEntry: {
            columns: { date: true, description: true },
          },
        },
      });

      return usage.map((u) => ({
        id: u.id,
        date: u.timeEntry?.date ?? u.createdAt,
        description:
          u.timeEntry?.description ??
          u.description ??
          st("portal.manualDeduction"),
        hoursUsed: u.hoursUsed,
      }));
    }),

  // Get branding by custom domain
  getBrandingByDomain: publicProcedure
    .input(z.object({ domain: z.string() }))
    .query(async ({ ctx, input }) => {
      const branding = await ctx.db.query.portalBranding.findFirst({
        where: and(
          eq(portalBranding.customDomain, input.domain.toLowerCase()),
          eq(portalBranding.customDomainVerified, true),
        ),
      });

      return pickPublicBranding(branding);
    }),

  // Get time report summary for client
  getTimeReport: publicProcedure
    .input(
      z.object({
        accessToken: z.string().optional(),
        sessionToken: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        projectId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await validateAccess(ctx.db, input);
      if (!access?.canViewTimeEntries) {
        throw forbidden(await tr("serverErrors", "portal.noTimeAccess"));
      }

      // Build date conditions
      const conditions = [
        eq(timeEntries.clientId, access.clientId),
        access.organizationId
          ? eq(timeEntries.organizationId, access.organizationId)
          : eq(timeEntries.userId, access.freelancerId),
      ];

      if (input.startDate) {
        conditions.push(gte(timeEntries.date, new Date(input.startDate)));
      }
      if (input.endDate) {
        conditions.push(dateUpperBound(timeEntries.date, input.endDate));
      }
      if (input.projectId) {
        conditions.push(eq(timeEntries.projectId, input.projectId));
      }

      // "Hele perioden" er standard i portalen — loft så en kunde med års
      // historik ikke trækker alt ned i én tabel.
      const [entries, portalClient] = await Promise.all([
        ctx.db.query.timeEntries.findMany({
          where: and(...conditions),
          orderBy: [desc(timeEntries.date)],
          limit: 1000,
          with: {
            project: true,
          },
        }),
        ctx.db.query.clients.findFirst({
          where: eq(clients.id, access.clientId),
          columns: { defaultBillable: true },
        }),
      ]);

      // Calculate summary
      const totalHours = entries.reduce(
        (sum, e) => sum + Number.parseFloat(e.hours),
        0,
      );
      const billedHours = entries
        .filter((e) => e.isBilled)
        .reduce((sum, e) => sum + Number.parseFloat(e.hours), 0);
      // Ufaktureret: samme definition som resten af appen (#626). Var før
      // `total − faktureret`, så kunden så et andet — og højere — tal end
      // freelanceren selv: klippekort-timer talte med som ufakturerede
      // (stik imod kommentaren nedenfor), og det gjorde ikke-fakturerbar tid
      // og tid der afventer godkendelse også.
      // Alle poster her tilhører portalens ene kunde, så dens defaultBillable
      // gælder for dem alle.
      const unbilledHours = entries
        .filter((e) =>
          isUnbilledEntry({
            isBilled: e.isBilled,
            isBillable: e.isBillable,
            isPrepaid: e.isPrepaid,
            approvalStatus: e.approvalStatus,
            clientDefaultBillable: portalClient?.defaultBillable ?? null,
          }),
        )
        .reduce((sum, e) => sum + Number.parseFloat(e.hours), 0);
      // Timer dækket af klippekort — vises for kunden som "Via klippekort"
      // i stedet for at tælle som ufaktureret.
      const prepaidHours = entries
        .filter((e) => e.isPrepaid)
        .reduce((sum, e) => sum + Number.parseFloat(e.hours), 0);

      // Group by project
      const byProject = new Map<
        string,
        { name: string; hours: number; count: number }
      >();
      for (const entry of entries) {
        const projectKey = entry.projectId || "no-project";
        const projectName = entry.project?.name || st("common.noProject");
        const existing = byProject.get(projectKey) || {
          name: projectName,
          hours: 0,
          count: 0,
        };
        existing.hours += Number.parseFloat(entry.hours);
        existing.count += 1;
        byProject.set(projectKey, existing);
      }

      // Group by date
      const byDate = new Map<string, number>();
      for (const entry of entries) {
        const dateKey = toLocalDateStr(entry.date);
        byDate.set(
          dateKey,
          (byDate.get(dateKey) || 0) + Number.parseFloat(entry.hours),
        );
      }

      // Log activity
      await ctx.db.insert(portalActivityLogs).values({
        portalAccessId: access.id,
        freelancerId: access.freelancerId,
        action: "view_time_report",
        metadata: {
          startDate: input.startDate,
          endDate: input.endDate,
          projectId: input.projectId,
        },
      });

      return {
        summary: {
          totalHours,
          billedHours,
          unbilledHours,
          prepaidHours,
          entriesCount: entries.length,
        },
        byProject: Array.from(byProject.entries()).map(([id, data]) => ({
          projectId: id,
          projectName: data.name,
          hours: data.hours,
          entriesCount: data.count,
        })),
        byDate: Array.from(byDate.entries())
          .map(([date, hours]) => ({ date, hours }))
          .sort((a, b) => b.date.localeCompare(a.date)),
        entries: entries.map((entry) => ({
          id: entry.id,
          description: entry.description,
          hours: entry.hours,
          date: toLocalDateStr(entry.date),
          projectName: entry.project?.name || null,
          isBilled: entry.isBilled,
          isPrepaid: entry.isPrepaid,
        })),
      };
    }),

  // Get portal dashboard summary
  getDashboard: publicProcedure
    .input(
      z.object({
        accessToken: z.string().optional(),
        sessionToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await validateAccess(ctx.db, input);
      if (!access) {
        throw forbidden(await tr("serverErrors", "portal.noAccess"));
      }

      const summary: {
        invoices?: { total: number; unpaid: number; overdue: number };
        projects?: { total: number; active: number };
        prepaid?: { packages: number; totalRemaining: number };
        recentActivity?: Array<{
          type: string;
          date: Date;
          description: string;
        }>;
      } = {};

      // Invoices summary - SECURITY: Include userId check
      if (access.canViewInvoices) {
        const allInvoices = await ctx.db.query.invoices.findMany({
          where: and(
            eq(invoices.clientId, access.clientId),
            access.organizationId
              ? eq(invoices.organizationId, access.organizationId)
              : eq(invoices.userId, access.freelancerId),
          ),
        });

        summary.invoices = {
          total: allInvoices.length,
          unpaid: allInvoices.filter(
            (i) => i.status === "sent" || i.status === "draft",
          ).length,
          overdue: allInvoices.filter((i) => i.status === "overdue").length,
        };
      }

      // Projects summary - SECURITY: Include userId check
      if (access.canViewProjects) {
        const allProjects = await ctx.db.query.projects.findMany({
          where: and(
            eq(projects.clientId, access.clientId),
            access.organizationId
              ? eq(projects.organizationId, access.organizationId)
              : eq(projects.userId, access.freelancerId),
          ),
        });

        summary.projects = {
          total: allProjects.length,
          active: allProjects.filter((p) => p.status === "active").length,
        };
      }

      // Prepaid summary - SECURITY: Include userId check
      if (access.canViewPrepaid) {
        const allPackages = await ctx.db.query.prepaidPackages.findMany({
          where: and(
            eq(prepaidPackages.clientId, access.clientId),
            access.organizationId
              ? eq(prepaidPackages.organizationId, access.organizationId)
              : eq(prepaidPackages.userId, access.freelancerId),
            eq(prepaidPackages.isActive, true),
            eq(prepaidPackages.hiddenFromPortal, false),
          ),
        });

        summary.prepaid = {
          packages: allPackages.length,
          totalRemaining: allPackages.reduce(
            (sum, p) => sum + Number(p.remainingHours || 0),
            0,
          ),
        };
      }

      return summary;
    }),

  // List pending approval requests for this client portal
  getMyApprovalRequests: publicProcedure
    .input(
      z.object({
        accessToken: z.string().optional(),
        sessionToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const access = await validateAccess(ctx.db, input);
      if (!access) {
        throw forbidden(await tr("serverErrors", "portal.noAccess"));
      }

      const requests = await ctx.db.query.timeApprovalRequests.findMany({
        where: and(
          eq(timeApprovalRequests.clientId, access.clientId),
          // Org-klient: vis anmodninger fra hele teamet (ikke kun portal-
          // opretteren); solo: scopet til freelanceren. Jf. it.37-40.
          access.organizationId
            ? eq(timeApprovalRequests.organizationId, access.organizationId)
            : eq(timeApprovalRequests.userId, access.freelancerId),
          eq(timeApprovalRequests.status, "pending"),
        ),
        orderBy: [desc(timeApprovalRequests.createdAt)],
      });

      // Alle anmodningers poster i ét opslag i stedet for ét pr. anmodning
      // (#1115); rækkefølgen (nyeste dato først) bevares pr. anmodning.
      const allEntryIds = [
        ...new Set(requests.flatMap((r) => r.entryIds ?? [])),
      ];
      const allEntries =
        allEntryIds.length > 0
          ? await ctx.db.query.timeEntries.findMany({
              where: and(
                inArray(timeEntries.id, allEntryIds),
                access.organizationId
                  ? eq(timeEntries.organizationId, access.organizationId)
                  : eq(timeEntries.userId, access.freelancerId),
              ),
              with: { project: true },
              orderBy: [desc(timeEntries.date)],
            })
          : [];

      const result = requests.map((request) => {
        const entryIds = new Set(request.entryIds ?? []);
        return {
          ...request,
          entries: allEntries
            .filter((e) => entryIds.has(e.id))
            .map((e) => ({
              id: e.id,
              description: e.description,
              hours: e.hours,
              date: e.date,
              projectName: e.project?.name ?? null,
            })),
        };
      });

      return result;
    }),

  // Approve a request
  approveRequest: publicProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        note: z.string().optional(),
        accessToken: z.string().optional(),
        sessionToken: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await validateAccess(ctx.db, input);
      if (!access?.canApproveTime) {
        throw forbidden(await tr("serverErrors", "portal.notAllowedApprove"));
      }

      const request = await ctx.db.query.timeApprovalRequests.findFirst({
        where: and(
          eq(timeApprovalRequests.id, input.requestId),
          eq(timeApprovalRequests.clientId, access.clientId),
          access.organizationId
            ? eq(timeApprovalRequests.organizationId, access.organizationId)
            : eq(timeApprovalRequests.userId, access.freelancerId),
        ),
      });
      if (!request)
        throw notFound(await tr("serverErrors", "portal.requestNotFound"));
      if (request.status !== "pending") {
        throw badRequest(await tr("serverErrors", "portal.requestHandled"));
      }

      // Load portal access for identifier (email)
      const portalAccess = await ctx.db.query.clientPortalAccess.findFirst({
        where: eq(clientPortalAccess.id, access.id),
        columns: { email: true },
      });
      const approvedBy = portalAccess?.email ?? "portal";

      const entryIds = request.entryIds ?? [];

      // Atomic: update request + entries + log activity in single transaction
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(timeApprovalRequests)
          .set({
            status: "approved",
            respondedAt: new Date(),
            responseNote: input.note,
          })
          .where(eq(timeApprovalRequests.id, input.requestId));

        if (entryIds.length > 0) {
          await tx
            .update(timeEntries)
            .set({
              approvalStatus: "approved",
              approvedAt: new Date(),
              approvedBy,
            })
            .where(
              and(
                inArray(timeEntries.id, entryIds),
                // Defense-in-depth: poster skal tilhøre anmodningens tenant.
                request.organizationId
                  ? eq(timeEntries.organizationId, request.organizationId)
                  : eq(timeEntries.userId, request.userId),
              ),
            );
        }

        await tx.insert(portalActivityLogs).values({
          portalAccessId: access.id,
          freelancerId: access.freelancerId,
          action: "approve_time_request",
          entityType: "time_approval_request",
          entityId: request.id,
        });
      });

      return { success: true };
    }),

  // Reject a request
  rejectRequest: publicProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        reason: z.string().min(1),
        accessToken: z.string().optional(),
        sessionToken: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await validateAccess(ctx.db, input);
      if (!access?.canApproveTime) {
        throw forbidden(await tr("serverErrors", "portal.notAllowedReject"));
      }

      const request = await ctx.db.query.timeApprovalRequests.findFirst({
        where: and(
          eq(timeApprovalRequests.id, input.requestId),
          eq(timeApprovalRequests.clientId, access.clientId),
          access.organizationId
            ? eq(timeApprovalRequests.organizationId, access.organizationId)
            : eq(timeApprovalRequests.userId, access.freelancerId),
        ),
      });
      if (!request)
        throw notFound(await tr("serverErrors", "portal.requestNotFound"));
      if (request.status !== "pending") {
        throw badRequest(await tr("serverErrors", "portal.requestHandled"));
      }

      const entryIds = request.entryIds ?? [];

      // Atomic: update request + entries + log activity in single transaction
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(timeApprovalRequests)
          .set({
            status: "rejected",
            respondedAt: new Date(),
            responseNote: input.reason,
          })
          .where(eq(timeApprovalRequests.id, input.requestId));

        if (entryIds.length > 0) {
          await tx
            .update(timeEntries)
            .set({
              approvalStatus: "rejected",
              rejectedAt: new Date(),
              rejectionReason: input.reason,
            })
            .where(
              and(
                inArray(timeEntries.id, entryIds),
                // Defense-in-depth: poster skal tilhøre anmodningens tenant.
                request.organizationId
                  ? eq(timeEntries.organizationId, request.organizationId)
                  : eq(timeEntries.userId, request.userId),
              ),
            );
        }

        await tx.insert(portalActivityLogs).values({
          portalAccessId: access.id,
          freelancerId: access.freelancerId,
          action: "reject_time_request",
          entityType: "time_approval_request",
          entityId: request.id,
        });
      });

      return { success: true };
    }),
});

// Helper function to validate access
async function validateAccess(
  db: typeof import("@/lib/db").db,
  input: { accessToken?: string; sessionToken?: string },
): Promise<{
  id: string;
  clientId: string;
  freelancerId: string;
  // The client's org (null for solo freelancers). When set, portal data is
  // scoped to the whole org for this client — not just the access owner — so a
  // team's client sees all members' invoices/projects/time, not one person's.
  organizationId: string | null;
  canViewInvoices: boolean | null;
  canViewProjects: boolean | null;
  canViewTimeEntries: boolean | null;
  canViewPrepaid: boolean | null;
  canApproveTime: boolean | null;
  canDownloadInvoices: boolean | null;
} | null> {
  // Try token-based access first
  if (input.accessToken) {
    const access = await db.query.clientPortalAccess.findFirst({
      where: and(
        tokenLookup(clientPortalAccess.accessTokenHash, input.accessToken),
        eq(clientPortalAccess.isActive, true),
        eq(clientPortalAccess.accessType, "token"),
        or(
          isNull(clientPortalAccess.tokenExpiresAt),
          gte(clientPortalAccess.tokenExpiresAt, new Date()),
        ),
      ),
    });

    if (access) {
      const client = await db.query.clients.findFirst({
        where: eq(clients.id, access.clientId),
        columns: { organizationId: true },
      });
      return {
        id: access.id,
        clientId: access.clientId,
        freelancerId: access.freelancerId,
        organizationId: client?.organizationId ?? null,
        canViewInvoices: access.canViewInvoices,
        canViewProjects: access.canViewProjects,
        canViewTimeEntries: access.canViewTimeEntries,
        canViewPrepaid: access.canViewPrepaid,
        canApproveTime: access.canApproveTime,
        canDownloadInvoices: access.canDownloadInvoices,
      };
    }
  }

  // Try session-based access
  if (input.sessionToken) {
    const session = await db.query.clientPortalSessions.findFirst({
      where: and(
        tokenLookup(clientPortalSessions.sessionTokenHash, input.sessionToken),
        gte(clientPortalSessions.expiresAt, new Date()),
      ),
      with: {
        portalAccess: true,
      },
    });

    if (session?.portalAccess.isActive) {
      const client = await db.query.clients.findFirst({
        where: eq(clients.id, session.portalAccess.clientId),
        columns: { organizationId: true },
      });
      return {
        id: session.portalAccess.id,
        clientId: session.portalAccess.clientId,
        freelancerId: session.portalAccess.freelancerId,
        organizationId: client?.organizationId ?? null,
        canViewInvoices: session.portalAccess.canViewInvoices,
        canViewProjects: session.portalAccess.canViewProjects,
        canViewTimeEntries: session.portalAccess.canViewTimeEntries,
        canViewPrepaid: session.portalAccess.canViewPrepaid,
        canApproveTime: session.portalAccess.canApproveTime,
        canDownloadInvoices: session.portalAccess.canDownloadInvoices,
      };
    }
  }

  return null;
}
