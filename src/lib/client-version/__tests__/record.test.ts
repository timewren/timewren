import { beforeEach, describe, expect, it } from "vitest";
import { ClientTooOldError } from "../guard";
import { recordClientTooOld, resetClientTooOldRecordThrottle } from "../record";

function fakeDb(tokenUserId: string | null = null) {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        inserted.push(v);
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (tokenUserId ? [{ userId: tokenUserId }] : []),
        }),
      }),
    }),
  };
  // biome-ignore lint/suspicious/noExplicitAny: testdobbelt for drizzle
  return { db: db as any, inserted };
}

function headers(init: Record<string, string>): Pick<Headers, "get"> {
  const h = new Headers(init);
  return { get: (k: string) => h.get(k) };
}

describe("recordClientTooOld", () => {
  beforeEach(() => resetClientTooOldRecordThrottle());

  it("logger client_too_old for en kendt bruger", async () => {
    const { db, inserted } = fakeDb();
    await recordClientTooOld({
      db,
      headers: headers({ "x-timetrack-client": "mobile/1.0.0+4" }),
      path: "timerSync.sync",
      error: new ClientTooOldError("mobile", "1.0.0+5", "1.0.0+4"),
      userId: "u1",
      now: 1000,
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      userId: "u1",
      event: "client_too_old",
      source: "mobile",
      clientHint: "mobile@1.0.0+4",
      detail: {
        path: "timerSync.sync",
        kind: "mobile",
        version: "1.0.0+4",
        minimum: "1.0.0+5",
      },
    });
  });

  it("finder brugeren via extension-token i input", async () => {
    const { db, inserted } = fakeDb("u-ext");
    await recordClientTooOld({
      db,
      headers: headers({ origin: "chrome-extension://abc" }),
      path: "extension.updateTimerState",
      error: new ClientTooOldError("extension", "2.5.2", "2.5.1"),
      userId: null,
      getRawInput: async () => ({ json: { token: "tt_ext_x" } }),
      now: 1000,
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      userId: "u-ext",
      source: "extension",
      clientHint: "extension/chrome",
    });
  });

  it("logger højst én gang pr. bruger+version pr. 10 min", async () => {
    const { db, inserted } = fakeDb();
    const base = {
      db,
      headers: headers({ "x-timetrack-client": "desktop/0.2.20" }),
      path: "time.create",
      error: new ClientTooOldError("desktop", "0.2.21", "0.2.20"),
      userId: "u1",
    };
    await recordClientTooOld({ ...base, now: 0 });
    await recordClientTooOld({ ...base, now: 60_000 });
    await recordClientTooOld({ ...base, now: 11 * 60_000 });
    expect(inserted).toHaveLength(2);
  });

  it("uden bruger logges intet og der kastes aldrig", async () => {
    const { db, inserted } = fakeDb(null);
    await expect(
      recordClientTooOld({
        db,
        headers: null,
        path: "extension.quickStop",
        error: new ClientTooOldError("extension", "2.5.2", "2.5.1"),
        userId: null,
        getRawInput: async () => {
          throw new Error("bad input");
        },
      }),
    ).resolves.toBeUndefined();
    expect(inserted).toHaveLength(0);
  });
});
