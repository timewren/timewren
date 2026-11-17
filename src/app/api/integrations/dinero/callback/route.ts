import { eq, lt } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { tr } from "@/i18n/server-text";
import { db } from "@/lib/db";
import { dineroOAuthPending } from "@/lib/db/schema";
import { DEMO_UNAVAILABLE_CODE, isDemoMode } from "@/lib/demo/demo-mode";
import {
  exchangeDineroCodeForTokens,
  fetchDineroOrganizations,
  saveDineroConnection,
  verifyDineroIdToken,
} from "@/lib/integrations/dinero-oauth";
import { appUrlEnv } from "@/lib/runtime-env";
import { encrypt } from "@/lib/utils/encryption";

const VISMA_ISSUER = "https://connect.visma.com";
const INTEGRATIONS_PATH = "/dashboard/settings/integrations";

/**
 * Resolve the public URL. See start/route.ts for the priority: real
 * forwarded headers win over a possibly-misconfigured
 * NEXT_PUBLIC_APP_URL or an internal `request.url`.
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
 * OAuth callback for Dinero via Visma Connect.
 *
 * Hybrid flow (`response_type=code id_token`) uses `response_mode=form_post`,
 * which is a cross-site POST. This strips SameSite=Lax cookies — the user's
 * session cookie is NOT available here. Instead, the admin's user id is
 * persisted in our own OAuth cookie (HttpOnly + Secure + SameSite=None,
 * set by /start) together with state, nonce and the PKCE verifier.
 *
 * The GET handler only runs for error redirects where Visma bounces back
 * with query params.
 */
export async function POST(request: NextRequest) {
  return handleCallback(request, "post");
}

export async function GET(request: NextRequest) {
  return handleCallback(request, "get");
}

async function handleCallback(
  request: NextRequest,
  verb: "get" | "post",
): Promise<NextResponse> {
  const base = appUrl(request);
  // 303 "See Other" forces the browser to follow the Location with a GET
  // even when the original request was POST (form_post). NextResponse
  // defaults to 307 which preserves the method, causing the service
  // worker / Next router to receive a POST at the settings page and
  // bounce it to /login.
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
    // Read response params from either POST body (form_post) or query.
    let code: string | null = null;
    let state: string | null = null;
    let idToken: string | null = null;
    let iss: string | null = null;
    let oauthError: string | null = null;

    if (verb === "post") {
      const form = await request.formData();
      code = (form.get("code") as string | null) ?? null;
      state = (form.get("state") as string | null) ?? null;
      idToken = (form.get("id_token") as string | null) ?? null;
      iss = (form.get("iss") as string | null) ?? null;
      oauthError = (form.get("error") as string | null) ?? null;
    } else {
      code = request.nextUrl.searchParams.get("code");
      state = request.nextUrl.searchParams.get("state");
      idToken = request.nextUrl.searchParams.get("id_token");
      iss = request.nextUrl.searchParams.get("iss");
      oauthError = request.nextUrl.searchParams.get("error");
    }

    if (oauthError) {
      console.error("Dinero OAuth error:", oauthError);
      return errorRedirect(oauthError);
    }

    // RFC 9207 — validate issuer when present.
    if (iss && iss !== VISMA_ISSUER) {
      console.error("Dinero OAuth iss mismatch:", iss);
      return errorRedirect("invalid_issuer");
    }

    // All flow cookies were set by /start with SameSite=None so they
    // survive the cross-site POST from Visma. Their presence + matching
    // state is our authentication: no one else could have set them.
    const storedState = request.cookies.get("dinero_oauth_state")?.value;
    const storedNonce = request.cookies.get("dinero_oauth_nonce")?.value;
    const codeVerifier = request.cookies.get("dinero_oauth_pkce")?.value;
    const userId = request.cookies.get("dinero_oauth_uid")?.value;

    if (!state || !storedState || state !== storedState) {
      console.error("Dinero OAuth state mismatch");
      return errorRedirect("invalid_state");
    }

    if (!storedNonce || !codeVerifier || !userId) {
      return errorRedirect("missing_session");
    }

    if (!code) return errorRedirect("no_code");
    if (!idToken) return errorRedirect("no_id_token");

    try {
      await verifyDineroIdToken(idToken, storedNonce);
    } catch (err) {
      console.error("Dinero ID token verification failed:", err);
      return errorRedirect("invalid_id_token");
    }

    const tokens = await exchangeDineroCodeForTokens(code, codeVerifier);

    const orgs = await fetchDineroOrganizations(tokens.accessToken);
    const proOrgs = orgs.filter((org) => org.isPro);
    if (proOrgs.length === 0) {
      return errorRedirect("dinero_no_pro_org");
    }

    // Clean up expired pending rows opportunistically
    await db
      .delete(dineroOAuthPending)
      .where(lt(dineroOAuthPending.expiresAt, new Date()));

    let response: NextResponse;

    if (proOrgs.length === 1) {
      // @ts-expect-error - db type mismatch between drizzle versions
      await saveDineroConnection(db, userId, tokens, {
        id: proOrgs[0].id,
        name: proOrgs[0].name,
      });
      response = successRedirect("dinero_connected");
    } else {
      await db
        .delete(dineroOAuthPending)
        .where(eq(dineroOAuthPending.userId, userId));

      await db.insert(dineroOAuthPending).values({
        userId,
        encryptedAccessToken: encrypt(tokens.accessToken),
        encryptedRefreshToken: encrypt(tokens.refreshToken),
        tokenExpiry: new Date(Date.now() + tokens.expiresIn * 1000),
        organizations: proOrgs,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      response = NextResponse.redirect(
        `${base}${INTEGRATIONS_PATH}?pending=dinero_org_select`,
        { status: 303 },
      );
    }

    for (const name of [
      "dinero_oauth_state",
      "dinero_oauth_nonce",
      "dinero_oauth_pkce",
      "dinero_oauth_uid",
    ]) {
      response.cookies.set(name, "", { path: "/", maxAge: 0 });
    }
    return response;
  } catch (error) {
    console.error("Dinero OAuth callback error:", error);
    return errorRedirect(
      await tr("serverErrors", "api.integrations.dineroFailed"),
    );
  }
}
