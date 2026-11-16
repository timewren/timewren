import { describe, expect, it, vi } from "vitest";

vi.mock("../../trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { router: t.router };
});
vi.mock("../enterprise/middleware", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return {
    organizationProcedure: t.procedure,
    orgAdminProcedure: t.procedure,
    orgManagerProcedure: t.procedure,
  };
});
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/enterprise/employment", () => ({
  effectiveProfileAt: async () => null,
}));
vi.mock("@/lib/enterprise/flex", () => ({
  recalculateFlexDay: async () => undefined,
}));
vi.mock("@/lib/enterprise/work-settings", () => ({
  loadOrgWorkSettings: async () => null,
}));
vi.mock("@/lib/org-audit", () => ({ logOrgAudit: async () => undefined }));
vi.mock("@/lib/notifications/bus", () => ({
  notify: async () => undefined,
  resolveManagerRecipientIds: async () => [],
}));
vi.mock("@/lib/notifications/push", () => ({
  pushToUser: async () => undefined,
}));
vi.mock("@/lib/time/copenhagen", () => ({
  copenhagenToday: () => "2026-11-03",
}));
vi.mock("@/lib/holidays/load", () => ({
  loadDaysOff: async () => [
    { date: "2026-11-03", isHalfDay: true },
    { date: "2026-11-04", isHalfDay: false },
  ],
}));

vi.mock("@/lib/enterprise/vacation", async (original) => ({
  ...(await original<typeof import("@/lib/enterprise/vacation")>()),
  getVacationOrgSettings: async () => ({
    accrualMode: "monthly",
    defaultWeeklyHours: 40,
  }),
  lockVacationBalance: async () => ({ remainingDays: 10 }),
  getVacationOverdraft: async () => 0,
}));

import { enterpriseAbsenceRouter } from "../enterprise/absence";

function setup(hoursPerDay: number) {
  const absenceType = {
    id: "type",
    organizationId: "org",
    category: "sickness",
    requiresApproval: true,
    deductsVacation: true,
  };
  const request = {
    id: "request",
    userId: "employee",
    organizationId: "org",
    startDate: "2026-11-03",
    endDate: null,
    status: "pending",
    hoursPerDay: String(hoursPerDay),
    absenceType,
  };
  const values = vi.fn((data) => ({
    returning: async () => [{ ...request, ...data }],
  }));
  const set = vi.fn((data) => ({
    where: () => ({ returning: async () => [{ ...request, ...data }] }),
  }));
  const db = {
    query: {
      employeeProfiles: {
        findFirst: async () => ({
          userId: "employee",
          weeklyHours: 40,
          workingDays: ["1", "2", "3", "4", "5"],
        }),
      },
      absenceTypes: { findFirst: async () => absenceType },
      absenceRequests: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(request)
          .mockResolvedValue(null),
      },
    },
    insert: () => ({ values }),
    update: () => ({ set }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn(db),
  };
  const caller = enterpriseAbsenceRouter.createCaller({
    db,
    orgId: "org",
    orgRole: "member",
    session: { user: { id: "employee" } },
  } as never);
  return { caller, db, values, set };
}

describe.each(["createRequest", "reportWell"] as const)("%s", (operation) => {
  it.each([
    [2, "2026-11-03", 0.25],
    [4, "2026-11-03", 0.5],
    [2, "2026-11-05", 0.5],
    [6, "2026-11-03", 0.5],
    [4, "2026-11-05", 1],
    [6, "2026-11-05", 1.25],
  ])("%i timer til %s giver %s dage", async (hours, endDate, expected) => {
    const { caller, db } = setup(hours);
    if (operation === "createRequest") {
      db.query.absenceRequests.findFirst.mockReset().mockResolvedValue(null);
    }
    const result =
      operation === "createRequest"
        ? await caller.createRequest({
            absenceTypeId: "type",
            startDate: "2026-11-03",
            endDate,
            hoursPerDay: hours,
          })
        : await caller.reportWell({
            requestId: "request",
            lastSickDate: endDate,
          });
    expect(result.totalDays).toBe(String(expected));
    expect(result.deductedDays).toBe(String(expected));
  });
});
