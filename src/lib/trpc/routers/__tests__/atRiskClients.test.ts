import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeClient, TEST_CLIENT_ID, TEST_CLIENT_ID_2 } from "@/test/fixtures";

/**
 * Unit tests for getAtRiskClients logic.
 *
 * The tRPC procedure:
 * 1. Finds clients with at least one time entry (have history)
 * 2. Excludes clients whose last time entry is within `daysSilent` days
 * 3. Excludes archived clients
 * 4. Attaches recent revenue (6 months before last activity) and klippekort saldo
 * 5. Sorts by recent revenue desc
 */

const DAYS_SILENT = 60;
const FIXED_NOW = new Date("2026-08-02T00:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---- helpers that mirror the router logic ----

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function isSilent(lastDate: Date, daysSilent: number): boolean {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysSilent);
  return lastDate < cutoff;
}

/**
 * Core at-risk filter:
 * Given a list of time-entry rows with { clientId, lastDate },
 * returns clientIds that are silent (no entry within daysSilent days).
 * Clients with NO entries at all are not in the input, so they are excluded.
 */
function filterSilentClients(
  lastActivityRows: Array<{ clientId: string | null; lastDate: Date | null }>,
  daysSilent: number,
): string[] {
  return lastActivityRows
    .filter(
      (r): r is { clientId: string; lastDate: Date } =>
        r.clientId !== null &&
        r.lastDate !== null &&
        isSilent(r.lastDate, daysSilent),
    )
    .map((r) => r.clientId);
}

/**
 * Revenue in the 6 months before lastActivityDate for a given clientId.
 */
function computeRecentRevenue(
  clientId: string,
  lastActivityDate: Date,
  allInvoices: Array<{
    clientId: string | null;
    issueDate: Date;
    amount: string;
  }>,
): number {
  const windowStart = new Date(lastActivityDate);
  windowStart.setMonth(windowStart.getMonth() - 6);
  return allInvoices
    .filter(
      (inv) =>
        inv.clientId === clientId &&
        inv.issueDate >= windowStart &&
        inv.issueDate <= lastActivityDate,
    )
    .reduce((sum, inv) => sum + parseFloat(inv.amount), 0);
}

/**
 * Compute active prepaid hours remaining for a clientId.
 */
function computeActivePrepaidHours(
  clientId: string,
  packages: Array<{
    clientId: string;
    remainingHours: string;
    isActive: boolean;
    isArchived: boolean;
  }>,
): number {
  return packages
    .filter(
      (p) =>
        p.clientId === clientId &&
        p.isActive &&
        !p.isArchived &&
        parseFloat(p.remainingHours) > 0,
    )
    .reduce((sum, p) => sum + parseFloat(p.remainingHours), 0);
}

function buildAtRiskResult(
  silentClientIds: string[],
  clientRows: Array<{
    id: string;
    name: string;
    email: string | null;
    isArchived: boolean;
  }>,
  lastActivityMap: Map<string, Date>,
  allInvoices: Array<{
    clientId: string | null;
    issueDate: Date;
    amount: string;
  }>,
  allPackages: Array<{
    clientId: string;
    remainingHours: string;
    isActive: boolean;
    isArchived: boolean;
  }>,
) {
  const activeClients = clientRows.filter(
    (c) => silentClientIds.includes(c.id) && !c.isArchived,
  );
  const now = new Date();
  const result = activeClients.map((client) => {
    const lastActivityDate = lastActivityMap.get(client.id) ?? null;
    const daysSinceLastActivity = lastActivityDate
      ? Math.floor(
          (now.getTime() - lastActivityDate.getTime()) / (1000 * 60 * 60 * 24),
        )
      : 0;
    const recentRevenue = lastActivityDate
      ? computeRecentRevenue(client.id, lastActivityDate, allInvoices)
      : 0;
    const activePrepaidHours = computeActivePrepaidHours(
      client.id,
      allPackages,
    );
    return {
      clientId: client.id,
      clientName: client.name,
      clientEmail: client.email,
      lastActivityDate,
      daysSinceLastActivity,
      recentRevenue,
      activePrepaidHours,
    };
  });
  result.sort((a, b) => b.recentRevenue - a.recentRevenue);
  return result;
}

// ---- tests ----

describe("filterSilentClients", () => {
  it("client with no entries ever is not in lastActivityRows → excluded naturally", () => {
    // New client has no time entries → won't appear in lastActivityRows at all
    const lastActivityRows: Array<{
      clientId: string | null;
      lastDate: Date | null;
    }> = [];
    const result = filterSilentClients(lastActivityRows, DAYS_SILENT);
    expect(result).toHaveLength(0);
  });

  it("client with entry 30 days ago is NOT silent (within 60-day window)", () => {
    const rows = [{ clientId: TEST_CLIENT_ID, lastDate: daysAgo(30) }];
    const result = filterSilentClients(rows, DAYS_SILENT);
    expect(result).toHaveLength(0);
  });

  it("client with entry 70 days ago IS silent", () => {
    const rows = [{ clientId: TEST_CLIENT_ID, lastDate: daysAgo(70) }];
    const result = filterSilentClients(rows, DAYS_SILENT);
    expect(result).toEqual([TEST_CLIENT_ID]);
  });

  it("exactly on the cutoff (60 days ago) is NOT silent", () => {
    const rows = [{ clientId: TEST_CLIENT_ID, lastDate: daysAgo(60) }];
    const result = filterSilentClients(rows, DAYS_SILENT);
    // 60 days ago is exactly at the cutoff — not strictly less than cutoff
    expect(result).toHaveLength(0);
  });

  it("filters out rows with null clientId", () => {
    const rows = [
      { clientId: null, lastDate: daysAgo(80) },
      { clientId: TEST_CLIENT_ID, lastDate: daysAgo(70) },
    ];
    const result = filterSilentClients(rows, DAYS_SILENT);
    expect(result).toEqual([TEST_CLIENT_ID]);
  });
});

describe("archived clients are excluded", () => {
  it("archived client is removed even if silent", () => {
    const silentIds = [TEST_CLIENT_ID];
    const clientRows = [makeClient({ id: TEST_CLIENT_ID, isArchived: true })];
    const lastActivityMap = new Map([[TEST_CLIENT_ID, daysAgo(70)]]);
    const result = buildAtRiskResult(
      silentIds,
      clientRows,
      lastActivityMap,
      [],
      [],
    );
    expect(result).toHaveLength(0);
  });

  it("non-archived silent client is included", () => {
    const silentIds = [TEST_CLIENT_ID];
    const clientRows = [makeClient({ id: TEST_CLIENT_ID, isArchived: false })];
    const lastActivityMap = new Map([[TEST_CLIENT_ID, daysAgo(70)]]);
    const result = buildAtRiskResult(
      silentIds,
      clientRows,
      lastActivityMap,
      [],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].clientId).toBe(TEST_CLIENT_ID);
  });
});

describe("client with entry 70 days ago AND active klippekort", () => {
  it("is included and shows klippekort hours", () => {
    const silentIds = [TEST_CLIENT_ID];
    const clientRows = [makeClient({ id: TEST_CLIENT_ID, isArchived: false })];
    const lastActivityMap = new Map([[TEST_CLIENT_ID, daysAgo(70)]]);
    const packages = [
      {
        clientId: TEST_CLIENT_ID,
        remainingHours: "12",
        isActive: true,
        isArchived: false,
      },
    ];
    const result = buildAtRiskResult(
      silentIds,
      clientRows,
      lastActivityMap,
      [],
      packages,
    );
    expect(result).toHaveLength(1);
    expect(result[0].activePrepaidHours).toBe(12);
  });

  it("inactive klippekort are not counted", () => {
    const silentIds = [TEST_CLIENT_ID];
    const clientRows = [makeClient({ id: TEST_CLIENT_ID, isArchived: false })];
    const lastActivityMap = new Map([[TEST_CLIENT_ID, daysAgo(70)]]);
    const packages = [
      {
        clientId: TEST_CLIENT_ID,
        remainingHours: "12",
        isActive: false,
        isArchived: false,
      },
    ];
    const result = buildAtRiskResult(
      silentIds,
      clientRows,
      lastActivityMap,
      [],
      packages,
    );
    expect(result[0].activePrepaidHours).toBe(0);
  });
});

describe("recent revenue computation", () => {
  it("includes invoices in 6-month window before last activity", () => {
    const lastActivity = daysAgo(70);
    const windowStart = new Date(lastActivity);
    windowStart.setMonth(windowStart.getMonth() - 6);
    // Invoice 3 months before last activity → inside window
    const insideDate = new Date(lastActivity);
    insideDate.setMonth(insideDate.getMonth() - 3);
    // Invoice 7 months before last activity → outside window
    const outsideDate = new Date(lastActivity);
    outsideDate.setMonth(outsideDate.getMonth() - 7);

    const invoices = [
      { clientId: TEST_CLIENT_ID, issueDate: insideDate, amount: "5000" },
      { clientId: TEST_CLIENT_ID, issueDate: outsideDate, amount: "3000" },
    ];

    const revenue = computeRecentRevenue(
      TEST_CLIENT_ID,
      lastActivity,
      invoices,
    );
    expect(revenue).toBe(5000);
  });

  it("returns 0 for client with no invoices", () => {
    const revenue = computeRecentRevenue(TEST_CLIENT_ID, daysAgo(70), []);
    expect(revenue).toBe(0);
  });
});

describe("sort by recent revenue desc", () => {
  it("most valuable client appears first", () => {
    const silentIds = [TEST_CLIENT_ID, TEST_CLIENT_ID_2];
    const lastActivity1 = daysAgo(70);
    const lastActivity2 = daysAgo(80);
    const clientRows = [
      makeClient({ id: TEST_CLIENT_ID, name: "Lille ApS", isArchived: false }),
      makeClient({ id: TEST_CLIENT_ID_2, name: "Stor A/S", isArchived: false }),
    ];
    const lastActivityMap = new Map([
      [TEST_CLIENT_ID, lastActivity1],
      [TEST_CLIENT_ID_2, lastActivity2],
    ]);
    // CLIENT_2 has higher invoice amount
    const inv1Date = new Date(lastActivity1);
    inv1Date.setMonth(inv1Date.getMonth() - 1);
    const inv2Date = new Date(lastActivity2);
    inv2Date.setMonth(inv2Date.getMonth() - 1);
    const allInvoices = [
      { clientId: TEST_CLIENT_ID, issueDate: inv1Date, amount: "2000" },
      { clientId: TEST_CLIENT_ID_2, issueDate: inv2Date, amount: "15000" },
    ];

    const result = buildAtRiskResult(
      silentIds,
      clientRows,
      lastActivityMap,
      allInvoices,
      [],
    );
    expect(result[0].clientId).toBe(TEST_CLIENT_ID_2);
    expect(result[0].recentRevenue).toBe(15000);
    expect(result[1].clientId).toBe(TEST_CLIENT_ID);
    expect(result[1].recentRevenue).toBe(2000);
  });
});

describe("daysSinceLastActivity", () => {
  it("is approximately correct for 70-day old entry", () => {
    const silentIds = [TEST_CLIENT_ID];
    const clientRows = [makeClient({ id: TEST_CLIENT_ID, isArchived: false })];
    const lastActivityMap = new Map([[TEST_CLIENT_ID, daysAgo(70)]]);
    const result = buildAtRiskResult(
      silentIds,
      clientRows,
      lastActivityMap,
      [],
      [],
    );
    // Allow ±1 due to exact time-of-day differences
    expect(result[0].daysSinceLastActivity).toBeGreaterThanOrEqual(69);
    expect(result[0].daysSinceLastActivity).toBeLessThanOrEqual(71);
  });
});
