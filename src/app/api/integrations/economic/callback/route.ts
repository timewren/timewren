import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { tr } from "@/i18n/server-text";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEMO_UNAVAILABLE_CODE, isDemoMode } from "@/lib/demo/demo-mode";
import { saveEconomicGrant } from "@/lib/integrations/economic-grant";
import { appUrlEnv } from "@/lib/runtime-env";

const INTEGRATIONS_PATH = "/dashboard/settings/integrations";

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
 * GET /api/integrations/economic/callback
 *
 * Callback for e-conomic's grant-access flow. e-conomic redirects the
 * user here with `?token=<AgreementGrantToken>&state=<CSRF state>`.
 *
 * Requires a session (Better-Auth cookie). For a future plug'n'play
 * install flow from e-conomic Market, this handler will accept an
 * un-authenticated user and stash the token in a pending-grants table.
 * For now it redirects to login with a return path.
 */
export async function GET(request: NextRequest) {
  const base = appUrl(request);
  const errorRedirect = (code: string) =>
    NextResponse.redirect(
      `${base}${INTEGRATIONS_PATH}?error=${encodeURIComponent(code)}`,
      { status: 303 },
    );
  const successRedirect = (code: string) =>
    NextResponse.redirect(
      `${base}${INTEGRATIONS_PATH}?success=${encodeURIComponent(code)}`,
      { status: 303 },
    );
  if (isDemoMode()) return errorRedirect(DEMO_UNAVAILABLE_CODE);

  try {
    const session = await auth.api.getSession({ headers: await headers() });

    if (!session?.user?.id) {
      return NextResponse.redirect(
        `${base}/login?redirect=${encodeURIComponent(INTEGRATIONS_PATH)}&error=not_authenticated`,
        { status: 303 },
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get("token");
    const state = searchParams.get("state");

    const storedState = request.cookies.get("economic_grant_state")?.value;
    if (!state || !storedState || state !== storedState) {
      console.error("e-conomic grant CSRF check failed: state mismatch");
      return errorRedirect("invalid_state");
    }

    if (!token) {
      return errorRedirect("economic_no_token");
    }

    // @ts-expect-error - db type mismatch between drizzle versions
    await saveEconomicGrant(db, session.user.id, token);

    const response = successRedirect("economic_connected");
    response.cookies.set("economic_grant_state", "", {
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    console.error("e-conomic callback error:", error);
    return errorRedirect(
      await tr("serverErrors", "api.integrations.economicFailed"),
    );
  }
}
