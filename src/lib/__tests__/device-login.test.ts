import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allowedDeviceCallbacks,
  cleanDeviceLabel,
  codeChallengeS256,
  deviceCallbackUrl,
  deviceTokenName,
  generateDeviceCode,
  isValidCodeChallenge,
  isValidDeviceId,
  isValidState,
  resolveDeviceCallback,
  verifierMatchesChallenge,
} from "@/lib/device-login";

// RFC 7636, appendix B
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

afterEach(() => vi.unstubAllEnvs());

describe("PKCE S256", () => {
  it("giver RFC 7636's eksempel", () => {
    expect(codeChallengeS256(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
  });

  it("verifier skal passe til challenge", () => {
    expect(verifierMatchesChallenge(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
    expect(
      verifierMatchesChallenge(`${RFC_VERIFIER.slice(0, -1)}x`, RFC_CHALLENGE),
    ).toBe(false);
    // En "plain"-challenge (verifier = challenge) accepteres ikke.
    expect(verifierMatchesChallenge(RFC_CHALLENGE, RFC_CHALLENGE)).toBe(false);
    expect(verifierMatchesChallenge("kort", RFC_CHALLENGE)).toBe(false);
  });
});

describe("inputregler", () => {
  it("state, challenge og enheds-id", () => {
    expect(isValidState("a".repeat(32))).toBe(true);
    expect(isValidState("kort")).toBe(false);
    expect(isValidState(`${"a".repeat(31)}&`)).toBe(false);
    expect(isValidCodeChallenge(RFC_CHALLENGE)).toBe(true);
    expect(isValidCodeChallenge("x".repeat(44))).toBe(false);
    expect(isValidDeviceId("3f2b6c1e-8d4a-4b7e-9f00-123456789abc")).toBe(true);
    expect(isValidDeviceId("a b")).toBe(false);
  });

  it("enhedsnavn renses for styretegn og afkortes", () => {
    expect(cleanDeviceLabel("  Mads' Mac\u0000\n ", 255)).toBe("Mads' Mac");
    expect(cleanDeviceLabel("x".repeat(80), 50)).toHaveLength(50);
    expect(cleanDeviceLabel("   ", 50)).toBeNull();
    expect(cleanDeviceLabel(42, 50)).toBeNull();
  });
});

describe("kode og deep link", () => {
  it("engangskoden er 256 bit og URL-sikker", () => {
    const code = generateDeviceCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateDeviceCode()).not.toBe(code);
  });

  it("deep linket bærer kode og state, aldrig et token", () => {
    const url = deviceCallbackUrl("kode123", "state-abc");
    expect(url).toBe("timetrack://auth/callback?code=kode123&state=state-abc");
  });

  it("uses the deployment callback and rejects web or credential URLs", () => {
    vi.stubEnv("DEVICE_CALLBACK_URL", "timewren://auth/callback");
    expect(deviceCallbackUrl("kode123", "state-abc")).toBe(
      "timewren://auth/callback?code=kode123&state=state-abc",
    );
    for (const callback of [
      "https://evil.example/auth/callback",
      "javascript:alert(1)",
      "timewren://user:pass@auth/callback",
      "timewren://auth/callback?code=stale",
      "timewren://auth/callback#fragment",
    ]) {
      vi.stubEnv("DEVICE_CALLBACK_URL", callback);
      expect(() => deviceCallbackUrl("code", "state")).toThrow();
    }
  });

  it("TimeTrack-instans + timetrack-klient", () => {
    expect(
      deviceCallbackUrl("k", "s", {
        brand: "timetrack",
        redirectUri: "timetrack://auth/callback",
      }),
    ).toBe("timetrack://auth/callback?code=k&state=s");
  });

  it("TimeWren-instans + timewren-klient", () => {
    expect(
      deviceCallbackUrl("k", "s", {
        brand: "timewren",
        redirectUri: "timewren://auth/callback",
      }),
    ).toBe("timewren://auth/callback?code=k&state=s");
  });

  it("klientens scheme vinder på tværs af brands (allowlist)", () => {
    expect(
      resolveDeviceCallback({
        brand: "timetrack",
        redirectUri: "timewren://auth/callback",
      }),
    ).toBe("timewren://auth/callback");
    expect(
      resolveDeviceCallback({
        brand: "timewren",
        redirectUri: "timetrack://auth/callback",
      }),
    ).toBe("timetrack://auth/callback");
  });

  it("manglende redirect_uri falder tilbage til instansens brand", () => {
    expect(resolveDeviceCallback({ brand: "timewren" })).toBe(
      "timewren://auth/callback",
    );
    expect(resolveDeviceCallback({ brand: "timetrack" })).toBe(
      "timetrack://auth/callback",
    );
    expect(resolveDeviceCallback({ brand: "timewren", redirectUri: "" })).toBe(
      "timewren://auth/callback",
    );
    expect(resolveDeviceCallback({ brand: "ukendt" })).toBe(
      "timetrack://auth/callback",
    );
  });

  it("ondsindet redirect_uri falder tilbage til brandets callback", () => {
    for (const evil of [
      "https://evil.example/auth/callback",
      "http://evil.example/auth/callback",
      "timewren://evil",
      "timewren://auth/callback.evil.example",
      "timewren://auth/callback?x=1",
      "timewren://user:pass@auth/callback",
      "javascript:alert(1)",
      "data:text/html,x",
      "evil://auth/callback",
      "exp://auth/callback",
      42,
      { toString: () => "timewren://auth/callback" },
    ]) {
      expect(
        resolveDeviceCallback({ brand: "timewren", redirectUri: evil }),
      ).toBe("timewren://auth/callback");
      expect(
        resolveDeviceCallback({ brand: "timetrack", redirectUri: evil }),
      ).toBe("timetrack://auth/callback");
    }
  });

  it("allowlisten følger APP_SCHEMES og DEVICE_CALLBACK_URL", () => {
    vi.stubEnv("APP_SCHEMES", "acme://");
    vi.stubEnv("DEVICE_CALLBACK_URL", "selfhost://auth/callback");
    expect(allowedDeviceCallbacks()).toEqual(
      expect.arrayContaining([
        "acme://auth/callback",
        "selfhost://auth/callback",
        "timewren://auth/callback",
        "timetrack://auth/callback",
      ]),
    );
    expect(resolveDeviceCallback({ redirectUri: "acme://auth/callback" })).toBe(
      "acme://auth/callback",
    );
    // begge brands standardcallbacks gælder, også uden for APP_SCHEMES
    expect(
      resolveDeviceCallback({
        brand: "timewren",
        redirectUri: "timetrack://auth/callback",
      }),
    ).toBe("timetrack://auth/callback");
    expect(
      resolveDeviceCallback({
        brand: "timetrack",
        redirectUri: "https://evil.example/auth/callback",
      }),
    ).toBe("selfhost://auth/callback");
  });

  it("tokennavnet viser app og enhed uden tankestreg", () => {
    expect(deviceTokenName("desktop", "Mads' Mac")).toBe(
      "TimeTrack Desktop (Mads' Mac)",
    );
    expect(deviceTokenName("mobile", null)).toBe("TimeTrack mobil");
    expect(deviceTokenName("desktop", "x".repeat(200))).toHaveLength(100);
  });

  it("challenge er base64url af sha256", () => {
    const v = "v".repeat(50);
    expect(codeChallengeS256(v)).toBe(
      createHash("sha256").update(v).digest("base64url"),
    );
  });
});
