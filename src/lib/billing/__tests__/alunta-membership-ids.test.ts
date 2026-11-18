import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listAll = vi.hoisted(() => vi.fn());
vi.mock("@/lib/alunta", () => ({ alunta: { subscriptions: { listAll } } }));

const { collectAluntaMembershipIds } = await import("../alunta-membership-ids");

type Row = {
  userId: string;
  organizationId: string | null;
  membershipId: string | null;
  customerId: string | null;
  matches: boolean;
  userMatches: boolean;
};

function fakeDb(rows: Row[]) {
  const selection = {
    from: () => selection,
    innerJoin: () => selection,
    where: async () => rows,
  };
  return { select: () => selection } as never;
}

// The checkout webhook set organizationId on a row whose Alunta membership
// predates workspaces and therefore carries the owner's user ID.
const orgRow = (userMatches: boolean): Row => ({
  userId: "owner",
  organizationId: "test-org",
  membershipId: "sub-local",
  customerId: null,
  matches: true,
  userMatches,
});
const legacy = { uuid: "sub-legacy", external_customer_id: "owner" };

describe("collectAluntaMembershipIds", () => {
  beforeEach(() => listAll.mockReset());

  it("includes a legacy user-keyed membership when the owner has only test workspaces", async () => {
    const ids = await collectAluntaMembershipIds(
      fakeDb([orgRow(true)]),
      sql<boolean>`true`,
      [legacy] as never,
    );
    expect([...ids].sort()).toEqual(["sub-legacy", "sub-local"]);
  });

  it("keeps the legacy membership when the owner also has a real workspace", async () => {
    const ids = await collectAluntaMembershipIds(
      fakeDb([orgRow(false)]),
      sql<boolean>`true`,
      [legacy] as never,
    );
    expect([...ids]).toEqual(["sub-local"]);
  });

  it("uses only local IDs without calling Alunta when the list is null", async () => {
    const ids = await collectAluntaMembershipIds(
      fakeDb([orgRow(true)]),
      sql<boolean>`true`,
      null,
    );
    expect([...ids]).toEqual(["sub-local"]);
    expect(listAll).not.toHaveBeenCalled();
  });

  it("fetches the list itself when none is passed", async () => {
    listAll.mockResolvedValue([legacy]);
    const ids = await collectAluntaMembershipIds(
      fakeDb([orgRow(true)]),
      sql<boolean>`true`,
    );
    expect(ids.has("sub-legacy")).toBe(true);
    expect(listAll).toHaveBeenCalledOnce();
  });

  it("skips malformed list entries instead of throwing", async () => {
    const ids = await collectAluntaMembershipIds(
      fakeDb([orgRow(true)]),
      sql<boolean>`true`,
      [null, {}, legacy] as never,
    );
    expect([...ids].sort()).toEqual(["sub-legacy", "sub-local"]);
  });

  it("skips IDs that do not fit the varchar(255) column", async () => {
    const ids = await collectAluntaMembershipIds(
      fakeDb([orgRow(true)]),
      sql<boolean>`true`,
      [
        { uuid: "x".repeat(256), external_customer_id: "owner" },
        { uuid: 42, external_customer_id: "owner" },
        { uuid: "sub\u0000legacy", external_customer_id: "owner" },
        legacy,
      ] as never,
    );
    expect([...ids].sort()).toEqual(["sub-legacy", "sub-local"]);
  });
});
