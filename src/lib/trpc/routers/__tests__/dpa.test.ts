import { TRPCError } from "@trpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_o: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

import { DPA_VERSION } from "@/lib/enterprise/dpa/content";
import { dpaRouter } from "../dpa";

type Role = "owner" | "admin" | "member";

function orgIn(node: unknown, seen = new Set<unknown>()): string | null {
  if (node === null || node === undefined || seen.has(node)) return null;
  if (typeof node === "string") return node.startsWith("org-") ? node : null;
  if (typeof node !== "object") return null;
  seen.add(node);
  for (const v of Object.values(node as Record<string, unknown>)) {
    const hit = orgIn(v, seen);
    if (hit) return hit;
  }
  return null;
}

/** Ingen enterprise-moduler: accept skal virke på alle planer. */
function makeDb(roles: Record<string, Role>) {
  const inserted: Record<string, unknown>[] = [];
  const audit: Record<string, unknown>[] = [];
  const db = {
    query: {
      sessions: { findFirst: async () => ({ activeOrganizationId: "org-A" }) },
      members: {
        findFirst: async (args: { where: unknown }) => {
          const orgId = orgIn(args.where);
          const role = orgId ? roles[orgId] : undefined;
          return role ? { id: "m", role, organizationId: orgId } : undefined;
        },
      },
      organizationModules: { findMany: async () => [] },
      organizations: {
        findFirst: async () => ({ requireTwoFactorForManagers: false }),
      },
      users: {
        findFirst: async () => ({
          email: "ejer@test.local",
          name: "Test Ejer",
          twoFactorEnabled: false,
        }),
      },
      orgDpaAcceptances: {
        findFirst: async () => undefined,
        findMany: async () => [],
      },
      employeeProfiles: {
        findFirst: async () => {
          throw new Error("må ikke røre enterprise-medarbejderprofiler");
        },
      },
    },
    transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            if ("action" in v) audit.push(v);
            else inserted.push(v);
            return {
              onConflictDoNothing: () => ({
                returning: async () => [{ id: "acc-1", ...v }],
              }),
              returning: async () => [{ id: "audit-1", ...v }],
            };
          },
        }),
        query: {},
      }),
  };
  return { db: db as never, inserted, audit };
}

function caller(db: unknown) {
  return dpaRouter.createCaller({
    session: {
      user: { id: "user-me", email: "ejer@test.local", name: "Test Ejer" },
      activeOrganizationId: "org-A",
    },
    db,
    headers: new Headers({ "x-forwarded-for": "203.0.113.5" }),
  } as never);
}

describe("dpa-router (alle planer)", () => {
  it("medarbejder kan ikke acceptere", async () => {
    const { db, inserted } = makeDb({ "org-A": "member" });
    const err = await caller(db)
      .accept({ version: DPA_VERSION })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect(inserted).toEqual([]);
  });

  it("ejer uden Enterprise kan acceptere, registreret på den aktive org", async () => {
    const { db, inserted } = makeDb({ "org-A": "owner" });
    const row = await caller(db).accept({ version: DPA_VERSION });
    expect(row).toMatchObject({
      organizationId: "org-A",
      version: DPA_VERSION,
    });
    expect(inserted[0]).toMatchObject({
      organizationId: "org-A",
      acceptedBy: "user-me",
      acceptedByName: "Test Ejer",
      ipAddress: "203.0.113.5",
    });
  });

  it("afviser en forældet version", async () => {
    const { db } = makeDb({ "org-A": "admin" });
    const err = await caller(db)
      .accept({ version: "0.9" })
      .catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("BAD_REQUEST");
  });
});

describe("dpa-router på delt prod-database (SHARED_PROD_DB=1)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("afviser accept, selv for en ejer", async () => {
    process.env.SHARED_PROD_DB = "1";
    const { db, inserted } = makeDb({ "org-A": "owner" });
    const err = await caller(db)
      .accept({ version: DPA_VERSION })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect(inserted).toEqual([]);
  });

  it("afviser status (skjuler kortet)", async () => {
    process.env.SHARED_PROD_DB = "1";
    const { db } = makeDb({ "org-A": "owner" });
    const err = await caller(db)
      .status()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });

  it("virker som normalt, når variablen ikke er sat", async () => {
    delete process.env.SHARED_PROD_DB;
    const { db } = makeDb({ "org-A": "owner" });
    const row = await caller(db).accept({ version: DPA_VERSION });
    expect(row).toMatchObject({
      organizationId: "org-A",
      version: DPA_VERSION,
    });
  });
});
