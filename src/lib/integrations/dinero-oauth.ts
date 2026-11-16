import { appUrlEnv } from "@/lib/runtime-env";
/**
 * Dinero OAuth 2.0 / OpenID Connect (hybrid flow) via Visma Connect.
 *
 * Flow: `response_type=code id_token` with `response_mode=form_post`
 * and PKCE (S256). The ID token proves the authorization response came
 * from Visma; PKCE protects the code-to-token exchange; the issuer
 * parameter on the callback (RFC 9207) protects against mix-up attacks.
 *
 * Endpoints match the OpenID Connect discovery at
 * https://connect.visma.com/.well-known/openid-configuration.
 */

import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { syncT } from "@/i18n/sync-text";
import { users } from "@/lib/db/schema";
import { fetchWithTimeout } from "@/lib/integrations/base";
import { decrypt, encrypt } from "@/lib/utils/encryption";

const DINERO_CLIENT_ID = process.env.DINERO_CLIENT_ID;
const DINERO_CLIENT_SECRET = process.env.DINERO_CLIENT_SECRET;
const DINERO_REDIRECT_URI =
  process.env.DINERO_REDIRECT_URI ||
  `${appUrlEnv()}/api/integrations/dinero/callback`;

const VISMA_ISSUER = "https://connect.visma.com";
const VISMA_AUTHORIZE_URL = `${VISMA_ISSUER}/connect/authorize`;
const VISMA_TOKEN_URL = `${VISMA_ISSUER}/connect/token`;
const VISMA_REVOCATION_URL = `${VISMA_ISSUER}/connect/revocation`;
const VISMA_JWKS_URL = `${VISMA_ISSUER}/.well-known/openid-configuration/jwks`;
const DINERO_API_URL = "https://api.dinero.dk/v1";

// `openid` triggers ID-token issuance (required for hybrid flow).
const SCOPES =
  "openid dineropublicapi:read dineropublicapi:write offline_access";

// Cached remote JWKS — fetches JWKs on first use, refreshes as needed.
const jwks = createRemoteJWKSet(new URL(VISMA_JWKS_URL));

export interface DineroTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface DineroOrganization {
  id: number;
  name: string;
  isPro: boolean;
}

export interface AuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  /** Raw PKCE verifier — send to token endpoint, store server-side. */
  codeVerifier: string;
}

/**
 * Check if Dinero OAuth is configured via env vars.
 */
export function isDineroOAuthConfigured(): boolean {
  return !!(DINERO_CLIENT_ID && DINERO_CLIENT_SECRET);
}

// -------------------------------------------------------------------------
// PKCE helpers (RFC 7636)
// -------------------------------------------------------------------------

/** Base64url encode a Buffer (no padding). */
function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 43-128 character high-entropy string. 32 random bytes → 43 b64url chars. */
function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(32));
}

/** S256 PKCE challenge: base64url(sha256(verifier)). */
function deriveCodeChallenge(verifier: string): string {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

// -------------------------------------------------------------------------
// Authorization URL
// -------------------------------------------------------------------------

/**
 * Build a Visma Connect authorization request with PKCE + hybrid flow.
 *
 * Returns the URL + all values the caller must persist server-side
 * (in HttpOnly cookies) to validate the callback.
 */
export function buildDineroAuthorizationRequest(): AuthorizationRequest {
  if (!DINERO_CLIENT_ID) {
    throw new Error("DINERO_CLIENT_ID is not configured");
  }

  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = deriveCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_id: DINERO_CLIENT_ID,
    response_type: "code id_token",
    response_mode: "form_post",
    scope: SCOPES,
    redirect_uri: DINERO_REDIRECT_URI,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    ui_locales: "da-DK",
  });

  return {
    url: `${VISMA_AUTHORIZE_URL}?${params.toString()}`,
    state,
    nonce,
    codeVerifier,
  };
}

// -------------------------------------------------------------------------
// ID-token validation
// -------------------------------------------------------------------------

/**
 * Validate the ID token returned in the form_post callback.
 * Throws on any failure (bad signature, wrong issuer, wrong audience,
 * expired, nonce mismatch). Errors are logged with enough context to
 * diagnose the specific cause without dumping secrets.
 */
export async function verifyDineroIdToken(
  idToken: string,
  expectedNonce: string,
): Promise<void> {
  if (!DINERO_CLIENT_ID) {
    throw new Error("DINERO_CLIENT_ID is not configured");
  }

  let payload: Record<string, unknown>;
  try {
    // clockTolerance absorbs clock skew between our server and Visma.
    // 30s wasn't enough in practice — the container clock drifts
    // faster than NTP corrects. 300s (5 min) still catches real replay
    // attacks (tokens are only valid 5 min total from issuance) while
    // being generous enough for typical host-clock drift.
    const result = await jwtVerify(idToken, jwks, {
      issuer: VISMA_ISSUER,
      audience: DINERO_CLIENT_ID,
      clockTolerance: 300,
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "unknown";
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[dinero] jwtVerify failed — code=${code}, message=${message}, ` +
        `expectedAud=${DINERO_CLIENT_ID}, expectedIss=${VISMA_ISSUER}`,
    );
    throw err;
  }

  if (payload.nonce !== expectedNonce) {
    console.error(
      `[dinero] nonce mismatch — tokenNonce=${String(payload.nonce).slice(0, 8)}..., ` +
        `expected=${expectedNonce.slice(0, 8)}...`,
    );
    throw new Error("ID token nonce mismatch");
  }
}

// -------------------------------------------------------------------------
// Token exchange / refresh / revocation
// -------------------------------------------------------------------------

/**
 * Exchange authorization code for tokens (with PKCE verifier).
 */
export async function exchangeDineroCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<DineroTokens> {
  if (!DINERO_CLIENT_ID || !DINERO_CLIENT_SECRET) {
    throw new Error("Dinero OAuth credentials not configured");
  }

  const response = await fetchWithTimeout(VISMA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: DINERO_REDIRECT_URI,
      client_id: DINERO_CLIENT_ID,
      client_secret: DINERO_CLIENT_SECRET,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Dinero token exchange failed:", error);
    throw new Error(syncT("integrations.dinero.tokenFailed"));
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Refresh an expired access token. Visma rotates refresh tokens —
 * always save the new one immediately after a successful response.
 */
export async function refreshDineroAccessToken(
  encryptedRefreshToken: string,
): Promise<DineroTokens> {
  if (!DINERO_CLIENT_ID || !DINERO_CLIENT_SECRET) {
    throw new Error("Dinero OAuth credentials not configured");
  }

  const refreshToken = decrypt(encryptedRefreshToken);
  if (!refreshToken) {
    throw new Error(syncT("integrations.dinero.refreshMissing"));
  }

  const response = await fetchWithTimeout(VISMA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: DINERO_CLIENT_ID,
      client_secret: DINERO_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Dinero token refresh failed:", error);
    throw new Error(syncT("integrations.dinero.expiredReconnect"));
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Revoke a token at Visma's revocation endpoint. Best-effort — logs
 * failures but does not throw, so a network blip at Visma doesn't
 * block the user from disconnecting locally.
 */
export async function revokeDineroToken(
  token: string,
  hint: "access_token" | "refresh_token",
): Promise<void> {
  if (!DINERO_CLIENT_ID || !DINERO_CLIENT_SECRET) return;

  try {
    const response = await fetchWithTimeout(VISMA_REVOCATION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token,
        token_type_hint: hint,
        client_id: DINERO_CLIENT_ID,
        client_secret: DINERO_CLIENT_SECRET,
      }),
    });
    if (!response.ok) {
      console.warn(
        `[dinero] revocation returned ${response.status}: ${await response.text()}`,
      );
    }
  } catch (err) {
    console.warn("[dinero] revocation network error:", err);
  }
}

// -------------------------------------------------------------------------
// Dinero API: organizations
// -------------------------------------------------------------------------

export async function fetchDineroOrganizations(
  accessToken: string,
): Promise<DineroOrganization[]> {
  const response = await fetchWithTimeout(`${DINERO_API_URL}/organizations`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(syncT("integrations.dinero.orgsFailed"));
  }

  const data = await response.json();
  return (data || []).map(
    (org: { id: number; name: string; isPro: boolean }) => ({
      id: org.id,
      name: org.name,
      isPro: org.isPro,
    }),
  );
}

// -------------------------------------------------------------------------
// Persistence
// -------------------------------------------------------------------------

export async function saveDineroConnection(
  db: PostgresJsDatabase<Record<string, never>>,
  userId: string,
  tokens: DineroTokens,
  org: { id: number; name: string },
): Promise<void> {
  const expiry = new Date(Date.now() + tokens.expiresIn * 1000);

  await db
    .update(users)
    .set({
      dineroApiKey: encrypt(tokens.accessToken),
      dineroRefreshToken: encrypt(tokens.refreshToken),
      dineroTokenExpiry: expiry,
      dineroOrganizationId: String(org.id),
      dineroOrgName: org.name,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/**
 * Disconnect Dinero — revokes the refresh token at Visma, then clears
 * local columns. Revocation is best-effort; local cleanup always runs.
 */
export async function disconnectDinero(
  db: PostgresJsDatabase<Record<string, never>>,
  userId: string,
): Promise<void> {
  const row = await db
    .select({
      dineroRefreshToken: users.dineroRefreshToken,
    })
    .from(users)
    .where(eq(users.id, userId))
    .then((rows) => rows[0]);

  if (row?.dineroRefreshToken) {
    try {
      const plainRefresh = decrypt(row.dineroRefreshToken);
      if (plainRefresh) {
        await revokeDineroToken(plainRefresh, "refresh_token");
      }
    } catch (err) {
      console.warn("[dinero] revoke-on-disconnect failed:", err);
    }
  }

  await db
    .update(users)
    .set({
      dineroApiKey: null,
      dineroRefreshToken: null,
      dineroTokenExpiry: null,
      dineroOrganizationId: null,
      dineroOrgName: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/**
 * Get a valid Dinero access token, refreshing if expired.
 */
export async function getValidDineroToken(
  db: PostgresJsDatabase<Record<string, never>>,
  userId: string,
): Promise<{ accessToken: string; organizationId: string } | null> {
  const user = await db
    .select({
      dineroApiKey: users.dineroApiKey,
      dineroRefreshToken: users.dineroRefreshToken,
      dineroTokenExpiry: users.dineroTokenExpiry,
      dineroOrganizationId: users.dineroOrganizationId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .then((rows) => rows[0]);

  if (!user?.dineroRefreshToken || !user?.dineroOrganizationId) {
    return null;
  }

  // Current token still valid (with 60s buffer)
  const now = new Date(Date.now() + 60_000);
  if (
    user.dineroTokenExpiry &&
    user.dineroTokenExpiry > now &&
    user.dineroApiKey
  ) {
    return {
      accessToken: decrypt(user.dineroApiKey),
      organizationId: user.dineroOrganizationId,
    };
  }

  // Expired — refresh
  try {
    const tokens = await refreshDineroAccessToken(user.dineroRefreshToken);

    const expiry = new Date(Date.now() + tokens.expiresIn * 1000);
    await db
      .update(users)
      .set({
        dineroApiKey: encrypt(tokens.accessToken),
        dineroRefreshToken: encrypt(tokens.refreshToken),
        dineroTokenExpiry: expiry,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return {
      accessToken: tokens.accessToken,
      organizationId: user.dineroOrganizationId,
    };
  } catch (error) {
    console.error("Failed to refresh Dinero token:", error);

    // Race-condition guard: another request may have already refreshed.
    const freshUser = await db
      .select({
        dineroApiKey: users.dineroApiKey,
        dineroTokenExpiry: users.dineroTokenExpiry,
        dineroOrganizationId: users.dineroOrganizationId,
      })
      .from(users)
      .where(eq(users.id, userId))
      .then((rows) => rows[0]);

    if (
      freshUser?.dineroTokenExpiry &&
      freshUser.dineroTokenExpiry > new Date() &&
      freshUser.dineroApiKey &&
      freshUser.dineroOrganizationId
    ) {
      return {
        accessToken: decrypt(freshUser.dineroApiKey),
        organizationId: freshUser.dineroOrganizationId,
      };
    }

    return null;
  }
}

/**
 * Force-refresh the Dinero token, ignoring the cached expiry.
 * Used by the retry-on-403 mechanism when the API rejects a supposedly-valid token.
 */
export async function forceRefreshDineroToken(
  db: PostgresJsDatabase<Record<string, never>>,
  userId: string,
): Promise<{ accessToken: string; organizationId: string } | null> {
  const user = await db
    .select({
      dineroRefreshToken: users.dineroRefreshToken,
      dineroOrganizationId: users.dineroOrganizationId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .then((rows) => rows[0]);

  if (!user?.dineroRefreshToken || !user?.dineroOrganizationId) {
    return null;
  }

  try {
    const tokens = await refreshDineroAccessToken(user.dineroRefreshToken);
    const expiry = new Date(Date.now() + tokens.expiresIn * 1000);
    await db
      .update(users)
      .set({
        dineroApiKey: encrypt(tokens.accessToken),
        dineroRefreshToken: encrypt(tokens.refreshToken),
        dineroTokenExpiry: expiry,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return {
      accessToken: tokens.accessToken,
      organizationId: user.dineroOrganizationId,
    };
  } catch (error) {
    console.error("[dinero] Force refresh failed:", error);
    return null;
  }
}

/**
 * @deprecated Old entrypoint — prefer `buildDineroAuthorizationRequest`.
 * Kept so existing callers still compile until they migrate.
 */
export function getDineroAuthorizationUrl(): string {
  const req = buildDineroAuthorizationRequest();
  return req.url;
}
