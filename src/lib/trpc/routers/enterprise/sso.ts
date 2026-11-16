import { TRPCError } from "@trpc/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { accountBrand } from "@/lib/auth/account-brand";
import { socialClient } from "@/lib/auth/social-providers";
import {
  accounts,
  organizations,
  orgVerifiedDomains,
  users,
} from "@/lib/db/schema";
import {
  buildVerificationRecord,
  generateVerificationToken,
  verificationHostnames,
  verifyDomainTxt,
} from "@/lib/enterprise/sso/dns-verify";
import {
  isFreeEmailDomain,
  normalizeDomain,
  normalizeTenantId,
} from "@/lib/enterprise/sso/domains";
import { SSO_PROVIDER_ID } from "@/lib/enterprise/sso/policy";
import { logOrgAudit } from "@/lib/org-audit";
import { router } from "../../trpc";
import { orgAdminProcedure } from "./middleware";

/**
 * Login & domæner (E12, #470). Kun org-admin/owner. Databehandleraftalen
 * ligger i dpa-routeren.
 *
 * Sikkerhed: auto-join virker KUN på DNS-verificerede domæner; et domæne kan
 * kun være verificeret af én org (partial unique index); "kun SSO" kan kun
 * slås til når Microsoft-login er konfigureret og mindst ét domæne er
 * verificeret; 2FA-krav kan kun slås til af en admin der selv har 2FA.
 */

const MAX_DOMAINS_PER_ORG = 20;

/** Microsoft-login for kontoens brand (TimeWren kræver sin egen klient). */
async function microsoftLoginConfigured(
  db: typeof import("@/lib/db").db,
  userId: string,
): Promise<boolean> {
  return Boolean(socialClient(await accountBrand(db, userId), "microsoft"));
}

async function actorHasMicrosoftAccount(
  db: typeof import("@/lib/db").db,
  userId: string,
): Promise<boolean> {
  const row = await db.query.accounts.findFirst({
    where: and(
      eq(accounts.userId, userId),
      eq(accounts.providerId, SSO_PROVIDER_ID),
    ),
    columns: { id: true },
  });
  return Boolean(row);
}

function presentDomain(row: typeof orgVerifiedDomains.$inferSelect) {
  return {
    id: row.id,
    domain: row.domain,
    status: row.status as "pending" | "verified",
    verifiedAt: row.verifiedAt,
    lastCheckedAt: row.lastCheckedAt,
    lastCheckError: row.lastCheckError,
    createdAt: row.createdAt,
    txtRecord: buildVerificationRecord(row.verificationToken),
    txtHosts: verificationHostnames(row.domain),
  };
}

export const enterpriseSsoRouter = router({
  getLoginSettings: orgAdminProcedure.query(async ({ ctx }) => {
    const [org, domains, me, msLinked] = await Promise.all([
      ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.orgId),
        columns: {
          ssoTenantId: true,
          autoJoinDefaultRole: true,
          requireSsoForDomains: true,
          requireTwoFactorForManagers: true,
        },
      }),
      ctx.db.query.orgVerifiedDomains.findMany({
        where: eq(orgVerifiedDomains.organizationId, ctx.orgId),
        orderBy: [desc(orgVerifiedDomains.createdAt)],
      }),
      ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.session.user.id),
        columns: { twoFactorEnabled: true },
      }),
      actorHasMicrosoftAccount(ctx.db, ctx.session.user.id),
    ]);
    if (!org) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: await tr("serverErrors", "enterprise.organizationNotFound"),
      });
    }
    return {
      ssoTenantId: org.ssoTenantId,
      autoJoinDefaultRole: org.autoJoinDefaultRole as "member" | "manager",
      requireSsoForDomains: org.requireSsoForDomains,
      requireTwoFactorForManagers: org.requireTwoFactorForManagers,
      microsoftConfigured: await microsoftLoginConfigured(
        ctx.db,
        ctx.session.user.id,
      ),
      actorHasTwoFactor: Boolean(me?.twoFactorEnabled),
      actorHasMicrosoftAccount: msLinked,
      domains: domains.map(presentDomain),
    };
  }),

  updateLoginSettings: orgAdminProcedure
    .input(
      z.object({
        ssoTenantId: z.string().trim().max(64).nullable().optional(),
        autoJoinDefaultRole: z.enum(["member", "manager"]).optional(),
        requireSsoForDomains: z.boolean().optional(),
        requireTwoFactorForManagers: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.orgId),
        columns: {
          ssoTenantId: true,
          autoJoinDefaultRole: true,
          requireSsoForDomains: true,
          requireTwoFactorForManagers: true,
        },
      });
      if (!before) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.organizationNotFound"),
        });
      }

      const patch: Partial<typeof before> = {};

      if (input.ssoTenantId !== undefined) {
        if (!input.ssoTenantId) {
          patch.ssoTenantId = null;
        } else {
          const tenant = normalizeTenantId(input.ssoTenantId);
          if (!tenant) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: await tr("serverErrors", "enterprise.sso.invalidTenant"),
            });
          }
          patch.ssoTenantId = tenant;
        }
      }
      if (input.autoJoinDefaultRole !== undefined) {
        patch.autoJoinDefaultRole = input.autoJoinDefaultRole;
      }
      if (input.requireSsoForDomains !== undefined) {
        if (input.requireSsoForDomains) {
          if (!(await microsoftLoginConfigured(ctx.db, ctx.session.user.id))) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: await tr(
                "serverErrors",
                "enterprise.sso.microsoftNotConfigured",
              ),
            });
          }
          const verified = await ctx.db.query.orgVerifiedDomains.findFirst({
            where: and(
              eq(orgVerifiedDomains.organizationId, ctx.orgId),
              eq(orgVerifiedDomains.status, "verified"),
            ),
            columns: { id: true },
          });
          if (!verified) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: await tr(
                "serverErrors",
                "enterprise.sso.verifyDomainFirst",
              ),
            });
          }
          // Ejer-lockout-værn: den handlende admin skal selv kunne logge ind
          // med Microsoft bagefter (Microsoft er ikke trusted provider, så
          // en e-mail/password-konto linkes IKKE automatisk ved første login).
          if (!(await actorHasMicrosoftAccount(ctx.db, ctx.session.user.id))) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: await tr(
                "serverErrors",
                "enterprise.sso.connectMicrosoftFirst",
              ),
            });
          }
        }
        patch.requireSsoForDomains = input.requireSsoForDomains;
      }
      if (input.requireTwoFactorForManagers !== undefined) {
        if (input.requireTwoFactorForManagers) {
          const me = await ctx.db.query.users.findFirst({
            where: eq(users.id, ctx.session.user.id),
            columns: { twoFactorEnabled: true },
          });
          if (!me?.twoFactorEnabled) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: await tr(
                "serverErrors",
                "enterprise.sso.enable2faFirst",
              ),
            });
          }
        }
        patch.requireTwoFactorForManagers = input.requireTwoFactorForManagers;
      }

      const diff: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
        if (before[key] !== patch[key]) {
          diff[key] = { from: before[key], to: patch[key] };
        }
      }
      if (Object.keys(diff).length === 0) return before;

      return ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .update(organizations)
          .set(patch)
          .where(eq(organizations.id, ctx.orgId))
          .returning({
            ssoTenantId: organizations.ssoTenantId,
            autoJoinDefaultRole: organizations.autoJoinDefaultRole,
            requireSsoForDomains: organizations.requireSsoForDomains,
            requireTwoFactorForManagers:
              organizations.requireTwoFactorForManagers,
          });
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "sso_settings_updated",
          { metadata: { field: Object.keys(diff).join(", "), diff } },
        );
        return row;
      });
    }),

  addDomain: orgAdminProcedure
    .input(z.object({ domain: z.string().trim().min(3).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const domain = normalizeDomain(input.domain);
      if (!domain) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "enterprise.sso.invalidDomain"),
        });
      }
      if (isFreeEmailDomain(domain)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "enterprise.sso.publicProviders"),
        });
      }
      const [existingHere, verifiedElsewhere, countRows] = await Promise.all([
        ctx.db.query.orgVerifiedDomains.findFirst({
          where: and(
            eq(orgVerifiedDomains.organizationId, ctx.orgId),
            eq(orgVerifiedDomains.domain, domain),
          ),
          columns: { id: true },
        }),
        ctx.db.query.orgVerifiedDomains.findFirst({
          where: and(
            eq(orgVerifiedDomains.domain, domain),
            eq(orgVerifiedDomains.status, "verified"),
            ne(orgVerifiedDomains.organizationId, ctx.orgId),
          ),
          columns: { id: true },
        }),
        ctx.db.query.orgVerifiedDomains.findMany({
          where: eq(orgVerifiedDomains.organizationId, ctx.orgId),
          columns: { id: true },
        }),
      ]);
      if (existingHere) {
        throw new TRPCError({
          code: "CONFLICT",
          message: await tr(
            "serverErrors",
            "enterprise.sso.domainAlreadyAdded",
          ),
        });
      }
      if (verifiedElsewhere) {
        throw new TRPCError({
          code: "CONFLICT",
          message: await tr(
            "serverErrors",
            "enterprise.sso.domainVerifiedElsewhere",
          ),
        });
      }
      if (countRows.length >= MAX_DOMAINS_PER_ORG) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "enterprise.sso.maxDomains", {
            max: MAX_DOMAINS_PER_ORG,
          }),
        });
      }

      const row = await ctx.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(orgVerifiedDomains)
          .values({
            organizationId: ctx.orgId,
            domain,
            verificationToken: generateVerificationToken(),
            status: "pending",
            createdBy: ctx.session.user.id,
          })
          .returning();
        await logOrgAudit(tx, ctx.orgId, ctx.session.user.id, "domain_added", {
          metadata: { domain },
        });
        return inserted;
      });
      return presentDomain(row);
    }),

  /**
   * verifyDomain — server-side DNS TXT-opslag. Virker også som
   * re-verifikation: et verificeret domæne hvor recorden er fjernet
   * (definitivt "ikke fundet", ikke netværksfejl) sættes tilbage til pending
   * og mister auto-join.
   */
  verifyDomain: orgAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.query.orgVerifiedDomains.findFirst({
        where: and(
          eq(orgVerifiedDomains.id, input.id),
          eq(orgVerifiedDomains.organizationId, ctx.orgId),
        ),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.sso.domainNotFound"),
        });
      }

      const result = await verifyDomainTxt(row.domain, row.verificationToken);
      const now = new Date();

      if (result.ok) {
        const verifiedElsewhere =
          await ctx.db.query.orgVerifiedDomains.findFirst({
            where: and(
              eq(orgVerifiedDomains.domain, row.domain),
              eq(orgVerifiedDomains.status, "verified"),
              ne(orgVerifiedDomains.organizationId, ctx.orgId),
            ),
            columns: { id: true },
          });
        if (verifiedElsewhere) {
          await ctx.db
            .update(orgVerifiedDomains)
            .set({
              lastCheckedAt: now,
              lastCheckError: await tr(
                "serverErrors",
                "enterprise.sso.domainVerifiedElsewhereShort",
              ),
              updatedAt: now,
            })
            .where(eq(orgVerifiedDomains.id, row.id));
          throw new TRPCError({
            code: "CONFLICT",
            message: await tr(
              "serverErrors",
              "enterprise.sso.txtCorrectButTaken",
            ),
          });
        }
        try {
          const updated = await ctx.db.transaction(async (tx) => {
            const [u] = await tx
              .update(orgVerifiedDomains)
              .set({
                status: "verified",
                verifiedAt: row.verifiedAt ?? now,
                lastCheckedAt: now,
                lastCheckError: null,
                updatedAt: now,
              })
              .where(eq(orgVerifiedDomains.id, row.id))
              .returning();
            if (row.status !== "verified") {
              await logOrgAudit(
                tx,
                ctx.orgId,
                ctx.session.user.id,
                "domain_verified",
                { metadata: { domain: row.domain, foundOn: result.foundOn } },
              );
            }
            return u;
          });
          return { ok: true as const, domain: presentDomain(updated) };
        } catch (error) {
          // Race mod en anden org på det partielle unique index
          if ((error as { code?: string })?.code === "23505") {
            throw new TRPCError({
              code: "CONFLICT",
              message: await tr(
                "serverErrors",
                "enterprise.sso.justVerifiedElsewhere",
              ),
            });
          }
          throw error;
        }
      }

      // Ikke fundet: pending forbliver pending; verificeret nedgraderes kun
      // ved definitivt "ingen record" — ikke ved transient DNS-fejl.
      const revoke = row.status === "verified" && !result.transient;
      const [updated] = await ctx.db
        .update(orgVerifiedDomains)
        .set({
          ...(revoke ? { status: "pending", verifiedAt: null } : {}),
          lastCheckedAt: now,
          lastCheckError:
            result.error ?? (await tr("serverErrors", "common.unknownError")),
          updatedAt: now,
        })
        .where(eq(orgVerifiedDomains.id, row.id))
        .returning();
      if (revoke) {
        await logOrgAudit(
          ctx.db,
          ctx.orgId,
          ctx.session.user.id,
          "domain_removed",
          {
            metadata: {
              domain: row.domain,
              reason: "txt_record_missing_on_recheck",
            },
          },
        );
      }
      return {
        ok: false as const,
        error: result.error,
        revoked: revoke,
        domain: presentDomain(updated),
      };
    }),

  removeDomain: orgAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.query.orgVerifiedDomains.findFirst({
        where: and(
          eq(orgVerifiedDomains.id, input.id),
          eq(orgVerifiedDomains.organizationId, ctx.orgId),
        ),
        columns: { id: true, domain: true, status: true },
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.sso.domainNotFound"),
        });
      }
      let requireSsoDisabled = false;
      await ctx.db.transaction(async (tx) => {
        await tx
          .delete(orgVerifiedDomains)
          .where(eq(orgVerifiedDomains.id, row.id));
        // Uden verificerede domæner er "kun SSO" tom — slå den fra så
        // indstillingen ikke lyver i UI'et.
        const remaining = await tx.query.orgVerifiedDomains.findFirst({
          where: and(
            eq(orgVerifiedDomains.organizationId, ctx.orgId),
            eq(orgVerifiedDomains.status, "verified"),
          ),
          columns: { id: true },
        });
        if (!remaining) {
          const [org] = await tx
            .update(organizations)
            .set({ requireSsoForDomains: false })
            .where(
              and(
                eq(organizations.id, ctx.orgId),
                eq(organizations.requireSsoForDomains, true),
              ),
            )
            .returning({ id: organizations.id });
          requireSsoDisabled = Boolean(org);
        }
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "domain_removed",
          {
            metadata: {
              domain: row.domain,
              wasVerified: row.status === "verified",
              requireSsoDisabled,
            },
          },
        );
      });
      return { ok: true, requireSsoDisabled };
    }),
  // Databehandleraftalen (læs og acceptér) ligger i dpa-routeren
  // (src/lib/trpc/routers/dpa.ts), så den virker på alle planer og kun
  // for ejere og administratorer efter members.role.
});
