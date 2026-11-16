import type { TRPCError } from "@trpc/server";
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
import {
  authorizeUserExportDownload,
  authorizeZipExportDownload,
  USER_EXPORT_REQUEST_TYPE,
} from "../access";

// Fast nøgle: encryptSecret kaster uden ENCRYPTION_KEY.
process.env.ENCRYPTION_KEY = "c".repeat(64);

const ORG_A = "org-A";
const ORG_B = "org-B";
const ME = "user-me";

type Role = "owner" | "admin" | "member";

/** Samme mock-db som access.test.ts: `roles` er brugerens rolle pr. org. */
function makeDb(opts: {
  roles: Record<string, Role>;
  activeOrg?: string;
  counts?: number[];
  rows?: Record<string, unknown>[];
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
      dataExportRequests: { findMany: async () => opts.rows ?? [] },
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

describe("requestUserExport: alle roller må bestille deres egne data", () => {
  it("en medarbejder kan bestille, låst til den aktive organisation og sig selv", async () => {
    const { db, inserted } = makeDb({ roles: { [ORG_A]: "member" } });
    const res = await caller(db).requestUserExport();
    expect(res.status).toBe("pending");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      userId: ME,
      organizationId: ORG_A,
      requestType: USER_EXPORT_REQUEST_TYPE,
      format: "zip",
    });
    // Linket gemmes kun som hash + krypteret, aldrig i klartekst.
    expect(inserted[0].downloadTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ejer og administrator kan også bestille deres egne data", async () => {
    for (const role of ["owner", "admin"] as const) {
      const { db, inserted } = makeDb({ roles: { [ORG_A]: role } });
      await caller(db).requestUserExport();
      expect(inserted[0]).toMatchObject({ userId: ME, organizationId: ORG_A });
    }
  });

  it("organisationen kommer fra sessionen: et org-id fra klienten ignoreres", async () => {
    const { db, inserted } = makeDb({
      roles: { [ORG_A]: "member", [ORG_B]: "owner" },
    });
    await (
      caller(db) as unknown as {
        requestUserExport: (i: unknown) => Promise<unknown>;
      }
    ).requestUserExport({ organizationId: ORG_B, userId: "en-anden" });
    expect(inserted[0]).toMatchObject({ userId: ME, organizationId: ORG_A });
  });

  it("en organisation, brugeren ikke er medlem af, bliver aldrig brugt (falder tilbage til brugerens egen)", async () => {
    // Sessionen påstår org A, men brugeren er kun medlem af org B.
    const { db, inserted } = makeDb({ roles: { [ORG_B]: "member" } });
    await caller(db, ORG_A).requestUserExport();
    expect(inserted[0].organizationId).not.toBe(ORG_A);
  });

  it("en bruger uden organisation afvises (#848)", async () => {
    const { db, inserted } = makeDb({ roles: {} });
    const err = await caller(db, undefined)
      .requestUserExport()
      .catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect((err as TRPCError).message).toMatch(
      /ikke medlem af en organisation/,
    );
    expect(inserted).toHaveLength(0);
  });

  it("kræver login", async () => {
    const { db } = makeDb({ roles: {} });
    const anon = dataExportRouter.createCaller({
      session: null,
      db,
      headers: null,
    } as never);
    const err = await anon.requestUserExport().catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("UNAUTHORIZED");
  });

  it("rate-limit som organisations-eksporten: én i gang ad gangen og højst 3 pr. døgn", async () => {
    const busy = makeDb({ roles: { [ORG_A]: "member" }, counts: [1, 0] });
    const e1 = await caller(busy.db)
      .requestUserExport()
      .catch((e: unknown) => e);
    expect((e1 as TRPCError).code).toBe("TOO_MANY_REQUESTS");

    const many = makeDb({ roles: { [ORG_A]: "member" }, counts: [0, 3] });
    const e2 = await caller(many.db)
      .requestUserExport()
      .catch((e: unknown) => e);
    expect((e2 as TRPCError).code).toBe("TOO_MANY_REQUESTS");
    expect(many.inserted).toEqual([]);
  });
});

describe("listUserExports", () => {
  it("viser kun download-link for færdige, ikke-udløbne eksporter", async () => {
    const { db } = makeDb({
      roles: { [ORG_A]: "member" },
      rows: [
        {
          id: "r1",
          status: "pending",
          createdAt: new Date(),
          processedAt: null,
          expiresAt: new Date(Date.now() + 1000),
          fileSizeBytes: null,
          downloadTokenEncrypted: null,
        },
      ],
    });
    const list = await caller(db).listUserExports();
    expect(list).toHaveLength(1);
    expect(list[0].downloadToken).toBeNull();
    expect(list[0]).not.toHaveProperty("downloadTokenEncrypted");
  });
});

describe("authorizeUserExportDownload: kun bestilleren, kun som medlem", () => {
  const request = { userId: ME, organizationId: ORG_A };

  it("en medarbejder må hente sin egen eksport", async () => {
    const { db } = makeDb({ roles: { [ORG_A]: "member" } });
    expect(await authorizeUserExportDownload(db, ME, request)).toEqual({
      ok: true,
    });
  });

  it("ejeren af organisationen må IKKE hente en medarbejders eksport", async () => {
    const { db } = makeDb({ roles: { [ORG_A]: "owner" } });
    const d = await authorizeUserExportDownload(db, "ejeren", request);
    expect(d).toMatchObject({ ok: false, status: 403 });
  });

  it("en anden bruger kan ikke hente din eksport", async () => {
    const { db } = makeDb({ roles: { [ORG_A]: "member" } });
    const d = await authorizeUserExportDownload(db, "en-anden", request);
    expect(d).toMatchObject({ ok: false, status: 403 });
  });

  it("en bruger, der er gået ud af organisationen, får 403", async () => {
    const { db } = makeDb({ roles: {} });
    const d = await authorizeUserExportDownload(db, ME, request);
    expect(d).toMatchObject({ ok: false, status: 403 });
  });

  it("en eksport uden organisation kan kun hentes af brugeren selv", async () => {
    const { db } = makeDb({ roles: {} });
    const solo = { userId: ME, organizationId: null };
    expect((await authorizeUserExportDownload(db, ME, solo)).ok).toBe(true);
    expect((await authorizeUserExportDownload(db, "en-anden", solo)).ok).toBe(
      false,
    );
  });

  it("reglen vælges efter eksporttype, og ukendte typer afvises", async () => {
    const { db } = makeDb({ roles: { [ORG_A]: "member" } });
    // Medlem uden admin-rolle: ok for bruger-eksport, afvist for org-eksport.
    expect(
      (
        await authorizeZipExportDownload(db, ME, {
          requestType: "user_full",
          ...request,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await authorizeZipExportDownload(db, ME, {
          requestType: "org_full",
          ...request,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await authorizeZipExportDownload(db, ME, {
          requestType: "gdpr_full",
          ...request,
        })
      ).ok,
    ).toBe(false);
  });
});
