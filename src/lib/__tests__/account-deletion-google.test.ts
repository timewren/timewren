import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Kontosletning låser brugerens Google Calendar-rækker (brugerens lås og
// FOR UPDATE), låser Google-kontoen og afgør før sletningen, om bevillingen
// må tilbagekaldes (kun når ingen anden række har samme Google-konto).
// Google kaldes først efter commit, i en ny transaktion under kontoens lås
// og efter en ny optælling, så en rollback aldrig efterlader en levende konto
// med tilbagekaldt kalender. En fejl hos Google må aldrig vælte sletningen.
// Den rigtige SQL afprøves i google-calendar-revoke.integration.test.ts.

const mocks = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
}));
vi.mock("@/lib/auth/apple", () => ({
  exchangeAppleAuthorizationCode: vi.fn(),
  collectAppleTokens: vi.fn(async () => []),
  revokeAppleTokens: vi.fn(async () => undefined),
}));
vi.mock("@/lib/alunta", () => ({
  alunta: { subscriptions: { cancel: vi.fn() } },
}));
vi.mock("@/lib/storage/user-uploads", () => ({
  purgeUserUploads: vi.fn(async () => 0),
  collectUserStorageKeys: vi.fn(async () => []),
  purgeStorageKeys: vi.fn(async () => 0),
}));

const { deleteUserAccountCompletely } = await import("@/lib/account-deletion");
const { GOOGLE_REVOKE_URL } = await import(
  "@/lib/integrations/google-calendar-revoke"
);
const { encryptSecret } = await import("@/lib/utils/encryption");

const TOKEN = "1//sole-refresh-secret";

const originalKey = process.env.ENCRYPTION_KEY;
const fetchMock = vi.fn();
let errorSpy: ReturnType<typeof vi.spyOn>;

const dialect = new PgDialect();

/** Brugerens Google-rækker: én primær med konto-id og et barn uden tokens. */
function googleRows() {
  return [
    {
      id: "conn-1",
      parentConnectionId: null,
      refreshToken: encryptSecret(TOKEN),
      accessToken: encryptSecret("ya29.sole"),
      oauthBrand: "timewren",
      providerAccountSub: "sub-a",
    },
    {
      id: "conn-child",
      parentConnectionId: "conn-1",
      refreshToken: null,
      accessToken: null,
      oauthBrand: "timetrack",
      providerAccountSub: null,
    },
  ];
}

/** `others` = antal andre rækker med samme Google-konto. */
function fakeDb(others = 0) {
  const statements: string[] = [];
  const execute = vi.fn(async (query: SQL) => {
    const { sql, params } = dialect.sqlToQuery(query);
    statements.push(
      sql.includes("pg_advisory_xact_lock")
        ? `lock ${params[0]}`
        : sql.trim().split(/\s+/).slice(0, 3).join(" "),
    );
    return undefined;
  });
  const tx = {
    execute,
    select: (columns: Record<string, unknown>) => ({
      from: () => ({
        where: () => ({
          // Optællingen af andre rækker med kontoen (awaited direkte)
          // biome-ignore lint/suspicious/noThenProperty: Drizzle-builderen er en thenable
          then: (resolve: (rows: unknown) => void) => {
            statements.push("count others");
            resolve("shared" in columns ? [{ shared: others }] : []);
          },
          // Brugerens egne rækker, FOR UPDATE
          for: async (strength: string) => {
            statements.push(`select for ${strength}`);
            return googleRows();
          },
        }),
      }),
    }),
    // Savepoint
    transaction: async (run: (t: unknown) => Promise<unknown>) => run(tx),
  };
  const commit = vi.fn();
  const db = {
    query: {
      members: {
        findMany: vi.fn(async () => [
          { userId: "user_1", organizationId: "org_1" },
        ]),
      },
      subscriptions: { findMany: vi.fn(async () => []) },
      accounts: { findMany: vi.fn(async () => []) },
    },
    execute,
    async transaction(run: (t: typeof tx) => Promise<unknown>) {
      const result = await run(tx);
      commit();
      return result;
    },
  };
  return { db, execute, statements, commit };
}

function revokedTokens(): string[] {
  return fetchMock.mock.calls
    .filter(([url]) => url === GOOGLE_REVOKE_URL)
    .map(([, init]) =>
      String(new URLSearchParams(String(init.body)).get("token")),
    );
}

describe("deleteUserAccountCompletely: Google Calendar", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "e".repeat(64);
    vi.clearAllMocks();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  it("låser, beslutter før sletningen og tilbagekalder den eneste forbindelse til kontoen efter commit", async () => {
    const { db, execute, statements, commit } = fakeDb(0);
    await expect(
      deleteUserAccountCompletely(db as never, "user_1"),
    ).resolves.toEqual({ outcome: "deleted" });

    expect(statements.slice(0, 7)).toEqual([
      "lock google-calendar-user:user_1",
      "select for update",
      "lock google-calendar-account:sub-a",
      "count others",
      "DO $deletion$ DECLARE",
      // Efter commit: kontoens lås og en ny optælling, før Google kaldes
      "lock google-calendar-account:sub-a",
      "count others",
    ]);
    // Den primære forbindelses eget token; barnet har ingen
    expect(revokedTokens()).toEqual([TOKEN]);
    expect(execute.mock.invocationCallOrder[2]).toBeLessThan(
      commit.mock.invocationCallOrder[0],
    );
    // Google kaldes først efter sletningens commit, mens kontoens lås holdes
    expect(commit).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      commit.mock.invocationCallOrder[0],
    );
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      commit.mock.invocationCallOrder[1],
    );
  });

  it("tilbagekalder ikke, når en anden række har samme Google-konto", async () => {
    const { db } = fakeDb(1);
    await expect(
      deleteUserAccountCompletely(db as never, "user_1"),
    ).resolves.toEqual({ outcome: "deleted" });
    expect(revokedTokens()).toEqual([]);
  });

  it("sletter alligevel, når Google fejler, og logger brandet uden token", async () => {
    fetchMock.mockRejectedValue(new TypeError(`fetch failed ${TOKEN}`));
    const { db } = fakeDb(0);
    await expect(
      deleteUserAccountCompletely(db as never, "user_1"),
    ).resolves.toEqual({ outcome: "deleted" });

    expect(mocks.captureException).toHaveBeenCalledTimes(1);
    expect(mocks.captureException.mock.calls[0][1]).toMatchObject({
      tags: { brand: "timewren", reason: "network" },
    });
    const logged = JSON.stringify([
      errorSpy.mock.calls,
      mocks.captureException.mock.calls,
      mocks.captureException.mock.calls.map(([e]) => String(e)),
    ]);
    expect(logged).toContain("calendar_revoke_failed");
    expect(logged).not.toContain(TOKEN);
  });
});
