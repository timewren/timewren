import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Google Calendar pr. brand (docs/specs/timewren-cloud.md → 5, "Kalender"):
 * callbacken vælger klient ud fra kontoens brand, kræver en gyldig signeret
 * state, gemmer tokens krypteret med brandet, og refresh/webhooks bruger
 * forbindelsens egen klient. Token-endpointet (google-auth-library) og
 * Calendar-API'et er mocket.
 */

const h = vi.hoisted(() => {
  const constructed: { clientId: string; redirectUri: string }[] = [];
  const getToken = vi.fn();
  const request = vi.fn();
  const refreshAccessToken = vi.fn();
  class FakeOAuth2 {
    transporter = { defaults: {} };
    clientId: string;
    constructor(clientId: string, _secret: string, redirectUri: string) {
      this.clientId = clientId;
      constructed.push({ clientId, redirectUri });
    }
    generateAuthUrl(opts: Record<string, unknown>) {
      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${this.clientId}&state=${opts.state}`;
    }
    setCredentials() {}
    getToken = getToken;
    request = request;
    refreshAccessToken = refreshAccessToken;
  }
  const watch = vi.fn();
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const db = {
    query: {
      users: { findFirst: vi.fn() },
      calendarConnections: { findFirst: vi.fn(), findMany: vi.fn() },
    },
    execute: vi.fn(async () => []),
    transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(db)),
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        return { returning: async () => [{ id: "conn-new" }] };
      },
    })),
    update: vi.fn(() => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        return {
          where: vi.fn(() =>
            Object.assign(Promise.resolve(undefined), {
              returning: async () => [{ id: "conn-1" }],
            }),
          ),
        };
      },
    })),
  };
  return {
    constructed,
    getToken,
    request,
    refreshAccessToken,
    FakeOAuth2,
    watch,
    inserts,
    updates,
    db,
    getSession: vi.fn(),
  };
});

vi.mock("google-auth-library", () => ({ OAuth2Client: h.FakeOAuth2 }));
vi.mock("@googleapis/calendar", () => ({
  calendar: () => ({ events: { watch: h.watch } }),
}));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: h.getSession } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/i18n/server-text", () => ({
  tr: async (_ns: string, key: string) => key,
}));

import { createCalendarOAuthState } from "@/lib/integrations/calendar-oauth-state";
import {
  getAuthenticatedClient,
  isGoogleCalendarAvailableForBrand,
  registerWebhookChannel,
} from "@/lib/integrations/google-calendar";
import { decryptSecret, encryptSecret } from "@/lib/utils/encryption";
import { GET } from "./route";

const ACCESS = "ya29.plain-access-token";
const REFRESH = "1//plain-refresh-token";

function stubBaseEnv() {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.timetrack.dk");
  vi.stubEnv(
    "BRANDS_CONFIG",
    JSON.stringify({
      timewren: { hosts: ["timewren.com", "www.timewren.com"] },
    }),
  );
  vi.stubEnv("MULTIBRAND_ENABLED", "1");
  vi.stubEnv("TIMEWREN_APP_ENABLED", "1");
  vi.stubEnv("GOOGLE_CLIENT_ID", "tt-g-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "tt-g-secret");
  vi.stubEnv("GOOGLE_REDIRECT_URI", "");
  vi.stubEnv("TIMEWREN_GOOGLE_CLIENT_ID", "tw-g-id");
  vi.stubEnv("TIMEWREN_GOOGLE_CLIENT_SECRET", "tw-g-secret");
  vi.stubEnv("TIMEWREN_GOOGLE_REDIRECT_URI", "");
  vi.stubEnv("ENCRYPTION_KEY", "e".repeat(64));
  vi.stubEnv("CALLBACK_BASE_URL", "");
}

function login(userId: string, brand: "timetrack" | "timewren") {
  h.getSession.mockResolvedValue({ user: { id: userId } });
  h.db.query.users.findFirst.mockResolvedValue({ brand });
}

function callback(params: { state?: string; cookie?: string; code?: string }) {
  const url = new URL("https://internal:3000/api/integrations/google/callback");
  if (params.code !== undefined) url.searchParams.set("code", params.code);
  if (params.state) url.searchParams.set("state", params.state);
  return new NextRequest(url, {
    headers: params.cookie
      ? { cookie: `google_oauth_state=${params.cookie}` }
      : {},
  });
}

function location(res: Response) {
  return new URL(res.headers.get("location") ?? "");
}

beforeEach(() => {
  stubBaseEnv();
  vi.clearAllMocks();
  h.constructed.length = 0;
  h.inserts.length = 0;
  h.updates.length = 0;
  h.db.query.calendarConnections.findFirst.mockResolvedValue(undefined);
  h.getToken.mockResolvedValue({
    tokens: {
      access_token: ACCESS,
      refresh_token: REFRESH,
      expiry_date: Date.now() + 3_600_000,
      scope: "https://www.googleapis.com/auth/calendar.readonly",
    },
  });
  h.request.mockResolvedValue({ data: { email: "kalender@example.com" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Google Calendar-callback pr. brand", () => {
  it("TimeTrack: gyldig state → TimeTracks klient, tokens krypteret, brand-default", async () => {
    login("user-tt", "timetrack");
    const state = createCalendarOAuthState({
      userId: "user-tt",
      brand: "timetrack",
      provider: "google",
    });
    const res = await GET(callback({ state, cookie: state, code: "c1" }));

    const to = location(res);
    expect(to.origin).toBe("https://app.timetrack.dk");
    expect(to.searchParams.get("success")).toBe("google_connected");
    expect(h.getToken).toHaveBeenCalledWith("c1");
    expect(h.constructed.map((c) => c.clientId)).toEqual(["tt-g-id"]);
    expect(h.constructed[0].redirectUri).toBe(
      "https://app.timetrack.dk/api/integrations/google/callback",
    );

    expect(h.inserts).toHaveLength(1);
    const row = h.inserts[0] as Record<string, string>;
    // Klarteksten står ingen steder i rækken
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(ACCESS);
    expect(serialized).not.toContain(REFRESH);
    expect(decryptSecret(row.accessToken)).toBe(ACCESS);
    expect(decryptSecret(row.refreshToken)).toBe(REFRESH);
    // TimeTrack skriver ikke kolonnen (default 'timetrack' som før)
    expect("oauthBrand" in row).toBe(false);
  });

  it("TimeWren: TIMEWREN_GOOGLE_*, redirect til timewren.com, brandet gemmes", async () => {
    login("user-tw", "timewren");
    const state = createCalendarOAuthState({
      userId: "user-tw",
      brand: "timewren",
      provider: "google",
    });
    const res = await GET(callback({ state, cookie: state, code: "c2" }));

    const to = location(res);
    expect(to.origin).toBe("https://timewren.com");
    expect(to.searchParams.get("success")).toBe("google_connected");
    expect(h.constructed.map((c) => c.clientId)).toEqual(["tw-g-id"]);
    expect(h.constructed[0].redirectUri).toBe(
      "https://timewren.com/api/integrations/google/callback",
    );
    const row = h.inserts[0] as Record<string, string>;
    expect(row.oauthBrand).toBe("timewren");
    expect(JSON.stringify(row)).not.toContain(ACCESS);
    expect(decryptSecret(row.accessToken)).toBe(ACCESS);
  });

  it("TimeWren uden TIMEWREN_GOOGLE_*: afvist, TimeTracks klient bruges aldrig", async () => {
    vi.stubEnv("TIMEWREN_GOOGLE_CLIENT_ID", "");
    vi.stubEnv("TIMEWREN_GOOGLE_CLIENT_SECRET", "");
    expect(isGoogleCalendarAvailableForBrand("timewren")).toBe(false);
    expect(isGoogleCalendarAvailableForBrand("timetrack")).toBe(true);
    login("user-tw", "timewren");
    const state = createCalendarOAuthState({
      userId: "user-tw",
      brand: "timewren",
      provider: "google",
    });
    const res = await GET(callback({ state, cookie: state, code: "c" }));
    expect(location(res).searchParams.get("error")).toBe("not_available");
    expect(h.getToken).not.toHaveBeenCalled();
    expect(h.inserts).toHaveLength(0);
  });

  it.each([
    ["mangler cookie", (s: string) => ({ state: s, code: "c" })],
    [
      "cookie og state er forskellige",
      (s: string) => ({
        state: s,
        cookie: `${s}x`,
        code: "c",
      }),
    ],
    [
      "forfalsket state",
      () => ({ state: "abc.def", cookie: "abc.def", code: "c" }),
    ],
  ])("afviser state: %s", async (_name, req) => {
    login("user-tt", "timetrack");
    const state = createCalendarOAuthState({
      userId: "user-tt",
      brand: "timetrack",
      provider: "google",
    });
    const res = await GET(callback(req(state)));
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(h.getToken).not.toHaveBeenCalled();
    expect(h.inserts).toHaveLength(0);
  });

  it("afviser udløbet state", async () => {
    login("user-tt", "timetrack");
    const state = createCalendarOAuthState({
      userId: "user-tt",
      brand: "timetrack",
      provider: "google",
      now: Date.now() - 11 * 60 * 1000,
    });
    const res = await GET(callback({ state, cookie: state, code: "c" }));
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(h.getToken).not.toHaveBeenCalled();
  });

  it("afviser en state udstedt til en anden konto", async () => {
    login("user-b", "timetrack");
    const state = createCalendarOAuthState({
      userId: "user-a",
      brand: "timetrack",
      provider: "google",
    });
    const res = await GET(callback({ state, cookie: state, code: "c" }));
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(h.getToken).not.toHaveBeenCalled();
  });

  it("afviser bruger fra forkert brand (state fra TimeTrack, konto på TimeWren)", async () => {
    login("user-1", "timewren");
    const state = createCalendarOAuthState({
      userId: "user-1",
      brand: "timetrack",
      provider: "google",
    });
    const res = await GET(callback({ state, cookie: state, code: "c" }));
    expect(location(res).origin).toBe("https://timewren.com");
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(h.getToken).not.toHaveBeenCalled();
  });

  it("afviser en Outlook-state på Google-callbacken", async () => {
    login("user-tt", "timetrack");
    const state = createCalendarOAuthState({
      userId: "user-tt",
      brand: "timetrack",
      provider: "outlook",
    });
    const res = await GET(callback({ state, cookie: state, code: "c" }));
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
  });
});

describe("forbindelsens egen klient", () => {
  function storedConnection(oauthBrand: string | undefined) {
    return {
      id: "conn-1",
      userId: "user-1",
      provider: "google",
      ...(oauthBrand && { oauthBrand }),
      providerAccountId: "a@example.com",
      accessToken: encryptSecret("old-access"),
      refreshToken: encryptSecret(REFRESH),
      tokenExpiry: new Date(Date.now() - 60_000),
      grantedScopes: null,
      calendarId: "primary",
      parentConnectionId: null,
      syncEnabled: true,
    };
  }

  it.each([
    ["timewren", "tw-g-id"],
    ["timetrack", "tt-g-id"],
    [undefined, "tt-g-id"],
  ])("refresh for oauth_brand=%s bruger %s", async (brand, clientId) => {
    h.db.query.calendarConnections.findFirst.mockResolvedValue(
      storedConnection(brand),
    );
    h.refreshAccessToken.mockResolvedValue({
      credentials: { access_token: "new-access", expiry_date: Date.now() + 1 },
    });

    const result = await getAuthenticatedClient("user-1");

    expect(result).not.toBeNull();
    expect(h.constructed.map((c) => c.clientId)).toEqual([clientId]);
    expect(h.refreshAccessToken).toHaveBeenCalledTimes(1);
    const update = h.updates[0] as Record<string, string>;
    expect(JSON.stringify(update)).not.toContain("new-access");
    expect(decryptSecret(update.accessToken)).toBe("new-access");
  });

  it("webhook-fornyelse bruger forbindelsens klient og brandets host", async () => {
    h.db.query.calendarConnections.findFirst.mockResolvedValue(
      storedConnection("timewren"),
    );
    h.watch.mockResolvedValue({ data: { expiration: String(Date.now()) } });

    const res = await registerWebhookChannel("user-1");

    expect(res.success).toBe(true);
    expect(h.constructed.map((c) => c.clientId)).toEqual(["tw-g-id"]);
    expect(h.watch.mock.calls[0][0].requestBody.address).toBe(
      "https://timewren.com/api/webhooks/google-calendar",
    );
  });

  it("webhook for TimeTrack som før (CALLBACK_BASE_URL/app-URL)", async () => {
    h.db.query.calendarConnections.findFirst.mockResolvedValue(
      storedConnection(undefined),
    );
    h.watch.mockResolvedValue({ data: {} });
    await registerWebhookChannel("user-1");
    expect(h.constructed.map((c) => c.clientId)).toEqual(["tt-g-id"]);
    expect(h.watch.mock.calls[0][0].requestBody.address).toBe(
      "https://app.timetrack.dk/api/webhooks/google-calendar",
    );
  });
});
