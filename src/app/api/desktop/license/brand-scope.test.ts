/**
 * En desktop-licens hører til ét brand: TT-nøgler virker kun på TimeTrack-
 * hosten, TW-nøgler kun på TimeWrens. Licenserne deles ikke (hverken
 * aktivering, verificering eller deaktivering). Se lib/desktop-license-brand.ts.
 *
 * Kun syntetiske nøgler og maskin-id'er. DB'en er en lille fake, der kun
 * kender de opslag ruterne laver.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TT_KEY = "TT-TEST-AAAA-BBBB-CCCC";
const TW_KEY = "TW-TEST-DDDD-EEEE-FFFF";
const licenses: Record<string, Record<string, unknown>> = {};

vi.mock("@/lib/db/schema", () => ({
  desktopLicenses: { licenseKey: "licenseKey" },
  desktopLicenseDevices: { id: "id", licenseId: "licenseId", machineId: "m" },
  desktopDevices: { id: "id", userId: "userId", machineId: "m" },
}));
vi.mock("drizzle-orm", async () => ({
  ...(await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm")),
  eq: (_col: string, val: unknown) => val,
  and: (...p: unknown[]) => p,
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      desktopLicenses: {
        findFirst: async ({ where }: { where: string }) => licenses[where],
      },
      desktopLicenseDevices: { findFirst: async () => undefined },
      desktopDevices: { findFirst: async () => undefined },
    },
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({ where: async () => undefined }),
  },
}));
vi.mock("@/lib/desktop-auth", () => ({
  signLicenseProof: async () => "signature",
}));

import { POST as activate } from "./activate/route";
import { POST as deactivate } from "./deactivate/route";
import { GET as verify } from "./verify/route";

let seq = 0;
const ip = () => `10.9.${Math.floor(++seq / 250)}.${seq % 250}`;

const post = (path: string, host: string, body: unknown) =>
  new Request(`https://${host}${path}`, {
    method: "POST",
    headers: { host, "x-forwarded-for": ip() },
    body: JSON.stringify(body),
  });
const get = (host: string, key: string) =>
  new NextRequest(`https://${host}/api/desktop/license/verify?key=${key}`, {
    headers: { host, "x-forwarded-for": ip() },
  });

beforeEach(() => {
  vi.stubEnv("MULTIBRAND_ENABLED", "1");
  for (const key of Object.keys(licenses)) delete licenses[key];
  for (const key of [TT_KEY, TW_KEY]) {
    licenses[key] = {
      id: `id-${key}`,
      userId: null,
      licenseKey: key,
      tier: "lifetime",
      maxDevices: 3,
      isActive: true,
      expiresAt: null,
    };
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const act = async (host: string, key: string) =>
  activate(
    post("/api/desktop/license/activate", host, {
      licenseKey: key,
      machineId: "machine-1",
    }),
  );

describe("activate", () => {
  it("a TimeWren licence activates on timewren.com and a TimeTrack licence on timetrack.dk", async () => {
    const tw = await act("timewren.com", TW_KEY);
    expect(tw.status).toBe(200);
    expect((await tw.json()).proof).toMatchObject({
      license_key: TW_KEY,
      tier: "lifetime",
      valid_until: null,
      devices_allowed: 3,
    });
    expect((await act("timetrack.dk", TT_KEY)).status).toBe(200);
  });

  it("a TimeTrack licence cannot be activated on TimeWren", async () => {
    const res = await act("timewren.com", TT_KEY);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Invalid license key");
  });

  it("a TimeWren licence cannot be activated on TimeTrack", async () => {
    const res = await act("timetrack.dk", TW_KEY);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Invalid license key");
  });

  it("fails closed without MULTIBRAND_ENABLED: a TW key is refused everywhere", async () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "");
    expect((await act("timewren.com", TW_KEY)).status).toBe(404);
    expect((await act("timewren.com", TT_KEY)).status).toBe(200);
  });
});

describe("verify", () => {
  it("is valid only on the licence's own brand's host", async () => {
    const own = await (await verify(get("timewren.com", TW_KEY))).json();
    expect(own).toMatchObject({ valid: true, tier: "lifetime" });
    expect(
      (await (await verify(get("timetrack.dk", TT_KEY))).json()).valid,
    ).toBe(true);

    const tw = await (await verify(get("timetrack.dk", TW_KEY))).json();
    expect(tw).toMatchObject({ valid: false, error: "License key not found" });
    const tt = await (await verify(get("timewren.com", TT_KEY))).json();
    expect(tt).toMatchObject({ valid: false, error: "License key not found" });
  });
});

describe("deactivate", () => {
  it("does not touch a licence from the other brand", async () => {
    const res = await deactivate(
      post("/api/desktop/license/deactivate", "timewren.com", {
        licenseKey: TT_KEY,
        machineId: "machine-1",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("finds its own brand's licence (then needs an account, as before)", async () => {
    const res = await deactivate(
      post("/api/desktop/license/deactivate", "timewren.com", {
        licenseKey: TW_KEY,
        machineId: "machine-1",
      }),
    );
    expect(res.status).toBe(400);
  });
});
