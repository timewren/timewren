import { beforeEach, describe, expect, it, vi } from "vitest";

// Sletning af en testkonto må ikke afhænge af, at Alunta kan levere hele
// abonnementslisten: listen hentes før transaktionen, og fejler den, gemmes
// kun de lokalt kendte abonnements-ID'er.

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(async () => ({})),
  listAll: vi.fn(),
  calls: [] as string[],
}));

vi.mock("@/lib/integrations/google-calendar-revoke", () => ({
  lockGoogleCalendarRows: vi.fn(async () => []),
  planGoogleCalendarRevokes: vi.fn(async () => []),
  executeGoogleCalendarRevokes: vi.fn(async () => undefined),
}));
vi.mock("@/lib/alunta", () => ({
  alunta: { subscriptions: { cancel: mocks.cancel, listAll: mocks.listAll } },
}));
vi.mock("@/lib/storage/user-uploads", () => ({
  purgeUserUploads: vi.fn(async () => 0),
  collectUserStorageKeys: vi.fn(async () => []),
  purgeStorageKeys: vi.fn(async () => 0),
}));

const { deleteUserAccountCompletely } = await import("@/lib/account-deletion");

function fakeDb({
  isTest = true,
  isTestInTx = isTest,
}: {
  isTest?: boolean;
  isTestInTx?: boolean;
} = {}) {
  const inserted: unknown[] = [];
  const execute = vi.fn(async () => undefined);
  const select = (test: boolean) => {
    const selection = {
      from: () => selection,
      innerJoin: () => selection,
      where: async () => rows(test),
    };
    return selection;
  };
  const rows = (test: boolean) =>
    test
      ? [
          {
            userId: "user_1",
            organizationId: "org_1",
            membershipId: "sub-local",
            customerId: "customer-1",
            matches: true,
            userMatches: true,
          },
        ]
      : [];
  const db = {
    query: {
      members: {
        findMany: vi.fn(async () => [
          { userId: "user_1", organizationId: "org_1" },
        ]),
      },
      subscriptions: {
        findMany: vi.fn(async () => [
          {
            userId: "user_1",
            organizationId: "org_1",
            status: "active",
            aluntaSubscriptionId: "sub-local",
            aluntaCustomerId: "customer-1",
          },
        ]),
      },
      accounts: { findMany: vi.fn(async () => []) },
    },
    execute,
    select: () => select(isTest),
    async transaction(run: (tx: unknown) => Promise<void>) {
      mocks.calls.push("transaction");
      await run({
        execute,
        select: () => select(isTestInTx),
        insert: () => ({
          values: (values: unknown[]) => {
            inserted.push(...values);
            return { onConflictDoNothing: async () => {} };
          },
        }),
      });
    },
  };
  return { db, inserted, execute };
}

describe("deleteUserAccountCompletely: Alunta-listen fejler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("sletter alligevel og gemmer de lokalt kendte ID'er", async () => {
    mocks.listAll.mockImplementation(async () => {
      mocks.calls.push("listAll");
      throw new Error("Alunta API 502");
    });
    const { db, inserted, execute } = fakeDb();
    await expect(
      deleteUserAccountCompletely(db as never, "user_1"),
    ).resolves.toEqual({ outcome: "deleted" });
    expect(mocks.calls).toEqual(["listAll", "transaction"]);
    expect(inserted).toEqual([{ subscriptionId: "sub-local" }]);
    expect(execute).toHaveBeenCalledTimes(2); // sletning + udfald
  });

  it("henter listen én gang før transaktionen og bruger den", async () => {
    mocks.listAll.mockImplementation(async () => {
      mocks.calls.push("listAll");
      return [{ uuid: "sub-seats", external_customer_id: "org_1" }];
    });
    const { db, inserted } = fakeDb();
    await deleteUserAccountCompletely(db as never, "user_1");
    expect(mocks.calls).toEqual(["listAll", "transaction"]);
    expect(inserted).toEqual([
      { subscriptionId: "sub-local" },
      { subscriptionId: "sub-seats" },
    ]);
  });

  it("logger hverken bruger-ID eller Aluntas svartekst", async () => {
    mocks.listAll.mockRejectedValue(
      Object.assign(new Error("Alunta API 502: kunde@example.dk"), {
        name: "AluntaApiError",
        status: 502,
      }),
    );
    const { db } = fakeDb();
    await deleteUserAccountCompletely(db as never, "user_1");
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("AluntaApiError 502");
    expect(logged).not.toContain("user_1");
    expect(logged).not.toContain("kunde@example.dk");
  });

  it("henter ikke listen, når intet testabonnement slettes", async () => {
    const { db, inserted } = fakeDb({ isTest: false });
    await expect(
      deleteUserAccountCompletely(db as never, "user_1"),
    ).resolves.toEqual({ outcome: "deleted" });
    expect(mocks.listAll).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it("bevarer lokale ID'er, når workspacet markeres som test efter forhåndstjekket", async () => {
    const { db, inserted } = fakeDb({ isTest: false, isTestInTx: true });
    await deleteUserAccountCompletely(db as never, "user_1");
    expect(mocks.listAll).not.toHaveBeenCalled();
    expect(inserted).toEqual([{ subscriptionId: "sub-local" }]);
  });
});
