import crypto from "node:crypto";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getEconomicGrantUrl,
  isEconomicGrantConfigured,
} from "@/lib/integrations/economic-grant";
import { appUrlEnv } from "@/lib/runtime-env";

/**
 * Resolve the public URL of this deployment in the face of reverse
 * proxies. See dinero/start/route.ts for the rationale.
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
 * GET /api/integrations/economic/start
 *
 * Initiates the e-conomic App Access Grant flow. Sets a CSRF state
 * cookie server-side and redirects the user to e-conomic's grant
 * screen. This is the "install URL" we expose on /integrations/economic
 * — it replaces the old TRPC mutation so anyone can link straight to
 * it (e.g. from the public integrations marketing page).
 */
export async function GET(request: NextRequest) {
  const base = appUrl(request);
  const errorRedirect = (code: string) =>
    NextResponse.redirect(
      `${base}/dashboard/settings/integrations?error=${code}`,
    );

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    // Not logged in: send to login and come back here afterwards.
    return NextResponse.redirect(
      `${base}/login?redirect=${encodeURIComponent(
        "/api/integrations/economic/start",
      )}`,
    );
  }

  if (!isEconomicGrantConfigured()) {
    return errorRedirect("economic_not_configured");
  }

  const state = crypto.randomUUID();
  const grantUrl = getEconomicGrantUrl(state);

  const response = NextResponse.redirect(grantUrl);

  // SameSite=Lax is fine here — e-conomic redirects back as a GET
  // (cross-site navigation, not cross-site POST), so Lax cookies
  // are delivered.
  response.cookies.set("economic_grant_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return response;
}
