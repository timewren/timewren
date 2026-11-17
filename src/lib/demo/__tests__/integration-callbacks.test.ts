import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Demoen må ikke forbinde regnskab eller kalender, heller ikke når en
// besøgende kalder callbacken direkte med en selvsat state-cookie.
const h = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ user: { id: "demo-user-1" } })),
  saveEconomicGrant: vi.fn(),
  exchangeDinero: vi.fn(),
  saveDinero: vi.fn(),
  exchangeGoogle: vi.fn(),
  saveGoogle: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: h.getSession } } }));
vi.mock("@/lib/auth/account-brand", () => ({
  accountBrand: async () => "timewren",
}));
vi.mock("@/lib/integrations/economic-grant", () => ({
  saveEconomicGrant: h.saveEconomicGrant,
}));
vi.mock("@/lib/integrations/dinero-oauth", () => ({
  exchangeDineroCodeForTokens: h.exchangeDinero,
  fetchDineroOrganizations: vi.fn(),
  saveDineroConnection: h.saveDinero,
  verifyDineroIdToken: vi.fn(),
}));
vi.mock("@/lib/integrations/google-calendar", () => ({
  exchangeCodeForTokens: h.exchangeGoogle,
  isGoogleCalendarAvailableForBrand: () => true,
  saveCalendarConnection: h.saveGoogle,
}));

import { GET as dineroCallback } from "@/app/api/integrations/dinero/callback/route";
import { GET as economicCallback } from "@/app/api/integrations/economic/callback/route";
import { GET as googleCallback } from "@/app/api/integrations/google/callback/route";

const get = (path: string, cookie: string) =>
  new NextRequest(`https://demo.example${path}`, { headers: { cookie } });

beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "1");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("integrations-callbacks i demo-tilstand", () => {
  it("e-conomic gemmer ingen nøgler", async () => {
    const res = await economicCallback(
      get(
        "/api/integrations/economic/callback?state=test&token=test-grant",
        "economic_grant_state=test",
      ),
    );
    expect(res.headers.get("location")).toContain("error=demo_unavailable");
    expect(h.saveEconomicGrant).not.toHaveBeenCalled();
  });

  it("Dinero bytter ingen kode", async () => {
    const res = await dineroCallback(
      get(
        "/api/integrations/dinero/callback?state=s&code=c&id_token=i",
        "dinero_oauth_state=s; dinero_oauth_nonce=n; dinero_oauth_pkce=p; dinero_oauth_uid=demo-user-1",
      ),
    );
    expect(res.headers.get("location")).toContain("error=demo_unavailable");
    expect(h.exchangeDinero).not.toHaveBeenCalled();
    expect(h.saveDinero).not.toHaveBeenCalled();
  });

  it("Google bytter ingen kode", async () => {
    const res = await googleCallback(
      get(
        "/api/integrations/google/callback?state=s&code=c",
        "google_oauth_state=s",
      ),
    );
    expect(res.headers.get("location")).toContain("error=demo_unavailable");
    expect(h.exchangeGoogle).not.toHaveBeenCalled();
    expect(h.saveGoogle).not.toHaveBeenCalled();
  });

  it("uden DEMO_MODE kører e-conomic-callbacken som før", async () => {
    vi.stubEnv("DEMO_MODE", "");
    await economicCallback(
      get(
        "/api/integrations/economic/callback?state=test&token=test-grant",
        "economic_grant_state=test",
      ),
    );
    expect(h.saveEconomicGrant).toHaveBeenCalledTimes(1);
  });
});
