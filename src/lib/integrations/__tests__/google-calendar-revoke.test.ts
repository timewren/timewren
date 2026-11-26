import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Frakobling og kontosletning tilbagekalder Google Calendar-bevillingen kun,
// når det beviseligt er sikkert: rækken har et Google-konto-id, og ingen
// anden række har samme konto, hverken da sletningen besluttes, eller efter
// commit, lige før Google kaldes. Ellers slettes der kun lokalt. Fejl må aldrig
// blokere, og tokenet eller Googles svar må aldrig stå i logningen. Den
// rigtige SQL afprøves i google-calendar-revoke.integration.test.ts.

const mocks = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
}));

const {
  GOOGLE_REVOKE_URL,
  executeGoogleCalendarRevokes,
  planGoogleCalendarRevokes,
} = await import("@/lib/integrations/google-calendar-revoke");

/** Beslut og udfør, som frakobling og kontosletning gør omkring sletningen. */
async function revokeGoogleCalendarGrants(
  tx: Parameters<typeof planGoogleCalendarRevokes>[0],
  userId: string,
  rows: Parameters<typeof planGoogleCalendarRevokes>[2],
) {
  await executeGoogleCalendarRevokes(
    tx as never,
    await planGoogleCalendarRevokes(tx, userId, rows),
  );
}
const { encryptSecret } = await import("@/lib/utils/encryption");

const REFRESH = "1//refresh-secret";
const ACCESS = "ya29.access-secret";

const originalKey = process.env.ENCRYPTION_KEY;
let errorSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;
const fetchMock = vi.fn();
const dialect = new PgDialect();

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "f".repeat(64);
  vi.clearAllMocks();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
});

/**
 * Transaktion, hvor optællingen af rækker med samme konto giver `shared`, da
 * sletningen besluttes, og `sharedAtRevoke` efter commit. `order` logger
 * låse, optællinger og revoke-kald i rækkefølge.
 */
function fakeTx(shared = 0, sharedAtRevoke = shared) {
  const order: string[] = [];
  const execute = vi.fn(async (query: SQL) => {
    const { params } = dialect.sqlToQuery(query);
    order.push(`lock ${params[0]}`);
    return [];
  });
  const where = vi.fn(async (_condition: SQL) => {
    order.push("count");
    return [{ shared: where.mock.calls.length > 1 ? sharedAtRevoke : shared }];
  });
  const tx = {
    execute,
    select: () => ({ from: () => ({ where }) }),
    // Savepoint
    transaction: async (run: (t: unknown) => Promise<unknown>) => run(tx),
  };
  fetchMock.mockImplementation(async () => {
    order.push("revoke");
    return new Response(null, { status: 200 });
  });
  return { tx: tx as never, order, where };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    parentConnectionId: null,
    accessToken: encryptSecret(ACCESS),
    refreshToken: encryptSecret(REFRESH),
    oauthBrand: "timewren",
    providerAccountSub: "sub-a",
    ...overrides,
  };
}

/** Alt, der er logget (console og Sentry), som én streng. */
function loggedText(): string {
  return JSON.stringify([
    errorSpy.mock.calls,
    infoSpy.mock.calls,
    mocks.captureException.mock.calls.map(([err, ctx]) => [
      (err as Error).message,
      ctx,
    ]),
  ]);
}

/** De strukturerede loglinjer (console.info/error med én JSON-streng). */
function logEvents(): Record<string, unknown>[] {
  return [...infoSpy.mock.calls, ...errorSpy.mock.calls].map(([line]) =>
    JSON.parse(String(line)),
  );
}

function revokedTokens(): string[] {
  return fetchMock.mock.calls
    .filter(([url]) => url === GOOGLE_REVOKE_URL)
    .map(([, init]) =>
      String(new URLSearchParams(String(init.body)).get("token")),
    );
}

describe("revokeGoogleCalendarGrants", () => {
  it("tilbagekalder den eneste forbindelse til kontoen én gang med rækkens refresh-token", async () => {
    const { tx, order, where } = fakeTx(0);
    await revokeGoogleCalendarGrants(tx, "user_1", [
      row(),
      // Barnet har ingen tokens og tilbagekaldes ikke selv
      row({
        id: "conn-child",
        parentConnectionId: "conn-1",
        accessToken: null,
        refreshToken: null,
        providerAccountSub: null,
      }),
    ]);
    // Besluttes under kontoens lås, og efter commit tælles der igen under
    // samme lås, før Google kaldes
    expect(order).toEqual([
      "lock google-calendar-account:sub-a",
      "count",
      "lock google-calendar-account:sub-a",
      "count",
      "revoke",
    ]);
    expect(revokedTokens()).toEqual([REFRESH]);
    expect(errorSpy).not.toHaveBeenCalled();
    // Optællingen er uden LIMIT, kun på konto-id og ser kun bort fra rækken
    // selv, ikke fra de andre rækker i samme sletning
    const planCount = dialect.sqlToQuery(where.mock.calls[0][0]);
    expect(planCount.sql).toContain('"id" <> $');
    expect(planCount.sql).not.toMatch(/limit|is null/i);
    expect(planCount.params).toEqual(["google", "sub-a", "conn-1"]);
    // Efter commit er rækken væk; alle rækker med kontoen tælles
    const revokeCount = dialect.sqlToQuery(where.mock.calls[1][0]);
    expect(revokeCount.sql).not.toMatch(/<>|limit/i);
    expect(revokeCount.params).toEqual(["google", "sub-a"]);
  });

  it("tilbagekalder ikke, når en callback har gemt samme konto efter commit", async () => {
    const { tx } = fakeTx(0, 1);
    await revokeGoogleCalendarGrants(tx, "user_1", [row()]);
    expect(revokedTokens()).toEqual([]);
    expect(logEvents()).toEqual([
      expect.objectContaining({
        event: "calendar_revoke_skipped",
        reason: "shared_account",
      }),
    ]);
  });

  it("beslutter uden at kalde Google; først udførelsen kalder", async () => {
    const { tx } = fakeTx(0);
    const planned = await planGoogleCalendarRevokes(tx, "user_1", [row()]);
    expect(revokedTokens()).toEqual([]);
    await executeGoogleCalendarRevokes(tx, planned);
    expect(revokedTokens()).toEqual([REFRESH]);
  });

  it("tilbagekalder ikke, når en anden række har samme Google-konto", async () => {
    const { tx } = fakeTx(1);
    await revokeGoogleCalendarGrants(tx, "user_1", [row()]);
    expect(revokedTokens()).toEqual([]);
    expect(logEvents()).toEqual([
      expect.objectContaining({
        event: "calendar_revoke_skipped",
        reason: "shared_account",
      }),
    ]);
  });

  it("tilbagekalder ikke en række uden Google-konto-id og låser eller tæller intet", async () => {
    const { tx, order } = fakeTx(0);
    await revokeGoogleCalendarGrants(tx, "user_1", [
      row({ providerAccountSub: null }),
    ]);
    expect(order).toEqual([]);
    expect(revokedTokens()).toEqual([]);
    expect(logEvents()).toEqual([
      expect.objectContaining({
        event: "calendar_revoke_skipped",
        reason: "no_account_id",
      }),
    ]);
  });

  it("bruger access-tokenet, når refresh-tokenet mangler", async () => {
    const { tx } = fakeTx(0);
    await revokeGoogleCalendarGrants(tx, "user_1", [
      row({ refreshToken: null }),
    ]);
    expect(revokedTokens()).toEqual([ACCESS]);
  });

  it("låser flere konti i sorteret rækkefølge i sletningens transaktion", async () => {
    // Efter commit tages hver konto i sin egen transaktion, så kun
    // sletningens samlede låse skal sorteres
    const { tx, order } = fakeTx(0);
    await planGoogleCalendarRevokes(tx, "user_1", [
      row({ id: "c-z", providerAccountSub: "sub-z" }),
      row({ id: "c-b", providerAccountSub: "sub-b" }),
    ]);
    expect(order.filter((o) => o.startsWith("lock"))).toEqual([
      "lock google-calendar-account:sub-b",
      "lock google-calendar-account:sub-z",
    ]);
  });

  it("400 invalid_token betyder allerede tilbagekaldt og logges ikke som fejl", async () => {
    const { tx } = fakeTx(0);
    fetchMock.mockResolvedValue(
      Response.json({ error: "invalid_token" }, { status: 400 }),
    );
    await revokeGoogleCalendarGrants(tx, "user_1", [row()]);
    expect(revokedTokens()).toEqual([REFRESH]);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it.each([
    [
      "500",
      () => new Response(`upstream echoed ${REFRESH}`, { status: 500 }),
      "http",
      500,
    ],
    ["429", () => new Response(null, { status: 429 }), "http", 429],
    ["202", () => new Response(null, { status: 202 }), "http", 202],
    [
      "400 uden invalid_token",
      () =>
        Response.json(
          { error: "invalid_request", error_description: `token=${REFRESH}` },
          { status: 400 },
        ),
      "http",
      400,
    ],
  ])(
    "logger %s med status og fast årsag, uden token eller svar",
    async (_label, response, reason, status) => {
      const { tx } = fakeTx(0);
      fetchMock.mockImplementation(async () => response());
      await expect(
        revokeGoogleCalendarGrants(tx, "user_1", [row()]),
      ).resolves.toBeUndefined();
      expect(mocks.captureException).toHaveBeenCalledTimes(1);
      expect(mocks.captureException.mock.calls[0][1]).toMatchObject({
        tags: { reason, status: String(status), brand: "timewren" },
      });
      expect(logEvents()).toEqual([
        expect.objectContaining({
          event: "calendar_revoke_failed",
          reason,
          status,
        }),
      ]);
      expect(loggedText()).not.toContain(REFRESH);
    },
  );

  it("logger timeout og netværksfejl uden token", async () => {
    const timeout = Object.assign(new Error(`timed out ${REFRESH}`), {
      name: "TimeoutError",
    });
    fetchMock.mockRejectedValueOnce(timeout);
    await revokeGoogleCalendarGrants(fakeTx(0).tx, "user_1", [row()]);
    fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed ${REFRESH}`));
    await revokeGoogleCalendarGrants(fakeTx(0).tx, "user_1", [row()]);

    expect(
      mocks.captureException.mock.calls.map(([, ctx]) => ctx.tags.reason),
    ).toEqual(["timeout", "network"]);
    expect(loggedText()).not.toContain(REFRESH);
  });

  it("kaster aldrig, heller ikke når optællingen fejler", async () => {
    const { tx, where } = fakeTx(0);
    where.mockRejectedValue(new Error("db down"));
    await expect(
      revokeGoogleCalendarGrants(tx, "user_1", [row()]),
    ).resolves.toBeUndefined();
    expect(revokedTokens()).toEqual([]);
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
  });

  it("kaster aldrig, når optællingen efter commit fejler, og kalder ikke Google", async () => {
    const { tx, where } = fakeTx(0);
    const planned = await planGoogleCalendarRevokes(tx, "user_1", [row()]);
    where.mockRejectedValue(new Error(`db down ${REFRESH}`));
    await expect(
      executeGoogleCalendarRevokes(tx, planned),
    ).resolves.toBeUndefined();
    expect(revokedTokens()).toEqual([]);
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
    expect(loggedText()).not.toContain(REFRESH);
  });

  it("logger fejl, når tokenet ikke kan dekrypteres, uden at kaste", async () => {
    const stored = encryptSecret(REFRESH);
    process.env.ENCRYPTION_KEY = "0".repeat(64);
    const { tx } = fakeTx(0);
    await expect(
      revokeGoogleCalendarGrants(tx, "user_1", [
        row({ refreshToken: stored, accessToken: stored }),
      ]),
    ).resolves.toBeUndefined();
    expect(revokedTokens()).toEqual([]);
    expect(mocks.captureException.mock.calls[0][1]).toMatchObject({
      tags: { reason: "decrypt" },
    });
  });
});
