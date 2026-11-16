import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  NUDGE_SURFACES,
  nudgeDismissKey,
  nudgeKeyPrefix,
} from "@/lib/adoption/nudges";
import { users } from "@/lib/db/schema";
import { trackEvent } from "@/lib/telemetry/track";
import { copenhagenToday } from "@/lib/time/copenhagen";
import { protectedProcedure, router } from "../trpc";

const nudgeInput = z.object({
  nudge: z.enum(["invoice", "prepaid"]),
  surface: z.enum(NUDGE_SURFACES),
  clientId: z.string().uuid(),
});

/**
 * Afvisning og måling af kontekstuelle nudges (#89/#90). Selve forslagene
 * hentes via invoices.nudgeCandidates og prepaid.suggestions, som er
 * plan-/modul-gatede.
 */
export const nudgesRouter = router({
  /**
   * "Ikke nu": gemmes i users.dismissedBanners. Faktura-nudges snoozes 30
   * dage, klippekort-forslag afvises permanent for kunden. Tidligere nøgler
   * for samme kunde+type fjernes i samme UPDATE, så arrayet ikke vokser.
   */
  dismiss: protectedProcedure
    .input(nudgeInput)
    .mutation(async ({ ctx, input }) => {
      const key = nudgeDismissKey(
        input.nudge,
        input.clientId,
        copenhagenToday(),
      );
      const prefix = nudgeKeyPrefix(input.nudge, input.clientId);
      await ctx.db
        .update(users)
        .set({
          dismissedBanners: sql`array_append(ARRAY(SELECT k FROM unnest(COALESCE(${users.dismissedBanners}, ARRAY[]::text[])) AS k WHERE k <> ${prefix} AND k NOT LIKE ${`${prefix}:%`}), ${key})`,
          updatedAt: new Date(),
        })
        .where(sql`${users.id} = ${ctx.session.user.id}`);

      trackEvent({
        userId: ctx.session.user.id,
        orgId: ctx.orgId,
        event: "nudge.dismissed",
        metadata: input,
      });
      return { success: true };
    }),

  /** Måling: nudge vist / klikket. Fire-and-forget. */
  track: protectedProcedure
    .input(nudgeInput.extend({ action: z.enum(["shown", "clicked"]) }))
    .mutation(({ ctx, input }) => {
      const { action, ...metadata } = input;
      trackEvent({
        userId: ctx.session.user.id,
        orgId: ctx.orgId,
        event: action === "shown" ? "nudge.shown" : "nudge.clicked",
        metadata,
      });
      return { success: true };
    }),
});
