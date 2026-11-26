import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Outlook-kalender (Microsoft Graph): start-ruten (state + PKCE), callbacken
 * (state, brand, krypterede tokens) og refresh med forbindelsens klient.
 * Microsofts token-endpoint og Graph er mocket via fetch.
 */

const h = vi.hoisted(() => {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const db = {
    query: {
      users: { findFirst: vi.fn() },
      members: { findFirst: vi.fn() },
      calendarConnections: { findFirst: vi.fn() },
    },
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        return { returning: async () => [{ id: "conn-new" }] };
      },
    })),
    update: vi.fn(() => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        return { where: vi.fn(async () => undefined) };
      },
    })),
  };
  return { db, inserts, updates, getSession: vi.fn(), sync: vi.fn() };
});

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: h.getSession } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/i18n/server-text", () => ({
  tr: async (_ns: string, key: string) => key,
}));
vi.mock("@/lib/integrations/outlook-calendar", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  // Første synk efter forbindelsen testes i outlook-calendar-sync.test.ts
  syncOutlookCalendar: h.sync,
}));

import { createCalendarOAuthState } from "@/lib/integrations/calendar-oauth-state";
import {
  deriveCodeChallenge,
  getOutlookAccessToken,
} from "@/lib/integrations/outlook-calendar";
import { decryptSecret, encryptSecret } from "@/lib/utils/encryption";
import { GET as start } from "../start/route";
import { GET } from "./route";

const ACCESS = "eyJ0eXAi.plain-outlook-access";
const REFRESH = "M.C123.plain-outlook-refresh";
const VERIFIER = "v".repeat(43);

const fetchMock = vi.fn();

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
  // TimeTracks login-app findes, men giver ikke Outlook-kalender
  vi.stubEnv("MICROSOFT_CLIENT_ID", "tt-ms-login");
  vi.stubEnv("MICROSOFT_CLIENT_SECRET", "tt-ms-login-secret");
  vi.stubEnv("OUTLOOK_CALENDAR_CLIENT_ID", "");
  vi.stubEnv("OUTLOOK_CALENDAR_CLIENT_SECRET", "");
  vi.stubEnv("TIMEWREN_OUTLOOK_CLIENT_ID", "");
  vi.stubEnv("TIMEWREN_OUTLOOK_CLIENT_SECRET", "");
  vi.stubEnv("TIMEWREN_OUTLOOK_REDIRECT_URI", "");
  vi.stubEnv("TIMEWREN_MICROSOFT_CLIENT_ID", "tw-ms-id");
  vi.stubEnv("TIMEWREN_MICROSOFT_CLIENT_SECRET", "tw-ms-secret");
  vi.stubEnv("TIMEWREN_MICROSOFT_TENANT_ID", "");
  vi.stubEnv("ENCRYPTION_KEY", "d".repeat(64));
}

function login(userId: string, brand: "timetrack" | "timewren") {
  h.getSession.mockResolvedValue({ user: { id: userId } });
  h.db.query.users.findFirst.mockResolvedValue({ brand });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Microsofts token-endpoint og Graph /me */
function mockMicrosoft() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/oauth2/v2.0/token")) {
      return json({
        access_token: ACCESS,
        refresh_token: REFRESH,
        expires_in: 3600,
        scope: "Calendars.Read User.Read openid profile email",
      });
    }
    if (url.startsWith("https://graph.microsoft.com/v1.0/me")) {
      return json({ mail: null, userPrincipalName: "kalender@example.com" });
    }
    return json({ error: "unexpected" }, 500);
  });
}

function callback(params: {
  state?: string;
  cookie?: string;
  pkce?: string;
  code?: string;
}) {
  const url = new URL(
    "https://internal:3000/api/integrations/outlook/callback",
  );
  if (params.code) url.searchParams.set("code", params.code);
  if (params.state) url.searchParams.set("state", params.state);
  const cookies = [
    params.cookie && `outlook_oauth_state=${params.cookie}`,
    params.pkce && `outlook_oauth_pkce=${params.pkce}`,
  ].filter(Boolean);
  return new NextRequest(url, {
    headers: cookies.length ? { cookie: cookies.join("; ") } : {},
  });
}

const location = (res: Response) => new URL(res.headers.get("location") ?? "");
const tokenCalls = () =>
  fetchMock.mock.calls.filter(([u]) => String(u).includes("/token"));

beforeEach(() => {
  stubBaseEnv();
  vi.clearAllMocks();
  h.inserts.length = 0;
  h.updates.length = 0;
  h.db.query.calendarConnections.findFirst.mockResolvedValue(undefined);
  h.db.query.members.findFirst.mockResolvedValue({ organizationId: "org-1" });
  h.sync.mockResolvedValue({ success: true });
  vi.stubGlobal("fetch", fetchMock);
  mockMicrosoft();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Outlook start-rute", () => {
  it("TimeWren: redirect til Microsoft med PKCE, minimale scopes og brandets klient", async () => {
    login("user-tw", "timewren");
    const res = await start(
      new NextRequest("https://timewren.com/api/integrations/outlook/start"),
    );
    const to = location(res);
    expect(to.origin + to.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(to.searchParams.get("client_id")).toBe("tw-ms-id");
    expect(to.searchParams.get("redirect_uri")).toBe(
      "https://timewren.com/api/integrations/outlook/callback",
    );
    expect(to.searchParams.get("scope")).toBe(
      "offline_access User.Read Calendars.Read",
    );
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");

    // State og verifier ligger i HttpOnly-cookies; challenge = S256(verifier)
    const state = res.cookies.get("outlook_oauth_state");
    const pkce = res.cookies.get("outlook_oauth_pkce");
    expect(state?.value).toBe(to.searchParams.get("state"));
    expect(state?.httpOnly).toBe(true);
    expect(pkce?.httpOnly).toBe(true);
    expect(to.searchParams.get("code_challenge")).toBe(
      deriveCodeChallenge(pkce?.value ?? ""),
    );
    // Verifieren sendes aldrig til Microsoft i authorize-kaldet
    expect(to.toString()).not.toContain(pkce?.value);
  });

  it("TimeTrack uden OUTLOOK_CALENDAR_*: afvist (login-appen genbruges ikke)", async () => {
    login("user-tt", "timetrack");
    const res = await start(
      new NextRequest(
        "https://app.timetrack.dk/api/integrations/outlook/start",
      ),
    );
    expect(location(res).origin).toBe("https://app.timetrack.dk");
    expect(location(res).searchParams.get("error")).toBe("not_available");
    expect(res.cookies.get("outlook_oauth_pkce")).toBeUndefined();
  });

  it("TimeTrack med OUTLOOK_CALENDAR_*: egen klient og app-URL", async () => {
    vi.stubEnv("OUTLOOK_CALENDAR_CLIENT_ID", "tt-o-id");
    vi.stubEnv("OUTLOOK_CALENDAR_CLIENT_SECRET", "tt-o-secret");
    login("user-tt", "timetrack");
    const res = await start(
      new NextRequest(
        "https://app.timetrack.dk/api/integrations/outlook/start",
      ),
    );
    expect(location(res).searchParams.get("client_id")).toBe("tt-o-id");
    expect(location(res).searchParams.get("redirect_uri")).toBe(
      "https://app.timetrack.dk/api/integrations/outlook/callback",
    );
  });
});

describe("Outlook-callback", () => {
  const twState = (overrides: { userId?: string; now?: number } = {}) =>
    createCalendarOAuthState({
      userId: overrides.userId ?? "user-tw",
      brand: "timewren",
      provider: "outlook",
      now: overrides.now,
    });

  it("gyldig state: code + verifier byttes med brandets klient, tokens krypteret", async () => {
    login("user-tw", "timewren");
    const state = twState();
    const res = await GET(
      callback({ state, cookie: state, pkce: VERIFIER, code: "ms-code" }),
    );

    const to = location(res);
    expect(to.origin).toBe("https://timewren.com");
    expect(to.searchParams.get("success")).toBe("outlook_connected");

    const [[tokenUrl, init]] = tokenCalls();
    expect(tokenUrl).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    );
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe("tw-ms-id");
    expect(body.get("client_secret")).toBe("tw-ms-secret");
    expect(body.get("code")).toBe("ms-code");
    expect(body.get("code_verifier")).toBe(VERIFIER);
    expect(body.get("redirect_uri")).toBe(
      "https://timewren.com/api/integrations/outlook/callback",
    );

    expect(h.inserts).toHaveLength(1);
    const row = h.inserts[0] as Record<string, string>;
    expect(row.provider).toBe("outlook");
    expect(row.oauthBrand).toBe("timewren");
    expect(row.providerAccountId).toBe("kalender@example.com");
    expect(row.organizationId).toBe("org-1");
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(ACCESS);
    expect(serialized).not.toContain(REFRESH);
    expect(decryptSecret(row.accessToken)).toBe(ACCESS);
    expect(decryptSecret(row.refreshToken)).toBe(REFRESH);

    // Flowets cookies ryddes
    expect(res.cookies.get("outlook_oauth_state")?.value).toBe("");
    expect(res.cookies.get("outlook_oauth_pkce")?.value).toBe("");
    expect(h.sync).toHaveBeenCalledWith("user-tw", { force: true });
  });

  it.each([
    ["uden cookie", (s: string) => ({ state: s, pkce: VERIFIER, code: "c" })],
    [
      "forkert cookie",
      (s: string) => ({
        state: s,
        cookie: `${s}x`,
        pkce: VERIFIER,
        code: "c",
      }),
    ],
    [
      "forfalsket",
      () => ({
        state: "a.b",
        cookie: "a.b",
        pkce: VERIFIER,
        code: "c",
      }),
    ],
  ])("afviser state %s", async (_n, req) => {
    login("user-tw", "timewren");
    const res = await GET(callback(req(twState())));
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(tokenCalls()).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it("afviser udløbet state", async () => {
    login("user-tw", "timewren");
    const state = twState({ now: Date.now() - 11 * 60 * 1000 });
    const res = await GET(
      callback({ state, cookie: state, pkce: VERIFIER, code: "c" }),
    );
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(tokenCalls()).toHaveLength(0);
  });

  it("afviser en anden kontos state", async () => {
    login("user-other", "timewren");
    const state = twState({ userId: "user-tw" });
    const res = await GET(
      callback({ state, cookie: state, pkce: VERIFIER, code: "c" }),
    );
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(tokenCalls()).toHaveLength(0);
  });

  it("afviser bruger fra forkert brand", async () => {
    // TimeTrack har Outlook her, men staten er udstedt til TimeWren-klienten
    vi.stubEnv("OUTLOOK_CALENDAR_CLIENT_ID", "tt-o-id");
    vi.stubEnv("OUTLOOK_CALENDAR_CLIENT_SECRET", "tt-o-secret");
    login("user-tw", "timetrack");
    const state = twState();
    const res = await GET(
      callback({ state, cookie: state, pkce: VERIFIER, code: "c" }),
    );
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(tokenCalls()).toHaveLength(0);
  });

  it("TimeTrack-konto uden OUTLOOK_CALENDAR_*: not_available før state og code", async () => {
    login("user-tt", "timetrack");
    const state = createCalendarOAuthState({
      userId: "user-tt",
      brand: "timetrack",
      provider: "outlook",
    });
    const res = await GET(
      callback({ state, cookie: state, pkce: VERIFIER, code: "c" }),
    );
    expect(location(res).searchParams.get("error")).toBe("not_available");
    expect(tokenCalls()).toHaveLength(0);
  });

  it("uden PKCE-verifier: ingen code-udveksling", async () => {
    login("user-tw", "timewren");
    const state = twState();
    const res = await GET(callback({ state, cookie: state, code: "c" }));
    expect(location(res).searchParams.get("error")).toBe("no_code");
    expect(tokenCalls()).toHaveLength(0);
  });

  it("afvist token-kald: fejlside, intet gemt", async () => {
    fetchMock.mockResolvedValue(json({ error: "invalid_grant" }, 400));
    login("user-tw", "timewren");
    const state = twState();
    const res = await GET(
      callback({ state, cookie: state, pkce: VERIFIER, code: "c" }),
    );
    expect(location(res).searchParams.get("error")).toBe(
      "api.integrations.outlookFailed",
    );
    expect(h.inserts).toHaveLength(0);
  });
});

describe("Outlook-refresh bruger forbindelsens klient", () => {
  function connection(oauthBrand: string) {
    return {
      id: "conn-o",
      userId: "user-1",
      provider: "outlook",
      oauthBrand,
      accessToken: encryptSecret("old-access"),
      refreshToken: encryptSecret("old-refresh"),
      tokenExpiry: new Date(Date.now() - 1000),
      grantedScopes: null,
      syncEnabled: true,
    } as never;
  }

  it.each([
    ["timewren", "tw-ms-id", "common"],
    ["timetrack", "tt-o-id", "contoso.onmicrosoft.com"],
  ])("oauth_brand=%s → klient %s", async (brand, clientId, tenant) => {
    vi.stubEnv("OUTLOOK_CALENDAR_CLIENT_ID", "tt-o-id");
    vi.stubEnv("OUTLOOK_CALENDAR_CLIENT_SECRET", "tt-o-secret");
    vi.stubEnv("OUTLOOK_CALENDAR_TENANT_ID", "contoso.onmicrosoft.com");

    expect(await getOutlookAccessToken(connection(brand))).toBe(ACCESS);

    const [[url, init]] = tokenCalls();
    expect(url).toBe(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    );
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe(clientId);
    expect(body.get("refresh_token")).toBe("old-refresh");
    const update = h.updates[0] as Record<string, string>;
    expect(JSON.stringify(update)).not.toContain(ACCESS);
    expect(decryptSecret(update.accessToken)).toBe(ACCESS);
    // Microsoft roterer refresh-tokenet
    expect(decryptSecret(update.refreshToken)).toBe(REFRESH);
  });

  it("afvist refresh-token: forbindelsen kræver ny forbindelse", async () => {
    fetchMock.mockResolvedValue(json({ error: "invalid_grant" }, 400));
    expect(await getOutlookAccessToken(connection("timewren"))).toBeNull();
    expect(h.updates[0]).toMatchObject({ syncEnabled: false });
  });

  it.each([
    ["invalid_client", 401],
    ["invalid_client", 400],
    ["temporarily_unavailable", 429],
  ])(
    "app-/forbigående fejl (%s, %i): kaster, forbindelsen forbliver slået til",
    async (code, status) => {
      fetchMock.mockResolvedValue(json({ error: code }, status));
      await expect(
        getOutlookAccessToken(connection("timewren")),
      ).rejects.toThrow();
      expect(h.updates.some((u) => u.syncEnabled === false)).toBe(false);
    },
  );

  it("interaction_required: forbindelsen kræver ny forbindelse", async () => {
    fetchMock.mockResolvedValue(json({ error: "interaction_required" }, 400));
    expect(await getOutlookAccessToken(connection("timewren"))).toBeNull();
    expect(h.updates[0]).toMatchObject({ syncEnabled: false });
  });

  it("gyldigt token: intet refresh", async () => {
    const fresh = {
      ...(connection("timewren") as object),
      accessToken: encryptSecret("still-valid"),
      tokenExpiry: new Date(Date.now() + 3_600_000),
    } as never;
    expect(await getOutlookAccessToken(fresh)).toBe("still-valid");
    expect(tokenCalls()).toHaveLength(0);
  });
});
