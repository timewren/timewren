import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: vi.fn(async () => "org-active"),
}));
vi.mock("../enterprise/middleware", async (original) => ({
  ...(await original<typeof import("../enterprise/middleware")>()),
  resolveModules: vi.fn(async () => ({ isEnabled: () => false })),
}));

import { timeRouter } from "../time";

function setup(userId: string, rows: unknown[] = []) {
  const findMany = vi.fn(async (_args: unknown) => rows);
  const caller = timeRouter.createCaller({
    db: { query: { timeEntries: { findMany } } },
    session: { user: { id: userId } },
    headers: new Headers(),
  } as never);
  return { caller, findMany };
}

describe("time.myRecords", () => {
  it.each(["member", "owner"])(
    "always scopes %s to their own records without client access or module checks",
    async (user) => {
      const { caller, findMany } = setup(user);
      await caller.myRecords({ year: 2015 });
      const args = findMany.mock.calls[0]?.[0] as unknown as {
        where: Parameters<PgDialect["sqlToQuery"]>[0];
        columns: unknown;
        limit: number;
      };
      expect(new PgDialect().sqlToQuery(args.where).params).toEqual([
        user,
        "org-active",
        "2015-01-01T00:00:00.000Z",
        "2016-01-01T00:00:00.000Z",
      ]);
      expect(args.columns).toEqual({
        id: true,
        date: true,
        description: true,
        hours: true,
      });
      expect(args.limit).toBe(251);
    },
  );
  it("exposes a next page until the entire period is read", async () => {
    const { caller } = setup(
      "self",
      Array.from({ length: 251 }, (_, i) => ({ id: String(i) })),
    );
    const page = await caller.myRecords({ year: 2024, offset: 1000 });
    expect(page.entries).toHaveLength(250);
    expect(page.nextOffset).toBe(1250);
    expect(
      (await setup("self").caller.myRecords({ year: 2024 })).nextOffset,
    ).toBeNull();
  });
  it("rejects unauthenticated requests before reading data", async () => {
    const findMany = vi.fn();
    const caller = timeRouter.createCaller({
      db: { query: { timeEntries: { findMany } } },
      session: null,
      headers: new Headers(),
    } as never);
    await expect(caller.myRecords({ year: 2024 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});
