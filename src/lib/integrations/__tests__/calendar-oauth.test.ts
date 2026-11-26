import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CalendarEnv,
  calendarProvidersForBrand,
  connectionOAuthBrand,
  googleCalendarClient,
  outlookCalendarClient,
} from "../calendar-oauth-clients";
import {
  CALENDAR_OAUTH_STATE_TTL_MS,
  createCalendarOAuthState,
  verifyCalendarOAuthState,
} from "../calendar-oauth-state";

/**
 * Kalender-OAuth pr. brand (docs/specs/timewren-cloud.md → 5, "Kalender"):
 * hvilken klient hvert brand bruger, hvornår en udbyder vises, og den
 * signerede state.
 */

const BRANDS_CONFIG = JSON.stringify({
  timewren: { hosts: ["timewren.com", "www.timewren.com"] },
});

/** TimeTracks prod-lignende env: login-apps sat, ingen kalender-Outlook. */
const TIMETRACK_ENV: CalendarEnv = {
  NEXT_PUBLIC_APP_URL: "https://app.timetrack.dk",
  BRANDS_CONFIG,
  GOOGLE_CLIENT_ID: "g-id",
  GOOGLE_CLIENT_SECRET: "g-secret",
  MICROSOFT_CLIENT_ID: "ms-login-id",
  MICROSOFT_CLIENT_SECRET: "ms-login-secret",
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.timetrack.dk");
  vi.stubEnv("BRANDS_CONFIG", BRANDS_CONFIG);
});
afterEach(() => vi.unstubAllEnvs());

describe("Google Calendar-klient pr. brand", () => {
  it("TimeTrack: GOOGLE_* og redirect til app-URL'en som før", () => {
    expect(googleCalendarClient("timetrack", TIMETRACK_ENV)).toEqual({
      clientId: "g-id",
      clientSecret: "g-secret",
      redirectUri: "https://app.timetrack.dk/api/integrations/google/callback",
    });
    expect(
      googleCalendarClient("timetrack", {
        ...TIMETRACK_ENV,
        GOOGLE_REDIRECT_URI: "https://x.example/cb",
      })?.redirectUri,
    ).toBe("https://x.example/cb");
  });

  it("TimeWren: kun TIMEWREN_GOOGLE_*, redirect til hosts[0]", () => {
    // TimeTracks klient giver aldrig TimeWren Google
    expect(googleCalendarClient("timewren", TIMETRACK_ENV)).toBeNull();
    const env = {
      ...TIMETRACK_ENV,
      TIMEWREN_GOOGLE_CLIENT_ID: "tw-g-id",
      TIMEWREN_GOOGLE_CLIENT_SECRET: "tw-g-secret",
    };
    expect(googleCalendarClient("timewren", env)).toEqual({
      clientId: "tw-g-id",
      clientSecret: "tw-g-secret",
      redirectUri: "https://timewren.com/api/integrations/google/callback",
    });
    expect(
      googleCalendarClient("timewren", {
        ...env,
        TIMEWREN_GOOGLE_REDIRECT_URI: "https://tw.example/cb",
      })?.redirectUri,
    ).toBe("https://tw.example/cb");
    // TimeTrack er uændret af TimeWren-nøglerne
    expect(googleCalendarClient("timetrack", env)?.clientId).toBe("g-id");
  });

  it("kræver både id og secret", () => {
    expect(
      googleCalendarClient("timewren", { TIMEWREN_GOOGLE_CLIENT_ID: "x" }),
    ).toBeNull();
    expect(googleCalendarClient("timetrack", { GOOGLE_CLIENT_ID: "x" })).toBe(
      null,
    );
  });
});

describe("Outlook-klient pr. brand", () => {
  it("TimeTrack uden OUTLOOK_CALENDAR_*: ingen Outlook, heller ikke med login-appen", () => {
    expect(outlookCalendarClient("timetrack", TIMETRACK_ENV)).toBeNull();
  });

  it("TimeTrack med OUTLOOK_CALENDAR_*: egen klient og tenant", () => {
    expect(
      outlookCalendarClient("timetrack", {
        ...TIMETRACK_ENV,
        OUTLOOK_CALENDAR_CLIENT_ID: "tt-o-id",
        OUTLOOK_CALENDAR_CLIENT_SECRET: "tt-o-secret",
      }),
    ).toEqual({
      clientId: "tt-o-id",
      clientSecret: "tt-o-secret",
      tenant: "common",
      redirectUri: "https://app.timetrack.dk/api/integrations/outlook/callback",
    });
  });

  it("TimeWren: TIMEWREN_OUTLOOK_* først, ellers login-appen TIMEWREN_MICROSOFT_*", () => {
    const login = {
      TIMEWREN_MICROSOFT_CLIENT_ID: "tw-ms-id",
      TIMEWREN_MICROSOFT_CLIENT_SECRET: "tw-ms-secret",
      TIMEWREN_MICROSOFT_TENANT_ID: "organizations",
    };
    expect(outlookCalendarClient("timewren", login)).toEqual({
      clientId: "tw-ms-id",
      clientSecret: "tw-ms-secret",
      tenant: "organizations",
      redirectUri: "https://timewren.com/api/integrations/outlook/callback",
    });
    expect(
      outlookCalendarClient("timewren", {
        ...login,
        TIMEWREN_OUTLOOK_CLIENT_ID: "tw-o-id",
        TIMEWREN_OUTLOOK_CLIENT_SECRET: "tw-o-secret",
      })?.clientId,
    ).toBe("tw-o-id");
    // Aldrig TimeTracks Microsoft- eller Outlook-app
    expect(
      outlookCalendarClient("timewren", {
        ...TIMETRACK_ENV,
        OUTLOOK_CALENDAR_CLIENT_ID: "tt-o-id",
        OUTLOOK_CALENDAR_CLIENT_SECRET: "tt-o-secret",
      }),
    ).toBeNull();
  });
});

describe("udbyderliste (UI-gating)", () => {
  it("uden env: kun iCloud", () => {
    expect(calendarProvidersForBrand("timetrack", {})).toEqual({
      google: false,
      outlook: false,
      icloud: true,
    });
    expect(calendarProvidersForBrand("timewren", {})).toEqual({
      google: false,
      outlook: false,
      icloud: true,
    });
  });

  it("TimeTrack i dag: Google og iCloud, ingen Outlook", () => {
    expect(calendarProvidersForBrand("timetrack", TIMETRACK_ENV)).toEqual({
      google: true,
      outlook: false,
      icloud: true,
    });
    // TimeWren-konti ser ingen af TimeTracks klienter
    expect(calendarProvidersForBrand("timewren", TIMETRACK_ENV)).toEqual({
      google: false,
      outlook: false,
      icloud: true,
    });
  });

  it("TimeWren-nøgler viser kun udbyderne for TimeWren", () => {
    const env = {
      ...TIMETRACK_ENV,
      TIMEWREN_GOOGLE_CLIENT_ID: "tw-g-id",
      TIMEWREN_GOOGLE_CLIENT_SECRET: "tw-g-secret",
      TIMEWREN_MICROSOFT_CLIENT_ID: "tw-ms-id",
      TIMEWREN_MICROSOFT_CLIENT_SECRET: "tw-ms-secret",
    };
    expect(calendarProvidersForBrand("timewren", env)).toEqual({
      google: true,
      outlook: true,
      icloud: true,
    });
    expect(calendarProvidersForBrand("timetrack", env).outlook).toBe(false);
  });
});

describe("connectionOAuthBrand", () => {
  it("ukendt eller manglende værdi giver TimeTrack", () => {
    expect(connectionOAuthBrand({})).toBe("timetrack");
    expect(connectionOAuthBrand({ oauthBrand: null })).toBe("timetrack");
    expect(connectionOAuthBrand({ oauthBrand: "evil" })).toBe("timetrack");
    expect(connectionOAuthBrand({ oauthBrand: "timewren" })).toBe("timewren");
  });
});

describe("signeret OAuth-state", () => {
  const now = 1_800_000_000_000;
  const make = () =>
    createCalendarOAuthState({
      userId: "user-1",
      brand: "timewren",
      provider: "outlook",
      now,
    });
  const verify = (
    state: string | null,
    cookieState: string | null,
    over: Partial<{ userId: string; provider: "google" | "outlook" }> = {},
    at = now + 1000,
  ) =>
    verifyCalendarOAuthState({
      state,
      cookieState,
      userId: over.userId ?? "user-1",
      provider: over.provider ?? "outlook",
      now: at,
    });

  it("gyldig state giver brandet", () => {
    const s = make();
    expect(verify(s, s)).toEqual({ ok: true, brand: "timewren" });
  });

  it("afviser manglende, forkert, forfalsket og udløbet state", () => {
    const s = make();
    expect(verify(null, s)).toEqual({ ok: false, reason: "missing" });
    expect(verify(s, null)).toEqual({ ok: false, reason: "missing" });
    expect(verify(s, make())).toEqual({ ok: false, reason: "mismatch" });

    // Ændret payload (andet brand) med gammel signatur
    const [, sig] = s.split(".");
    const forged = `${Buffer.from(
      JSON.stringify({
        u: "user-1",
        b: "timetrack",
        p: "outlook",
        e: now * 2,
        n: "x",
      }),
    ).toString("base64url")}.${sig}`;
    expect(verify(forged, forged)).toEqual({ ok: false, reason: "invalid" });
    expect(verify("garbage", "garbage")).toEqual({
      ok: false,
      reason: "invalid",
    });

    expect(verify(s, s, {}, now + CALENDAR_OAUTH_STATE_TTL_MS + 1)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("afviser en anden konto og en anden udbyder", () => {
    const s = make();
    expect(verify(s, s, { userId: "user-2" })).toEqual({
      ok: false,
      reason: "wrong_user",
    });
    expect(verify(s, s, { provider: "google" })).toEqual({
      ok: false,
      reason: "wrong_provider",
    });
  });

  it("signaturen afhænger af BETTER_AUTH_SECRET", () => {
    const s = make();
    vi.stubEnv("BETTER_AUTH_SECRET", "another-secret");
    expect(verify(s, s)).toEqual({ ok: false, reason: "invalid" });
  });
});
