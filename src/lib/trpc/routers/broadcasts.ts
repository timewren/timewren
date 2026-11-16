import { z } from "zod";
import { tr } from "@/i18n/server-text";
import {
  createBroadcast,
  getBroadcast,
  listBroadcasts,
  removeBroadcast,
  sendBroadcast,
} from "@/lib/resend-broadcasts";
import { getSegmentCounts } from "@/lib/resend-segments";
import { adminProcedure, router } from "../trpc";
import { logAdminAction } from "./admin/shared";

export const broadcastsRouter = router({
  /**
   * List all broadcasts from Resend
   */
  list: adminProcedure.query(async () => {
    const data = await listBroadcasts();
    return data;
  }),

  /**
   * Get a specific broadcast
   */
  get: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const data = await getBroadcast(input.id);
      return data;
    }),

  /**
   * Create a new broadcast (draft)
   */
  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        subject: z.string().min(1).max(500),
        html: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const data = await createBroadcast({
        name: input.name,
        subject: input.subject,
        html: input.html,
      });
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "broadcast_create",
        null,
        { name: input.name, subject: input.subject, broadcastId: data?.id },
        ctx.headers,
      );
      return data;
    }),

  /**
   * Send a broadcast
   */
  send: adminProcedure
    .input(
      z.object({
        id: z.string(),
        // Typed confirmation: admin must type the broadcast name.
        // Prevents accidental mass-email sends.
        confirmName: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const broadcast = await getBroadcast(input.id);
      if (!broadcast) {
        throw new Error(await tr("serverErrors", "broadcasts.notFound"));
      }
      if (broadcast.name !== input.confirmName) {
        throw new Error(
          await tr("serverErrors", "broadcasts.confirmNameMismatch"),
        );
      }
      const data = await sendBroadcast(input.id);
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "broadcast_send",
        null,
        { broadcastId: input.id, name: broadcast.name },
        ctx.headers,
      );
      return data;
    }),

  /**
   * Remove a broadcast
   */
  remove: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const data = await removeBroadcast(input.id);
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "broadcast_remove",
        null,
        { broadcastId: input.id },
        ctx.headers,
      );
      return data;
    }),

  /**
   * Get segment counts for admin overview
   */
  segments: adminProcedure.query(async () => {
    const segments = await getSegmentCounts();
    return segments;
  }),
});
