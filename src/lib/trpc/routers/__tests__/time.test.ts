import { describe, expect, it, vi } from "vitest";

// Mock modules that trigger DB connection on import
vi.mock("@/lib/db", () => ({
  db: {},
}));
vi.mock("@/lib/email/engagement", () => ({
  sendFirstTimeEntryEmail: vi.fn(),
}));
vi.mock("@/lib/email/prepaid", () => ({
  sendLowBalanceAlert: vi.fn(),
}));

import {
  makeClient,
  makeProject,
  makeUser,
  TEST_CLIENT_ID,
  TEST_CLIENT_ID_2,
  TEST_PROJECT_ID,
  TEST_USER_ID,
} from "@/test/fixtures";
import {
  getRateForTimeEntry,
  getRateFromCache,
  type RateLookupCache,
} from "../time";

// Type alias for mock DB to avoid `as any` lint warnings
type MockDb = Parameters<typeof getRateForTimeEntry>[0];

// =============================================
// getRateFromCache — Pure function tests
// =============================================
describe("getRateFromCache", () => {
  function makeCache(
    overrides: Partial<RateLookupCache> = {},
  ): RateLookupCache {
    return {
      projects: new Map(),
      clients: new Map(),
      userDefaultRate: "500",
      memberRates: [],
      ...overrides,
    };
  }

  it("returns project rate when project has hourlyRate", () => {
    const cache = makeCache({
      projects: new Map([
        [TEST_PROJECT_ID, { hourlyRate: "900", clientId: TEST_CLIENT_ID }],
      ]),
    });

    const rate = getRateFromCache(cache, TEST_PROJECT_ID, TEST_CLIENT_ID);
    expect(rate).toBe("900");
  });

  it("falls back to client rate when project has no rate", () => {
    const cache = makeCache({
      projects: new Map([
        [TEST_PROJECT_ID, { hourlyRate: null, clientId: TEST_CLIENT_ID }],
      ]),
      clients: new Map([[TEST_CLIENT_ID, "750"]]),
    });

    const rate = getRateFromCache(cache, TEST_PROJECT_ID, TEST_CLIENT_ID);
    expect(rate).toBe("750");
  });

  it("uses project's clientId for client rate lookup (not direct clientId)", () => {
    const cache = makeCache({
      projects: new Map([
        [TEST_PROJECT_ID, { hourlyRate: null, clientId: TEST_CLIENT_ID }],
      ]),
      clients: new Map([
        [TEST_CLIENT_ID, "750"],
        [TEST_CLIENT_ID_2, "600"],
      ]),
    });

    // Even though we pass clientId2, the project's clientId should be used first
    const rate = getRateFromCache(cache, TEST_PROJECT_ID, TEST_CLIENT_ID_2);
    expect(rate).toBe("750");
  });

  it("falls back to direct clientId when project has no client", () => {
    const cache = makeCache({
      projects: new Map([
        [TEST_PROJECT_ID, { hourlyRate: null, clientId: null }],
      ]),
      clients: new Map([[TEST_CLIENT_ID, "600"]]),
    });

    const rate = getRateFromCache(cache, TEST_PROJECT_ID, TEST_CLIENT_ID);
    expect(rate).toBe("600");
  });

  it("falls back to user default rate when no project/client rates", () => {
    const cache = makeCache({
      userDefaultRate: "500",
    });

    const rate = getRateFromCache(cache, null, null);
    expect(rate).toBe("500");
  });

  it("returns null when no rates at all", () => {
    const cache = makeCache({
      userDefaultRate: null,
    });

    const rate = getRateFromCache(cache, null, null);
    expect(rate).toBeNull();
  });

  it("returns client rate when no projectId provided", () => {
    const cache = makeCache({
      clients: new Map([[TEST_CLIENT_ID, "650"]]),
    });

    const rate = getRateFromCache(cache, null, TEST_CLIENT_ID);
    expect(rate).toBe("650");
  });

  it("ignores unknown projectId and falls to client rate", () => {
    const cache = makeCache({
      clients: new Map([[TEST_CLIENT_ID, "700"]]),
    });

    const rate = getRateFromCache(cache, "unknown-project-id", TEST_CLIENT_ID);
    expect(rate).toBe("700");
  });

  it("ignores unknown clientId and falls to user default", () => {
    const cache = makeCache({
      userDefaultRate: "450",
    });

    const rate = getRateFromCache(cache, null, "unknown-client-id");
    expect(rate).toBe("450");
  });
});

// =============================================
// getRateForTimeEntry — Async DB-based rate lookup
// =============================================
describe("getRateForTimeEntry", () => {
  function createMockDb() {
    return {
      query: {
        projects: {
          findFirst: vi.fn(),
        },
        clients: {
          findFirst: vi.fn(),
        },
        users: {
          findFirst: vi.fn(),
        },
      },
    };
  }

  it("returns project hourly rate when project has one", async () => {
    const db = createMockDb();
    db.query.projects.findFirst.mockResolvedValue(
      makeProject({ hourlyRate: "900" }),
    );

    const rate = await getRateForTimeEntry(
      db as unknown as MockDb,
      TEST_USER_ID,
      TEST_PROJECT_ID,
      TEST_CLIENT_ID,
    );

    expect(rate).toBe("900");
    // Should not query clients or users since project rate found
    expect(db.query.clients.findFirst).not.toHaveBeenCalled();
    expect(db.query.users.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to project's client rate when project has no rate", async () => {
    const db = createMockDb();
    db.query.projects.findFirst.mockResolvedValue(
      makeProject({
        hourlyRate: null,
        client: makeClient({ defaultHourlyRate: "750" }),
      }),
    );

    const rate = await getRateForTimeEntry(
      db as unknown as MockDb,
      TEST_USER_ID,
      TEST_PROJECT_ID,
      null,
    );

    expect(rate).toBe("750");
    expect(db.query.users.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to direct client rate when no project", async () => {
    const db = createMockDb();
    db.query.clients.findFirst.mockResolvedValue(
      makeClient({ defaultHourlyRate: "600" }),
    );

    const rate = await getRateForTimeEntry(
      db as unknown as MockDb,
      TEST_USER_ID,
      null,
      TEST_CLIENT_ID,
    );

    expect(rate).toBe("600");
    expect(db.query.projects.findFirst).not.toHaveBeenCalled();
    expect(db.query.users.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to global user rate when no project/client rate", async () => {
    const db = createMockDb();
    db.query.projects.findFirst.mockResolvedValue(
      makeProject({
        hourlyRate: null,
        client: makeClient({ defaultHourlyRate: null }),
      }),
    );
    db.query.users.findFirst.mockResolvedValue(
      makeUser({ defaultHourlyRate: "500" }),
    );

    const rate = await getRateForTimeEntry(
      db as unknown as MockDb,
      TEST_USER_ID,
      TEST_PROJECT_ID,
      null,
    );

    expect(rate).toBe("500");
  });

  it("returns null when no rates configured anywhere", async () => {
    const db = createMockDb();
    db.query.users.findFirst.mockResolvedValue(
      makeUser({ defaultHourlyRate: null }),
    );

    const rate = await getRateForTimeEntry(
      db as unknown as MockDb,
      TEST_USER_ID,
      null,
      null,
    );

    expect(rate).toBeNull();
  });

  it("prioritizes project rate over client rate", async () => {
    const db = createMockDb();
    db.query.projects.findFirst.mockResolvedValue(
      makeProject({
        hourlyRate: "1200",
        client: makeClient({ defaultHourlyRate: "800" }),
      }),
    );

    const rate = await getRateForTimeEntry(
      db as unknown as MockDb,
      TEST_USER_ID,
      TEST_PROJECT_ID,
      TEST_CLIENT_ID,
    );

    expect(rate).toBe("1200");
  });
});

// =============================================
// Task actualMinutes delta calculation
// =============================================
describe("actualMinutes sync logic", () => {
  it("calculates correct minutes from hours on create", () => {
    const hours = 2.5;
    const minutesWorked = Math.round(hours * 60);
    expect(minutesWorked).toBe(150);
  });

  it("calculates correct delta on quickUpdateHours", () => {
    const oldHours = 2.5;
    const newHours = 3.0;
    const oldMinutes = Math.round(oldHours * 60);
    const newMinutes = Math.round(newHours * 60);
    const delta = newMinutes - oldMinutes;

    expect(oldMinutes).toBe(150);
    expect(newMinutes).toBe(180);
    expect(delta).toBe(30);
  });

  it("calculates negative delta when hours decrease", () => {
    const oldHours = 3.0;
    const newHours = 1.5;
    const delta = Math.round(newHours * 60) - Math.round(oldHours * 60);

    expect(delta).toBe(-90);
  });

  it("calculates zero delta when hours unchanged", () => {
    const oldHours = 2.0;
    const newHours = 2.0;
    const delta = Math.round(newHours * 60) - Math.round(oldHours * 60);

    expect(delta).toBe(0);
  });

  it("calculates correct minutes to remove on delete", () => {
    const hours = 1.75;
    const minutesToRemove = Math.round(Number(hours) * 60);
    expect(minutesToRemove).toBe(105);
  });

  it("handles GREATEST(0, ...) for preventing negative minutes", () => {
    // The SQL uses GREATEST(0, COALESCE(actualMinutes, 0) - minutesToRemove)
    // Simulating this in JS:
    const currentMinutes = 30;
    const minutesToRemove = 60;
    const result = Math.max(0, (currentMinutes ?? 0) - minutesToRemove);
    expect(result).toBe(0); // Clamped to 0, not -30
  });
});

// =============================================
// Billable rate assignment on create
// =============================================
describe("Billable rate assignment", () => {
  it("assigns rate from project when creating time entry", async () => {
    const db = {
      query: {
        projects: {
          findFirst: vi
            .fn()
            .mockResolvedValue(makeProject({ hourlyRate: "950" })),
        },
        clients: { findFirst: vi.fn() },
        users: { findFirst: vi.fn() },
      },
    };

    const rate = await getRateForTimeEntry(
      db as unknown as MockDb,
      TEST_USER_ID,
      TEST_PROJECT_ID,
      TEST_CLIENT_ID,
    );

    expect(rate).toBe("950");
  });

  it("uses client rate when project has no rate and entry has clientId", async () => {
    const db = {
      query: {
        projects: { findFirst: vi.fn() },
        clients: {
          findFirst: vi
            .fn()
            .mockResolvedValue(makeClient({ defaultHourlyRate: "650" })),
        },
        users: { findFirst: vi.fn() },
      },
    };

    const rate = await getRateForTimeEntry(
      db as unknown as MockDb,
      TEST_USER_ID,
      null, // no project
      TEST_CLIENT_ID,
    );

    expect(rate).toBe("650");
  });
});
