import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { bannedEmailDomains, users } from "@/lib/db/schema";
import { sendSignupPasswordEmail } from "@/lib/email/signup-password";
import {
  DISPOSABLE_EMAIL_ERROR,
  isDisposableEmail,
} from "@/lib/utils/email-blocklist";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";
import { publicProcedure, router } from "../trpc";

// Generate a cryptographically secure random password
function generateSecurePassword(length = 16): string {
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const numbers = "0123456789";
  const special = "!@#$%^&*";
  const allChars = lowercase + uppercase + numbers + special;

  // Use crypto.randomBytes for secure random selection
  function secureRandomIndex(max: number): number {
    const randomBytes = crypto.randomBytes(4);
    return randomBytes.readUInt32BE(0) % max;
  }

  let password = "";

  // Ensure at least one of each type
  password += lowercase[secureRandomIndex(lowercase.length)];
  password += uppercase[secureRandomIndex(uppercase.length)];
  password += numbers[secureRandomIndex(numbers.length)];
  password += special[secureRandomIndex(special.length)];

  // Fill the rest with cryptographically random characters
  for (let i = password.length; i < length; i++) {
    password += allChars[secureRandomIndex(allChars.length)];
  }

  // Shuffle using Fisher-Yates with crypto.randomBytes
  const chars = password.split("");
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const quickSignupInput = z.object({
  email: z.string().email({ error: () => st("zod.invalidEmail") }),
  name: z
    .string()
    .min(1, { error: () => st("zod.enterName") })
    .optional(),
  // Honeypot field - should always be empty (bots fill it)
  website: z.string().max(0).optional(),
});

export const quickSignupRouter = router({
  register: publicProcedure
    .input(quickSignupInput)
    .mutation(async ({ ctx, input }) => {
      // Honeypot check - if website field is filled, it's a bot
      if (input.website && input.website.length > 0) {
        // Silently reject but return success to not tip off the bot
        return {
          success: true,
          message: await tr("serverErrors", "quickSignup.created"),
          credentials: {
            email: input.email,
            password: "dummy",
          },
          user: {
            email: input.email,
            name: input.name || input.email.split("@")[0],
          },
        };
      }

      // Rate limiting - 3 signups per hour per IP
      const clientIp = ctx.headers ? getClientIp(ctx.headers) : "unknown";
      await rateLimiter.checkOrThrow(
        ipRateLimitKey(clientIp, "signup"),
        "signup",
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
          throw new Error(
            await tr("serverErrors", "quickSignup.emailNotAllowed"),
          );
        }
      }

      // Check if email already exists
      const existingUser = await ctx.db.query.users.findFirst({
        where: eq(users.email, input.email),
      });

      if (existingUser) {
        throw new Error(await tr("serverErrors", "quickSignup.emailTaken"));
      }

      // Generate secure password
      const generatedPassword = generateSecurePassword();

      // Extract name from email if not provided
      const userName = input.name || input.email.split("@")[0];

      // Create user using Better-Auth (it will handle password hashing and auto-signin)
      // We need to use the Better-Auth API directly
      // Multibrand: kontoen oprettes af hostens auth-instans (og får dens brand).
      const { authForHost } = await import("@/lib/auth");
      const auth = authForHost(ctx.headers?.get("host"));

      try {
        // Create the user through Better-Auth WITHOUT auto-signin
        // The client will handle the actual signin to properly set cookies
        const signupResult = await auth.api.signUpEmail({
          body: {
            email: input.email,
            password: generatedPassword,
            name: userName,
            callbackURL: "/dashboard", // Where to redirect after email verification if needed
          },
        });

        if (!signupResult) {
          throw new Error(await tr("serverErrors", "quickSignup.createFailed"));
        }

        // Send password email
        try {
          await sendSignupPasswordEmail({
            to: input.email,
            name: userName,
            password: generatedPassword,
          });
        } catch (emailError) {
          // Log error but don't fail signup
          console.error("Failed to send password email:", emailError);
          // Still return success since user was created
        }

        return {
          success: true,
          message: await tr("serverErrors", "quickSignup.created"),
          credentials: {
            email: input.email,
          },
          user: {
            email: input.email,
            name: userName,
          },
        };
      } catch (error) {
        console.error("Signup error:", error);
        throw new Error(
          error instanceof Error
            ? error.message
            : await tr("serverErrors", "quickSignup.error"),
        );
      }
    }),
});
