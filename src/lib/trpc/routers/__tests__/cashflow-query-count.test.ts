/**
 * Cashflow-forecastet slog før op med tre forespørgsler pr. kunde med aktivt
 * klippekort (aktiv pakke, historik, 3-måneders forbrug). Testene kører den
 * RIGTIGE router gennem `createCaller` og tæller databasekaldene: antallet
 * må ikke vokse med antallet af kunder, og de beregnede klippekort-input til
 * forecastet må være de samme som før.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: vi.fn(async () => "org-cashflow"),
  resolveRequestedOrgId: vi.fn(async ({ orgId }: { orgId: string }) => orgId),
}));
vi.mock("../enterprise/middleware", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../enterprise/middleware")>()),
  resolveModules: vi.fn(async () => ({
    raw: new Map(),
    isAvailable: () => true,
    isEnabled: () => true,
  })),
}));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

const forecastInput = vi.hoisted(() => ({
  last: null as null | {
    activePrepaid: Array<{
      clientId: string;
      clientName: string;
      currentSaldoHours: number;
      avgHoursPerMonth: number;
      historicalPackages: Array<{
        priceExVat: number;
        hoursAtPurchase: number;
      }>;
    }>;
  },
}));
vi.mock("@/lib/cashflow/forecast", () => ({
  forecastCashflow: vi.fn((input: typeof forecastInput.last) => {
    forecastInput.last = input;
    return { weeks: [], totalExpected: 0, totalOverdue: 0 };
  }),
}));

import { cashflowRouter } from "../cashflow";

const USER = "user-cashflow";
const ORG = "org-cashflow";

const AUTH_ROWS = {
  users: { id: USER, role: "user" },
  subscriptions: {
    id: "sub-cashflow",
    userId: USER,
    organizationId: ORG,
    status: "active",
    planTier: "solo",
    trialEndsAt: new Date("2099-01-01T00:00:00Z"),
    pastDueSince: null,
  },
  members: { userId: USER, organizationId: ORG, role: "owner" },
} as const;

function stub(row: unknown) {
  return { findFirst: async () => row, findMany: async () => [row] };
}

function pkg(id: string, clientId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    clientId,
    client: { id: clientId, name: `Testkunde ${clientId} ApS` },
    isActive: true,
    isArchived: false,
    remainingHours: "10",
    totalHours: "20",
    totalValue: "16000",
    hourlyRate: "800",
    renewalBaseHours: null,
    purchaseDate: new Date("2026-03-01T00:00:00Z"),
    ...over,
  };
}

/** Tæller hvert kald, der rammer databasen (efter auth-opslagene). */
function makeDb(packages: ReturnType<typeof pkg>[], usage: unknown[]) {
  let calls = 0;
  const counted = <T>(rows: T) => {
    calls += 1;
    return rows;
  };
  const selectChain = () => {
    // Et rigtigt Promise-objekt med kæde-metoder, så `await` giver rækkerne.
    const chain: Promise<unknown> & Record<string, unknown> = Object.assign(
      Promise.resolve(counted(usage)),
      {} as Record<string, unknown>,
    );
    for (const m of ["from", "innerJoin", "where", "groupBy", "orderBy"]) {
      chain[m] = () => chain;
    }
    return chain;
  };
  const db = {
    select: selectChain,
    query: {
      users: stub(AUTH_ROWS.users),
      subscriptions: stub(AUTH_ROWS.subscriptions),
      members: stub(AUTH_ROWS.members),
      employeeProfiles: stub(undefined),
      invoices: { findMany: async () => counted([]) },
      prepaidPackages: {
        findMany: async (args: { where?: unknown; limit?: number }) => {
          counted(null);
          // Første kald er "aktive pakker" (med client-relation); resten er
          // historikken. Samme rækker dur til begge, filtreringen sker i SQL.
          return args.limit === undefined && "with" in args
            ? packages.filter((p) => p.isActive)
            : [...packages].sort(
                (a, b) => b.purchaseDate.getTime() - a.purchaseDate.getTime(),
              );
        },
      },
    },
  };
  return { db, calls: () => calls };
}

function caller(db: unknown) {
  return cashflowRouter.createCaller({
    db,
    session: { user: { id: USER } },
    headers: new Headers(),
  } as never);
}

describe("cashflow.getCashflowForecast — antal databasekald", () => {
  beforeEach(() => {
    forecastInput.last = null;
  });

  it("vokser ikke med antallet af kunder med aktivt klippekort", async () => {
    const one = makeDb(
      [pkg("p1", "c1")],
      [{ clientId: "c1", totalHoursUsed: "6" }],
    );
    await caller(one.db).getCashflowForecast();

    const many = makeDb(
      [
        pkg("p1", "c1"),
        pkg("p2", "c2"),
        pkg("p3", "c3"),
        pkg("p4", "c4"),
        pkg("p5", "c5"),
      ],
      ["c1", "c2", "c3", "c4", "c5"].map((clientId) => ({
        clientId,
        totalHoursUsed: "6",
      })),
    );
    await caller(many.db).getCashflowForecast();

    expect(many.calls()).toBe(one.calls());
  });

  it("giver samme klippekort-input: saldo, gennemsnit og historik pr. kunde", async () => {
    const { db } = makeDb(
      [
        pkg("a-old", "c1", {
          isActive: false,
          remainingHours: "0",
          purchaseDate: new Date("2025-01-01T00:00:00Z"),
          totalValue: "8000",
          totalHours: "10",
        }),
        pkg("a-new", "c1", { remainingHours: "4" }),
        pkg("a-big", "c1", { remainingHours: "9" }),
        pkg("b-new", "c2", {
          remainingHours: "2",
          renewalBaseHours: "5",
          hourlyRate: "900",
        }),
      ],
      [
        { clientId: "c1", totalHoursUsed: "9" },
        // c2 har intet forbrug de seneste tre måneder: ingen række.
      ],
    );

    await caller(db).getCashflowForecast();

    const byClient = new Map(
      forecastInput.last?.activePrepaid.map((p) => [p.clientId, p]),
    );
    const c1 = byClient.get("c1");
    const c2 = byClient.get("c2");

    // c1: pakken med flest timer tilbage vælges; 9 timer / 3 måneder.
    expect(c1?.currentSaldoHours).toBe(9);
    expect(c1?.avgHoursPerMonth).toBe(3);
    expect(c1?.clientName).toBe("Testkunde c1 ApS");
    expect(c1?.historicalPackages).toHaveLength(3);
    expect(c1?.historicalPackages.map((h) => h.priceExVat)).toEqual([
      // Nyeste først, som ORDER BY purchase_date DESC i databasen.
      16000, 16000, 8000,
    ]);

    // c2: periodisk pakke bruger grundtimer × sats, og intet forbrug giver 0.
    expect(c2?.currentSaldoHours).toBe(2);
    expect(c2?.avgHoursPerMonth).toBe(0);
    expect(c2?.historicalPackages.map((h) => h.priceExVat)).toEqual([4500]);
  });
});
