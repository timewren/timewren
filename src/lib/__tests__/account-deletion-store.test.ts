import { beforeEach, describe, expect, it, vi } from "vitest";

// Et abonnement købt i App Store/Google Play stopper ikke, når kontoen
// slettes: kun brugeren kan opsige det i butikken. Sletningen må ikke
// blokeres, men kræver en eksplicit bekræftelse, også når API'et kaldes
// direkte uden om web-UI'et.

const mocks = vi.hoisted(() => ({ cancel: vi.fn() }));

vi.mock("@/lib/alunta", () => ({
  alunta: { subscriptions: { cancel: mocks.cancel } },
}));
vi.mock("@/lib/storage/user-uploads", () => ({
  purgeUserUploads: vi.fn(async () => 0),
  collectUserStorageKeys: vi.fn(async () => []),
  purgeStorageKeys: vi.fn(async () => 0),
}));

const { deleteUserAccountCompletely } = await import("@/lib/account-deletion");

const STORE_ROW = {
  userId: "user_1",
  organizationId: "org_1",
  status: "active",
  aluntaSubscriptionId: "alunta-gammel",
  storeProvider: "apple",
  storeStatus: "active",
};

function fakeDb(subs: Array<Record<string, unknown>>) {
  const selection = {
    from: () => selection,
    innerJoin: () => selection,
    where: async () => [],
  };
  const db = {
    select: () => selection,
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

describe("deleteUserAccountCompletely: abonnement købt i appen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("kræver bekræftelse, når kontoen har et aktivt butiksabonnement", async () => {
    const db = fakeDb([STORE_ROW]);
    await expect(
      deleteUserAccountCompletely(db as never, "user_1"),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("App Store"),
    });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("sletter efter bekræftelse uden at røre det gamle Alunta-link", async () => {
    const db = fakeDb([STORE_ROW]);
    await deleteUserAccountCompletely(db as never, "user_1", {
      storeSubscriptionAcknowledged: true,
    });
    expect(db.execute).toHaveBeenCalledTimes(2); // sletning + udfald
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("et udløbet butiksabonnement kræver ingen bekræftelse", async () => {
    const db = fakeDb([{ ...STORE_ROW, storeStatus: "expired" }]);
    await deleteUserAccountCompletely(db as never, "user_1");
    expect(db.execute).toHaveBeenCalledTimes(2); // sletning + udfald
  });

  it("et web-abonnement kræver ingen bekræftelse og annulleres stadig", async () => {
    const db = fakeDb([
      { ...STORE_ROW, storeProvider: null, storeStatus: null },
    ]);
    mocks.cancel.mockResolvedValue({});
    await deleteUserAccountCompletely(db as never, "user_1");
    expect(db.execute).toHaveBeenCalledTimes(2); // sletning + udfald
    expect(mocks.cancel).toHaveBeenCalledWith("alunta-gammel");
  });
});
