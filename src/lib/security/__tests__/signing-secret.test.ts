import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authenticateDevice,
  DeviceAuthError,
  generateDeviceToken,
  verifyDeviceToken,
} from "@/lib/desktop-auth";
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
} from "@/lib/email/unsubscribe";
import { getSigningSecret } from "../signing-secret";

// #1013: ingen forudsigelig signeringsnøgle som kode-fallback. Mangler
// BETTER_AUTH_SECRET, skal signering og verificering fejle tydeligt, ikke
// falde tilbage til en kendt streng, som alle kan forfalske tokens med.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSigningSecret", () => {
  it("returnerer BETTER_AUTH_SECRET når den er sat", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "rigtig-hemmelighed");
    expect(new TextDecoder().decode(getSigningSecret())).toBe(
      "rigtig-hemmelighed",
    );
  });

  for (const env of ["production", "development", "test"]) {
    it(`kaster uden hemmelighed i NODE_ENV=${env}`, () => {
      vi.stubEnv("NODE_ENV", env);
      vi.stubEnv("BETTER_AUTH_SECRET", "");
      vi.stubEnv("CRON_SECRET", "må-ikke-bruges-som-fallback");
      expect(() => getSigningSecret()).toThrow(/BETTER_AUTH_SECRET/);
    });
  }
});

describe("desktop-tokens", () => {
  it("signerer og verificerer med hemmelighed (uændret drift)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "prod-hemmelighed");
    const token = await generateDeviceToken("u1", "d1", "pro");
    await expect(verifyDeviceToken(token)).resolves.toEqual({
      userId: "u1",
      deviceId: "d1",
      tier: "pro",
    });
  });

  it("nægter at signere og verificere i produktion uden hemmelighed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    await expect(generateDeviceToken("u1", "d1", "pro")).rejects.toThrow(
      /BETTER_AUTH_SECRET/,
    );
    await expect(verifyDeviceToken("a.b.c")).rejects.toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });
});

describe("authenticateDevice", () => {
  it("giver ikke 401 invalid_token når hemmeligheden mangler (serverfejl)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    const req = new Request("http://x", {
      headers: { Authorization: "Bearer a.b.c" },
    });
    const err = await authenticateDevice(req).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DeviceAuthError);
    expect(err.message).toMatch(/BETTER_AUTH_SECRET/);
  });

  it("afviser stadig et forkert token med 401-fejl når hemmelighed er sat", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "prod-hemmelighed");
    const req = new Request("http://x", {
      headers: { Authorization: "Bearer a.b.c" },
    });
    await expect(authenticateDevice(req)).rejects.toMatchObject({
      code: "invalid_token",
    });
  });
});

describe("unsubscribe-tokens", () => {
  it("roundtrip med hemmelighed (uændret drift)", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "prod-hemmelighed");
    const token = generateUnsubscribeToken("user-1");
    expect(verifyUnsubscribeToken(token)).toBe("user-1");
  });

  it("nægter at signere uden hemmelighed, også med CRON_SECRET sat", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    vi.stubEnv("CRON_SECRET", "cron");
    expect(() => generateUnsubscribeToken("user-1")).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });
});
