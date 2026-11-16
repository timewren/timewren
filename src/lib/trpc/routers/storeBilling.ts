// Køb i appen (App Store / Google Play). Kontrakten med appen: se
// docs/ENTERPRISE-FEATURES.md og src/lib/store-billing/. Mørkt indtil
// STORE_BILLING_ENABLED=1.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { st } from "@/i18n/sync-text";
import { assertCheckoutAvailable } from "@/lib/billing/assert-checkout";
import { isCheckoutAvailableForUser } from "@/lib/billing/brand-billing";
import { storeAccountTokenForUser } from "@/lib/store-billing/account-token";
import { getAppleVerifier } from "@/lib/store-billing/apple";
import { getGooglePlayClient } from "@/lib/store-billing/google";
import { STORE_PRODUCTS } from "@/lib/store-billing/products";
import {
  isStoreBillingEnabled,
  purchaseEligibility,
  verifyApplePurchase,
  verifyGooglePurchase,
} from "@/lib/store-billing/service";
import { currentFromRow } from "@/lib/store-billing/state";
import { protectedProcedure, router } from "../trpc";
import { resolveActiveSubscription } from "./subscription";

function assertEnabled() {
  if (!isStoreBillingEnabled()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: st("storeBilling.notAvailable"),
    });
  }
}

export const storeBillingRouter = router({
  config: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    // TimeWren-konti kan ikke betale endnu (lib/billing/brand-billing.ts).
    const enabled =
      isStoreBillingEnabled() &&
      (await isCheckoutAvailableForUser(ctx.db, userId));
    const governing = await resolveActiveSubscription(
      ctx.db,
      ctx.orgId,
      userId,
    );
    const block = enabled
      ? (await purchaseEligibility(ctx.db, ctx.orgId, userId)).block
      : null;
    return {
      enabled,
      accountToken: storeAccountTokenForUser(userId),
      products: STORE_PRODUCTS.map((p) => ({ ...p })),
      current: currentFromRow(governing),
      // Ud over kontrakten (additivt): så appen kan skjule købsknapper FØR
      // brugeren betaler, i stedet for at serveren afviser bagefter.
      canPurchase: enabled && !block,
      purchaseBlockedReason: enabled ? (block?.reason ?? null) : "disabled",
    };
  }),

  verifyApple: protectedProcedure
    .input(z.object({ signedTransaction: z.string().min(1).max(20_000) }))
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      await assertCheckoutAvailable(ctx.db, ctx.session.user.id);
      return verifyApplePurchase(ctx.db, {
        userId: ctx.session.user.id,
        orgId: ctx.orgId,
        signedTransaction: input.signedTransaction,
        verifier: getAppleVerifier(),
      });
    }),

  verifyGoogle: protectedProcedure
    .input(
      z.object({
        productId: z.string().min(1).max(100),
        purchaseToken: z.string().min(1).max(4_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled();
      await assertCheckoutAvailable(ctx.db, ctx.session.user.id);
      return verifyGooglePurchase(ctx.db, {
        userId: ctx.session.user.id,
        orgId: ctx.orgId,
        productId: input.productId,
        purchaseToken: input.purchaseToken,
        client: getGooglePlayClient(),
      });
    }),
});
