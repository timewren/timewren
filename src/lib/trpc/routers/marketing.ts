import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { marketingLeads } from "@/lib/db/schema";
import { sendToolGuideEmail, TOOL_GUIDES } from "@/lib/email/tool-guide";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";
import { publicProcedure, router } from "../trpc";

const leadInput = z.object({
  email: z
    .string()
    .max(255)
    .email({ error: () => st("zod.invalidEmailShort") }),
  tool: z
    .string()
    .refine((t) => t in TOOL_GUIDES, { error: () => st("zod.unknownTool") }),
  payload: z.record(z.string(), z.unknown()).optional(),
  consentText: z.string().min(10).max(500),
  // Honeypot — mennesker ser ikke feltet, bots udfylder det. Skal acceptere
  // vilkårligt indhold i SCHEMAET (ellers fejler valideringen hårdt før
  // handleren og afslører honeypotten) — selve checket sker i resolveren.
  website: z.string().max(255).optional(),
});

export const marketingRouter = router({
  captureLead: publicProcedure
    .input(leadInput)
    .mutation(async ({ ctx, input }) => {
      // Honeypot udfyldt → lad som om alt gik godt.
      if (input.website) {
        return { success: true };
      }

      const ip = ctx.headers ? getClientIp(ctx.headers) : "unknown";
      const email = input.email.trim().toLowerCase();

      // Dobbelt rate limit: pr. IP (spam fra én afsender) OG pr. mod-
      // tager-email (beskytter tredjepart mod at få tilsendt guides fra
      // mange IP'er). Endpointet sender reelle mails uden dobbelt opt-in —
      // accepteret risiko for v1, men capped ad begge akser.
      for (const key of [
        ipRateLimitKey(ip, "lead"),
        ipRateLimitKey(`email:${email}`, "lead"),
      ]) {
        const rateLimitResult = await rateLimiter.check(key, "lead");
        if (!rateLimitResult.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: await tr("serverErrors", "marketing.tooManyAttempts"),
          });
        }
      }

      // Idempotent: unique (email, tool) — gen-submit sender ikke ny mail.
      const inserted = await ctx.db
        .insert(marketingLeads)
        .values({
          email,
          tool: input.tool,
          payload: input.payload ?? null,
          consentText: input.consentText,
        })
        .onConflictDoNothing()
        .returning({ id: marketingLeads.id });

      if (inserted.length > 0) {
        // Mail-fejl må ikke vælte capture — leadet er gemt.
        try {
          await sendToolGuideEmail({ to: email, tool: input.tool });
        } catch (error) {
          console.error("tool-guide mail fejlede:", error);
        }
      }

      return { success: true };
    }),
});
