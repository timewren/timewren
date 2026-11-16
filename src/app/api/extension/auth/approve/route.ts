import { NextResponse } from "next/server";
import { tr } from "@/i18n/server-text";
import { auth } from "@/lib/auth";
import { resolvePrimaryOrgId } from "@/lib/auth/active-org";
import { db } from "@/lib/db";
import { extensionTokens } from "@/lib/db/schema";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/desktop-rate-limit";
import {
  generateExtensionToken,
  isAllowedExtensionRedirectUri,
} from "@/lib/extension-auth";
import { hashToken } from "@/lib/security/token-hash";

/**
 * POST /api/extension/auth/approve
 *
 * Called from the browser when the user clicks "Forbind" on the extension
 * authorization page (/auth/extension). Mints a long-lived extension token
 * bound to the authenticated user.
 *
 * Body: { redirectUri: string, browser?: "chrome" | "firefox" }
 * Returns: { token: string, defaultOrgId: string | null }
 */
export async function POST(request: Request) {
  // Rate limit: 10 approvals per minute per IP.
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`ext-auth-approve:${ip}`, 10, 60_000))) {
    return rateLimitResponse();
  }

  try {
    // 1. Require an authenticated Better-Auth session.
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: await tr("serverErrors", "api.notAuthorized") },
        { status: 401 },
      );
    }
    const userId = session.user.id;

    // 2. Parse and validate the request body.
    let body: { redirectUri?: string; browser?: "chrome" | "firefox" };
    try {
      body = (await request.json()) as {
        redirectUri?: string;
        browser?: "chrome" | "firefox";
      };
    } catch {
      return NextResponse.json(
        { error: await tr("serverErrors", "api.invalidRequest") },
        { status: 400 },
      );
    }

    // 3. Validate the redirect URI so we never mint a token for a page that
    //    would leak it to a non-extension origin.
    if (!body.redirectUri || !isAllowedExtensionRedirectUri(body.redirectUri)) {
      return NextResponse.json(
        { error: await tr("serverErrors", "api.ext.invalidRedirect") },
        { status: 400 },
      );
    }

    // 4. Resolve the user's primary org (owner-preferred) as the token default.
    const defaultOrgId = await resolvePrimaryOrgId({ db, userId });

    // 5. Mint the token row (reuses the same extension_tokens table as the
    //    manual token-paste flow).
    const tokenName =
      body.browser === "firefox" ? "Firefox Extension" : "Chrome Extension";
    const token = generateExtensionToken();
    await db.insert(extensionTokens).values({
      userId,
      organizationId: defaultOrgId,
      // Kun hashen gemmes (#713); klartekst returneres én gang herunder.
      tokenHash: hashToken(token),
      name: tokenName,
    });

    return NextResponse.json({ token, defaultOrgId });
  } catch (error) {
    console.error("[Extension Auth Approve] Error:", error);
    return NextResponse.json(
      { error: await tr("serverErrors", "api.approvalFailed") },
      { status: 500 },
    );
  }
}
