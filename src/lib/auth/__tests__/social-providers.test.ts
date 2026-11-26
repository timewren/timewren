import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AuthProviders,
  fallbackProviders,
  visibleAuthMethods,
} from "@/components/auth/SocialAuthButtons";
import { isCheckoutAvailableForBrand } from "@/lib/billing/brand-billing";
import {
  linkableProviders,
  oauthAvailability,
  providerEnvName,
  socialClient,
} from "../social-providers";

/**
 * Login-udbydere pr. brand (docs/specs/timewren-cloud.md → 5,
 * "Login-udbydere"): TimeWren registrerer og viser kun udbydere med en
 * TimeWren-klient, og timetrack.dk er uændret.
 */

const h = vi.hoisted(() => ({ msCalls: [] as Record<string, unknown>[] }));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth/microsoft-entra", async (orig) => {
  const m = (await orig()) as Record<string, unknown>;
  return {
    ...m,
    microsoftEntra: (o: Record<string, unknown>) => {
      h.msCalls.push({
        clientId: o.clientId,
        clientSecret: o.clientSecret,
        tenantId: o.tenantId,
      });
      return (m.microsoftEntra as (x: unknown) => unknown)(o);
    },
  };
});

/** TimeTracks klienter, som i prod. */
const TIMETRACK_ENV = {
  NEXT_PUBLIC_APP_URL: "https://timetrack.dk",
  NEXT_PUBLIC_BRAND: "timetrack",
  BRANDS_CONFIG: JSON.stringify({
    timewren: { hosts: ["timewren.com", "www.timewren.com"] },
  }),
  GOOGLE_CLIENT_ID: "g-id",
  GOOGLE_CLIENT_SECRET: "g-secret",
  GITHUB_CLIENT_ID: "gh-id",
  GITHUB_CLIENT_SECRET: "gh-secret",
  DISCORD_CLIENT_ID: "",
  DISCORD_CLIENT_SECRET: "",
  MICROSOFT_CLIENT_ID: "ms-id",
  MICROSOFT_CLIENT_SECRET: "ms-secret",
  MICROSOFT_TENANT_ID: "",
  APPLE_CLIENT_ID: "",
};

const TIMEWREN_KEYS = [
  "GOOGLE",
  "GITHUB",
  "DISCORD",
  "MICROSOFT",
  "APPLE",
].flatMap((p) => [
  `TIMEWREN_${p}_CLIENT_ID`,
  `TIMEWREN_${p}_CLIENT_SECRET`,
  `TIMEWREN_${p}_TENANT_ID`,
]);

function stubEnv(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

beforeEach(() => {
  h.msCalls.length = 0;
  stubEnv(TIMETRACK_ENV);
  for (const k of TIMEWREN_KEYS) vi.stubEnv(k, "");
  vi.stubEnv("MULTIBRAND_ENABLED", "1");
  vi.stubEnv("TIMEWREN_APP_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

type Plugin = { id: string };
type Options = {
  socialProviders: Record<string, unknown>;
  account: unknown;
  plugins: Plugin[];
};

async function resolved(sp: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sp)) {
    out[k] = typeof v === "function" ? await (v as () => unknown)() : v;
  }
  return out;
}

async function loadAuth() {
  vi.resetModules();
  h.msCalls.length = 0;
  const mod = await import("@/lib/auth");
  const defaultMsCalls = [...h.msCalls];
  return { mod, defaultMsCalls };
}

function timewrenInstance(mod: typeof import("@/lib/auth")) {
  h.msCalls.length = 0;
  const tw = mod.authForHost("timewren.com");
  expect(tw).not.toBe(mod.auth);
  return { options: tw.options as unknown as Options, msCalls: [...h.msCalls] };
}

describe("env-navne og klienter", () => {
  it("TimeTrack bruger de gamle navne, TimeWren TIMEWREN_-præfiks", () => {
    expect(providerEnvName("timetrack", "google", "CLIENT_ID")).toBe(
      "GOOGLE_CLIENT_ID",
    );
    expect(providerEnvName("timewren", "google", "CLIENT_SECRET")).toBe(
      "TIMEWREN_GOOGLE_CLIENT_SECRET",
    );
    expect(providerEnvName("timewren", "microsoft", "TENANT_ID")).toBe(
      "TIMEWREN_MICROSOFT_TENANT_ID",
    );
  });

  it("TimeWren falder aldrig tilbage til TimeTracks klienter", () => {
    expect(socialClient("timetrack", "google")).toEqual({
      clientId: "g-id",
      clientSecret: "g-secret",
    });
    for (const p of [
      "google",
      "github",
      "discord",
      "microsoft",
      "apple",
    ] as const) {
      expect(socialClient("timewren", p)).toBeNull();
    }
    expect(oauthAvailability("timewren")).toEqual({
      google: false,
      github: false,
      discord: false,
      microsoft: false,
    });
  });

  it("kræver både id og secret (Apple kun Services ID)", () => {
    vi.stubEnv("TIMEWREN_GOOGLE_CLIENT_ID", "tw-g-id");
    expect(socialClient("timewren", "google")).toBeNull();
    vi.stubEnv("TIMEWREN_GOOGLE_CLIENT_SECRET", "tw-g-secret");
    expect(socialClient("timewren", "google")).toEqual({
      clientId: "tw-g-id",
      clientSecret: "tw-g-secret",
    });
    vi.stubEnv("TIMEWREN_APPLE_CLIENT_ID", "com.timewren.web");
    expect(socialClient("timewren", "apple")).toEqual({
      clientId: "com.timewren.web",
      clientSecret: "",
    });
  });
});

describe("(a) udbydere registreret pr. host", () => {
  it("TimeWren uden TIMEWREN_-env: ingen sociale udbydere og ingen Microsoft", async () => {
    const { mod } = await loadAuth();
    const tw = timewrenInstance(mod);
    expect(tw.options.socialProviders).toEqual({});
    expect(tw.msCalls).toEqual([]);
    expect(tw.options.plugins.map((p) => p.id)).not.toContain(
      "microsoft-entra-id-provider",
    );
    // Konto-kobling er den samme liste som TimeTrack, men uden registrerede
    // udbydere kan intet kobles.
    expect(tw.options.account).toEqual(mod.auth.options.account);
  });

  it("TimeWren med egne klienter: kun dem, med TimeWrens nøgler", async () => {
    stubEnv({
      TIMEWREN_GOOGLE_CLIENT_ID: "tw-g-id",
      TIMEWREN_GOOGLE_CLIENT_SECRET: "tw-g-secret",
      TIMEWREN_MICROSOFT_CLIENT_ID: "tw-ms-id",
      TIMEWREN_MICROSOFT_CLIENT_SECRET: "tw-ms-secret",
      TIMEWREN_MICROSOFT_TENANT_ID: "tw-tenant",
    });
    const { mod } = await loadAuth();
    const tw = timewrenInstance(mod);
    expect(await resolved(tw.options.socialProviders)).toEqual({
      google: {
        clientId: "tw-g-id",
        clientSecret: "tw-g-secret",
        enabled: true,
      },
    });
    expect(tw.msCalls).toEqual([
      {
        clientId: "tw-ms-id",
        clientSecret: "tw-ms-secret",
        tenantId: "tw-tenant",
      },
    ]);
    // TimeTracks instans har stadig sine egne nøgler.
    const tt = await resolved(
      (mod.auth.options as unknown as Options).socialProviders,
    );
    expect(tt.google).toMatchObject({ clientId: "g-id" });
  });

  it("kalender-nøgler registrerer ingen login-udbydere", async () => {
    // Outlook-kalenderens egne apps (docs/specs/timewren-cloud.md → 5,
    // "Kalender") må ikke slå Microsoft-login til på nogen af instanserne.
    stubEnv({
      TIMEWREN_OUTLOOK_CLIENT_ID: "tw-o-id",
      TIMEWREN_OUTLOOK_CLIENT_SECRET: "tw-o-secret",
      OUTLOOK_CALENDAR_CLIENT_ID: "tt-o-id",
      OUTLOOK_CALENDAR_CLIENT_SECRET: "tt-o-secret",
    });
    const { mod, defaultMsCalls } = await loadAuth();
    const tw = timewrenInstance(mod);
    expect(tw.options.socialProviders).toEqual({});
    expect(tw.msCalls).toEqual([]);
    expect(defaultMsCalls.map((c) => c.clientId)).toEqual(["ms-id"]);
  });

  it("Apple på TimeWren kun med Services ID og signeringsnøgle", async () => {
    vi.stubEnv("TIMEWREN_APPLE_CLIENT_ID", "com.timewren.web");
    let { mod } = await loadAuth();
    expect(timewrenInstance(mod).options.socialProviders).toEqual({});

    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    stubEnv({
      APPLE_TEAM_ID: "TEAM123456",
      APPLE_KEY_ID: "KEY1234567",
      APPLE_PRIVATE_KEY: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    });
    ({ mod } = await loadAuth());
    const apple = (
      await resolved(timewrenInstance(mod).options.socialProviders)
    ).apple as Record<string, unknown>;
    expect(apple.clientId).toBe("com.timewren.web");
    expect(apple.enabled).toBe(true);
    expect(apple.clientSecret).toEqual(expect.any(String));
    // Ingen TimeTrack-bundle-id: mobilappens tokens gælder ikke på TimeWren.
    expect(apple.appBundleIdentifier).toBeUndefined();
  });

  it("/api/auth/providers følger hosten", async () => {
    vi.stubEnv("TIMEWREN_GITHUB_CLIENT_ID", "tw-gh-id");
    vi.stubEnv("TIMEWREN_GITHUB_CLIENT_SECRET", "tw-gh-secret");
    const { GET } = await import("@/app/api/auth/providers/route");
    const get = async (host: string) =>
      (await GET(
        new Request("https://x/api/auth/providers", { headers: { host } }),
      ).then((r) => r.json())) as AuthProviders;

    expect(await get("timetrack.dk")).toMatchObject({
      google: true,
      github: true,
      discord: false,
      microsoft: true,
    });
    expect(await get("timewren.com")).toMatchObject({
      google: false,
      github: true,
      discord: false,
      microsoft: false,
      email: true,
      passkey: true,
    });

    // Uden TIMEWREN_APP_ENABLED er timewren.com som alle andre hosts.
    vi.stubEnv("TIMEWREN_APP_ENABLED", "");
    expect(await get("timewren.com")).toMatchObject({
      google: true,
      github: true,
      microsoft: true,
    });
  });

  it("kontoindstillinger: forbind kun brandets udbydere", () => {
    expect(linkableProviders("timetrack")).toEqual({
      google: true,
      github: true,
      discord: false,
      "microsoft-entra-id": true,
    });
    expect(linkableProviders("timewren")).toEqual({
      google: false,
      github: false,
      discord: false,
      "microsoft-entra-id": false,
    });
  });
});

/**
 * Standardinstansens udbydere, konto-kobling og plugins, taget på main
 * (7299e7e25, før auth pr. brand) med TIMETRACK_ENV. Ens med og uden flag.
 */
const MAIN_BASELINE = {
  socialProviders: {
    apple: {
      clientId: "",
      clientSecret: "",
      appBundleIdentifier: "dk.timetrack.app",
      enabled: false,
    },
    google: { clientId: "g-id", clientSecret: "g-secret", enabled: true },
    discord: { clientId: "", clientSecret: "", enabled: false },
    github: { clientId: "gh-id", clientSecret: "gh-secret", enabled: true },
  },
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      // Discord er ikke trusted (#1117): auto-link kun med verificeret e-mail.
      trustedProviders: ["google", "github"],
    },
  },
  pluginIds: [
    "expo",
    "microsoft-entra-id-provider",
    "admin",
    "organization",
    "magic-link",
    "phone-number",
    "passkey",
    "two-factor",
    "oauth-provider",
    "cimd",
    "timetrack-mcp-consent-guard",
  ],
  ms: [{ clientId: "ms-id", clientSecret: "ms-secret", tenantId: "common" }],
};

describe("(b) timetrack.dk's auth-konfiguration er uændret", () => {
  async function defaultConfig() {
    const { mod, defaultMsCalls } = await loadAuth();
    const o = mod.auth.options as unknown as Options;
    return {
      socialProviders: await resolved(o.socialProviders),
      account: o.account,
      pluginIds: o.plugins.map((p) => p.id),
      ms: defaultMsCalls,
    };
  }

  it("som main, med og uden flagene og med TIMEWREN_-klienter sat", async () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "");
    vi.stubEnv("TIMEWREN_APP_ENABLED", "");
    expect(await defaultConfig()).toEqual(MAIN_BASELINE);

    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    vi.stubEnv("TIMEWREN_APP_ENABLED", "1");
    expect(await defaultConfig()).toEqual(MAIN_BASELINE);

    stubEnv({
      TIMEWREN_GOOGLE_CLIENT_ID: "tw-g-id",
      TIMEWREN_GOOGLE_CLIENT_SECRET: "tw-g-secret",
      TIMEWREN_DISCORD_CLIENT_ID: "tw-d-id",
      TIMEWREN_DISCORD_CLIENT_SECRET: "tw-d-secret",
    });
    expect(await defaultConfig()).toEqual(MAIN_BASELINE);

    // Kalender-klienterne (Outlook pr. brand) ændrer heller ikke login
    stubEnv({
      OUTLOOK_CALENDAR_CLIENT_ID: "tt-o-id",
      OUTLOOK_CALENDAR_CLIENT_SECRET: "tt-o-secret",
      TIMEWREN_OUTLOOK_CLIENT_ID: "tw-o-id",
      TIMEWREN_OUTLOOK_CLIENT_SECRET: "tw-o-secret",
    });
    expect(await defaultConfig()).toEqual(MAIN_BASELINE);
  });

  it("timetrack-hosts får standardinstansen", async () => {
    const { mod } = await loadAuth();
    expect(mod.authForHost("timetrack.dk")).toBe(mod.auth);
    expect(mod.authForHost("app.timetrack.dk")).toBe(mod.auth);
  });
});

describe("(c) login-knapper pr. brand", () => {
  async function buttons(host: string, mode: "login" | "register") {
    const { GET } = await import("@/app/api/auth/providers/route");
    const providers = (await GET(
      new Request("https://x/api/auth/providers", { headers: { host } }),
    ).then((r) => r.json())) as AuthProviders;
    return visibleAuthMethods(providers, mode);
  }

  it("timetrack.dk: som før", async () => {
    expect(await buttons("timetrack.dk", "login")).toEqual([
      "google",
      "microsoft",
      "github",
      "passkey",
    ]);
    expect(await buttons("timetrack.dk", "register")).toEqual([
      "google",
      "microsoft",
      "github",
    ]);
  });

  it("timewren.com uden TimeWren-klienter: ingen OAuth-knapper", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(await buttons("timewren.com", "login")).toEqual([
      "magicLink",
      "passkey",
    ]);
    expect(await buttons("timewren.com", "register")).toEqual([]);
  });

  it("timewren.com med TIMEWREN_GOOGLE_*: kun Google", async () => {
    vi.stubEnv("TIMEWREN_GOOGLE_CLIENT_ID", "tw-g-id");
    vi.stubEnv("TIMEWREN_GOOGLE_CLIENT_SECRET", "tw-g-secret");
    expect(await buttons("timewren.com", "register")).toEqual(["google"]);
  });

  it("SMS-login kun på timetrack.dk, ikke på timewren.com", async () => {
    vi.stubEnv("MESSAGEBIRD_API_KEY", "mb-test");
    const { GET } = await import("@/app/api/auth/providers/route");
    const phone = async (host: string) =>
      (
        (await GET(
          new Request("https://x/api/auth/providers", { headers: { host } }),
        ).then((r) => r.json())) as AuthProviders
      ).phone;
    expect(await phone("timetrack.dk")).toBe(true);
    expect(await phone("timewren.com")).toBe(false);

    // TimeWren-instansen har hverken SMS-login eller -signup.
    const { mod } = await loadAuth();
    const ids = (plugins: { id: string }[] | undefined) =>
      (plugins ?? []).map((pl) => pl.id);
    expect(ids(mod.auth.options.plugins)).toContain("phone-number");
    expect(ids(timewrenInstance(mod).options.plugins)).not.toContain(
      "phone-number",
    );
  });

  it("fallback ved netværksfejl: OAuth kun på build-brandets hosts", () => {
    expect(fallbackProviders("timetrack", "timetrack")).toMatchObject({
      google: true,
      github: true,
      discord: true,
    });
    expect(fallbackProviders("timewren", "timetrack")).toMatchObject({
      google: false,
      github: false,
      discord: false,
      microsoft: false,
      email: true,
      passkey: true,
    });
    // Selvhost med TimeWren-build: egne env-navne, som før.
    expect(fallbackProviders("timewren", "timewren")).toMatchObject({
      google: true,
    });
  });
});

describe("kalender og betaling pr. brand", () => {
  it("Google Calendar: TimeWren kun med egen klient (TIMEWREN_GOOGLE_*)", async () => {
    const { isGoogleCalendarAvailableForBrand } = await import(
      "@/lib/integrations/google-calendar"
    );
    expect(isGoogleCalendarAvailableForBrand("timetrack")).toBe(true);
    expect(isGoogleCalendarAvailableForBrand("timewren")).toBe(false);

    // Samme Google-app som login kan genbruges til kalenderen
    stubEnv({
      TIMEWREN_GOOGLE_CLIENT_ID: "tw-g-id",
      TIMEWREN_GOOGLE_CLIENT_SECRET: "tw-g-secret",
    });
    expect(isGoogleCalendarAvailableForBrand("timewren")).toBe(true);
    expect(isGoogleCalendarAvailableForBrand("timetrack")).toBe(true);
  });

  it("checkout kun for TimeTrack", () => {
    expect(isCheckoutAvailableForBrand("timetrack")).toBe(true);
    expect(isCheckoutAvailableForBrand("timewren")).toBe(false);
  });
});
