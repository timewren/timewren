import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { organizationModules, organizations } from "@/lib/db/schema";
import { ensureDefaultAbsenceTypes } from "@/lib/enterprise/absence-defaults";
import { applyBundle } from "@/lib/modules/bundles";
import { invalidateOrgModules } from "@/lib/modules/cache";
import {
  ENTERPRISE_BUNDLE,
  FREELANCE_BUNDLE,
  MODULE_KEYS,
} from "@/lib/modules/constants";
import { parseOrgMetadata } from "@/lib/utils/org-metadata";
import { adminProcedure, router } from "../../trpc";
import { logAdminAction } from "./shared";

export const adminOrganizationModulesRouter = router({
  getTestAccountFlag: adminProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const org = await ctx.db.query.organizations.findFirst({
        columns: { isTestAccount: true },
        where: eq(organizations.id, input.organizationId),
      });
      if (!org) throw new TRPCError({ code: "NOT_FOUND" });
      return org.isTestAccount;
    }),

  setTestAccountFlag: adminProcedure
    .input(z.object({ organizationId: z.string(), testAccount: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [org] = await ctx.db
        .update(organizations)
        .set({ isTestAccount: input.testAccount })
        .where(eq(organizations.id, input.organizationId))
        .returning({ id: organizations.id });
      if (!org) throw new TRPCError({ code: "NOT_FOUND" });

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "set_test_account_flag",
        null,
        input,
        ctx.headers,
      );
    }),

  /** List all module rows for a given organization. */
  list: adminProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.query.organizationModules.findMany({
        where: eq(organizationModules.organizationId, input.organizationId),
      });
      const byKey = new Map(rows.map((r) => [r.moduleKey, r]));
      return MODULE_KEYS.map((key) => {
        const existing = byKey.get(key);
        return {
          key,
          isAvailable: existing?.isAvailable ?? false,
          isEnabled: existing?.isEnabled ?? false,
          availableAt: existing?.availableAt ?? null,
          enabledAt: existing?.enabledAt ?? null,
          updatedAt: existing?.updatedAt ?? null,
        };
      });
    }),

  /** Super-admin: toggle module availability for an org. */
  setAvailability: adminProcedure
    .input(
      z.object({
        organizationId: z.string(),
        moduleKey: z.enum([...MODULE_KEYS] as [string, ...string[]]),
        isAvailable: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.organizationModules.findFirst({
        where: and(
          eq(organizationModules.organizationId, input.organizationId),
          eq(organizationModules.moduleKey, input.moduleKey),
        ),
      });

      if (existing) {
        await ctx.db
          .update(organizationModules)
          .set({
            isAvailable: input.isAvailable,
            availableAt: input.isAvailable ? new Date() : existing.availableAt,
            // Disabling availability also disables the module
            isEnabled: input.isAvailable ? existing.isEnabled : false,
            updatedAt: new Date(),
            updatedBy: ctx.session.user.id,
          })
          .where(eq(organizationModules.id, existing.id));
      } else {
        await ctx.db.insert(organizationModules).values({
          id: crypto.randomUUID(),
          organizationId: input.organizationId,
          moduleKey: input.moduleKey,
          isAvailable: input.isAvailable,
          isEnabled: false,
          availableAt: input.isAvailable ? new Date() : null,
          enabledAt: null,
          updatedBy: ctx.session.user.id,
        });
      }
      await invalidateOrgModules(input.organizationId);

      return { success: true };
    }),

  /** Super-admin: apply a named bundle to an org (preset shortcut). */
  applyBundle: adminProcedure
    .input(
      z.object({
        organizationId: z.string(),
        bundle: z.enum(["freelance", "enterprise", "empty"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.bundle === "empty") {
        await ctx.db
          .delete(organizationModules)
          .where(eq(organizationModules.organizationId, input.organizationId));
        await invalidateOrgModules(input.organizationId);
        return { success: true };
      }

      const bundle =
        input.bundle === "enterprise" ? ENTERPRISE_BUNDLE : FREELANCE_BUNDLE;
      await applyBundle(
        ctx.db,
        input.organizationId,
        bundle,
        ctx.session.user.id,
      );
      if (input.bundle === "enterprise") {
        await ensureDefaultAbsenceTypes(ctx.db, input.organizationId);
      }

      // Merge bundle type into existing metadata
      const currentOrg = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, input.organizationId),
      });
      const newMetadata = {
        // Parse først: Better-Auth gemmer metadata som JSON-streng, og en
        // spredt streng sletter de øvrige felter (domæner, valuta).
        ...parseOrgMetadata(currentOrg?.metadata),
        type: input.bundle,
      };
      await ctx.db
        .update(organizations)
        .set({ metadata: newMetadata })
        .where(eq(organizations.id, input.organizationId));

      return { success: true };
    }),
});
