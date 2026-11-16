import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBrandConfigs } from "@/lib/brands/registry";
import {
  authBrandForHost,
  brandAuthParams,
  isHostAuthEnabled,
  isRedirectFlow,
  isWrongBrand,
  signupLocale,
  toBrandKey,
} from "../host-auth";

/**
 * Auth pr. host (docs/specs/timewren-cloud.md → 5). Integrationstesten
 * (host-auth.integration.test.ts) kører flowene mod en database; her er
 * reglerne og den byggede better-auth-konfiguration uden database.
 */

vi.mock("@/lib/db", () => ({ db: {} }));

beforeEach(() => {
  vi.stubEnv("MULTIBRAND_ENABLED", "1");
  vi.stubEnv("TIMEWREN_APP_ENABLED", "1");
  vi.stubEnv("BRANDS_CONFIG", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("flag og host → brand", () => {
  it("kræver både MULTIBRAND_ENABLED og TIMEWREN_APP_ENABLED", () => {
    expect(isHostAuthEnabled()).toBe(true);
    for (const [multi, app] of [
      ["", "1"],
      ["1", ""],
      ["", ""],
    ]) {
      vi.stubEnv("MULTIBRAND_ENABLED", multi);
      vi.stubEnv("TIMEWREN_APP_ENABLED", app);
      expect(isHostAuthEnabled()).toBe(false);
      expect(authBrandForHost("timewren.com")).toBe("timetrack");
    }
  });

  it("TimeWren-hosts giver timewren; alt andet timetrack", () => {
    expect(authBrandForHost("timewren.com")).toBe("timewren");
    expect(authBrandForHost("www.timewren.com:443")).toBe("timewren");
    expect(authBrandForHost("timetrack.dk")).toBe("timetrack");
    expect(authBrandForHost("app.timetrack.dk")).toBe("timetrack");
    expect(authBrandForHost("localhost:3000")).toBe("timetrack");
    expect(authBrandForHost(null)).toBe("timetrack");
  });

  it("hosts fra BRANDS_CONFIG", () => {
    vi.stubEnv(
      "BRANDS_CONFIG",
      JSON.stringify({ timewren: { hosts: ["timewren.net"] } }),
    );
    expect(authBrandForHost("timewren.net")).toBe("timewren");
    expect(authBrandForHost("timewren.com")).toBe("timetrack");
  });
});

describe("TimeWrens auth-parametre", () => {
  const names = { name: "TimeWren", shortName: "TimeWren" };

  it("baseURL, RP ID og origins fra den primære host; host-only cookies", () => {
    vi.stubEnv("AUTH_COOKIE_DOMAIN", ".timetrack.dk");
    vi.stubEnv("AUTH_RP_ID", "timetrack.dk");
    vi.stubEnv("TRUSTED_ORIGINS", "https://timetrack.dk");
    const p = brandAuthParams(getBrandConfigs().timewren, names);
    expect(p.baseURL).toBe("https://timewren.com");
    expect(p.rpID).toBe("timewren.com");
    expect(p.cookieDomain).toBeUndefined();
    expect(p.trustedOrigins).toContain("https://timewren.com");
    expect(p.trustedOrigins).toContain("https://www.timewren.com");
    expect(p.trustedOrigins.join(" ")).not.toContain("timetrack");
  });

  it("følger BRANDS_CONFIG", () => {
    const cfg = getBrandConfigs(
      JSON.stringify({
        timewren: { hosts: ["timewren.net", "www.timewren.net"] },
      }),
    ).timewren;
    const p = brandAuthParams(cfg, names);
    expect(p.baseURL).toBe("https://timewren.net");
    expect(p.rpID).toBe("timewren.net");
    expect(p.trustedOrigins).toEqual([
      "https://timewren.net",
      "https://www.timewren.net",
      "https://appleid.apple.com",
      "timewren://",
    ]);
  });

  it("stoler på TimeWren-appens scheme, men ikke på TimeTracks", () => {
    const p = brandAuthParams(getBrandConfigs().timewren, names);
    expect(p.trustedOrigins).toContain("timewren://");
    expect(p.trustedOrigins).not.toContain("timetrack://");
    expect(p.trustedOrigins).not.toContain("exp://");
  });
});

describe("sprog ved tilmelding", () => {
  const tw = () => getBrandConfigs().timewren;
  const h = (init: Record<string, string>) => new Headers(init);

  it("locale-cookie, så Accept-Language, begrænset til brandets sprog", () => {
    expect(signupLocale(tw(), h({ cookie: "a=1; locale=de; b=2" }))).toBe("de");
    expect(
      signupLocale(tw(), h({ "accept-language": "es-ES,es;q=0.9,en;q=0.8" })),
    ).toBe("es");
    // Sprog uden for brandet (fr, sv) giver brandets standard (en), aldrig "da".
    expect(signupLocale(tw(), h({ "accept-language": "fr-FR,sv;q=0.5" }))).toBe(
      "en",
    );
    expect(signupLocale(tw(), h({ cookie: "locale=sv" }))).toBe("en");
    expect(signupLocale(tw(), undefined)).toBe("en");
    expect(signupLocale(tw(), h({ "accept-language": "da-DK" }))).toBe("da");
  });
});

describe("kontoens brand mod sitets", () => {
  it("afviser kun på tværs af brands, og kun med flagene", () => {
    expect(isWrongBrand("timewren", "timetrack")).toBe(true);
    expect(isWrongBrand("timetrack", "timewren")).toBe(true);
    expect(isWrongBrand("timewren", "timewren")).toBe(false);
    expect(isWrongBrand("timetrack", "timetrack")).toBe(false);
    // Ukendt/manglende brand = timetrack (kolonnens default).
    expect(isWrongBrand(null, "timetrack")).toBe(false);
    expect(isWrongBrand("noget", "timewren")).toBe(true);
    vi.stubEnv("TIMEWREN_APP_ENABLED", "");
    expect(isWrongBrand("timewren", "timetrack")).toBe(false);
  });

  it("toBrandKey og redirect-flows", () => {
    expect(toBrandKey("timewren")).toBe("timewren");
    expect(toBrandKey(undefined)).toBe("timetrack");
    expect(isRedirectFlow("/callback/google")).toBe(true);
    expect(isRedirectFlow("/oauth2/callback/x")).toBe(true);
    expect(isRedirectFlow("/magic-link/verify")).toBe(true);
    expect(isRedirectFlow("/verify-email")).toBe(true);
    expect(isRedirectFlow("/sign-in/email")).toBe(false);
    expect(isRedirectFlow(undefined)).toBe(false);
  });
});

/**
 * Standardinstansens konfiguration (det timetrack.dk kører på) er den samme
 * med og uden flagene, og værdierne er dem, auth.ts gav før multibrand.
 */
describe("timetrack.dk er uændret", () => {
  const ENV = {
    NEXT_PUBLIC_APP_URL: "https://timetrack.dk",
    NEXT_PUBLIC_MARKETING_URL: "",
    NEXT_PUBLIC_BRAND: "timetrack",
    AUTH_COOKIE_DOMAIN: ".timetrack.dk",
    AUTH_RP_ID: "",
    AUTH_COOKIE_PREFIX: "",
    TRUSTED_ORIGINS: "https://extra.example",
  };

  type Plugin = { id: string; options?: Record<string, unknown> };

  async function load(flags: "1" | "") {
    vi.resetModules();
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    vi.stubEnv("MULTIBRAND_ENABLED", flags);
    vi.stubEnv("TIMEWREN_APP_ENABLED", flags);
    const mod = await import("@/lib/auth");
    const o = mod.auth.options as unknown as {
      appName: string;
      baseURL: string;
      trustedOrigins: string[];
      advanced: Record<string, unknown>;
      plugins: Plugin[];
    };
    const plugin = (id: string) =>
      o.plugins.find((p) => p.id === id)?.options ?? {};
    return {
      mod,
      config: {
        appName: o.appName,
        baseURL: o.baseURL,
        trustedOrigins: o.trustedOrigins,
        advanced: o.advanced,
        passkey: {
          rpID: plugin("passkey").rpID,
          rpName: plugin("passkey").rpName,
        },
        issuer: plugin("two-factor").issuer,
      },
    };
  }

  it("samme værdier som før multibrand", async () => {
    const { config } = await load("");
    expect(config).toEqual({
      appName: "TimeTrack",
      baseURL: "https://timetrack.dk",
      trustedOrigins: [
        "https://timetrack.dk",
        "https://appleid.apple.com",
        "https://extra.example",
        "timetrack://",
        "timetrack.preview://",
      ],
      advanced: {
        cookiePrefix: "better-auth",
        crossSubDomainCookies: { enabled: true, domain: ".timetrack.dk" },
        useSecureCookies: false,
      },
      passkey: { rpID: "timetrack.dk", rpName: "TimeTrack" },
      issuer: "TimeTrack",
    });
  });

  it("identisk med flagene slået til", async () => {
    const off = await load("");
    const on = await load("1");
    expect(on.config).toEqual(off.config);
    // timetrack-hosts får standardinstansen; uden flag også TimeWren-hosts.
    expect(on.mod.authForHost("timetrack.dk")).toBe(on.mod.auth);
    expect(on.mod.authForHost("app.timetrack.dk")).toBe(on.mod.auth);
    expect(on.mod.authForHost("localhost:3000")).toBe(on.mod.auth);
    // Flagene læses ved kald.
    vi.stubEnv("TIMEWREN_APP_ENABLED", "");
    expect(on.mod.authForHost("timewren.com")).toBe(on.mod.auth);
    expect(on.mod.authForBrand("timewren")).toBe(on.mod.auth);
  });

  it("TimeWren-instansen med flagene: egen baseURL, RP ID og host-only cookies", async () => {
    const { mod } = await load("1");
    const tw = mod.authForHost("timewren.com");
    expect(tw).not.toBe(mod.auth);
    expect(mod.authForBrand("timewren")).toBe(tw);
    const o = tw.options as unknown as {
      appName: string;
      baseURL: string;
      advanced: { crossSubDomainCookies: unknown; cookiePrefix: string };
      plugins: Plugin[];
    };
    expect(o.appName).toBe("TimeWren");
    expect(o.baseURL).toBe("https://timewren.com");
    expect(o.advanced.crossSubDomainCookies).toEqual({ enabled: false });
    expect(o.advanced.cookiePrefix).toBe("better-auth");
    const passkey = o.plugins.find((p) => p.id === "passkey")?.options;
    expect(passkey).toMatchObject({ rpID: "timewren.com", rpName: "TimeWren" });
    expect(o.plugins.find((p) => p.id === "two-factor")?.options).toMatchObject(
      { issuer: "TimeWren" },
    );
    // users.locale skrives kun af TimeWren-instansen; TimeTrack erklærer det
    // ikke (kolonnens default "da", svar som før).
    const fields = (i: { options: unknown }) =>
      Object.keys(
        (i.options as { user: { additionalFields: Record<string, unknown> } })
          .user.additionalFields,
      );
    expect(fields(tw)).toEqual(["brand", "locale"]);
    expect(fields(mod.auth)).toEqual(["brand"]);
  });
});
