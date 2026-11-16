import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

import { dataExportRouter } from "@/lib/trpc/routers/dataExport";
import { authorizeOrgExportDownload, ORG_EXPORT_REQUEST_TYPE } from "../access";

// Fast nøgle: encryptSecret kaster uden ENCRYPTION_KEY.
process.env.ENCRYPTION_KEY = "c".repeat(64);

const ORG_A = "org-A";
const ORG_B = "org-B";
const ME = "user-me";

type Role = "owner" | "admin" | "member";

/**
 * Mock-db: `roles` er brugerens rolle pr. organisation. Dækker isAuthed
 * (aktiv org), requireOrgAdmin (rolle) og requestOrgExport (tæller + insert).
 */
function makeDb(opts: {
  roles: Record<string, Role>;
  activeOrg?: string;
  counts?: number[];
}) {
  const inserted: Record<string, unknown>[] = [];
  const counts = [...(opts.counts ?? [0, 0])];
  const db = {
    query: {
      sessions: {
        findFirst: async () => ({ activeOrganizationId: opts.activeOrg }),
      },
      members: {
        findFirst: async (args: { where: unknown }) => {
          // getOrgRole/resolveActiveOrgId filtrerer på user + org; mocken
          // læser org-id'et ud af drizzle-betingelsen.
          // Uden org i betingelsen er det resolveActiveOrgId's fallback til
          // brugerens eget medlemskab (#848).
          const orgId = findOrgId(args.where) ?? Object.keys(opts.roles)[0];
          const role = orgId ? opts.roles[orgId] : undefined;
          return role
            ? { id: `m-${orgId}`, role, organizationId: orgId }
            : undefined;
        },
      },
      organizationModules: { findMany: async () => [] },
      dataExportRequests: { findMany: async () => [] },
    },
    select: () => ({
      from: () => ({
        where: async () => [{ count: counts.shift() ?? 0 }],
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return {
          returning: async () => [
            { id: "req-1", status: "pending", expiresAt: v.expiresAt },
          ],
        };
      },
    }),
  };
  return { db: db as never, inserted };
}

/** Find et org-id (string-parameter der starter med "org-") i en drizzle-SQL. */
function findOrgId(node: unknown, seen = new Set<unknown>()): string | null {
  if (node === null || node === undefined || seen.has(node)) return null;
  if (typeof node === "string") return node.startsWith("org-") ? node : null;
  if (typeof node !== "object") return null;
  seen.add(node);
  const value = (node as { value?: unknown }).value;
  if (typeof value === "string" && value.startsWith("org-")) return value;
  for (const v of Object.values(node as Record<string, unknown>)) {
    const hit = findOrgId(v, seen);
    if (hit) return hit;
  }
  return null;
}

function caller(db: unknown, activeOrg: string | undefined = ORG_A) {
  return dataExportRouter.createCaller({
    session: {
      user: { id: ME, email: "me@test.local", name: "Mig" },
      activeOrganizationId: activeOrg,
    },
    db,
    headers: null,
  } as never);
}

describe("requestOrgExport: hvem må bestille", () => {
  it("afviser en medarbejder med FORBIDDEN", async () => {
    const { db, inserted } = makeDb({ roles: { [ORG_A]: "member" } });
    const err = await caller(db)
      .requestOrgExport()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect(inserted).toEqual([]);
  });

  it("lader en administrator bestille, låst til den aktive organisation", async () => {
    const { db, inserted } = makeDb({ roles: { [ORG_A]: "admin" } });
    const res = await caller(db).requestOrgExport();
    expect(res.status).toBe("pending");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      userId: ME,
      organizationId: ORG_A,
      requestType: ORG_EXPORT_REQUEST_TYPE,
      format: "zip",
    });
    // Linket gemmes kun som hash + krypteret, aldrig i klartekst.
    expect(inserted[0].downloadTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("en bruger uden organisation afvises (#848)", async () => {
    const { db, inserted } = makeDb({ roles: {} });
    const err = await caller(db, undefined)
      .requestOrgExport()
      .catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect((err as TRPCError).message).toMatch(
      /ikke medlem af en organisation/,
    );
    expect(inserted).toHaveLength(0);
  });

  it("rate-limit: én i gang ad gangen og højst 3 pr. døgn", async () => {
    const busy = makeDb({ roles: { [ORG_A]: "owner" }, counts: [1, 0] });
    const e1 = await caller(busy.db)
      .requestOrgExport()
      .catch((e: unknown) => e);
    expect((e1 as TRPCError).code).toBe("TOO_MANY_REQUESTS");

    const many = makeDb({ roles: { [ORG_A]: "owner" }, counts: [0, 3] });
    const e2 = await caller(many.db)
      .requestOrgExport()
      .catch((e: unknown) => e);
    expect((e2 as TRPCError).code).toBe("TOO_MANY_REQUESTS");
    expect(many.inserted).toEqual([]);
  });
});

describe("authorizeOrgExportDownload: hvem må hente", () => {
  const request = { userId: ME, organizationId: ORG_A };

  it("ejer og administrator af organisationen må hente deres egen eksport", async () => {
    for (const role of ["owner", "admin"] as const) {
      const { db } = makeDb({ roles: { [ORG_A]: role } });
      expect(await authorizeOrgExportDownload(db, ME, request)).toEqual({
        ok: true,
      });
    }
  });

  it("en medarbejder får 403", async () => {
    const { db } = makeDb({ roles: { [ORG_A]: "member" } });
    const d = await authorizeOrgExportDownload(db, ME, request);
    expect(d.ok).toBe(false);
  });

  it("en administrator, der er sat ned siden bestillingen, får 403", async () => {
    const { db } = makeDb({ roles: { [ORG_A]: "member", [ORG_B]: "owner" } });
    expect((await authorizeOrgExportDownload(db, ME, request)).ok).toBe(false);
  });

  it("ejeren af en anden organisation kan aldrig hente den", async () => {
    // Brugeren er ejer i org B, men ikke medlem af org A.
    const { db } = makeDb({ roles: { [ORG_B]: "owner" } });
    expect((await authorizeOrgExportDownload(db, ME, request)).ok).toBe(false);
  });

  it("en anden bruger kan ikke hente din eksport, heller ikke som ejer", async () => {
    const { db } = makeDb({ roles: { [ORG_A]: "owner" } });
    const d = await authorizeOrgExportDownload(db, "en-anden", request);
    expect(d.ok).toBe(false);
  });

  it("en solo-eksport (uden org) kan kun hentes af brugeren selv", async () => {
    const { db } = makeDb({ roles: {} });
    const solo = { userId: ME, organizationId: null };
    expect((await authorizeOrgExportDownload(db, ME, solo)).ok).toBe(true);
    expect((await authorizeOrgExportDownload(db, "en-anden", solo)).ok).toBe(
      false,
    );
  });
});
