import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { DEMO_UNAVAILABLE_CODE, isDemoMode } from "@/lib/demo/demo-mode";
import {
  buildDineroAuthorizationRequest,
  isDineroOAuthConfigured,
} from "@/lib/integrations/dinero-oauth";
import { appUrlEnv } from "@/lib/runtime-env";

/**
 * Resolve the public URL of this deployment in the face of reverse
 * proxies. `request.url` can show the internal container host
 * (`0.0.0.0:3000`) behind Traefik/Dokploy; `NEXT_PUBLIC_APP_URL` can be
 * misconfigured (e.g. copied from .env.example). So we prefer real
 * forwarded headers over both of those.
 */
function appUrl(request: NextRequest): string {
  const isBadHost = (s: string | null | undefined) =>
    !s || s.includes("0.0.0.0") || s.includes("localhost:3000");

  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (!isBadHost(forwardedHost)) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = request.headers.get("host");
  if (!isBadHost(host)) {
    const proto = request.nextUrl.protocol.replace(":", "") || "https";
    return `${proto}://${host}`;
  }

  const envUrl = appUrlEnv();
  if (envUrl && !isBadHost(new URL(envUrl).host)) {
    return envUrl.replace(/\/$/, "");
  }

  return request.nextUrl.origin;
}

/**
 * GET /api/integrations/dinero/start
 *
 * Initiates the Dinero OAuth flow (OpenID Connect hybrid: `code id_token`
 * with PKCE S256, response_mode=form_post).
 *
 * The callback arrives as a cross-site POST, which strips SameSite=Lax
 * cookies — including Better-Auth's session cookie. So we cannot rely on
 * the session at callback time; instead we persist the user id in our
 * own OAuth cookies (HttpOnly + Secure + SameSite=None) that survive the
 * cross-site POST. The cookies only contain flow-specific values and are
 * short-lived (10 min), so the exposure is minimal.
 */
export async function GET(request: NextRequest) {
  const base = appUrl(request);
  const errorRedirect = (code: string) =>
    NextResponse.redirect(
      `${base}/dashboard/settings/integrations?error=${code}`,
    );
  if (isDemoMode()) return errorRedirect(DEMO_UNAVAILABLE_CODE);

  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.id) {
    return NextResponse.redirect(`${base}/auth/signin?error=not_authenticated`);
  }

  if (!isDineroOAuthConfigured()) {
    return errorRedirect("dinero_not_configured");
  }

  const authRequest = buildDineroAuthorizationRequest();

  const response = NextResponse.redirect(authRequest.url);

  // SameSite=None is required because response_mode=form_post triggers
  // a cross-site POST that Lax would block. Secure is required for
  // SameSite=None, which is fine in production (HTTPS). Locally over
  // HTTP the Secure flag prevents the cookie from being set — but
  // Dinero OAuth in local dev needs an HTTPS tunnel (ngrok etc.) anyway.
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    path: "/",
    maxAge: 600,
  };

  response.cookies.set("dinero_oauth_state", authRequest.state, cookieOptions);
  response.cookies.set("dinero_oauth_nonce", authRequest.nonce, cookieOptions);
  response.cookies.set(
    "dinero_oauth_pkce",
    authRequest.codeVerifier,
    cookieOptions,
  );
  // Persist the admin user id across the cross-site POST since the
  // session cookie (SameSite=Lax) will not be sent to the callback.
  response.cookies.set("dinero_oauth_uid", session.user.id, cookieOptions);

  return response;
}
