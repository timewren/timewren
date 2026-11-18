import { beforeEach, describe, expect, it, vi } from "vitest";

// Apple 5.1.1(v): Apple-login skal tilbagekaldes, når kontoen slettes. iOS-
// appens native login gemmer intet token i `account`, så appen sender en frisk
// authorization code med sletningen, som byttes til et token FØR sletningen og
// tilbagekaldes EFTER. En fejl i ombytningen må aldrig vælte sletningen.

const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  collect: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("@/lib/auth/apple", () => ({
  exchangeAppleAuthorizationCode: mocks.exchange,
  collectAppleTokens: mocks.collect,
  revokeAppleTokens: mocks.revoke,
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

const NATIVE = {
  token: "native-token",
  hint: "refresh_token" as const,
  clientId: "dk.timetrack.app",
};
const WEB = { token: "web-token", hint: "access_token" as const };

function fakeDb(subs: Array<Record<string, unknown>> = []) {
  const db = {
    query: {
      members: {
        findMany: vi.fn(async () => [
          { userId: "user_1", organizationId: "org_1" },
        ]),
      },
      subscriptions: { findMany: vi.fn(async () => subs) },
      accounts: { findMany: vi.fn(async () => []) },
    },
    execute: vi.fn(async () => undefined),
  };
  return {
    ...db,
    async transaction(run: (tx: unknown) => Promise<void>) {
      const selection = {
        from: () => selection,
        innerJoin: () => selection,
        where: () => selection,
      };
      await run({
        execute: db.execute,
        select: () => selection,
        insert: () => ({
          select: () => ({ onConflictDoNothing: async () => {} }),
        }),
      });
    },
  };
}

function logged(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((c) => c.map(String).join(" "));
}

describe("deleteUserAccountCompletely: Apple authorization code", () => {
  let error: { mock: { calls: unknown[][] } };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exchange.mockResolvedValue(NATIVE);
    mocks.collect.mockResolvedValue([]);
    mocks.revoke.mockResolvedValue(undefined);
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("bytter koden før sletningen og tilbagekalder det native token efter", async () => {
    const db = fakeDb();
    await deleteUserAccountCompletely(db as never, "user_1", {
      appleAuthorizationCode: "code-1",
    });

    expect(mocks.exchange).toHaveBeenCalledWith("code-1", "user_1");
    expect(mocks.collect).toHaveBeenCalledWith(db, "user_1", {
      nativeTokenObtained: true,
    });
    expect(mocks.revoke).toHaveBeenCalledWith([NATIVE], "user_1");
    const [exchangeOrder] = mocks.exchange.mock.invocationCallOrder;
    const [firstExecute] = db.execute.mock.invocationCallOrder;
    const [revokeOrder] = mocks.revoke.mock.invocationCallOrder;
    expect(exchangeOrder).toBeLessThan(firstExecute);
    expect(firstExecute).toBeLessThan(revokeOrder);
  });

  it("lægger det ombyttede token sammen med gemte web-tokens", async () => {
    mocks.collect.mockResolvedValue([WEB]);
    await deleteUserAccountCompletely(fakeDb() as never, "user_1", {
      appleAuthorizationCode: "code-1",
    });
    expect(mocks.revoke).toHaveBeenCalledWith([NATIVE, WEB], "user_1");
  });

  it("giver ombytningen intet token, gennemføres sletningen alligevel", async () => {
    mocks.exchange.mockResolvedValue(null);
    mocks.collect.mockResolvedValue([WEB]);
    const db = fakeDb();
    await expect(
      deleteUserAccountCompletely(db as never, "user_1", {
        appleAuthorizationCode: "code-1",
      }),
    ).resolves.toEqual({ outcome: "deleted" });
    expect(db.execute).toHaveBeenCalledTimes(2); // sletning + udfald
    expect(mocks.collect).toHaveBeenCalledWith(db, "user_1", {
      nativeTokenObtained: false,
    });
    expect(mocks.revoke).toHaveBeenCalledWith([WEB], "user_1");
  });

  it("kaster ombytningen, gennemføres sletningen og fejlen logges uden koden", async () => {
    mocks.exchange.mockRejectedValue(new Error("boom"));
    const db = fakeDb();
    await expect(
      deleteUserAccountCompletely(db as never, "user_1", {
        appleAuthorizationCode: "code-hemmelig",
      }),
    ).resolves.toEqual({ outcome: "deleted" });
    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(mocks.revoke).toHaveBeenCalledWith([], "user_1");
    const lines = logged(error);
    expect(lines.some((l) => l.includes("MANUEL OPFØLGNING"))).toBe(true);
    expect(lines.some((l) => l.includes("code-hemmelig"))).toBe(false);
  });

  it("uden kode (web og ældre klienter) sker der ingen ombytning, og sletningen er uændret", async () => {
    mocks.collect.mockResolvedValue([WEB]);
    const db = fakeDb();
    await expect(
      deleteUserAccountCompletely(db as never, "user_1"),
    ).resolves.toEqual({ outcome: "deleted" });
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(mocks.collect).toHaveBeenCalledWith(db, "user_1", {
      nativeTokenObtained: false,
    });
    expect(mocks.revoke).toHaveBeenCalledWith([WEB], "user_1");
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it("en blokeret sletning bruger ikke engangskoden", async () => {
    const db = fakeDb([
      {
        userId: "user_1",
        organizationId: "org_1",
        status: "active",
        storeProvider: "apple",
        storeStatus: "active",
      },
    ]);
    await expect(
      deleteUserAccountCompletely(db as never, "user_1", {
        appleAuthorizationCode: "code-1",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });
});
