import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { alunta } from "@/lib/alunta";
import { subscriptions } from "@/lib/db/schema";
import { toLocalDateStr } from "@/lib/format";
import { storeProviderLabel } from "@/lib/store-billing/products";
import { isStoreManaged } from "@/lib/store-billing/state";
import { copenhagenToday } from "@/lib/time/copenhagen";
import { adminProcedure, router } from "../../trpc";
import { logAdminAction } from "./shared";

export const adminBillingRouter = router({
  // ============================================
  // User Billing (Admin only — contains Stripe IDs)
  // ============================================

  getUserBilling: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_user_billing",
        input.userId,
        null,
        ctx.headers,
      );

      const subscription = await ctx.db.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, input.userId),
      });

      return {
        subscription: subscription
          ? {
              id: subscription.id,
              status: subscription.status,
              billingCycle: subscription.billingCycle,
              isTrial: subscription.isTrial,
              trialEndsAt: subscription.trialEndsAt,
              currentPeriodStart: subscription.currentPeriodStart,
              currentPeriodEnd: subscription.currentPeriodEnd,
              cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
              canceledAt: subscription.canceledAt,
              aluntaSubscriptionId: subscription.aluntaSubscriptionId,
              aluntaCustomerId: subscription.aluntaCustomerId,
              foundingTier: subscription.foundingTier,
              discountPercent: subscription.discountPercent,
              discountExpiresAt: subscription.discountExpiresAt,
              storeProvider: subscription.storeProvider,
              storeStatus: subscription.storeStatus,
              storeProductId: subscription.storeProductId,
              storeEnvironment: subscription.storeEnvironment,
              storeManaged: isStoreManaged(subscription),
              createdAt: subscription.createdAt,
              updatedAt: subscription.updatedAt,
            }
          : null,
      };
    }),

  setSubscriptionDiscount: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        discountPercent: z.number().min(0).max(100),
        discountExpiresAt: z.string().nullable(), // ISO date string or null for forever
        discountName: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [sub] = await ctx.db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, input.userId),
            eq(subscriptions.status, "active"),
          ),
        )
        .limit(1);

      if (!sub) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Brugeren har ikke et aktivt abonnement",
        });
      }
      if (isStoreManaged(sub)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Abonnementet betales via ${storeProviderLabel(sub.storeProvider)} — prisen styres af butikken, så rabat kan ikke gives her.`,
        });
      }

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "set_subscription_discount",
        input.userId,
        {
          previousDiscount: sub.discountPercent,
          previousExpiresAt: sub.discountExpiresAt,
          newDiscount: input.discountPercent,
          newExpiresAt: input.discountExpiresAt,
        },
        ctx.headers,
      );

      // Sync discount to Alunta if subscription has an Alunta ID
      let aluntaSynced = false;
      if (sub.aluntaSubscriptionId) {
        try {
          if (input.discountPercent > 0) {
            const today = copenhagenToday();
            await alunta.subscriptions.addDiscount(sub.aluntaSubscriptionId, {
              discount_name:
                input.discountName || `Admin rabat ${input.discountPercent}%`,
              discount_type: "percent",
              discount_value: input.discountPercent,
              from_date: today,
              to_date: input.discountExpiresAt
                ? input.discountExpiresAt.split("T")[0]
                : undefined,
            });
            aluntaSynced = true;
          } else {
            // Remove all active discounts from Alunta
            const { data: existingDiscounts } =
              await alunta.subscriptions.listDiscounts(
                sub.aluntaSubscriptionId,
              );
            for (const discount of existingDiscounts) {
              await alunta.subscriptions.deleteDiscount(
                sub.aluntaSubscriptionId,
                discount.uuid,
              );
            }
            aluntaSynced = true;
          }
        } catch (error) {
          console.error("[Admin] Failed to sync discount to Alunta:", error);
          // Continue — local discount is still applied
        }
      }

      await ctx.db
        .update(subscriptions)
        .set({
          discountPercent: input.discountPercent,
          discountExpiresAt: input.discountExpiresAt
            ? new Date(input.discountExpiresAt)
            : null,
        })
        .where(eq(subscriptions.id, sub.id));

      const discountMsg =
        input.discountPercent > 0
          ? `Rabat sat til ${input.discountPercent}%`
          : "Rabat er fjernet";

      // Build appropriate sync status message
      let syncNote = "";
      if (sub.aluntaSubscriptionId) {
        if (aluntaSynced) {
          syncNote = " (synkroniseret til Alunta)";
        } else {
          syncNote = " (Alunta sync fejlede — kun lokal)";
        }
      }

      return {
        success: true,
        message: `${discountMsg}${syncNote}`,
        aluntaSynced,
      };
    }),

  removeFoundingTier: adminProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Find the user's active subscription with a founding tier
      const [sub] = await ctx.db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, input.userId),
            eq(subscriptions.status, "active"),
          ),
        )
        .limit(1);

      if (!sub?.foundingTier) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Brugeren har ikke en aktiv founding member status",
        });
      }

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "remove_founding_tier",
        input.userId,
        {
          previousTier: sub.foundingTier,
          previousDiscount: sub.discountPercent,
        },
        ctx.headers,
      );

      await ctx.db
        .update(subscriptions)
        .set({
          foundingTier: null,
          discountPercent: 0,
          discountExpiresAt: null,
        })
        .where(eq(subscriptions.id, sub.id));

      return {
        success: true,
        message: "Founding member status er fjernet",
      };
    }),

  // Manually grant a subscription (comp / manual access) — with or without
  // an end date. No Alunta billing is involved; this only controls app access
  // via the local subscription row (see dashboard layout gating).
  //   - endDate === null  → status "active" (access forever)
  //   - endDate set       → status "trialing" with trialEndsAt = endDate
  //                         (auto-expires via the existing trial gating)
  setManualSubscription: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        endDate: z.string().nullable(), // ISO date string or null for forever
        reason: z.string().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Parse as end-of-day in the server's local time so "til 31/12" grants
      // access through that whole day. Parsing the bare "YYYY-MM-DD" would be
      // UTC midnight, which combined with a local-time comparison could land
      // on the wrong day on a non-UTC server.
      const endsAt = input.endDate
        ? new Date(`${input.endDate}T23:59:59.999`)
        : null;

      if (endsAt) {
        if (Number.isNaN(endsAt.getTime())) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ugyldig slutdato",
          });
        }
        if (endsAt < new Date()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Slutdatoen skal være i fremtiden",
          });
        }
      }

      const existing = await ctx.db.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, input.userId),
      });
      // Butikkens notifikationer ville overskrive et manuelt abonnement.
      if (existing && isStoreManaged(existing)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Abonnementet betales via ${storeProviderLabel(existing.storeProvider)}. Det skal opsiges dér, før et manuelt abonnement kan sættes.`,
        });
      }

      // "active" → access forever; "trialing" + future trialEndsAt → access
      // until that date. Both clear any pending cancellation.
      const shared = {
        status: endsAt ? ("trialing" as const) : ("active" as const),
        isTrial: false,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        updatedAt: new Date(),
      };

      if (existing) {
        await ctx.db
          .update(subscriptions)
          .set({
            ...shared,
            // Only move the trial date when an end date is given; for an
            // infinite grant leave the (notNull) trial date untouched.
            ...(endsAt ? { trialEndsAt: endsAt } : {}),
          })
          .where(eq(subscriptions.id, existing.id));
      } else {
        // No subscription row yet (e.g. user never onboarded) — create one.
        // trialEndsAt is notNull, so default to the end date or "now" for
        // an active grant where the date is irrelevant to gating.
        await ctx.db.insert(subscriptions).values({
          userId: input.userId,
          billingCycle: "monthly",
          trialEndsAt: endsAt ?? new Date(),
          ...shared,
        });
      }

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "set_manual_subscription",
        input.userId,
        {
          endDate: endsAt ? endsAt.toISOString() : null,
          previousStatus: existing?.status ?? null,
          reason: input.reason,
        },
        ctx.headers,
      );

      return {
        success: true,
        endsAt,
        message: endsAt
          ? `Manuelt abonnement aktiveret til ${endsAt.toLocaleDateString("da-DK", { timeZone: "Europe/Copenhagen" })}`
          : "Uendeligt manuelt abonnement aktiveret",
      };
    }),

  adjustUserTrial: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        days: z.number().int().min(-365).max(365),
        reason: z.string().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const subscription = await ctx.db.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, input.userId),
      });

      if (!subscription) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Intet abonnement fundet for denne bruger",
        });
      }

      // Allow adjustment if user is trialing OR has a future trial end date
      // (Alunta webhooks may set status to "active" even during our local trial)
      const hasActiveTrial =
        subscription.status === "trialing" ||
        (subscription.trialEndsAt && subscription.trialEndsAt > new Date());

      if (!hasActiveTrial) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bruger er ikke i prøveperiode",
        });
      }

      const oldTrialEnd = new Date(subscription.trialEndsAt);
      const newTrialEnd = new Date(oldTrialEnd);
      newTrialEnd.setDate(newTrialEnd.getDate() + input.days);

      // Don't allow setting trial end in the past (use at least tomorrow)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (newTrialEnd < tomorrow && input.days < 0) {
        newTrialEnd.setTime(tomorrow.getTime());
      }

      // Update locally
      await ctx.db
        .update(subscriptions)
        .set({
          trialEndsAt: newTrialEnd,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, subscription.id));

      // Sync trial end date to Alunta (so billing start aligns)
      const aluntaSubscriptionId = subscription.aluntaSubscriptionId;
      const aluntaLinked = !!aluntaSubscriptionId;
      let aluntaSynced = false;
      if (aluntaSubscriptionId) {
        try {
          const endDateStr = toLocalDateStr(newTrialEnd);
          await alunta.subscriptions.updateTrial(
            aluntaSubscriptionId,
            endDateStr,
          );
          aluntaSynced = true;
        } catch (err) {
          // Non-fatal: local trial still controls app access
          // Alunta may reject if trial is locked (already invoiced)
          console.warn("Failed to sync trial to Alunta:", err);
        }
      }

      const action =
        input.days >= 0 ? "extend_user_trial" : "reduce_user_trial";
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        action,
        input.userId,
        {
          daysChanged: input.days,
          oldTrialEnd: oldTrialEnd.toISOString(),
          newTrialEnd: newTrialEnd.toISOString(),
          reason: input.reason,
          aluntaLinked,
          aluntaSynced,
        },
        ctx.headers,
      );

      return {
        success: true,
        newTrialEnd,
        aluntaLinked,
        aluntaSynced,
      };
    }),

  // ============================================
  // Alunta Subscription Discount Management
  // ============================================

  listSubscriptionDiscounts: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [sub] = await ctx.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, input.userId))
        .limit(1);

      if (!sub?.aluntaSubscriptionId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Brugeren har ikke et Alunta-abonnement",
        });
      }

      const result = await alunta.subscriptions.listDiscounts(
        sub.aluntaSubscriptionId,
      );
      return result.data;
    }),

  deleteSubscriptionDiscount: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        discountUuid: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [sub] = await ctx.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, input.userId))
        .limit(1);

      if (!sub?.aluntaSubscriptionId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Brugeren har ikke et Alunta-abonnement",
        });
      }

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "delete_subscription_discount",
        input.userId,
        {
          discountUuid: input.discountUuid,
          aluntaSubscriptionId: sub.aluntaSubscriptionId,
        },
        ctx.headers,
      );

      await alunta.subscriptions.deleteDiscount(
        sub.aluntaSubscriptionId,
        input.discountUuid,
      );

      return { success: true };
    }),
});
