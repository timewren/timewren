import { decryptOAuthToken, setTokenUtil } from "better-auth/oauth2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeIdTokenClaims } from "@/lib/enterprise/sso/domains";
import { SECRET_PREFIX } from "@/lib/utils/encryption";
import {
  betterAuthTokenCodec,
  encryptIdTokenBeforeWrite,
  protectIdToken,
  readStoredIdToken,
} from "../oauth-token-crypto";

const AUTH_SECRET = "test-".repeat(8);

/** Minimal better-auth-kontekst som encryptOAuthTokens-stierne læser. */
function authCtx(encryptOAuthTokens: boolean) {
  return {
    options: { account: { encryptOAuthTokens } },
    secretConfig: AUTH_SECRET,
  } as unknown as Parameters<typeof decryptOAuthToken>[1];
}

/** Realistiske token-former pr. udbyder (ingen er rene hex-strenge). */
const PROVIDER_TOKENS = {
  google: "ya29.a0AfB_byC-1x2y3z_example-access-token",
  googleRefresh: "1//0gExampleRefreshToken-abcDEF_123",
  github: `gho_${"Example".repeat(5)}x`,
  discord: "6qrZcUqja7812RVdnEKjpzOL4CvHBFG",
  apple: "a1b2c3d4e5f60718293a4b5c6d7e8f90.0.rsxy.Ab12Cd34Ef56",
  appleRefresh: "r0f1e2d3c4b5a69788796a5b4c3d2e1f0.0.rsxy.Zy98Xw76",
  microsoft: "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJ4IjoxfQ.sig",
};

function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(claims)}.signature`;
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "e".repeat(64);
  process.env.BETTER_AUTH_SECRET = AUTH_SECRET;
  delete process.env.BETTER_AUTH_SECRETS;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("betterAuthTokenCodec (access/refresh-tokens, #710)", () => {
  it("skriver i præcis det format better-auth selv dekrypterer", async () => {
    const encrypted = await betterAuthTokenCodec.encrypt(
      PROVIDER_TOKENS.google,
    );
    expect(encrypted).not.toContain("ya29");
    expect(await decryptOAuthToken(encrypted, authCtx(true))).toBe(
      PROVIDER_TOKENS.google,
    );
  });

  it("læser tokens better-auth har krypteret ved login", async () => {
    const stored = await setTokenUtil(
      PROVIDER_TOKENS.appleRefresh,
      authCtx(true),
    );
    expect(stored).not.toBe(PROVIDER_TOKENS.appleRefresh);
    expect(betterAuthTokenCodec.detect(stored as string)).toBe("prefixed");
    expect(await betterAuthTokenCodec.decrypt(stored as string)).toBe(
      PROVIDER_TOKENS.appleRefresh,
    );
  });

  it.each(Object.entries(PROVIDER_TOKENS))(
    "gammel klartekst-række (%s) læses uændret af better-auth og ses som klartekst af backfill",
    async (_provider, token) => {
      expect(betterAuthTokenCodec.detect(token)).toBe("plaintext");
      expect(await decryptOAuthToken(token, authCtx(true))).toBe(token);
    },
  );

  it("kaster uden BETTER_AUTH_SECRET og ved versionerede nøgler", async () => {
    delete process.env.BETTER_AUTH_SECRET;
    await expect(betterAuthTokenCodec.encrypt("x")).rejects.toThrow(
      /BETTER_AUTH_SECRET mangler/,
    );
    process.env.BETTER_AUTH_SECRET = AUTH_SECRET;
    process.env.BETTER_AUTH_SECRETS = "1:abc";
    await expect(betterAuthTokenCodec.encrypt("x")).rejects.toThrow(
      /BETTER_AUTH_SECRETS/,
    );
  });

  it("forkert BETTER_AUTH_SECRET kan ikke dekryptere", async () => {
    const encrypted = await betterAuthTokenCodec.encrypt("token");
    process.env.BETTER_AUTH_SECRET = "anden-".repeat(8);
    await expect(betterAuthTokenCodec.decrypt(encrypted)).rejects.toThrow();
  });
});

describe("idToken (databaseHooks + SSO auto-join, #710)", () => {
  const jwt = fakeJwt({ tid: "tenant-1", preferred_username: "a@b.dk" });

  it("krypteres ved skrivning og kan læses igen til claims", () => {
    const stored = protectIdToken(jwt);
    expect(stored?.startsWith(SECRET_PREFIX)).toBe(true);
    expect(stored).not.toContain(jwt.split(".")[1]);
    const claims = decodeIdTokenClaims(readStoredIdToken(stored));
    expect(claims?.tid).toBe("tenant-1");
  });

  it("dobbeltkrypterer ikke (better-auth skriver rækkens idToken tilbage ved refresh)", () => {
    const stored = protectIdToken(jwt);
    expect(protectIdToken(stored)).toBe(stored);
  });

  it("gamle klartekst-rækker læses uændret", () => {
    expect(readStoredIdToken(jwt)).toBe(jwt);
    expect(decodeIdTokenClaims(readStoredIdToken(jwt))?.tid).toBe("tenant-1");
  });

  it("null/undefined passerer uændret (fx credential-konti og delvise updates)", () => {
    expect(protectIdToken(null)).toBeNull();
    expect(protectIdToken(undefined)).toBeUndefined();
    expect(readStoredIdToken(null)).toBeNull();
  });

  it("uden ENCRYPTION_KEY gemmes intet idToken i stedet for klartekst — login fejler ikke", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(protectIdToken(jwt)).toBeNull();
  });

  it("databaseHook merger kun et krypteret idToken ind og lader rækker uden idToken være", async () => {
    // better-auth: actualData = { ...data, ...result.data }
    const row = { userId: "u1", accessToken: "x", idToken: jwt };
    const result = await encryptIdTokenBeforeWrite(row);
    const merged = { ...row, ...result?.data };
    expect(merged.accessToken).toBe("x");
    expect(merged.idToken?.startsWith(SECRET_PREFIX)).toBe(true);
    expect(readStoredIdToken(merged.idToken)).toBe(jwt);
    expect(await encryptIdTokenBeforeWrite({ password: "h" } as never)).toBe(
      undefined,
    );
  });

  it("ulæseligt idToken (forkert nøgle) giver null i stedet for at kaste", () => {
    const stored = protectIdToken(jwt);
    process.env.ENCRYPTION_KEY = "f".repeat(64);
    expect(readStoredIdToken(stored)).toBeNull();
  });
});
