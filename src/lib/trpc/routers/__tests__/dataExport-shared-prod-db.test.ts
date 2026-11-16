/**
 * beta.timetrack.dk deler database med en ældre prod-version, der ikke
 * kender request-typerne `org_full`/`user_full` (ZIP-eksport): dens cron
 * tager ALLE `pending`-rækker uden typefilter og ville lave en forkert
 * eksport af dem. Når SHARED_PROD_DB=1 skal begge bestillinger afvises,
 * uden at skrive en række.
 */

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
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: vi.fn(async () => "org-A"),
}));
vi.mock("../enterprise/middleware", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../enterprise/middleware")>()),
  resolveModules: vi.fn(async () => ({
    raw: new Map(),
    isAvailable: () => true,
    isEnabled: () => true,
  })),
}));

import { dataExportRouter } from "../dataExport";

function makeDb() {
  const inserted: Record<string, unknown>[] = [];

  const countChain: Record<string, unknown> = {};
  for (const step of ["from", "where"]) {
    countChain[step] = () => countChain;
  }
  // Ingen aktiv/ventende eksport og ingen rate-limit ramt: to count()-opslag
  // pr. mutation svarer begge [{ count: 0 }].
  // biome-ignore lint/suspicious/noThenProperty: bevidst thenable db-builder
  countChain.then = (resolve: (rows: unknown[]) => unknown) =>
    resolve([{ count: 0 }]);

  const db = {
    query: {
      members: { findFirst: vi.fn(async () => ({ role: "owner" })) },
    },
    select: () => countChain,
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return {
          returning: async () => [
            {
              id: "export-1",
              status: "pending",
              expiresAt: new Date("2026-11-01T00:00:00.000Z"),
              ...v,
            },
          ],
        };
      },
    }),
  };

  return { db: db as never, inserted };
}

function caller(db: unknown) {
  return dataExportRouter.createCaller({
    session: {
      user: { id: "user-1", email: "ejer@test.local", name: "Test Ejer" },
      activeOrganizationId: "org-A",
    },
    db,
    headers: new Headers(),
  } as never);
}

describe("requestOrgExport og requestUserExport på delt prod-database", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("requestOrgExport afviser venligt, når SHARED_PROD_DB=1", async () => {
    process.env.SHARED_PROD_DB = "1";
    const { db, inserted } = makeDb();
    const err = await caller(db)
      .requestOrgExport()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect(inserted).toEqual([]);
  });

  it("requestUserExport afviser venligt, når SHARED_PROD_DB=1", async () => {
    process.env.SHARED_PROD_DB = "1";
    const { db, inserted } = makeDb();
    const err = await caller(db)
      .requestUserExport()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect(inserted).toEqual([]);
  });

  it("requestOrgExport virker som normalt, når variablen ikke er sat", async () => {
    delete process.env.SHARED_PROD_DB;
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    const { db } = makeDb();
    const result = await caller(db).requestOrgExport();
    expect(result).toMatchObject({ id: "export-1", status: "pending" });
  });

  it("requestUserExport virker som normalt, når variablen ikke er sat", async () => {
    delete process.env.SHARED_PROD_DB;
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    const { db } = makeDb();
    const result = await caller(db).requestUserExport();
    expect(result).toMatchObject({ id: "export-1", status: "pending" });
  });

  it("getExportFlags afspejler SHARED_PROD_DB", async () => {
    process.env.SHARED_PROD_DB = "1";
    const { db } = makeDb();
    expect(await caller(db).getExportFlags()).toEqual({
      fullExportEnabled: false,
    });

    delete process.env.SHARED_PROD_DB;
    expect(await caller(db).getExportFlags()).toEqual({
      fullExportEnabled: true,
    });
  });
});
