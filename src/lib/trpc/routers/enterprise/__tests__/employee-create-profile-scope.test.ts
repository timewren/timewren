import { TRPCError } from "@trpc/server";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { enterpriseEmployeeRouter } from "@/lib/trpc/routers/enterprise/employee";
import { router } from "@/lib/trpc/trpc";

const ADMIN_ID = "org-admin-user";
const ORG_ID = "org-a";
/** En bruger fra en anden organisation, som ikke er medlem af org-a. */
const OUTSIDER_ID = "outsider-user";

const dialect = new PgDialect();
const params = (where: unknown) =>
  where ? dialect.sqlToQuery(where as SQL).params : [];

function makeDb() {
  const query = new Proxy(
    {
      users: { findFirst: async () => ({ role: "user" }) },
      // Kun admin'en er medlem af org-a.
      members: {
        findFirst: async (opts?: { where?: unknown }) =>
          params(opts?.where).includes(ADMIN_ID)
            ? {
                id: "m-admin",
                organizationId: ORG_ID,
                userId: ADMIN_ID,
                role: "owner",
              }
            : undefined,
        findMany: async () => [
          { id: "m-admin", organizationId: ORG_ID, userId: ADMIN_ID },
        ],
      },
      // Admin'en har sin egen medarbejderprofil (enterprise-middlewaren).
      employeeProfiles: {
        findFirst: async (opts?: { where?: unknown }) =>
          params(opts?.where).includes(ADMIN_ID)
            ? { id: "p-admin", role: "admin" }
            : undefined,
        findMany: async () => [],
      },
    } as Record<string, unknown>,
    {
      get: (target, key: string) =>
        target[key] ?? {
          findFirst: async () => undefined,
          findMany: async () => [],
        },
    },
  );
  const forbiddenWrite = () => {
    throw new Error("uventet skrivning til databasen");
  };
  return {
    query,
    insert: vi.fn(forbiddenWrite),
    update: vi.fn(forbiddenWrite),
    transaction: vi.fn(forbiddenWrite),
  };
}

const testRouter = router({ enterprise: enterpriseEmployeeRouter });

describe("enterprise.createProfile kræver eksisterende medlemskab", () => {
  it("melder en bruger uden for organisationen ikke ind", async () => {
    const db = makeDb();
    const caller = testRouter.createCaller({
      session: { user: { id: ADMIN_ID, email: "admin@example.com" } },
      db,
      headers: null,
    } as never);

    const err = await caller.enterprise
      .createProfile({ userId: OUTSIDER_ID, role: "admin" })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
    expect(db.insert).not.toHaveBeenCalled();
  });
});
