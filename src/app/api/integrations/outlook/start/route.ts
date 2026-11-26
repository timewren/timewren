import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { accountBrand } from "@/lib/auth/account-brand";
import { requestAppUrl } from "@/lib/brands/app-url";
import { db } from "@/lib/db";
import { calendarAppUrl } from "@/lib/integrations/calendar-oauth-clients";
import {
  buildOutlookAuthorizationRequest,
  getOutlookStatus,
  isOutlookCalendarAvailableForBrand,
} from "@/lib/integrations/outlook-calendar";
import {
  OUTLOOK_PKCE_COOKIE,
  OUTLOOK_STATE_COOKIE,
  outlookCookieOptions,
} from "@/lib/integrations/outlook-cookies";

const INTEGRATIONS_PATH = "/dashboard/settings/integrations";

/**
 * GET /api/integrations/outlook/start
 *
 * Starter Outlook-forbindelsen: signeret state (konto + brand + udløb) og en
 * PKCE-verifier i HttpOnly-cookies, derefter redirect til Microsoft. Klienten
 * vælges ud fra kontoens brand; uden brandets nøgler afvises flowet.
 */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.redirect(
      new URL(
        "/auth/signin?error=not_authenticated",
        (await requestAppUrl()) || request.url,
      ),
    );
  }

  const brand = await accountBrand(db, session.user.id);
  const base = calendarAppUrl(brand) || request.url;
  if (!isOutlookCalendarAvailableForBrand(brand)) {
    return NextResponse.redirect(
      new URL(`${INTEGRATIONS_PATH}?error=not_available`, base),
    );
  }

  const status = await getOutlookStatus(session.user.id);
  const authRequest = buildOutlookAuthorizationRequest({
    brand,
    userId: session.user.id,
    loginHint: status.accountEmail,
  });

  const response = NextResponse.redirect(authRequest.url);
  response.cookies.set(
    OUTLOOK_STATE_COOKIE,
    authRequest.state,
    outlookCookieOptions(),
  );
  response.cookies.set(
    OUTLOOK_PKCE_COOKIE,
    authRequest.codeVerifier,
    outlookCookieOptions(),
  );
  return response;
}
