import { NextResponse } from "next/server";
import { authBrandForHost } from "@/lib/auth/host-auth";
import { oauthAvailability } from "@/lib/auth/social-providers";
import { DEFAULT_BRAND_KEY } from "@/lib/brands/registry";
import { isMailAvailable } from "@/lib/email/transport";

export const dynamic = "force-dynamic";

/**
 * Returns which authentication providers are available.
 * This helps the frontend show only the auth methods that are configured.
 *
 * OAuth følger hostens brand (samme valg som /api/auth): TimeWren-hosts viser
 * kun udbydere med en TimeWren-klient (TIMEWREN_GOOGLE_CLIENT_ID osv.).
 */
export async function GET(req: Request) {
  const authBrand = authBrandForHost(req.headers.get("host"));
  const providers = {
    // OAuth providers
    ...oauthAvailability(authBrand),

    // Email/password is always enabled
    email: true,

    // Magic link is always enabled (uses Resend)
    magicLink: isMailAvailable(),

    // Phone/SMS requires MessageBird. Kun standardinstansen har SMS-login
    // (TimeWren-instansen er uden phoneNumber-pluginet).
    phone:
      authBrand === DEFAULT_BRAND_KEY &&
      Boolean(process.env.MESSAGEBIRD_API_KEY),

    // Passkey is always available (browser-dependent)
    passkey: true,
  };

  return NextResponse.json(providers);
}
