import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { RoundingMethod } from "@/lib/utils/rounding";
import { router } from "../../trpc";
import { deviceProcedure, type WebInputs, webInput } from "./device-procedure";

/**
 * Brugerens og virksomhedens indstillinger for token-klienter. Læsninger og
 * skrivninger er web's (user.getProfile/updateProfile,
 * onboarding.getCompanyProfile/updateCompanyProfile, invoiceTemplates
 * .getDefault) med web's vagter: virksomhedsprofilen kan kun rettes af
 * org'ens admin/ejer.
 */

export const extUserRouter = router({
  /**
   * Brugerens egne standarder. Uden valgt afrunding: som web's
   * afrundingshierarki (15 minutter, op). Uden momsperiode: kvartalsvis,
   * som web's momsoverblik.
   */
  settings: deviceProcedure.query(async ({ ctx }) => {
    const profile = await ctx.web.user.getProfile();
    if (!profile) throw new TRPCError({ code: "NOT_FOUND" });
    return {
      defaultHourlyRate: profile.defaultHourlyRate ?? null,
      roundingEnabled: profile.roundingEnabled ?? false,
      roundingMinutes: profile.roundingMinutes ?? 15,
      roundingMethod: (profile.roundingMethod ?? "up") as RoundingMethod,
      weeklyHourGoal:
        profile.weeklyHourGoal == null ? null : Number(profile.weeklyHourGoal),
      vatPeriod: profile.vatPeriod ?? "quarterly",
    };
  }),

  /**
   * Ret et eller flere felter med web's updateProfile (samme input, fx
   * `{ defaultHourlyRate: "850", roundingEnabled: true, roundingMinutes:
   * 15, roundingMethod: "up", weeklyHourGoal: "37" }`).
   */
  updateSettings: deviceProcedure
    .input(z.object({ data: webInput<WebInputs["user"]["updateProfile"]>() }))
    .mutation(({ ctx, input }) => ctx.web.user.updateProfile(input.data)),
});

export const extCompanyRouter = router({
  /**
   * Virksomhedsprofil (afsender, CVR, bank, `vatRegistered`) og org'ens
   * standard-fakturaskabelon (moms-sats, valuta, betalingsfrist). Begge er
   * `null`, når de ikke findes; skabelonen også, når rollen ikke har adgang
   * til skabeloner.
   */
  get: deviceProcedure.query(async ({ ctx }) => {
    const [companyProfile, defaultInvoiceTemplate] = await Promise.all([
      ctx.web.onboarding.getCompanyProfile(),
      ctx.web.invoiceTemplates.getDefault().catch((err: unknown) => {
        if (err instanceof TRPCError && err.code === "FORBIDDEN") return null;
        throw err;
      }),
    ]);
    return {
      companyProfile,
      defaultInvoiceTemplate: defaultInvoiceTemplate ?? null,
    };
  }),

  /** Web's updateCompanyProfile (kun org'ens admin/ejer). */
  update: deviceProcedure
    .input(
      z.object({
        data: webInput<WebInputs["onboarding"]["updateCompanyProfile"]>(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.web.onboarding.updateCompanyProfile(input.data),
    ),
});
