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
vi.mock("@/lib/modules/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/modules/cache")>()),
  invalidateOrgModules: vi.fn(async () => undefined),
}));
vi.mock("@/lib/enterprise/absence-defaults", () => ({
  ensureDefaultAbsenceTypes: vi.fn(async () => undefined),
}));

import { organizationRouter } from "../organization";

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

function makeDb(existing: { isAvailable: boolean; isEnabled: boolean }) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    query: {
      sessions: { findFirst: async () => ({ activeOrganizationId: "org-A" }) },
      members: {
        findFirst: async (args: { where: unknown }) =>
          orgIn(args.where)
            ? { id: "m", role: "owner", organizationId: "org-A" }
            : undefined,
      },
      organizationModules: {
        findMany: async () => [],
        findFirst: async () => ({
          id: "mod-1",
          moduleKey: "enterprise",
          enabledAt: null,
          ...existing,
        }),
      },
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
    },
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        return { where: async () => undefined };
      },
    }),
  };
  return { db: db as never, updates };
}

function caller(db: unknown) {
  return organizationRouter.createCaller({
    session: {
      user: { id: "user-me", email: "ejer@test.local", name: "Test Ejer" },
      activeOrganizationId: "org-A",
    },
    db,
    headers: new Headers(),
  } as never);
}

const BILLING_VARS = [
  "ALUNTA_API_KEY",
  "STRIPE_SECRET_KEY",
  "STORE_BILLING_ENABLED",
] as const;

describe("organization.setModuleEnabled (#1035: ingen billing-lås)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  for (const [label, env] of [
    ["uden billing-env (selvhost)", {}],
    [
      "med Cloud-env",
      {
        ALUNTA_API_KEY: "x",
        STRIPE_SECRET_KEY: "x",
        STORE_BILLING_ENABLED: "1",
      },
    ],
  ] as const) {
    it(`admin kan tænde et utilgængeligt enterprise-modul ${label}`, async () => {
      for (const k of BILLING_VARS) delete process.env[k];
      Object.assign(process.env, env);
      const { db, updates } = makeDb({ isAvailable: false, isEnabled: false });
      await expect(
        caller(db).setModuleEnabled({ moduleKey: "enterprise", enabled: true }),
      ).resolves.toEqual({ success: true });
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({ isEnabled: true, isAvailable: true });
    });
  }

  it("at slå fra rører ikke isAvailable", async () => {
    const { db, updates } = makeDb({ isAvailable: true, isEnabled: true });
    await caller(db).setModuleEnabled({
      moduleKey: "enterprise",
      enabled: false,
    });
    expect(updates[0]).toMatchObject({ isEnabled: false });
    expect(updates[0]).not.toHaveProperty("isAvailable");
  });
});
