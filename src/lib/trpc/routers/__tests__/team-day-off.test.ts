import { expect, it, vi } from "vitest";

vi.mock("../../trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { router: t.router };
});
vi.mock("../enterprise/middleware", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return {
    orgManagerProcedure: t.procedure,
    orgManagerReadProcedure: t.procedure,
  };
});
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/enterprise/scope", () => ({
  getVisibleScope: async () => ({}),
  profileScopeCondition: () => undefined,
}));
vi.mock("@/lib/holidays/load", () => ({
  loadDayOffLookupsForUsers: async () =>
    new Map([
      [
        "employee",
        (date: string) => (date === "2026-11-03" ? { isHalfDay: true } : null),
      ],
    ]),
}));

import { enterpriseTeamRouter } from "../enterprise/team";

it("teamoversigten fjerner den resterende halve norm ved godkendt fravær (#763)", async () => {
  const db = {
    query: {
      employeeProfiles: {
        findMany: async () => [
          {
            userId: "employee",
            weeklyHours: 37,
            workingDays: ["1", "2", "3", "4", "5"],
            departmentId: null,
          },
        ],
      },
      employmentPeriods: { findMany: async () => [] },
      timesheetWeeks: { findMany: async () => [] },
      absenceRequests: {
        findMany: async () => [
          {
            userId: "employee",
            startDate: "2026-11-03",
            endDate: "2026-11-03",
            absenceType: { name: "Ferie", color: "#123456" },
          },
        ],
      },
      organizations: { findFirst: async () => null },
    },
    select: () => ({
      from: () => ({ where: () => ({ groupBy: async () => [] }) }),
    }),
  };
  const caller = enterpriseTeamRouter.createCaller({
    db,
    orgId: "org",
    session: { user: { id: "manager" } },
  } as never);
  const result = await caller.getTeamWeekOverview({ weekStart: "2026-11-02" });
  expect(result.members[0].norm).toBe(29.6);
  expect(result.members[0].absenceByDay["2026-11-03"]).toEqual({
    name: "Ferie",
    color: "#123456",
  });
});
