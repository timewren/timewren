/**
 * Enhedstests for publicPortal-routerens adgangskontrol.
 *
 * Fokus: et token-link må kun kunne give adgang til netop det tokens kunde,
 * og en session må kun kunne beskrive den adgang den blev udstedt til.
 *
 * Databasen er en lille fake der læser parameter-værdierne ud af Drizzles
 * where-udtryk, så opslagene faktisk testes på den nøgle de slår op med.
 */

import { TRPCError } from "@trpc/server";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "@/lib/security/token-hash";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));

vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));

vi.mock("@/lib/utils/rate-limiter", () => ({
  getClientIp: () => "127.0.0.1",
  ipRateLimitKey: (ip: string, action: string) => `${ip}:${action}`,
  rateLimiter: { checkOrThrow: vi.fn().mockResolvedValue(undefined) },
}));

import { publicPortalRouter } from "../publicPortal";

// ---------------------------------------------------------------------------
// Fake DB
// ---------------------------------------------------------------------------

/** Samler alle bundne parameter-værdier fra et Drizzle where-udtryk. */
function whereParams(node: unknown, out: unknown[] = []): unknown[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) whereParams(child, out);
    return out;
  }
  const obj = node as Record<string, unknown>;
  if ("queryChunks" in obj) return whereParams(obj.queryChunks, out);
  if ("value" in obj) out.push(obj.value);
  return out;
}

/**
 * Rækker gemmer kun hashen (#713/#726). `legacyPlaintext` simulerer en række
 * der aldrig blev backfilled: klartekst i den gamle kolonne og ingen hash —
 * mock-DB'en matcher stadig på klartekst, så testene beviser at opslaget
 * ikke længere sender klarteksten med.
 */
function makeAccess(suffix: string, { legacyPlaintext = false } = {}) {
  return {
    id: `access-${suffix}`,
    legacyAccessToken: legacyPlaintext ? `token-${suffix}` : null,
    accessTokenHash: legacyPlaintext ? null : hashToken(`token-${suffix}`),
    clientId: `client-${suffix}`,
    freelancerId: `freelancer-${suffix}`,
    isActive: true,
    accessCount: 3,
    canViewInvoices: true,
    canViewProjects: true,
    canViewTimeEntries: true,
    canViewPrepaid: true,
    canApproveTime: false,
    canDownloadInvoices: true,
    client: {
      id: `client-${suffix}`,
      name: `Kunde ${suffix}`,
      organizationId: null,
    },
    freelancer: { id: `freelancer-${suffix}`, name: "Freelanceren" },
  };
}

const ACCESS_A = makeAccess("a");
const ACCESS_B = makeAccess("b");
const ACCESS_LEGACY = makeAccess("legacy", { legacyPlaintext: true });

type Session = {
  legacySessionToken?: string | null;
  sessionTokenHash: string | null;
  expiresAt: Date;
  portalAccess: ReturnType<typeof makeAccess>;
};

const insertedSessions: { table: string; values: Record<string, unknown> }[] =
  [];

function makeDb(sessions: Session[] = []) {
  const chain = {
    set: () => chain,
    where: () => Promise.resolve(undefined),
  };
  return {
    query: {
      clientPortalAccess: {
        findFirst: vi.fn(async ({ where }: { where: unknown }) => {
          const params = whereParams(where);
          return (
            [ACCESS_A, ACCESS_B, ACCESS_LEGACY].find(
              (a) =>
                (a.legacyAccessToken && params.includes(a.legacyAccessToken)) ||
                (a.accessTokenHash && params.includes(a.accessTokenHash)),
            ) ?? undefined
          );
        }),
      },
      clientPortalSessions: {
        findFirst: vi.fn(async ({ where }: { where: unknown }) => {
          const params = whereParams(where);
          return sessions.find(
            (s) =>
              (s.legacySessionToken && params.includes(s.legacySessionToken)) ||
              (s.sessionTokenHash && params.includes(s.sessionTokenHash)),
          );
        }),
      },
      portalBranding: {
        findFirst: vi.fn(async () => undefined),
      },
    },
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        insertedSessions.push({ table: String(table), values });
      }),
    })),
    update: vi.fn(() => chain),
  };
}

function caller(db: ReturnType<typeof makeDb>) {
  return publicPortalRouter.createCaller({
    db,
    headers: new Headers(),
    session: null,
  } as never);
}

beforeEach(() => {
  insertedSessions.length = 0;
});

// ---------------------------------------------------------------------------

describe("publicPortal.validateToken", () => {
  it("afviser et ukendt token", async () => {
    await expect(
      caller(makeDb()).validateToken({ token: "findes-ikke" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("returnerer den kunde token'et hører til", async () => {
    const result = await caller(makeDb()).validateToken({
      token: "token-a",
    });
    expect(result.access.id).toBe(ACCESS_A.id);
    expect(result.access.clientId).toBe(ACCESS_A.clientId);
    expect(result.access.clientName).toBe(ACCESS_A.client.name);
    expect(result.sessionToken).toEqual(expect.any(String));
  });

  it("giver to forskellige tokens hver sin kunde og session", async () => {
    const a = await caller(makeDb()).validateToken({
      token: "token-a",
    });
    const b = await caller(makeDb()).validateToken({
      token: "token-b",
    });
    expect(a.access.clientId).not.toBe(b.access.clientId);
    expect(a.sessionToken).not.toBe(b.sessionToken);
  });

  it("binder den nye session til det validerede access-id", async () => {
    await caller(makeDb()).validateToken({ token: "token-b" });
    const session = insertedSessions.find(
      (row) => "sessionTokenHash" in row.values,
    );
    expect(session?.values.portalAccessId).toBe(ACCESS_B.id);
  });

  it("finder ikke et link der kun har klartekst — ingen fallback (#726)", async () => {
    const db = makeDb();
    await expect(
      caller(db).validateToken({ token: "token-legacy" }),
    ).rejects.toBeInstanceOf(TRPCError);
    const [{ where }] = db.query.clientPortalAccess.findFirst.mock.calls[0];
    expect(whereParams(where)).not.toContain("token-legacy");
  });

  it("gemmer kun hashen af det nye session-token (#713)", async () => {
    const result = await caller(makeDb()).validateToken({
      token: "token-a",
    });
    const session = insertedSessions.find(
      (row) => "sessionTokenHash" in row.values,
    );
    expect(session?.values.sessionTokenHash).toBe(
      hashToken(result.sessionToken),
    );
    expect(session?.values).not.toHaveProperty("sessionToken");
  });
});

describe("publicPortal.validateSession", () => {
  const sessionA: Session = {
    sessionTokenHash: hashToken("session-a"),
    expiresAt: new Date(Date.now() + 60_000),
    portalAccess: ACCESS_A,
  };

  it("melder ugyldig for en ukendt session", async () => {
    const result = await caller(makeDb([sessionA])).validateSession({
      sessionToken: "findes-ikke",
    });
    expect(result.valid).toBe(false);
    expect("access" in result).toBe(false);
  });

  it("melder ugyldig når adgangen er deaktiveret", async () => {
    const revoked: Session = {
      ...sessionA,
      sessionTokenHash: hashToken("session-revoked"),
      portalAccess: { ...ACCESS_A, isActive: false },
    };
    const result = await caller(makeDb([revoked])).validateSession({
      sessionToken: "session-revoked",
    });
    expect(result.valid).toBe(false);
  });

  it("finder ikke en session der kun har klartekst — ingen fallback (#726)", async () => {
    const legacy: Session = {
      legacySessionToken: "session-legacy",
      sessionTokenHash: null,
      expiresAt: new Date(Date.now() + 60_000),
      portalAccess: ACCESS_B,
    };
    const result = await caller(makeDb([legacy])).validateSession({
      sessionToken: "session-legacy",
    });
    expect(result.valid).toBe(false);
  });

  it("beskriver kun den adgang sessionen blev udstedt til", async () => {
    const sessionB: Session = {
      sessionTokenHash: hashToken("session-b"),
      expiresAt: new Date(Date.now() + 60_000),
      portalAccess: ACCESS_B,
    };
    const db = makeDb([sessionA, sessionB]);
    const a = await caller(db).validateSession({ sessionToken: "session-a" });
    const b = await caller(db).validateSession({ sessionToken: "session-b" });
    expect(a.valid).toBe(true);
    expect(b.valid).toBe(true);
    expect(a.access?.clientName).toBe(ACCESS_A.client.name);
    expect(b.access?.clientName).toBe(ACCESS_B.client.name);
    expect(a.access?.id).not.toBe(b.access?.id);
  });
});

describe("publicPortal.getTimeReport", () => {
  /** Fake-db der også kan køre rapporten og gemmer tidspost-filteret. */
  function makeReportDb() {
    const base = makeDb();
    const timeEntriesFindMany = vi.fn(async (_args: { where: unknown }) => []);
    const db = {
      ...base,
      query: {
        ...base.query,
        clients: {
          findFirst: vi.fn(async () => ({
            organizationId: null,
            defaultBillable: true,
          })),
        },
        timeEntries: { findMany: timeEntriesFindMany },
      },
    };
    return { db, timeEntriesFindMany };
  }

  it("tager hele slutdagen med — også poster med klokkeslæt efter midnat", async () => {
    const { db, timeEntriesFindMany } = makeReportDb();
    await caller(db as never).getTimeReport({
      accessToken: "token-a",
      startDate: "2026-09-26",
      endDate: "2026-09-26",
    });

    const { where } = timeEntriesFindMany.mock.calls[0][0];
    const { sql, params } = new PgDialect().sqlToQuery(where as SQL);
    // Eksklusiv grænse på næste dags start i stedet for `<= slutdagens midnat`
    expect(sql).toContain('"time_entries"."date" >= $');
    expect(sql).toContain('"time_entries"."date" < $');
    expect(sql).not.toContain('"time_entries"."date" <= $');
    expect(params).toContain("2026-09-26T00:00:00.000Z");
    expect(params).toContain("2026-09-27T00:00:00.000Z");
  });
});

describe("publicPortal.getPrepaidUsage export", () => {
  const packageId = "00000000-0000-4000-8000-000000000001";
  function usageDb(allowed = true) {
    const db = makeDb();
    const rows = Array.from({ length: 150 }, (_, i) => ({
      id: `usage-${i}`,
      createdAt: new Date("2026-03-01"),
      hoursUsed: "1.25",
      valueUsed: "625",
      description: "Manuelt træk",
      timeEntry: null,
    }));
    return {
      ...db,
      query: {
        ...db.query,
        clients: { findFirst: vi.fn(async () => ({ organizationId: null })) },
        prepaidPackages: {
          findFirst: vi.fn(async () =>
            allowed ? { id: packageId } : undefined,
          ),
        },
        prepaidUsage: {
          findMany: vi.fn(async (opts: { limit?: number }) =>
            rows.slice(0, opts.limit),
          ),
        },
      },
    };
  }
  it("returns all 150 rows without exposing monetary values", async () => {
    const db = usageDb();
    const result = await caller(db).getPrepaidUsage({
      accessToken: "token-a",
      packageId,
    });
    expect(result).toHaveLength(150);
    expect(result[0]).not.toHaveProperty("valueUsed");
    const [{ where }] = db.query.prepaidPackages.findFirst.mock
      .calls[0] as unknown as [{ where: unknown }];
    expect(whereParams(where)).toEqual(
      expect.arrayContaining([
        packageId,
        ACCESS_A.clientId,
        ACCESS_A.freelancerId,
      ]),
    );
  });
  it("rejects a package outside the portal scope before reading usage", async () => {
    const db = usageDb(false);
    await expect(
      caller(db).getPrepaidUsage({ accessToken: "token-a", packageId }),
    ).rejects.toThrow("Klippekort ikke fundet");
    expect(db.query.prepaidUsage.findMany).not.toHaveBeenCalled();
  });
});

describe("publicPortal.getMyApprovalRequests", () => {
  function approvalDb() {
    const base = makeDb();
    const entry = (id: string, date: string, project: string) => ({
      id,
      description: `Opgave ${id}`,
      hours: "1.00",
      date: new Date(date),
      project: { name: project },
    });
    const allEntries = [
      entry("e3", "2026-10-03", "Projekt B"),
      entry("e2", "2026-10-02", "Projekt A"),
      entry("e1", "2026-10-01", "Projekt A"),
    ];
    const timeEntriesFindMany = vi.fn(async ({ where }: { where: unknown }) => {
      const params = whereParams(where);
      return allEntries.filter((e) => params.includes(e.id));
    });
    const db = {
      ...base,
      query: {
        ...base.query,
        clients: { findFirst: vi.fn(async () => ({ organizationId: null })) },
        timeApprovalRequests: {
          findMany: vi.fn(async () => [
            { id: "r1", entryIds: ["e1", "e3"] },
            { id: "r2", entryIds: ["e2"] },
            { id: "r3", entryIds: [] },
          ]),
        },
        timeEntries: { findMany: timeEntriesFindMany },
      },
    };
    return { db, timeEntriesFindMany };
  }

  it("henter posterne for alle anmodninger i ét opslag (ingen N+1)", async () => {
    const { db, timeEntriesFindMany } = approvalDb();
    const result = await caller(db as never).getMyApprovalRequests({
      accessToken: "token-a",
    });

    expect(timeEntriesFindMany).toHaveBeenCalledTimes(1);
    expect(result.map((r) => [r.id, r.entries.map((e) => e.id)])).toEqual([
      ["r1", ["e3", "e1"]],
      ["r2", ["e2"]],
      ["r3", []],
    ]);
    expect(result[0].entries[0]).toEqual({
      id: "e3",
      description: "Opgave e3",
      hours: "1.00",
      date: new Date("2026-10-03"),
      projectName: "Projekt B",
    });
  });
});
