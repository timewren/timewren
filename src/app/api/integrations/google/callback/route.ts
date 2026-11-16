import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { tr } from "@/i18n/server-text";
import { auth } from "@/lib/auth";
import { accountBrand } from "@/lib/auth/account-brand";
import { db } from "@/lib/db";
import {
  exchangeCodeForTokens,
  isGoogleCalendarAvailableForBrand,
  saveCalendarConnection,
} from "@/lib/integrations/google-calendar";
import { getCalendarAccessLevel } from "@/lib/integrations/google-calendar-scopes";
import { appUrlEnv } from "@/lib/runtime-env";

/**
 * Redirects skal bygges på appens offentlige adresse. Bag Traefik er
 * request.url containerens interne adresse (https://0.0.0.0:3000), så en
 * redirect ud fra den lander på en død side.
 */
function redirectBase(request: NextRequest): string {
  return appUrlEnv() || request.url;
}

/**
 * GET /api/integrations/google/callback
 *
 * OAuth2 callback endpoint for Google Calendar.
 * Handles the authorization code exchange and saves the connection.
 */
export async function GET(request: NextRequest) {
  try {
    // Get current user session
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.redirect(
        new URL("/auth/signin?error=not_authenticated", redirectBase(request)),
      );
    }

    // TimeWren-konti må aldrig forbindes med TimeTracks Google-klient.
    if (
      !isGoogleCalendarAvailableForBrand(
        await accountBrand(db, session.user.id),
      )
    ) {
      return NextResponse.redirect(
        new URL(
          "/dashboard/settings/integrations?error=not_available",
          redirectBase(request),
        ),
      );
    }

    // Get authorization code and state from URL
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const error = searchParams.get("error");
    const state = searchParams.get("state");

    // Verify OAuth state parameter to prevent CSRF
    const storedState = request.cookies.get("google_oauth_state")?.value;
    if (!state || !storedState || state !== storedState) {
      console.error("Google OAuth CSRF check failed: state mismatch");
      return NextResponse.redirect(
        new URL(
          "/dashboard/settings/integrations?error=invalid_state",
          redirectBase(request),
        ),
      );
    }

    // Handle error from Google
    if (error) {
      console.error("Google OAuth error:", error);
      return NextResponse.redirect(
        new URL(
          `/dashboard/settings/integrations?error=${encodeURIComponent(error)}`,
          redirectBase(request),
        ),
      );
    }

    // Verify we have a code
    if (!code) {
      return NextResponse.redirect(
        new URL(
          "/dashboard/settings/integrations?error=no_code",
          redirectBase(request),
        ),
      );
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);

    // Save the connection
    await saveCalendarConnection(session.user.id, tokens);

    // Clear state cookie and redirect to settings with success message.
    // `access` lets the page confirm whether write access was actually granted
    // (the user can untick calendar.events on Google's consent screen).
    const successUrl = new URL(
      "/dashboard/settings/integrations?success=google_connected",
      redirectBase(request),
    );
    if (tokens.grantedScopes) {
      successUrl.searchParams.set(
        "access",
        getCalendarAccessLevel(tokens.grantedScopes),
      );
    }
    const response = NextResponse.redirect(successUrl);
    response.cookies.set("google_oauth_state", "", {
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    console.error("Google OAuth callback error:", error);

    return NextResponse.redirect(
      new URL(
        `/dashboard/settings/integrations?error=${encodeURIComponent(await tr("serverErrors", "api.integrations.googleFailed"))}`,
        redirectBase(request),
      ),
    );
  }
}
