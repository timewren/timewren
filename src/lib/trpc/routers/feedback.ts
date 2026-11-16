import { GetObjectCommand } from "@aws-sdk/client-s3";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { feedbackSubmissions, organizations, users } from "@/lib/db/schema";
import { reportIdPrefix } from "@/lib/feedback/report-id";
import { feedbackSubmitSchema } from "@/lib/feedback/schema";
import { FeedbackSubmitError, submitFeedback } from "@/lib/feedback/submit";
import { FEEDBACK_TYPES } from "@/lib/feedback/types";
import { S3_BUCKET, s3 } from "@/lib/s3";
import { getClientIp } from "@/lib/utils/rate-limiter";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "../trpc";

function toTrpcError(err: unknown): never {
  if (err instanceof FeedbackSubmitError) {
    throw new TRPCError({
      code: err.code === "RATE_LIMITED" ? "TOO_MANY_REQUESTS" : "BAD_REQUEST",
      message: err.message,
    });
  }
  throw err;
}

export const feedbackRouter = router({
  submit: protectedProcedure
    .input(feedbackSubmitSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await submitFeedback({
          db: ctx.db,
          user: ctx.session.user,
          orgId: ctx.orgId ?? null,
          input,
        });
      } catch (err) {
        toTrpcError(err);
      }
    }),

  // Mobilappen uden konto: samme pipeline (DB, mail, Discord, admin-side),
  // rate-limitet pr. installation og IP. Kontakt-mail er valgfri.
  submitAnonymous: publicProcedure
    .input(
      feedbackSubmitSchema.extend({
        installId: z.string().uuid(),
        contactEmail: z.string().email().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { installId, contactEmail, ...feedback } = input;
      try {
        return await submitFeedback({
          db: ctx.db,
          user: null,
          orgId: null,
          input: feedback,
          anonymous: {
            installId,
            contactEmail,
            ip: ctx.headers ? getClientIp(ctx.headers) : "unknown",
          },
        });
      } catch (err) {
        toTrpcError(err);
      }
    }),

  // Admin: liste over indsendt feedback med bruger/org-info
  adminList: adminProcedure
    .input(
      z.object({
        status: z.enum(["new", "seen", "closed"]).optional(),
        type: z.enum(FEEDBACK_TYPES).optional(),
        limit: z.number().min(1).max(200).default(50),
        // Rapportnummeret fra panelets bekræftelse (de første 8 tegn af
        // uuid'et) eller et længere stykke af det
        reportId: z.string().max(64).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const search = input.reportId?.trim() ? input.reportId : undefined;
      const prefix = search ? reportIdPrefix(search) : null;
      const where = and(
        input.status ? eq(feedbackSubmissions.status, input.status) : undefined,
        input.type ? eq(feedbackSubmissions.type, input.type) : undefined,
        // Præfikset er kun hex og bindestreg, så LIKE får ingen wildcards
        // udefra. Noget, der ikke kan være et uuid, finder intet
        search
          ? prefix
            ? sql`${feedbackSubmissions.id}::text like ${`${prefix}%`}`
            : sql`false`
          : undefined,
      );

      const [rows, [{ total }], [{ newCount }]] = await Promise.all([
        ctx.db
          .select({
            id: feedbackSubmissions.id,
            type: feedbackSubmissions.type,
            message: feedbackSubmissions.message,
            context: feedbackSubmissions.context,
            screenshotKey: feedbackSubmissions.screenshotKey,
            status: feedbackSubmissions.status,
            createdAt: feedbackSubmissions.createdAt,
            userName: users.name,
            userEmail: users.email,
            contactEmail: feedbackSubmissions.contactEmail,
            orgName: organizations.name,
          })
          .from(feedbackSubmissions)
          .leftJoin(users, eq(feedbackSubmissions.userId, users.id))
          .leftJoin(
            organizations,
            eq(feedbackSubmissions.organizationId, organizations.id),
          )
          .where(where)
          .orderBy(desc(feedbackSubmissions.createdAt))
          .limit(input.limit),
        ctx.db
          .select({ total: count() })
          .from(feedbackSubmissions)
          .where(where),
        ctx.db
          .select({ newCount: count() })
          .from(feedbackSubmissions)
          .where(eq(feedbackSubmissions.status, "new")),
      ]);

      return { rows, total: Number(total), newCount: Number(newCount) };
    }),

  // Admin: skift status (new/seen/closed)
  setStatus: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["new", "seen", "closed"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(feedbackSubmissions)
        .set({ status: input.status })
        .where(eq(feedbackSubmissions.id, input.id))
        .returning({ id: feedbackSubmissions.id });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true };
    }),

  // Admin: hent screenshot fra privat S3 som data-url
  getScreenshot: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.feedbackSubmissions.findFirst({
        where: eq(feedbackSubmissions.id, input.id),
        columns: { screenshotKey: true },
      });
      if (!row?.screenshotKey) throw new TRPCError({ code: "NOT_FOUND" });
      try {
        const obj = await s3.send(
          new GetObjectCommand({ Bucket: S3_BUCKET, Key: row.screenshotKey }),
        );
        const bytes = await obj.Body?.transformToByteArray();
        if (!bytes) throw new Error("tomt S3-objekt");
        return {
          dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
        };
      } catch (err) {
        console.error("[Feedback] Screenshot-hentning fejlede:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: await tr("serverErrors", "feedback.screenshotFailed"),
        });
      }
    }),
});
