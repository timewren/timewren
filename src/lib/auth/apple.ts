import { createPrivateKey, sign } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { db as defaultDb } from "@/lib/db";
import { accounts, users } from "@/lib/db/schema";
import { betterAuthTokenCodec } from "@/lib/security/oauth-token-crypto";
import { socialClient } from "./social-providers";

type Db = typeof defaultDb;

/**
 * Client secret til Sign in with Apple: en ES256-JWT signeret med Apples .p8-nøgle.
 * Env: APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_CLIENT_ID (Services ID), APPLE_PRIVATE_KEY
 * (PEM med linjeskift som \n, eller base64 af hele PEM-filen). Tom streng slår provideren fra.
 *
 * JWT'ens `sub` er det client-id, secreten gælder for: Services ID'et (web) eller
 * appens bundle-id (native, se `getAppleAppBundleId`). Samme team, nøgle og .p8.
 */
function buildAppleClientSecret(clientId: string | undefined): string {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const raw = process.env.APPLE_PRIVATE_KEY;
  if (!teamId || !keyId || !clientId || !raw) return "";
  const pem = raw.includes("BEGIN PRIVATE KEY")
    ? raw.replace(/\\n/g, "\n")
    : Buffer.from(raw, "base64").toString("utf8");
  const key = createPrivateKey(pem);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "ES256", kid: keyId }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: teamId,
      iat: now,
      exp: now + 60 * 60 * 24 * 150,
      aud: "https://appleid.apple.com",
      sub: clientId,
    }),
  ).toString("base64url");
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${header}.${payload}.${signature}`;
}
// Apple tillader maks. 6 måneders levetid; vi fornyer efter 30 dage, så en
// langvarig proces aldrig sender en udløbet secret.
const APPLE_SECRET_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const appleSecretCache = new Map<
  string,
  { value: string; createdAt: number }
>();
/**
 * Client secret for `clientId`; uden argument Services ID'et (APPLE_CLIENT_ID),
 * som web-login bruger. Cachet pr. client-id. En tom streng (Apple er ikke
 * konfigureret) caches ikke, så en senere konfiguration slår igennem.
 */
export function getAppleClientSecret(
  clientId: string | undefined = process.env.APPLE_CLIENT_ID,
): string {
  const cacheKey = clientId ?? "";
  const cached = appleSecretCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt <= APPLE_SECRET_TTL_MS) {
    return cached.value;
  }
  const value = buildAppleClientSecret(clientId);
  if (value) appleSecretCache.set(cacheKey, { value, createdAt: Date.now() });
  return value;
}

/**
 * Appens bundle-id: client-id for native login (id-token-flowet) og for de
 * tokens, som Apple udsteder til appen. Samme default som better-auth får i
 * `src/lib/auth.ts`.
 */
export function getAppleAppBundleId(): string {
  return process.env.APPLE_APP_BUNDLE_IDENTIFIER || "dk.timetrack.app";
}

export const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
export const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";

export interface AppleTokenToRevoke {
  token: string;
  hint: "refresh_token" | "access_token";
  /**
   * Det client-id, tokenet er udstedt til. Mangler det, er det Services ID'et
   * (APPLE_CLIENT_ID, web-login); native tokens er udstedt til appens bundle-id.
   */
  clientId?: string;
}

/**
 * Læser og dekrypterer brugerens Apple-tokens fra `account` (#919). Skal
 * kaldes FØR kontosletningen, fordi rækkerne forsvinder med den. Refresh-
 * tokenet foretrækkes: tilbagekaldes det, er hele autorisationen væk.
 *
 * Native login (appens id-token-flow) gemmer ingen access/refresh-token i
 * `account`. Dem får vi i stedet ved at bytte en frisk authorization code fra
 * appen (`exchangeAppleAuthorizationCode`). Er den ombyttet (`nativeTokenObtained`),
 * er en række uden gemt token forventet og logges kun som info; ellers logges
 * det til manuel opfølgning. Tokens logges aldrig.
 *
 * Web-tokens er udstedt til brandets Services ID: en TimeWren-konto loggede
 * ind via TimeWren-instansen (TIMEWREN_APPLE_CLIENT_ID), så tokenet får det
 * client-id med og tilbagekaldes aldrig med TimeTracks klient. TimeTrack-konti
 * får intet client-id og bruger APPLE_CLIENT_ID som før.
 */
export async function collectAppleTokens(
  db: Pick<Db, "query">,
  userId: string,
  opts: { nativeTokenObtained?: boolean } = {},
): Promise<AppleTokenToRevoke[]> {
  const rows = await db.query.accounts.findMany({
    where: and(eq(accounts.userId, userId), eq(accounts.providerId, "apple")),
    columns: { refreshToken: true, accessToken: true },
  });
  const tokens: AppleTokenToRevoke[] = [];
  if (rows.length === 0) return tokens;
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { brand: true },
  });
  // Uden TimeWren-klient (fjernet efter login) bliver client-id'et tomt, så
  // revokeAppleTokens melder manuel opfølgning i stedet for at bruge
  // TimeTracks Services ID.
  const brandClientId =
    user?.brand === "timewren"
      ? (socialClient("timewren", "apple")?.clientId ?? "")
      : undefined;
  for (const row of rows) {
    const stored = row.refreshToken || row.accessToken;
    if (!stored) {
      if (opts.nativeTokenObtained) {
        console.info(
          `[Account Deletion] Apple-login for bruger ${userId} har intet gemt token (native login); tilbagekaldes via appens authorization code.`,
        );
      } else {
        console.warn(
          `[Account Deletion] MANUEL OPFØLGNING: Apple-login for bruger ${userId} har intet gemt token (native login) og kan ikke tilbagekaldes automatisk.`,
        );
      }
      continue;
    }
    try {
      const token =
        betterAuthTokenCodec.detect(stored) === "plaintext"
          ? stored
          : await betterAuthTokenCodec.decrypt(stored);
      tokens.push({
        token,
        hint: row.refreshToken ? "refresh_token" : "access_token",
        ...(brandClientId !== undefined && { clientId: brandClientId }),
      });
    } catch (err) {
      console.error(
        `[Account Deletion] MANUEL OPFØLGNING PÅKRÆVET: Apple-token for bruger ${userId} kunne ikke dekrypteres og bliver ikke tilbagekaldt:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return tokens;
}

/**
 * Bytter en authorization code fra appens native login (Sign in with Apple) til
 * et token (POST /auth/token), så det kan tilbagekaldes ved kontosletning (Apple
 * 5.1.1(v)). Koden er engangs og gyldig i 5 minutter. Den er udstedt til appens
 * bundle-id, så client_id og client secret er bundle-id'et, ikke Services ID'et.
 *
 * Best effort: kaster aldrig. Fejl logges til manuel opfølgning UDEN kode og
 * tokens (kun HTTP-status og Apples fejlkode), og giver null.
 */
export async function exchangeAppleAuthorizationCode(
  code: string,
  userId?: string,
): Promise<AppleTokenToRevoke | null> {
  const who = userId ? ` for bruger ${userId}` : "";
  const clientId = getAppleAppBundleId();
  try {
    const clientSecret = getAppleClientSecret(clientId);
    if (!clientSecret) {
      console.error(
        `[Account Deletion] MANUEL OPFØLGNING PÅKRÆVET: Apple-login${who} blev ikke tilbagekaldt — Sign in with Apple er ikke konfigureret.`,
      );
      return null;
    }
    const res = await fetch(APPLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!res.ok) {
      // Apples fejlkode (fx invalid_grant) er ufarlig og nyttig; resten af
      // svaret logges aldrig.
      const error = body?.error;
      const reason =
        typeof error === "string" && /^[a-z_]{1,64}$/.test(error)
          ? `, ${error}`
          : "";
      console.error(
        `[Account Deletion] MANUEL OPFØLGNING PÅKRÆVET: Apple afviste ombytning af authorization code${who} (HTTP ${res.status}${reason}); login blev ikke tilbagekaldt.`,
      );
      return null;
    }
    const refresh = body?.refresh_token;
    if (typeof refresh === "string" && refresh) {
      return { token: refresh, hint: "refresh_token", clientId };
    }
    const access = body?.access_token;
    if (typeof access === "string" && access) {
      return { token: access, hint: "access_token", clientId };
    }
    console.error(
      `[Account Deletion] MANUEL OPFØLGNING PÅKRÆVET: Apple svarede uden token ved ombytning af authorization code${who}; login blev ikke tilbagekaldt.`,
    );
    return null;
  } catch (err) {
    console.error(
      `[Account Deletion] MANUEL OPFØLGNING PÅKRÆVET: authorization code${who} kunne ikke ombyttes hos Apple; login blev ikke tilbagekaldt:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Tilbagekalder Apple-tokens (POST /auth/revoke). Kaldes EFTER at sletningen
 * er committet; best effort — en fejl logges til manuel opfølgning og vælter
 * aldrig sletningen. Kaster ikke.
 *
 * Client-id og client secret vælges pr. token: web-tokens er udstedt til
 * Services ID'et (APPLE_CLIENT_ID), native tokens til appens bundle-id
 * (`token.clientId`). Apple afviser en revoke med et andet client-id end det,
 * tokenet er udstedt til.
 */
export async function revokeAppleTokens(
  tokens: AppleTokenToRevoke[],
  userId: string,
): Promise<void> {
  if (tokens.length === 0) return;
  const secrets = new Map<string, string>();
  const secretFor = (clientId: string | undefined): string => {
    if (!clientId) return "";
    const known = secrets.get(clientId);
    if (known !== undefined) return known;
    let secret = "";
    try {
      secret = getAppleClientSecret(clientId);
    } catch (err) {
      console.error(
        "[Account Deletion] Apple client secret kunne ikke dannes:",
        err instanceof Error ? err.message : err,
      );
    }
    secrets.set(clientId, secret);
    return secret;
  };
  for (const { token, hint, clientId: tokenClientId } of tokens) {
    const clientId = tokenClientId ?? process.env.APPLE_CLIENT_ID;
    const clientSecret = secretFor(clientId);
    if (!clientId || !clientSecret) {
      console.error(
        `[Account Deletion] MANUEL OPFØLGNING PÅKRÆVET: Apple-${hint} for bruger ${userId} blev ikke tilbagekaldt — Sign in with Apple er ikke konfigureret.`,
      );
      continue;
    }
    try {
      const res = await fetch(APPLE_REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          token,
          token_type_hint: hint,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.error(
          `[Account Deletion] MANUEL OPFØLGNING PÅKRÆVET: Apple afviste tilbagekaldelse af ${hint} for bruger ${userId} (HTTP ${res.status}).`,
        );
        continue;
      }
      console.info(
        `[Account Deletion] Apple-${hint} tilbagekaldt for bruger ${userId}`,
      );
    } catch (err) {
      console.error(
        `[Account Deletion] MANUEL OPFØLGNING PÅKRÆVET: Apple-${hint} for bruger ${userId} kunne ikke tilbagekaldes:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
