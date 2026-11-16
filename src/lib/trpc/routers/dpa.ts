import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { isSharedProdDb } from "@/lib/config";
import {
  acceptDpaForOrg,
  listDpaAcceptances,
} from "@/lib/enterprise/dpa/accept";
import { DPA_VERSION, DPA_VERSION_DATE } from "@/lib/enterprise/dpa/content";
import { getOrgRole } from "@/lib/trpc/middleware/org-role";
import { protectedProcedure, router } from "../trpc";
import { assertTwoFactorIfRequired } from "./enterprise/middleware";

/**
 * Databehandleraftalen for alle planer (Indstillinger > GDPR & Databeskyttelse).
 * Ikke bag enterprise-modulet: enhver organisation kan acceptere. Bruger
 * IKKE enterprise-organizationProcedure, fordi den opretter en
 * medarbejderprofil som sideeffekt. Regel: ejer eller administrator
 * (members.role) af den aktive organisation, 2FA hvis org'en kræver det.
 *
 * SHARED_PROD_DB=1 afviser her for alle: en ældre prod-version kender ikke
 * DPA-version 1.1 og ville overskrive dens egne accepter i orgDpaAcceptances.
 */
const dpaAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (isSharedProdDb()) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "dpa.notFromEnv"),
    });
  }
  const orgId = (ctx as { orgId?: string | null }).orgId;
  if (!orgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "dpa.notInOrg"),
    });
  }
  const role = await getOrgRole(ctx.db, ctx.session.user.id, orgId);
  if (role !== "owner" && role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "dpa.ownersAdminsOnly"),
    });
  }
  await assertTwoFactorIfRequired(ctx.db, orgId, ctx.session.user.id);
  return next({ ctx: { ...ctx, orgId } });
});

export const dpaRouter = router({
  status: dpaAdminProcedure.query(async ({ ctx }) => {
    const history = await listDpaAcceptances(ctx.db, ctx.orgId);
    return {
      version: DPA_VERSION,
      versionDate: DPA_VERSION_DATE,
      currentAcceptance: history.find((h) => h.version === DPA_VERSION) ?? null,
      history,
    };
  }),

  accept: dpaAdminProcedure
    .input(z.object({ version: z.string().min(1).max(20) }))
    .mutation(({ ctx, input }) =>
      acceptDpaForOrg(ctx.db, {
        orgId: ctx.orgId,
        userId: ctx.session.user.id,
        sessionEmail: ctx.session.user.email,
        sessionName: ctx.session.user.name,
        version: input.version,
        headers: ctx.headers,
      }),
    ),
});
