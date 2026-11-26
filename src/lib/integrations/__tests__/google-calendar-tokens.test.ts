import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = ["test", "secret"].join("-");
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const credentialsSet: Record<string, unknown>[] = [];
  /** Har callbacken erstattet rækken, rammer en vagtet opdatering intet. */
  const state = { replaced: false };
  const refreshAccessToken = vi.fn();
  /** userinfo-opslaget, der udfylder konto-id på ældre rækker. */
  const request = vi.fn(async () => ({ data: {} as { id?: string } }));
  class FakeOAuth2 {
    transporter = { defaults: {} };
    setCredentials(creds: Record<string, unknown>) {
      credentialsSet.push(creds);
    }
    refreshAccessToken = refreshAccessToken;
    request = request;
  }
  const db = {
    query: {
      calendarConnections: { findFirst: vi.fn() },
    },
    execute: vi.fn(async (_q: unknown) => []),
    transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(db)),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: () =>
            Object.assign(Promise.resolve(undefined), {
              // Rækker, som en vagtet opdatering ramte
              returning: async () => (state.replaced ? [] : [{ id: "conn-1" }]),
            }),
        };
      },
    })),
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return { returning: async () => [{ id: "new-conn" }] };
      },
    })),
  };
  return {
    db,
    updates,
    inserts,
    credentialsSet,
    state,
    refreshAccessToken,
    request,
    FakeOAuth2,
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("google-auth-library", () => ({
  OAuth2Client: mocks.FakeOAuth2,
}));

import {
  decryptSecret,
  EncryptionKeyError,
  encryptSecret,
  SECRET_PREFIX,
} from "@/lib/utils/encryption";
import {
  getAuthenticatedClient,
  readConnectionTokens,
  saveCalendarConnection,
} from "../google-calendar";

const ACCESS = "ya29.fresh-access";
const REFRESH = "1//fresh-refresh";
const originalKey = process.env.ENCRYPTION_KEY;

function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    userId: "user-1",
    provider: "google",
    providerAccountId: "a@example.com",
    accessToken: ACCESS,
    refreshToken: REFRESH,
    tokenExpiry: new Date(Date.now() + 3_600_000),
    grantedScopes: null,
    parentConnectionId: null,
    syncEnabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "f".repeat(64);
  mocks.updates.length = 0;
  mocks.inserts.length = 0;
  mocks.credentialsSet.length = 0;
  mocks.state.replaced = false;
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
  vi.restoreAllMocks();
});

describe("saveCalendarConnection", () => {
  it("gemmer nye tokens krypteret", async () => {
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue(undefined);

    await saveCalendarConnection("user-1", {
      accessToken: ACCESS,
      refreshToken: REFRESH,
      tokenExpiry: null,
      accountEmail: "a@example.com",
    });

    const row = mocks.inserts[0] as {
      accessToken: string;
      refreshToken: string;
    };
    expect(row.accessToken.startsWith(SECRET_PREFIX)).toBe(true);
    expect(row.refreshToken.startsWith(SECRET_PREFIX)).toBe(true);
    expect(decryptSecret(row.accessToken)).toBe(ACCESS);
    expect(decryptSecret(row.refreshToken)).toBe(REFRESH);
  });

  it.each([
    // Samme konto og brand kan stadig være et skiftet klient-id
    ["samme konto og brand", { providerAccountSub: "x" }, "x"],
    ["en anden Google-konto", { providerAccountSub: "x" }, "y"],
    ["en række uden konto-id", { providerAccountSub: null }, "y"],
    [
      "en anden klient",
      { providerAccountSub: "y", oauthBrand: "timewren" },
      "y",
    ],
  ])("genbruger ikke det gemte refresh-token for %s", async (_l, row, sub) => {
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue(
      connectionRow({ refreshToken: encryptSecret(REFRESH), ...row }),
    );

    await saveCalendarConnection("user-1", {
      accessToken: "ya29.other",
      refreshToken: undefined,
      tokenExpiry: null,
      accountEmail: null,
      accountSub: sub,
    });

    expect(mocks.updates[0]).toMatchObject({
      refreshToken: null,
      providerAccountSub: sub,
    });
  });

  describe("låse mod frakobling og kontosletning", () => {
    const dialect = new PgDialect();
    const fetchMock = vi.fn();
    const NEW = {
      accessToken: "ya29.reconnect-secret",
      refreshToken: "1//reconnect-secret",
      tokenExpiry: null,
      accountEmail: "a@example.com",
      accountSub: "sub-a",
    };
    const locks = () =>
      mocks.db.execute.mock.calls.map(
        ([q]) => dialect.sqlToQuery(q as SQL).params[0],
      );

    beforeEach(() => {
      fetchMock.mockReset();
      vi.stubGlobal("fetch", fetchMock);
      mocks.db.query.calendarConnections.findFirst.mockResolvedValue(undefined);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("låser brugeren og derefter Google-kontoen, før rækken gemmes", async () => {
      await expect(
        saveCalendarConnection("user-1", NEW, "timetrack"),
      ).resolves.toBe("new-conn");
      expect(locks()).toEqual([
        "google-calendar-user:user-1",
        "google-calendar-account:sub-a",
      ]);
      expect(mocks.inserts[0]).toMatchObject({ providerAccountSub: "sub-a" });
      // Ingen kald til Google under gem (intet token-tjek, intet tilbagekald)
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("låser kun brugeren, når Google ikke gav et konto-id", async () => {
      await saveCalendarConnection(
        "user-1",
        { ...NEW, accountSub: null },
        "timetrack",
      );
      expect(locks()).toEqual(["google-calendar-user:user-1"]);
      expect(mocks.inserts[0]).toMatchObject({ providerAccountSub: null });
    });
  });

  it("gemmer intet uden ENCRYPTION_KEY", async () => {
    delete process.env.ENCRYPTION_KEY;
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue(undefined);

    await expect(
      saveCalendarConnection("user-1", {
        accessToken: ACCESS,
        refreshToken: REFRESH,
        tokenExpiry: null,
        accountEmail: null,
      }),
    ).rejects.toBeInstanceOf(EncryptionKeyError);
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.updates).toHaveLength(0);
  });
});

describe("getAuthenticatedClient", () => {
  it("giver Google de dekrypterede tokens for nye rækker", async () => {
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue(
      connectionRow({
        accessToken: encryptSecret(ACCESS),
        refreshToken: encryptSecret(REFRESH),
      }),
    );

    await getAuthenticatedClient("user-1");

    expect(mocks.credentialsSet[0]).toMatchObject({
      access_token: ACCESS,
      refresh_token: REFRESH,
    });
  });

  it("tåler klartekst-rækker fra før backfill", async () => {
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue(
      connectionRow(),
    );

    await getAuthenticatedClient("user-1");

    expect(mocks.credentialsSet[0]).toMatchObject({
      access_token: ACCESS,
      refresh_token: REFRESH,
    });
  });

  it("krypterer den nye access-token ved refresh", async () => {
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue(
      connectionRow({
        accessToken: encryptSecret("ya29.expired"),
        refreshToken: encryptSecret(REFRESH),
        tokenExpiry: new Date(Date.now() - 1000),
      }),
    );
    mocks.refreshAccessToken.mockResolvedValue({
      credentials: { access_token: "ya29.refreshed", expiry_date: Date.now() },
    });

    const result = await getAuthenticatedClient("user-1");

    expect(result).not.toBeNull();
    const update = mocks.updates[0] as { accessToken: string };
    expect(update.accessToken.startsWith(SECRET_PREFIX)).toBe(true);
    expect(decryptSecret(update.accessToken)).toBe("ya29.refreshed");
  });

  it("giver ingen klient, når callbacken har erstattet rækken under fornyelsen", async () => {
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue(
      connectionRow({
        accessToken: encryptSecret("ya29.expired"),
        refreshToken: encryptSecret(REFRESH),
        tokenExpiry: new Date(Date.now() - 1000),
        providerAccountSub: null,
      }),
    );
    mocks.refreshAccessToken.mockResolvedValue({
      credentials: { access_token: "ya29.old-account", expiry_date: 1 },
    });
    mocks.state.replaced = true;

    await expect(getAuthenticatedClient("user-1")).resolves.toBeNull();
    // Heller ikke den gamle kontos id på den nye forbindelse
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("viser 'forbind igen', når Google afviser fornyelsen med invalid_grant (fx efter et forsinket tilbagekald)", async () => {
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue(
      connectionRow({
        accessToken: encryptSecret("ya29.expired"),
        refreshToken: encryptSecret(REFRESH),
        tokenExpiry: new Date(Date.now() - 1000),
      }),
    );
    const invalidGrant = Object.assign(new Error(`invalid_grant ${REFRESH}`), {
      name: "GaxiosError",
      // gaxios lægger forespørgslen (med refresh-tokenet) på fejlen
      config: { data: `refresh_token=${REFRESH}` },
      response: { status: 400, data: { error: "invalid_grant" } },
    });
    mocks.refreshAccessToken.mockRejectedValue(invalidGrant);

    await expect(getAuthenticatedClient("user-1")).resolves.toBeNull();

    expect(mocks.updates).toEqual([
      expect.objectContaining({
        syncEnabled: false,
        syncError: expect.stringContaining("reconnect"),
      }),
    ]);
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain(REFRESH);
  });

  it("udfylder konto-id på en ældre række under brugerens og kontoens lås", async () => {
    const dialect = new PgDialect();
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue(
      connectionRow({ providerAccountSub: null }),
    );
    mocks.request.mockResolvedValue({ data: { id: "sub-legacy" } });

    await getAuthenticatedClient("user-1");

    expect(
      mocks.db.execute.mock.calls.map(
        ([q]) => dialect.sqlToQuery(q as SQL).params[0],
      ),
    ).toEqual([
      "google-calendar-user:user-1",
      "google-calendar-account:sub-legacy",
    ]);
    expect(mocks.updates).toEqual([{ providerAccountSub: "sub-legacy" }]);
  });

  it("kaster tydeligt ved forkert nøgle og slår ikke sync fra", async () => {
    const stored = encryptSecret(ACCESS);
    process.env.ENCRYPTION_KEY = "0".repeat(64);
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue(
      connectionRow({ accessToken: stored }),
    );

    await expect(getAuthenticatedClient("user-1")).rejects.toThrow(
      /dekrypteres/,
    );
    expect(mocks.updates).toHaveLength(0);
  });
});

describe("readConnectionTokens", () => {
  it("håndterer null og blandede rækker", () => {
    expect(
      readConnectionTokens({ accessToken: null, refreshToken: null }),
    ).toEqual({ accessToken: null, refreshToken: null });
    expect(
      readConnectionTokens({
        accessToken: ACCESS,
        refreshToken: encryptSecret(REFRESH),
      }),
    ).toEqual({ accessToken: ACCESS, refreshToken: REFRESH });
  });
});
