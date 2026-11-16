import { and, count, desc, eq, gte, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { bannedEmailDomains, betaSignups } from "@/lib/db/schema";
import { sendBetaInviteEmail } from "@/lib/email/beta-invite";
import {
  DISPOSABLE_EMAIL_ERROR,
  isDisposableEmail,
} from "@/lib/utils/email-blocklist";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";
import {
  adminProcedure,
  publicProcedure,
  router,
  supporterProcedure,
} from "../trpc";

const betaSignupInput = z.object({
  email: z.string().email({ error: () => st("zod.invalidEmail") }),
  name: z.string().optional(),
  company: z.string().optional(),
  currentTool: z.enum(["effihub", "excel", "andet", "ingen"]).optional(),
  message: z
    .string()
    .max(500, { error: () => st("zod.messageMax500") })
    .optional(),
  referralSource: z.string().optional(),
  // Honeypot field - should always be empty (bots fill it)
  website: z.string().max(0).optional(),
});

export const betaSignupRouter = router({
  register: publicProcedure
    .input(betaSignupInput)
    .mutation(async ({ ctx, input }) => {
      // Honeypot check - if website field is filled, it's a bot
      if (input.website && input.website.length > 0) {
        // Silently reject but return success to not tip off the bot
        return {
          success: true,
          message: await tr("serverErrors", "beta.thanks"),
        };
      }

      // Rate limiting - 5 beta signups per hour per IP
      const clientIp = ctx.headers ? getClientIp(ctx.headers) : "unknown";
      await rateLimiter.checkOrThrow(
        ipRateLimitKey(clientIp, "betaSignup"),
        "betaSignup",
      );

      // Check for disposable email
      if (isDisposableEmail(input.email)) {
        throw new Error(DISPOSABLE_EMAIL_ERROR);
      }

      // Check for admin-banned email domain
      const emailDomain = input.email.split("@")[1]?.toLowerCase();
      if (emailDomain) {
        const bannedDomain = await ctx.db.query.bannedEmailDomains.findFirst({
          where: eq(bannedEmailDomains.domain, emailDomain),
        });
        if (bannedDomain) {
          throw new Error(await tr("serverErrors", "beta.emailNotAllowed"));
        }
      }

      // Check if email already exists
      const existingSignup = await ctx.db.query.betaSignups.findFirst({
        where: eq(betaSignups.email, input.email),
      });

      if (existingSignup) {
        throw new Error(await tr("serverErrors", "beta.alreadyOnList"));
      }

      // Insert new beta signup
      await ctx.db.insert(betaSignups).values({
        email: input.email,
        name: input.name,
        company: input.company,
        currentTool: input.currentTool,
        message: input.message,
        referralSource: input.referralSource,
        status: "pending",
      });

      return {
        success: true,
        message: await tr("serverErrors", "beta.thanks"),
      };
    }),

  // Admin endpoint to get beta signup count (for landing page stats)
  getCount: publicProcedure.query(async ({ ctx }) => {
    const result = await ctx.db
      .select({ count: betaSignups.id })
      .from(betaSignups);
    return result.length;
  }),

  // ============================================
  // Admin procedures
  // ============================================

  adminList: supporterProcedure
    .input(
      z.object({
        search: z.string().optional(),
        status: z
          .enum(["all", "pending", "invited", "registered", "rejected"])
          .optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { search, status, page, pageSize } = input;

      const conditions = [];

      if (status && status !== "all") {
        conditions.push(eq(betaSignups.status, status));
      }

      if (search) {
        conditions.push(
          or(
            ilike(betaSignups.email, `%${search}%`),
            ilike(betaSignups.name, `%${search}%`),
            ilike(betaSignups.company, `%${search}%`),
          ),
        );
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [items, totalResult] = await Promise.all([
        ctx.db
          .select()
          .from(betaSignups)
          .where(where)
          .orderBy(desc(betaSignups.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        ctx.db.select({ count: count() }).from(betaSignups).where(where),
      ]);

      return {
        items,
        total: totalResult[0]?.count ?? 0,
        page,
        pageSize,
        totalPages: Math.ceil((totalResult[0]?.count ?? 0) / pageSize),
      };
    }),

  adminStats: supporterProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalResult,
      pendingResult,
      invitedResult,
      registeredResult,
      rejectedResult,
      thisWeekResult,
    ] = await Promise.all([
      ctx.db.select({ count: count() }).from(betaSignups),
      ctx.db
        .select({ count: count() })
        .from(betaSignups)
        .where(eq(betaSignups.status, "pending")),
      ctx.db
        .select({ count: count() })
        .from(betaSignups)
        .where(eq(betaSignups.status, "invited")),
      ctx.db
        .select({ count: count() })
        .from(betaSignups)
        .where(eq(betaSignups.status, "registered")),
      ctx.db
        .select({ count: count() })
        .from(betaSignups)
        .where(eq(betaSignups.status, "rejected")),
      ctx.db
        .select({ count: count() })
        .from(betaSignups)
        .where(gte(betaSignups.createdAt, weekAgo)),
    ]);

    return {
      total: totalResult[0]?.count ?? 0,
      pending: pendingResult[0]?.count ?? 0,
      invited: invitedResult[0]?.count ?? 0,
      registered: registeredResult[0]?.count ?? 0,
      rejected: rejectedResult[0]?.count ?? 0,
      thisWeek: thisWeekResult[0]?.count ?? 0,
    };
  }),

  adminUpdateStatus: adminProcedure
    .input(
      z.object({
        ids: z.array(z.string().uuid()),
        status: z.enum(["pending", "invited", "registered", "rejected"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(betaSignups)
        .set({ status: input.status })
        .where(inArray(betaSignups.id, input.ids));

      return { updated: input.ids.length };
    }),

  adminDelete: adminProcedure
    .input(
      z.object({
        ids: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(betaSignups)
        .where(inArray(betaSignups.id, input.ids));

      return { deleted: input.ids.length };
    }),

  adminSendEmail: adminProcedure
    .input(
      z.object({
        signupId: z.string().uuid(),
        discountCode: z.string().optional(),
        customMessage: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const signup = await ctx.db.query.betaSignups.findFirst({
        where: eq(betaSignups.id, input.signupId),
      });

      if (!signup) {
        throw new Error(await tr("serverErrors", "beta.signupNotFound"));
      }

      await sendBetaInviteEmail({
        to: signup.email,
        recipientName: signup.name ?? undefined,
        discountCode: input.discountCode,
        customMessage: input.customMessage,
      });

      // Update status to invited
      await ctx.db
        .update(betaSignups)
        .set({ status: "invited" })
        .where(eq(betaSignups.id, input.signupId));

      return { success: true, email: signup.email };
    }),
});
