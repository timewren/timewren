import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { DEFAULT_PORTAL_COLORS } from "@/lib/brand/tokens";
import { getMarketingUrl } from "@/lib/config";
import { portalBranding } from "@/lib/db/schema";
import {
  registerDomainWithDokploy,
  removeDomainFromDokploy,
} from "@/lib/hosting/dokploy";
import { protectedProcedure, router } from "../trpc";

export const portalBrandingRouter = router({
  // Get portal branding settings for current user
  get: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    let branding = await ctx.db.query.portalBranding.findFirst({
      where: ctx.orgId
        ? eq(portalBranding.organizationId, ctx.orgId)
        : eq(portalBranding.userId, userId),
    });

    // If no branding exists, create default
    if (!branding) {
      const [newBranding] = await ctx.db
        .insert(portalBranding)
        .values({
          userId,
          organizationId: ctx.orgId,
          ...DEFAULT_PORTAL_COLORS,
        })
        .returning();
      branding = newBranding;
    }

    return branding;
  }),

  // Update basic branding (logo, name, favicon)
  updateBasic: protectedProcedure
    .input(
      z.object({
        brandName: z.string().max(255).optional().nullable(),
        logoUrl: z.string().url().optional().nullable(),
        faviconUrl: z.string().url().optional().nullable(),
        footerText: z.string().max(1000).optional().nullable(),
        supportEmail: z.string().email().optional().nullable(),
        supportPhone: z.string().max(50).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Ensure branding record exists
      const existing = await ctx.db.query.portalBranding.findFirst({
        where: ctx.orgId
          ? eq(portalBranding.organizationId, ctx.orgId)
          : eq(portalBranding.userId, userId),
      });

      if (existing) {
        const [updated] = await ctx.db
          .update(portalBranding)
          .set({
            brandName: input.brandName,
            logoUrl: input.logoUrl,
            faviconUrl: input.faviconUrl,
            footerText: input.footerText,
            supportEmail: input.supportEmail,
            supportPhone: input.supportPhone,
            updatedAt: new Date(),
          })
          .where(
            ctx.orgId
              ? eq(portalBranding.organizationId, ctx.orgId)
              : eq(portalBranding.userId, userId),
          )
          .returning();
        return updated;
      } else {
        const [created] = await ctx.db
          .insert(portalBranding)
          .values({
            userId,
            organizationId: ctx.orgId,
            ...DEFAULT_PORTAL_COLORS,
            brandName: input.brandName,
            logoUrl: input.logoUrl,
            faviconUrl: input.faviconUrl,
            footerText: input.footerText,
            supportEmail: input.supportEmail,
            supportPhone: input.supportPhone,
          })
          .returning();
        return created;
      }
    }),

  // Update color scheme
  updateColors: protectedProcedure
    .input(
      z.object({
        primaryColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
        secondaryColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
        accentColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
        backgroundColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
        textColor: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const [updated] = await ctx.db
        .update(portalBranding)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(
          ctx.orgId
            ? eq(portalBranding.organizationId, ctx.orgId)
            : eq(portalBranding.userId, userId),
        )
        .returning();

      return updated;
    }),

  // Update fonts
  updateFonts: protectedProcedure
    .input(
      z.object({
        headingFont: z.string().max(100).optional(),
        bodyFont: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const [updated] = await ctx.db
        .update(portalBranding)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(
          ctx.orgId
            ? eq(portalBranding.organizationId, ctx.orgId)
            : eq(portalBranding.userId, userId),
        )
        .returning();

      return updated;
    }),

  // Update portal feature toggles
  updateFeatures: protectedProcedure
    .input(
      z.object({
        showInvoices: z.boolean().optional(),
        showProjects: z.boolean().optional(),
        showTimeEntries: z.boolean().optional(),
        showPrepaid: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const [updated] = await ctx.db
        .update(portalBranding)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(
          ctx.orgId
            ? eq(portalBranding.organizationId, ctx.orgId)
            : eq(portalBranding.userId, userId),
        )
        .returning();

      return updated;
    }),

  // Set custom domain
  setCustomDomain: protectedProcedure
    .input(
      z.object({
        customDomain: z.string().min(3).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Generate verification token
      const verificationToken = crypto.randomBytes(32).toString("hex");

      const [updated] = await ctx.db
        .update(portalBranding)
        .set({
          customDomain: input.customDomain.toLowerCase(),
          customDomainVerified: false,
          customDomainVerifiedAt: null,
          domainVerificationToken: verificationToken,
          updatedAt: new Date(),
        })
        .where(
          ctx.orgId
            ? eq(portalBranding.organizationId, ctx.orgId)
            : eq(portalBranding.userId, userId),
        )
        .returning();

      return {
        branding: updated,
        verificationInstructions: {
          txtRecord: {
            name: `_timetrack-verify.${input.customDomain}`,
            value: `verify=${verificationToken}`,
          },
          cnameRecord: {
            name: input.customDomain,
            value: new URL(getMarketingUrl()).hostname,
          },
        },
      };
    }),

  // Verify custom domain
  verifyCustomDomain: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const branding = await ctx.db.query.portalBranding.findFirst({
      where: ctx.orgId
        ? eq(portalBranding.organizationId, ctx.orgId)
        : eq(portalBranding.userId, userId),
    });

    if (!branding?.customDomain || !branding.domainVerificationToken) {
      throw new Error(await tr("serverErrors", "portalBranding.noDomain"));
    }

    const verificationToken = branding.domainVerificationToken;
    let isVerified = false;

    // In development, auto-verify for testing
    if (process.env.NODE_ENV === "development") {
      isVerified = true;
    } else {
      // In production, verify DNS TXT record
      try {
        const dns = await import("node:dns");
        const dnsPromises = dns.promises;
        const verificationDomain = `_timetrack-verify.${branding.customDomain}`;

        const txtRecords = await dnsPromises.resolveTxt(verificationDomain);
        // TXT records come as arrays of strings, join them
        isVerified = txtRecords.some((record) =>
          record.join("").includes(verificationToken),
        );
      } catch (error) {
        // DNS lookup failed - domain not configured or TXT record not found
        console.error("DNS verification failed:", error);
        isVerified = false;
      }
    }

    if (isVerified) {
      // Register domain with Dokploy for automatic SSL
      await registerDomainWithDokploy(branding.customDomain);

      const [updated] = await ctx.db
        .update(portalBranding)
        .set({
          customDomainVerified: true,
          customDomainVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          ctx.orgId
            ? eq(portalBranding.organizationId, ctx.orgId)
            : eq(portalBranding.userId, userId),
        )
        .returning();

      return { success: true, branding: updated };
    }

    throw new Error(
      await tr("serverErrors", "portalBranding.verifyFailed", {
        domain: branding.customDomain,
        token: branding.domainVerificationToken,
      }),
    );
  }),

  // Remove custom domain
  removeCustomDomain: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Remove domain from Dokploy before DB cleanup
    const existing = await ctx.db.query.portalBranding.findFirst({
      where: ctx.orgId
        ? eq(portalBranding.organizationId, ctx.orgId)
        : eq(portalBranding.userId, userId),
    });
    // Kun et domæne, org'en selv har verificeret via DNS, er registreret af
    // os. setCustomDomain tager enhver host, så et uverificeret domæne kan
    // være en anden kundes (eller appens eget) på samme Dokploy-app.
    if (existing?.customDomain && existing.customDomainVerified) {
      await removeDomainFromDokploy(existing.customDomain);
    }

    const [updated] = await ctx.db
      .update(portalBranding)
      .set({
        customDomain: null,
        customDomainVerified: false,
        customDomainVerifiedAt: null,
        domainVerificationToken: null,
        updatedAt: new Date(),
      })
      .where(
        ctx.orgId
          ? eq(portalBranding.organizationId, ctx.orgId)
          : eq(portalBranding.userId, userId),
      )
      .returning();

    return updated;
  }),

  // Reset to default colors
  resetColors: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [updated] = await ctx.db
      .update(portalBranding)
      .set({
        ...DEFAULT_PORTAL_COLORS,
        updatedAt: new Date(),
      })
      .where(
        ctx.orgId
          ? eq(portalBranding.organizationId, ctx.orgId)
          : eq(portalBranding.userId, userId),
      )
      .returning();

    return updated;
  }),
});
