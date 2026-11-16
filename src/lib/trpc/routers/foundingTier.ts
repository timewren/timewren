import { eq } from "drizzle-orm";
import { FOUNDING_MEMBER } from "@/lib/config";
import { subscriptions } from "@/lib/db/schema";
import { protectedProcedure, router } from "../trpc";

export const foundingTierRouter = router({
  /** Protected: current user's founding member status */
  getMyTier: protectedProcedure.query(async ({ ctx }) => {
    const sub = await ctx.db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, ctx.session.user.id),
      columns: {
        foundingTier: true,
        discountPercent: true,
        discountExpiresAt: true,
      },
    });

    if (sub?.foundingTier !== "founding_member") return null;

    return {
      key: "founding_member" as const,
      label: FOUNDING_MEMBER.label,
      discountPercent: sub.discountPercent ?? FOUNDING_MEMBER.discountPercent,
      discountForever: FOUNDING_MEMBER.discountForever,
      discountExpiresAt: sub.discountExpiresAt,
    };
  }),
});
