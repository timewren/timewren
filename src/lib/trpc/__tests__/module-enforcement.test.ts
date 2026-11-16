/**
 * Integration tests for module enforcement on the guarded routers.
 *
 * Strategy:
 * - guardedRouter inserts the guard middleware AFTER isAuthed, so the chain
 *   is: withClientVersion → isAuthed → guard → resolver.
 * - isAuthed calls resolveModules via a dynamic await import() that is NOT
 *   intercepted by vi.mock. Module state comes from db.query.organizationModules.
 * - For "blocking" tests: the default callable Proxy returns [] for any query,
 *   so resolveModules produces all-disabled modules → guard throws FORBIDDEN.
 * - For the "allow" test: a DB proxy returns real module rows for
 *   organizationModules so resolveModules reports invoicing as enabled.
 * - The db mock uses a callable Proxy so real resolvers can run without errors.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ModuleKey } from "@/lib/modules/constants";
import { MODULE_KEYS } from "@/lib/modules/constants";
import type { ModulesContext } from "../routers/enterprise/middleware";

// ---------------------------------------------------------------------------
// Mock the database module so tests run without a real DB connection.
// Must be declared before any import that transitively imports @/lib/db.
// ---------------------------------------------------------------------------
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));

// ---------------------------------------------------------------------------
// Mock resolveModules so isAuthed (runs after guard passes) can resolve
// modules without hitting the real database.
// ---------------------------------------------------------------------------
vi.mock("../routers/enterprise/middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../routers/enterprise/middleware")>();
  return {
    ...actual,
    resolveModules: vi.fn(),
  };
});

// Mock Sentry to avoid side effects and keep tests clean
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModules(enabled: ModuleKey[]): ModulesContext {
  const raw = new Map<ModuleKey, { available: boolean; enabled: boolean }>();
  for (const key of MODULE_KEYS) {
    raw.set(key, {
      available: enabled.includes(key),
      enabled: enabled.includes(key),
    });
  }
  return {
    raw,
    isAvailable: (key) => raw.get(key)?.available ?? false,
    isEnabled: (key) => {
      const s = raw.get(key);
      return Boolean(s?.available && s?.enabled);
    },
  };
}

/**
 * Callable proxy that returns itself on any property access and returns
 * Promise.resolve([]) on any function call. This lets real resolvers call
 * db.query.anyTable.findMany(...) or db.query.anyTable.findFirst(...) without
 * throwing.
 */
function makeCallableProxy(): unknown {
  return new Proxy(() => Promise.resolve([]), {
    get: (_t, _prop) => makeCallableProxy(),
    apply: () => Promise.resolve([]),
  });
}

/**
 * Build a DB query proxy that returns all-disabled module rows for
 * organizationModules.findMany (so resolveModules doesn't fall back to
 * makePermissiveModules), and [] for everything else.
 */
function makeDisabledModulesQueryProxy(): unknown {
  const allDisabledRows = MODULE_KEYS.map((key) => ({
    moduleKey: key,
    isAvailable: false,
    isEnabled: false,
  }));

  const organizationModulesProxy = new Proxy(() => Promise.resolve([]), {
    get: (_t, prop) => {
      if (prop === "findMany") return () => Promise.resolve(allDisabledRows);
      return makeCallableProxy();
    },
    apply: () => Promise.resolve([]),
  });

  return new Proxy(() => Promise.resolve([]), {
    get: (_t, prop) => {
      if (prop === "organizationModules") return organizationModulesProxy;
      return makeCallableProxy();
    },
    apply: () => Promise.resolve([]),
  });
}

/**
 * Like makeDisabledModulesQueryProxy but enables specific modules.
 */
function makeEnabledModulesQueryProxy(enabled: ModuleKey[]): unknown {
  const rows = MODULE_KEYS.map((key) => ({
    moduleKey: key,
    isAvailable: enabled.includes(key),
    isEnabled: enabled.includes(key),
  }));

  const organizationModulesProxy = new Proxy(() => Promise.resolve([]), {
    get: (_t, prop) => {
      if (prop === "findMany") return () => Promise.resolve(rows);
      return makeCallableProxy();
    },
    apply: () => Promise.resolve([]),
  });

  return new Proxy(() => Promise.resolve([]), {
    get: (_t, prop) => {
      if (prop === "organizationModules") return organizationModulesProxy;
      return makeCallableProxy();
    },
    apply: () => Promise.resolve([]),
  });
}

/**
 * Build a mock context for testRouter.createCaller.
 *
 * Key design:
 * - `session.activeOrganizationId` is set so isAuthed skips the members
 *   DB lookup and goes straight to resolveModules.
 * - resolveModules in isAuthed calls db.query.organizationModules.findMany;
 *   the callable Proxy returns [] by default (all modules disabled).
 * - `modules` and `orgId` are pre-populated as fallback for any sub-middleware
 *   that reads ctx directly (e.g. organizationProcedure).
 */
function makeCtx(modules: ModulesContext, enabledModules?: ModuleKey[]) {
  return {
    session: {
      user: {
        id: "u_test",
        email: "test@test.local",
        name: "Test User",
        role: "user",
      },
      // isAuthed uses this to skip the members DB query
      activeOrganizationId: "org_test",
    },
    db: {
      query: enabledModules
        ? makeEnabledModulesQueryProxy(enabledModules)
        : makeDisabledModulesQueryProxy(),
      insert: () => ({
        values: () => ({ returning: () => Promise.resolve([]) }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({ returning: () => Promise.resolve([]) }),
        }),
      }),
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    },
    // Injected so the guard middleware can read it immediately (before isAuthed)
    modules,
    orgId: "org_test",
    headers: null,
  };
}

// ---------------------------------------------------------------------------
// Slim router with only the routers these tests call (#698).
//
// Importing the full appRouter pulls in every router's dependency tree
// (~7-8 s locally, past the 30 s hook timeout on a busy CI runner). The
// routes below are wired exactly like routers/index.ts — the "appRouter
// wiring" test at the bottom asserts that index.ts still matches, so a
// route losing its guard there is still caught.
// ---------------------------------------------------------------------------
const GUARDED_ROUTES = {
  clients: { module: "clients", routerName: "clientsRouter" },
  enterprise: { module: "enterprise", routerName: "enterpriseRouter" },
  invoices: { module: "invoicing", routerName: "invoicesRouter" },
  prepaid: { module: "klippekort", routerName: "prepaidRouter" },
  tasks: { module: "tasks", routerName: "tasksRouter" },
} as const satisfies Record<string, { module: ModuleKey; routerName: string }>;

async function buildTestRouter() {
  const [
    { router },
    { guardedRouter },
    { clientsRouter },
    { enterpriseRouter },
    { invoicesRouter },
    { prepaidRouter },
    { tasksRouter },
    { timeRouter },
  ] = await Promise.all([
    import("../trpc"),
    import("../module-guard"),
    import("../routers/clients"),
    import("../routers/enterprise"),
    import("../routers/invoices"),
    import("../routers/prepaid"),
    import("../routers/tasks"),
    import("../routers/time"),
  ]);

  // guardedRouter splices the guard in AFTER isAuthed (one-time mutation),
  // so the chain is: withClientVersion → isAuthed → guard → resolver.
  return router({
    clients: guardedRouter(GUARDED_ROUTES.clients.module, clientsRouter),
    enterprise: guardedRouter(
      GUARDED_ROUTES.enterprise.module,
      enterpriseRouter,
    ),
    invoices: guardedRouter(GUARDED_ROUTES.invoices.module, invoicesRouter),
    prepaid: guardedRouter(GUARDED_ROUTES.prepaid.module, prepaidRouter),
    tasks: guardedRouter(GUARDED_ROUTES.tasks.module, tasksRouter),
    time: timeRouter,
  });
}

let testRouter: Awaited<ReturnType<typeof buildTestRouter>>;

beforeAll(async () => {
  // Note: resolveModules is mocked but the dynamic import() in isAuthed
  // bypasses vi.mock. Module state is controlled via db.query.organizationModules
  // rows instead. This seed is kept for legacy compatibility only.
  const { resolveModules } = await import("../routers/enterprise/middleware");
  vi.mocked(resolveModules).mockResolvedValue(makeModules([]));

  testRouter = await buildTestRouter();
}, 60_000 /* backstop for a busy CI runner; normally a few seconds */);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("module enforcement via guarded routers (integration)", () => {
  it("blocks invoices.list when invoicing is disabled", async () => {
    const { resolveModules } = await import("../routers/enterprise/middleware");
    vi.mocked(resolveModules).mockResolvedValue(makeModules([]));

    const caller = testRouter.createCaller(makeCtx(makeModules([])) as never);
    const err = await caller.invoices.list().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect((err as TRPCError).message).toMatch(/invoicing/);
  }, 15_000);

  it("blocks prepaid.list when klippekort is disabled", async () => {
    const { resolveModules } = await import("../routers/enterprise/middleware");
    vi.mocked(resolveModules).mockResolvedValue(makeModules([]));

    const caller = testRouter.createCaller(makeCtx(makeModules([])) as never);
    const err = await caller.prepaid.list().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect((err as TRPCError).message).toMatch(/klippekort/);
  }, 15_000);

  it("blocks clients.list when clients is disabled", async () => {
    const { resolveModules } = await import("../routers/enterprise/middleware");
    vi.mocked(resolveModules).mockResolvedValue(makeModules([]));

    const caller = testRouter.createCaller(makeCtx(makeModules([])) as never);
    const err = await caller.clients.list().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect((err as TRPCError).message).toMatch(/clients/);
  });

  it("blocks enterprise.listMembers when enterprise module is disabled", async () => {
    const { resolveModules } = await import("../routers/enterprise/middleware");
    vi.mocked(resolveModules).mockResolvedValue(makeModules(["projects"]));

    const caller = testRouter.createCaller(
      makeCtx(makeModules(["projects"]), ["projects"]) as never,
    );
    const err = await caller.enterprise.listMembers().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect((err as TRPCError).message).toMatch(/enterprise/);
  });

  it("does NOT throw FORBIDDEN when invoicing IS enabled", async () => {
    const caller = testRouter.createCaller(
      makeCtx(makeModules(["invoicing"]), ["invoicing"]) as never,
    );
    const err = await caller.invoices.list().catch((e: unknown) => e);

    // The module guard must NOT block — any downstream DB/validation error is OK
    if (err instanceof TRPCError) {
      expect((err as TRPCError).code).not.toBe("FORBIDDEN");
    }
    // If it succeeded (guard passed + DB mock returned []), that's also fine
  });

  it("does NOT block time.list (always-on route, no guardedRouter)", async () => {
    const { resolveModules } = await import("../routers/enterprise/middleware");
    // All modules disabled — time is unguarded and must still proceed
    vi.mocked(resolveModules).mockResolvedValue(makeModules([]));

    const caller = testRouter.createCaller(makeCtx(makeModules([])) as never);
    const err = await caller.time.list().catch((e: unknown) => e);

    // Must NOT be FORBIDDEN from our module guard
    if (err instanceof TRPCError) {
      expect((err as TRPCError).code).not.toBe("FORBIDDEN");
    }
  });

  // Regression: subscribedProcedure used to skip isAuthed, leaving ctx.modules
  // undefined. guardedRouter then threw FORBIDDEN even when the module was
  // enabled in the DB. Fix: subscribedProcedure now chains isAuthed before
  // hasActiveSubscription, and hasActiveSubscription forwards full ctx.
  it("does NOT block tasks.reorder (subscribedProcedure) when tasks module IS enabled", async () => {
    const moduleRows = [
      { moduleKey: "tasks", isAvailable: true, isEnabled: true },
    ];
    const adminUserRow = { role: "admin" };
    const dbWithModules = {
      ...makeCtx(makeModules(["tasks"])).db,
      query: new Proxy(
        {},
        {
          get: (_t, prop: string | symbol) => {
            const key = String(prop);
            if (key === "organizationModules") {
              return {
                findMany: () => Promise.resolve(moduleRows),
                findFirst: () => Promise.resolve(moduleRows[0]),
              };
            }
            if (key === "users") {
              // hasActiveSubscription short-circuits on admin role, avoiding
              // the need to mock a subscription row.
              return {
                findFirst: () => Promise.resolve(adminUserRow),
              };
            }
            return makeCallableProxy();
          },
        },
      ),
    };

    const caller = testRouter.createCaller({
      ...makeCtx(makeModules(["tasks"])),
      db: dbWithModules,
    } as never);
    const err = await caller.tasks
      .reorder({
        taskId: "00000000-0000-0000-0000-000000000001",
        newStatus: "todo",
        newPosition: 0,
      })
      .catch((e: unknown) => e);

    // The module guard must NOT block. Downstream errors (task not found,
    // etc.) from the DB mock are acceptable — they prove the guard passed.
    if (err instanceof TRPCError) {
      expect((err as TRPCError).code).not.toBe("FORBIDDEN");
    }
  });
});

describe("appRouter wiring matches the slim test router", () => {
  // Reads routers/index.ts as text instead of importing it, so the guard
  // mapping stays covered without loading every router (#698).
  const indexSource = readFileSync(
    fileURLToPath(new URL("../routers/index.ts", import.meta.url)),
    "utf8",
  );

  for (const [route, { module, routerName }] of Object.entries(
    GUARDED_ROUTES,
  )) {
    it(`${route} is guarded by "${module}"`, () => {
      expect(indexSource).toContain(
        `${route}: guardedRouter("${module}", ${routerName}),`,
      );
    });
  }

  it("time is unguarded", () => {
    expect(indexSource).toContain("time: timeRouter,");
  });
});
