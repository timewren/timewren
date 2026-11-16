import { appUrlEnv } from "@/lib/runtime-env";
/**
 * e-conomic App Access Grant flow.
 *
 * Unlike Dinero (which now uses Visma Connect OAuth 2.0), e-conomic's REST
 * API still uses the older X-AppSecretToken + X-AgreementGrantToken header
 * scheme. But the "grant" step can still be automated for users via
 * e-conomic's own redirect flow — functionally identical UX to OAuth from
 * the user's perspective:
 *
 *   1. We build a URL on secure.e-conomic.com/secure/api1/requestaccess.aspx
 *      with our AppPublicToken and a callback URL.
 *   2. User clicks, logs in to e-conomic, grants access.
 *   3. e-conomic redirects back to our callback with `?token=<grantToken>`.
 *   4. We persist it as users.economicAgreementGrantToken.
 *
 * The AppSecretToken stays server-wide (env var) and is never shown to
 * the user. It lives in ECONOMIC_APP_SECRET_TOKEN.
 *
 * Docs: https://www.e-conomic.com/developer/connect
 */

import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { users } from "@/lib/db/schema";
import { encrypt } from "@/lib/utils/encryption";

const ECONOMIC_APP_PUBLIC_TOKEN = process.env.ECONOMIC_APP_PUBLIC_TOKEN;
const ECONOMIC_APP_SECRET_TOKEN = process.env.ECONOMIC_APP_SECRET_TOKEN;
const ECONOMIC_REDIRECT_URI =
  process.env.ECONOMIC_REDIRECT_URI ||
  `${appUrlEnv()}/api/integrations/economic/callback`;

const ECONOMIC_GRANT_URL =
  "https://secure.e-conomic.com/secure/api1/requestaccess.aspx";

/**
 * True when both AppPublicToken and AppSecretToken env vars are set.
 * AppPublicToken drives the user-facing grant URL; AppSecretToken is used
 * server-side for every API call on behalf of connected users.
 */
export function isEconomicGrantConfigured(): boolean {
  return !!(ECONOMIC_APP_PUBLIC_TOKEN && ECONOMIC_APP_SECRET_TOKEN);
}

/**
 * Build the e-conomic grant-access URL that the user is redirected to.
 * `state` is a CSRF token we verify in the callback.
 *
 * e-conomic's redirect doesn't natively echo a `state` parameter back,
 * so we smuggle it through the `redirectUrl` query string and also set
 * it as a same-site cookie; the callback checks both match.
 */
export function getEconomicGrantUrl(state: string): string {
  if (!ECONOMIC_APP_PUBLIC_TOKEN) {
    throw new Error("ECONOMIC_APP_PUBLIC_TOKEN is not configured");
  }

  // e-conomic appends `?token=XXX` to the redirectUrl. We add our own
  // `state=XXX` there so the callback can verify it.
  const redirectWithState = new URL(ECONOMIC_REDIRECT_URI);
  redirectWithState.searchParams.set("state", state);

  const params = new URLSearchParams({
    appPublicToken: ECONOMIC_APP_PUBLIC_TOKEN,
    // roleType=2 → standard access (customers, products, invoices, etc.).
    // roleType=0 would be read-only. We need write access to create
    // invoices, so 2 is correct.
    roleType: "2",
    redirectUrl: redirectWithState.toString(),
  });

  return `${ECONOMIC_GRANT_URL}?${params.toString()}`;
}

/**
 * Save the user's AgreementGrantToken received from e-conomic's callback.
 * Also stamps the server-wide AppSecretToken onto the user row so existing
 * API-call code paths (which read user.economicAppSecretToken) continue to
 * work unchanged.
 */
export async function saveEconomicGrant(
  db: PostgresJsDatabase<Record<string, never>>,
  userId: string,
  agreementGrantToken: string,
): Promise<void> {
  if (!ECONOMIC_APP_SECRET_TOKEN) {
    throw new Error("ECONOMIC_APP_SECRET_TOKEN is not configured");
  }

  await db
    .update(users)
    .set({
      economicAppSecretToken: encrypt(ECONOMIC_APP_SECRET_TOKEN),
      economicAgreementGrantToken: encrypt(agreementGrantToken),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/**
 * Clear the user's e-conomic tokens.
 */
export async function disconnectEconomic(
  db: PostgresJsDatabase<Record<string, never>>,
  userId: string,
): Promise<void> {
  await db
    .update(users)
    .set({
      economicAppSecretToken: null,
      economicAgreementGrantToken: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}
