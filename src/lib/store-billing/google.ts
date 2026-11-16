import { importPKCS8, SignJWT } from "jose";
import { STORE_APP_ID } from "./products";
import type { GooglePurchaseData } from "./state";

/**
 * Google Play Developer API (purchases.subscriptionsv2.get + acknowledge) med
 * en servicekonto. Rene fetch-kald med et selvsigneret JWT (jose er allerede
 * en afhængighed) i stedet for hele googleapis-klienten. Injicerbar til tests.
 */
export interface GooglePlayClient {
  getSubscription(purchaseToken: string): Promise<GooglePurchaseData>;
  acknowledge(productId: string, purchaseToken: string): Promise<void>;
}

/** Købet findes ikke hos Google (ugyldigt eller andet package-navn). */
export class GooglePlayPurchaseNotFoundError extends Error {
  constructor() {
    super("Købet blev ikke fundet hos Google Play");
    this.name = "GooglePlayPurchaseNotFoundError";
  }
}

const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";
/**
 * Et hængende kald må ikke blokere tRPC-kaldet, Pub/Sub-webhooken eller
 * sweep-cronens løkke. Abort-fejlen behandles som enhver anden forbigående
 * fejl (500 til Pub/Sub, googleFailed i sweepet).
 */
const GOOGLE_TIMEOUT_MS = 15_000;

export function googlePlayPackageName(): string {
  return process.env.GOOGLE_PLAY_PACKAGE_NAME || STORE_APP_ID;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function readServiceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON er ikke sat");
  }
  const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  if (!parsed?.client_email || !parsed?.private_key) {
    throw new Error(
      "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON mangler client_email/private_key",
    );
  }
  return parsed as ServiceAccount;
}

export function createGooglePlayClient(
  fetchImpl: typeof fetch = fetch,
): GooglePlayClient {
  let cached: { token: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const sa = readServiceAccount();
    const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
    const key = await importPKCS8(sa.private_key, "RS256");
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(sa.client_email)
      .setAudience(tokenUri)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);
    const res = await fetchImpl(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Google OAuth-token fejlede (HTTP ${res.status})`);
    }
    const json = (await res.json()) as {
      access_token: string;
      expires_in?: number;
    };
    cached = {
      token: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return json.access_token;
  }

  const pkg = () => encodeURIComponent(googlePlayPackageName());

  return {
    async getSubscription(purchaseToken) {
      const res = await fetchImpl(
        `${API}/applications/${pkg()}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
        {
          headers: { Authorization: `Bearer ${await accessToken()}` },
          signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
        },
      );
      // 400/404/410: ugyldigt eller ukendt token — ikke en forbigående fejl.
      if (res.status === 400 || res.status === 404 || res.status === 410) {
        throw new GooglePlayPurchaseNotFoundError();
      }
      if (!res.ok) {
        throw new Error(
          `Google Play subscriptionsv2.get fejlede (HTTP ${res.status})`,
        );
      }
      return (await res.json()) as GooglePurchaseData;
    },

    async acknowledge(productId, purchaseToken) {
      const res = await fetchImpl(
        `${API}/applications/${pkg()}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await accessToken()}`,
            "Content-Type": "application/json",
          },
          body: "{}",
          signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        throw new Error(`Google Play acknowledge fejlede (HTTP ${res.status})`);
      }
    },
  };
}

let instance: GooglePlayClient | null = null;

export function getGooglePlayClient(): GooglePlayClient {
  instance ??= createGooglePlayClient();
  return instance;
}

/** Kun til tests. */
export function setGooglePlayClientForTests(c: GooglePlayClient | null) {
  instance = c;
}
