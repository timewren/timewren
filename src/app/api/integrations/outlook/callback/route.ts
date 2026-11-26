import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { tr } from "@/i18n/server-text";
import { auth } from "@/lib/auth";
import { accountBrand } from "@/lib/auth/account-brand";
import { requestAppUrl } from "@/lib/brands/app-url";
import { type BrandKey, DEFAULT_BRAND_KEY } from "@/lib/brands/registry";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { calendarAppUrl } from "@/lib/integrations/calendar-oauth-clients";
import { verifyCalendarOAuthState } from "@/lib/integrations/calendar-oauth-state";
import {
  exchangeOutlookCode,
  isOutlookCalendarAvailableForBrand,
  saveOutlookConnection,
  syncOutlookCalendar,
} from "@/lib/integrations/outlook-calendar";
import {
  OUTLOOK_PKCE_COOKIE,
  OUTLOOK_STATE_COOKIE,
  outlookCookieOptions,
} from "@/lib/integrations/outlook-cookies";

const INTEGRATIONS_PATH = "/dashboard/settings/integrations";

/**
 * GET /api/integrations/outlook/callback
 *
 * Microsoft sender brugeren tilbage med `code` og `state`. Staten skal stå i
 * flowets cookie, være signeret, ikke udløbet og udstedt til den indloggede
 * konto og dens brand. Code udveksles med brandets klient og PKCE-verifieren;
 * tokens gemmes krypteret.
 */
export async function GET(request: NextRequest) {
  let brand: BrandKey = DEFAULT_BRAND_KEY;
  const redirect = (query: string) => {
    const response = NextResponse.redirect(
      new URL(
        `${INTEGRATIONS_PATH}?${query}`,
        calendarAppUrl(brand) || request.url,
      ),
    );
    // Flowets cookies bruges kun én gang
    response.cookies.set(OUTLOOK_STATE_COOKIE, "", outlookCookieOptions(0));
    response.cookies.set(OUTLOOK_PKCE_COOKIE, "", outlookCookieOptions(0));
    return response;
  };

  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return NextResponse.redirect(
        new URL(
          "/auth/signin?error=not_authenticated",
          (await requestAppUrl()) || request.url,
        ),
      );
    }
    const userId = session.user.id;

    brand = await accountBrand(db, userId);
    if (!isOutlookCalendarAvailableForBrand(brand)) {
      return redirect("error=not_available");
    }

    const params = request.nextUrl.searchParams;
    const verified = verifyCalendarOAuthState({
      state: params.get("state"),
      cookieState: request.cookies.get(OUTLOOK_STATE_COOKIE)?.value,
      userId,
      provider: "outlook",
    });
    if (!verified.ok || verified.brand !== brand) {
      console.error(
        `Outlook OAuth state check failed: ${verified.ok ? "brand_mismatch" : verified.reason}`,
      );
      return redirect("error=invalid_state");
    }

    const error = params.get("error");
    if (error) {
      console.error("Outlook OAuth error:", error);
      return redirect(`error=${encodeURIComponent(error)}`);
    }

    const code = params.get("code");
    const codeVerifier = request.cookies.get(OUTLOOK_PKCE_COOKIE)?.value;
    if (!code || !codeVerifier) return redirect("error=no_code");

    const tokens = await exchangeOutlookCode({ brand, code, codeVerifier });
    const membership = await db.query.members.findFirst({
      where: eq(members.userId, userId),
      columns: { organizationId: true },
    });
    await saveOutlookConnection({
      userId,
      orgId: membership?.organizationId ?? null,
      brand,
      tokens,
    });

    // Første synk med det samme, så kalenderen ikke er tom til næste cron.
    // En fejl her må ikke vælte forbindelsen; den vises på siden.
    await syncOutlookCalendar(userId, { force: true }).catch((err: unknown) =>
      console.error(
        "[Outlook] Første synk fejlede:",
        err instanceof Error ? err.message : err,
      ),
    );

    return redirect("success=outlook_connected");
  } catch (error) {
    console.error(
      "Outlook OAuth callback error:",
      error instanceof Error ? error.message : error,
    );
    return redirect(
      `error=${encodeURIComponent(await tr("serverErrors", "api.integrations.outlookFailed"))}`,
    );
  }
}
