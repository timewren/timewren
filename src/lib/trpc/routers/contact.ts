import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { contactMessages } from "@/lib/db/schema";
import { notifyAdmin } from "@/lib/notifications/admin";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";
import { publicProcedure, router } from "../trpc";

const contactInput = z.object({
  name: z
    .string()
    .min(2, { error: () => st("zod.nameMin2") })
    .max(255),
  email: z
    .string()
    .max(255)
    .email({ error: () => st("zod.invalidEmail") }),
  subject: z
    .string()
    .min(5, { error: () => st("zod.subjectMin5") })
    .max(255),
  message: z
    .string()
    .min(10, { error: () => st("zod.messageMin10") })
    .max(5000),
});

const BETA_PLATFORM_LABEL = {
  ios: "iPhone",
  android: "Android",
  both: "iPhone og Android",
} as const;

const betaTesterInput = z.object({
  email: z
    .string()
    .max(255)
    .email({ error: () => st("zod.invalidEmail") }),
  platform: z.enum(["ios", "android", "both"]),
  // Honeypot — udfyldes kun af bots
  website: z.string().max(0).optional(),
});

export const contactRouter = router({
  send: publicProcedure.input(contactInput).mutation(async ({ ctx, input }) => {
    // Rate limit to prevent spam
    const ip = ctx.headers ? getClientIp(ctx.headers) : "unknown";
    const rateLimitKey = ipRateLimitKey(ip, "contact");
    const rateLimitResult = await rateLimiter.check(rateLimitKey, "contact");
    if (!rateLimitResult.allowed) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: await tr("serverErrors", "common.rateLimited", {
          seconds: Math.ceil(rateLimitResult.resetIn / 1000),
        }),
      });
    }

    // Insert contact message
    await ctx.db.insert(contactMessages).values({
      name: input.name,
      email: input.email,
      subject: input.subject,
      message: input.message,
      status: "new",
    });

    return {
      success: true,
      message: await tr("serverErrors", "contact.thanks"),
    };
  }),

  // Tilmelding som betatester af mobilappen (TestFlight / Play-test). Gemmes
  // som kontaktbesked og sendes til admin, så invitationen kan sendes manuelt.
  betaTester: publicProcedure
    .input(betaTesterInput)
    .mutation(async ({ ctx, input }) => {
      const ip = ctx.headers ? getClientIp(ctx.headers) : "unknown";
      const rateLimitResult = await rateLimiter.check(
        ipRateLimitKey(ip, "contact"),
        "contact",
      );
      if (!rateLimitResult.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: await tr("serverErrors", "common.rateLimited", {
            seconds: Math.ceil(rateLimitResult.resetIn / 1000),
          }),
        });
      }

      const platform = BETA_PLATFORM_LABEL[input.platform];

      await ctx.db.insert(contactMessages).values({
        name: "Betatester",
        email: input.email,
        subject: `Betatester: ${platform}`,
        message: `Vil gerne teste mobilappen på ${platform}.`,
        status: "new",
      });

      await notifyAdmin("beta_tester_signup", {
        userEmail: input.email,
        reason: `Platform: ${platform}`,
      });

      return { success: true };
    }),
});
