import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = ["test", "secret"].join("-");
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const credentialsSet: Record<string, unknown>[] = [];
  const refreshAccessToken = vi.fn();
  class FakeOAuth2 {
    transporter = { defaults: {} };
    setCredentials(creds: Record<string, unknown>) {
      credentialsSet.push(creds);
    }
    refreshAccessToken = refreshAccessToken;
  }
  const db = {
    query: {
      calendarConnections: { findFirst: vi.fn() },
    },
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: vi.fn(async () => undefined) };
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
    refreshAccessToken,
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

  it("beholder den gemte refresh-token uændret når Google ikke sender en ny", async () => {
    const storedRefresh = encryptSecret(REFRESH);
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue(
      connectionRow({ refreshToken: storedRefresh }),
    );

    await saveCalendarConnection("user-1", {
      accessToken: "ya29.reconnected",
      refreshToken: undefined,
      tokenExpiry: null,
      accountEmail: null,
    });

    const update = mocks.updates[0] as {
      accessToken: string;
      refreshToken: string;
    };
    expect(update.refreshToken).toBe(storedRefresh); // ikke dobbeltkrypteret
    expect(decryptSecret(update.accessToken)).toBe("ya29.reconnected");
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
