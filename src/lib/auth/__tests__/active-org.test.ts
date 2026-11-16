import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { resolvePrimaryOrgId, resolveRequestedOrgId } from "../active-org";

vi.mock("@/lib/db", () => ({ db: {} }));

function fakeDb(member: { id: string } | undefined) {
  return {
    query: { members: { findFirst: vi.fn(async () => member) } },
  } as never;
}

describe("eksplicit org fra offline-køen", () => {
  it("accepterer en org, brugeren er medlem af", async () => {
    await expect(
      resolveRequestedOrgId({
        db: fakeDb({ id: "m1" }),
        userId: "u1",
        orgId: "org-a",
      }),
    ).resolves.toBe("org-a");
  });

  it("afviser en org, brugeren ikke er medlem af", async () => {
    await expect(
      resolveRequestedOrgId({
        db: fakeDb(undefined),
        userId: "u1",
        orgId: "org-x",
      }),
    ).resolves.toBeNull();
  });
});

describe("brugerens primære org", () => {
  function capturingDb(member: { organizationId: string } | undefined) {
    const findFirst = vi.fn(
      async (_args: { orderBy?: SQL[] }) => member as unknown,
    );
    return { db: { query: { members: { findFirst } } } as never, findFirst };
  }

  it("sorterer som pickPrimaryMembership: ejer i rollelisten, ældste, org-id", async () => {
    const { db, findFirst } = capturingDb({ organizationId: "org-a" });
    await expect(resolvePrimaryOrgId({ db, userId: "u1" })).resolves.toBe(
      "org-a",
    );

    const orderBy = findFirst.mock.calls[0][0].orderBy ?? [];
    const rendered = new PgDialect().sqlToQuery(sql.join(orderBy, sql`, `)).sql;
    // Kommasepareret rolle ("owner,admin") tæller som ejer, og org-id bryder
    // stabilt, når rolle og tidspunkt er ens (#1118)
    expect(rendered).toBe(
      `CASE WHEN ',' || replace(lower("members"."role"), ' ', '') || ',' LIKE '%,owner,%' THEN 0 ELSE 1 END, "members"."created_at" asc, "members"."organization_id" COLLATE "C"`,
    );
  });

  it("giver null, når brugeren ikke er medlem af nogen org", async () => {
    const { db } = capturingDb(undefined);
    await expect(resolvePrimaryOrgId({ db, userId: "u1" })).resolves.toBeNull();
  });
});
