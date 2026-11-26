import { beforeEach, describe, expect, it, vi } from "vitest";

// Kontosletning rydder brugerens filer i S3 — men først når selve
// databasesletningen er lykkedes, og en S3-fejl må aldrig vælte sletningen.
// Nøglerne til filer, der kun kendes via databasen, SKAL indsamles før
// sletningen, fordi rækkerne forsvinder med den.

const mocks = vi.hoisted(() => ({
  purgeUserUploads: vi.fn(),
  collectUserStorageKeys: vi.fn(),
  purgeStorageKeys: vi.fn(),
  order: [] as string[],
}));

vi.mock("@/lib/integrations/google-calendar-revoke", () => ({
  lockGoogleCalendarRows: vi.fn(async () => []),
  planGoogleCalendarRevokes: vi.fn(async () => []),
  executeGoogleCalendarRevokes: vi.fn(async () => undefined),
}));
vi.mock("@/lib/alunta", () => ({
  alunta: { subscriptions: { cancel: vi.fn() } },
}));
vi.mock("@/lib/storage/user-uploads", () => ({
  purgeUserUploads: mocks.purgeUserUploads,
  collectUserStorageKeys: mocks.collectUserStorageKeys,
  purgeStorageKeys: mocks.purgeStorageKeys,
}));

const { deleteUserAccountCompletely } = await import("@/lib/account-deletion");

const KEYS = [
  "timetrack/uploads/images/2026/10/0b9c1f3e-6d2a-4c5b-8e7f-1a2b3c4d5e6f.jpg",
  "timetrack/email-attachments/a1b2c3d4/0123456789ab",
];

function fakeDb(execute: () => Promise<unknown>) {
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
    execute: vi.fn(async () => {
      mocks.order.push("db");
      return execute();
    }),
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

describe("deleteUserAccountCompletely: S3-oprydning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.purgeUserUploads.mockImplementation(async () => {
      mocks.order.push("purge-uploads");
      return 3;
    });
    mocks.collectUserStorageKeys.mockImplementation(async () => {
      mocks.order.push("collect");
      return KEYS;
    });
    mocks.purgeStorageKeys.mockImplementation(async () => {
      mocks.order.push("purge-keys");
      return 5;
    });
  });

  it("sletter uploads i S3 efter databasesletningen", async () => {
    await deleteUserAccountCompletely(
      fakeDb(async () => undefined) as never,
      "user_1",
    );

    expect(mocks.purgeUserUploads).toHaveBeenCalledWith("user_1");
    expect(mocks.order.indexOf("purge-uploads")).toBeGreaterThan(
      mocks.order.indexOf("db"),
    );
  });

  it("indsamler nøgler FØR databasesletningen og sletter dem EFTER", async () => {
    const db = fakeDb(async () => undefined);
    await deleteUserAccountCompletely(db as never, "user_1");

    expect(mocks.collectUserStorageKeys).toHaveBeenCalledWith(db, "user_1", [
      "org_1",
    ]);
    expect(mocks.purgeStorageKeys).toHaveBeenCalledWith(KEYS);
    expect(mocks.order.indexOf("collect")).toBeLessThan(
      mocks.order.indexOf("db"),
    );
    expect(mocks.order.indexOf("purge-keys")).toBeGreaterThan(
      mocks.order.indexOf("db"),
    );
  });

  it("rører ikke S3 hvis databasesletningen fejler", async () => {
    await expect(
      deleteUserAccountCompletely(
        fakeDb(async () => {
          throw new Error("FK-fejl");
        }) as never,
        "user_1",
      ),
    ).rejects.toThrow("FK-fejl");

    expect(mocks.purgeUserUploads).not.toHaveBeenCalled();
    expect(mocks.purgeStorageKeys).not.toHaveBeenCalled();
  });

  it("en S3-fejl vælter ikke den færdige kontosletning", async () => {
    mocks.purgeUserUploads.mockRejectedValue(new Error("S3 nede"));
    mocks.purgeStorageKeys.mockRejectedValue(new Error("S3 nede"));

    await expect(
      deleteUserAccountCompletely(
        fakeDb(async () => undefined) as never,
        "user_1",
      ),
    ).resolves.toEqual({ outcome: "deleted" });

    const manual = vi
      .mocked(console.error)
      .mock.calls.filter(([msg]) => String(msg).includes("MANUEL OPFØLGNING"));
    expect(manual).toHaveLength(2);
  });

  it("hvis indsamlingen fejler, slettes kontoen alligevel og fejlen logges", async () => {
    mocks.collectUserStorageKeys.mockRejectedValue(new Error("opslag fejlede"));

    await expect(
      deleteUserAccountCompletely(
        fakeDb(async () => undefined) as never,
        "user_1",
      ),
    ).resolves.toEqual({ outcome: "deleted" });

    expect(mocks.order).toContain("db");
    expect(mocks.purgeStorageKeys).toHaveBeenCalledWith([]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("kunne ikke indsamles"),
      expect.any(Error),
    );
  });
});
