import { beforeEach, describe, expect, it, vi } from "vitest";

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock("@/lib/valkey", () => {
  const m = {
    getValkey: () => ({
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
      },
      del: async (k: string) => {
        store.delete(k);
      },
    }),
  };
  return { ...m, getReadyValkey: m.getValkey };
});
vi.mock("@sentry/nextjs", () => ({}));
// Kun resolveModules bruges; procedurekæden i samme fil skal bare kunne bygges.
vi.mock("@/lib/trpc/trpc", () => {
  const procedure = { use: () => procedure };
  return { protectedProcedure: procedure };
});

import { resolveModules } from "@/lib/trpc/routers/enterprise/middleware";
import { applyBundle } from "./bundles";
import { invalidateOrgModules } from "./cache";

function fakeDb(
  rows: { moduleKey: string; isAvailable: boolean; isEnabled: boolean }[],
) {
  const findMany = vi.fn(async () => rows);
  const onConflictDoUpdate = vi.fn(async () => {});
  const db = {
    query: { organizationModules: { findMany } },
    insert: () => ({ values: () => ({ onConflictDoUpdate }) }),
  };
  return { db: db as never, findMany };
}

describe("modul-cachen i resolveModules", () => {
  beforeEach(() => store.clear());

  it("læser databasen én gang og derefter fra cachen", async () => {
    const { db, findMany } = fakeDb([
      { moduleKey: "tasks", isAvailable: true, isEnabled: true },
    ]);
    const first = await resolveModules(db, "org-1");
    const second = await resolveModules(db, "org-1");
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(first.isEnabled("tasks")).toBe(true);
    expect(second.isEnabled("tasks")).toBe(true);
  });

  it("henter frisk efter invalidering", async () => {
    const { db, findMany } = fakeDb([
      { moduleKey: "tasks", isAvailable: true, isEnabled: true },
    ]);
    await resolveModules(db, "org-1");
    await invalidateOrgModules("org-1");
    await resolveModules(db, "org-1");
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("cacher ikke en org uden modul-rækker", async () => {
    const { db, findMany } = fakeDb([]);
    await resolveModules(db, "org-ny");
    await resolveModules(db, "org-ny");
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("applyBundle rydder orgens cache", async () => {
    const { db, findMany } = fakeDb([
      { moduleKey: "tasks", isAvailable: true, isEnabled: true },
    ]);
    await resolveModules(db, "org-1");
    await applyBundle(db, "org-1", ["tasks"]);
    await resolveModules(db, "org-1");
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
